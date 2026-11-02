import WebSocket from "ws";

export type RpcEndpoint = { wsUrl: string; token: string };

export type RpcStatus = "connecting" | "open" | "closed";

export interface RpcLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface RpcClientOptions {
  /** Called before every connection attempt, so the server can be re-discovered. Null means "retry later". */
  resolveEndpoint: () => Promise<RpcEndpoint | null>;
  logger?: RpcLogger;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  requestTimeoutMs?: number;
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

type Subscription = {
  tag: string;
  payload: unknown;
  onValue: (value: unknown) => void;
  requestId: string | null;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const silentLogger: RpcLogger = { info: () => {}, warn: () => {} };

/** Turns the opaque Effect RPC failure cause into a short message. */
export function describeCause(cause: unknown): string {
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const inner = record.error ?? record.defect;
    if (inner && typeof inner === "object") {
      const err = inner as Record<string, unknown>;
      const label = [err._tag, err.message ?? err.detail ?? err.reason].filter((x) => typeof x === "string");
      if (label.length > 0) parts.push(label.join(": "));
    } else if (typeof inner === "string") {
      parts.push(inner);
    } else if (typeof record._tag === "string" && record._tag !== "Fail" && record._tag !== "Die") {
      parts.push(record._tag);
    }
  };
  visit(cause);
  return parts.join("; ") || "request failed";
}

/**
 * Minimal Effect RPC (JSON serialization) client over `ws`, with ping/pong liveness,
 * reconnect with backoff, and automatic re-subscription of streams.
 */
export class RpcClient {
  private socket: WebSocket | null = null;
  private status: RpcStatus = "closed";
  private stopped = true;
  private nextId = 1;
  private backoffMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;
  private readonly subscriptions = new Set<Subscription>();
  private readonly subsByRequestId = new Map<string, Subscription>();
  private readonly pending = new Map<string, Pending>();
  private readonly statusListeners = new Set<(status: RpcStatus) => void>();
  private readonly log: RpcLogger;
  private readonly opts: Required<Omit<RpcClientOptions, "logger" | "resolveEndpoint">>;

  constructor(private readonly options: RpcClientOptions) {
    this.log = options.logger ?? silentLogger;
    this.opts = {
      pingIntervalMs: options.pingIntervalMs ?? 5_000,
      pongTimeoutMs: options.pongTimeoutMs ?? 15_000,
      initialBackoffMs: options.initialBackoffMs ?? 1_000,
      maxBackoffMs: options.maxBackoffMs ?? 30_000,
      requestTimeoutMs: options.requestTimeoutMs ?? 20_000,
    };
    this.backoffMs = this.opts.initialBackoffMs;
  }

  get currentStatus(): RpcStatus {
    return this.status;
  }

  onStatus(listener: (status: RpcStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.backoffMs = this.opts.initialBackoffMs;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.teardownSocket();
    this.setStatus("closed");
  }

  /** Drops the current socket and reconnects immediately (e.g. after settings change). */
  restart(): void {
    this.stop();
    this.start();
  }

  subscribe(tag: string, payload: unknown, onValue: (value: unknown) => void): () => void {
    const sub: Subscription = { tag, payload, onValue, requestId: null };
    this.subscriptions.add(sub);
    if (this.status === "open") this.sendSubscription(sub);
    return () => {
      this.subscriptions.delete(sub);
      if (sub.requestId !== null) {
        this.subsByRequestId.delete(sub.requestId);
        this.send({ _tag: "Interrupt", requestId: sub.requestId });
        sub.requestId = null;
      }
    };
  }

  request<T = unknown>(tag: string, payload: unknown): Promise<T> {
    if (this.status !== "open") return Promise.reject(new RpcError("not connected"));
    const id = this.allocateId();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.send({ _tag: "Interrupt", requestId: id });
        reject(new RpcError(`${tag} timed out`));
      }, this.opts.requestTimeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send({ _tag: "Request", id, tag, payload, headers: [] });
    });
  }

  private allocateId(): string {
    return String(this.nextId++);
  }

  private setStatus(status: RpcStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.setStatus("connecting");
    let endpoint: RpcEndpoint | null = null;
    try {
      endpoint = await this.options.resolveEndpoint();
    } catch (error) {
      this.log.warn(`T3 endpoint resolution failed: ${String(error)}`);
    }
    if (this.stopped) return;
    if (!endpoint) {
      this.setStatus("closed");
      this.scheduleReconnect();
      return;
    }

    const socket = new WebSocket(endpoint.wsUrl, {
      headers: { Authorization: `Bearer ${endpoint.token}` },
      handshakeTimeout: 10_000,
    });
    this.socket = socket;

    socket.on("open", () => {
      if (this.socket !== socket) return;
      this.log.info(`Connected to T3 server ${new URL(endpoint.wsUrl).host}`);
      this.backoffMs = this.opts.initialBackoffMs;
      this.lastPongAt = Date.now();
      this.setStatus("open");
      this.startPing();
      for (const sub of this.subscriptions) this.sendSubscription(sub);
    });
    socket.on("message", (data, isBinary) => {
      if (this.socket !== socket || isBinary) return;
      this.handleFrame(data.toString());
    });
    socket.on("unexpected-response", (_req, res) => {
      this.log.warn(`T3 server refused the WebSocket upgrade (HTTP ${res.statusCode})`);
      socket.terminate();
    });
    socket.on("error", (error) => {
      if (this.socket === socket) this.log.warn(`T3 socket error: ${error.message}`);
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.teardownSocket();
      this.setStatus("closed");
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.opts.maxBackoffMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private teardownSocket(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners("message");
      socket.on("error", () => {});
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.terminate();
      }
    }
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new RpcError("connection lost"));
    }
    this.pending.clear();
    this.subsByRequestId.clear();
    for (const sub of this.subscriptions) sub.requestId = null;
  }

  private startPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastPongAt > this.opts.pongTimeoutMs) {
        this.log.warn("T3 server stopped answering pings, reconnecting");
        this.socket?.terminate();
        return;
      }
      this.send({ _tag: "Ping" });
    }, this.opts.pingIntervalMs);
  }

  private sendSubscription(sub: Subscription): void {
    const id = this.allocateId();
    sub.requestId = id;
    this.subsByRequestId.set(id, sub);
    this.send({ _tag: "Request", id, tag: sub.tag, payload: sub.payload, headers: [] });
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private handleFrame(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.log.warn("T3 server sent a non-JSON frame");
      return;
    }
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    for (const message of messages) {
      if (message && typeof message === "object") this.handleMessage(message as Record<string, unknown>);
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    this.lastPongAt = Date.now();
    const requestId = typeof message.requestId === "string" ? message.requestId : String(message.requestId ?? "");
    switch (message._tag) {
      case "Pong":
        return;
      case "Chunk": {
        const sub = this.subsByRequestId.get(requestId);
        this.send({ _tag: "Ack", requestId });
        if (!sub) return;
        const values = Array.isArray(message.values) ? message.values : [];
        for (const value of values) {
          try {
            sub.onValue(value);
          } catch (error) {
            this.log.warn(`T3 ${sub.tag} handler failed: ${String(error)}`);
          }
        }
        return;
      }
      case "Exit": {
        const exit = (message.exit ?? {}) as Record<string, unknown>;
        const pending = this.pending.get(requestId);
        if (pending) {
          this.pending.delete(requestId);
          clearTimeout(pending.timer);
          if (exit._tag === "Success") pending.resolve(exit.value);
          else pending.reject(new RpcError(describeCause(exit.cause), exit.cause));
          return;
        }
        const sub = this.subsByRequestId.get(requestId);
        if (sub) {
          this.subsByRequestId.delete(requestId);
          sub.requestId = null;
          this.log.warn(
            exit._tag === "Success"
              ? `T3 stream ${sub.tag} ended`
              : `T3 stream ${sub.tag} failed: ${describeCause(exit.cause)}`,
          );
        }
        return;
      }
      case "Defect":
      case "ClientProtocolError":
        this.log.warn(`T3 server reported ${String(message._tag)}`);
        return;
    }
  }
}
