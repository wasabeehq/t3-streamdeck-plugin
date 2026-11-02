import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";

import { RpcClient } from "../src/t3/rpc.js";

type Received = Record<string, unknown>;

/** Fake T3 server: records every client message and connection. */
function fakeServer() {
  const wss = new WebSocketServer({ port: 0 });
  const received: Received[] = [];
  const authHeaders: (string | undefined)[] = [];
  const sockets: WebSocket[] = [];
  const waiters: { predicate: (m: Received) => boolean; resolve: (m: Received) => void }[] = [];
  wss.on("connection", (socket, req) => {
    sockets.push(socket);
    authHeaders.push(req.headers.authorization);
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as Received;
      received.push(message);
      for (const waiter of [...waiters]) {
        if (waiter.predicate(message)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    });
  });
  const port = (wss.address() as { port: number }).port;
  return {
    wss,
    received,
    authHeaders,
    sockets,
    url: `ws://127.0.0.1:${port}/ws?orchestrationProtocol=2`,
    next(predicate: (m: Received) => boolean): Promise<Received> {
      const found = received.find(predicate);
      if (found) return Promise.resolve(found);
      return new Promise((resolve) => waiters.push({ predicate, resolve }));
    },
    nextNew(predicate: (m: Received) => boolean): Promise<Received> {
      return new Promise((resolve) => waiters.push({ predicate, resolve }));
    },
    close: () => new Promise<void>((resolve) => wss.close(() => resolve())),
  };
}

let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

function setup() {
  const server = fakeServer();
  const client = new RpcClient({
    resolveEndpoint: async () => ({ wsUrl: server.url, token: "secret-token" }),
    initialBackoffMs: 10,
  });
  cleanup.push(() => server.close(), () => client.stop());
  return { server, client };
}

const isRequest = (tag: string) => (m: Received) => m._tag === "Request" && m.tag === tag;

describe("RpcClient", () => {
  it("sends the bearer token and requests with an empty headers array", async () => {
    const { server, client } = setup();
    client.start();
    const pending = new Promise((resolve) => client.onStatus((s) => s === "open" && resolve(s)));
    await pending;
    const result = client.request("server.refreshProviders", { fresh: true });
    const request = await server.next(isRequest("server.refreshProviders"));
    expect(server.authHeaders[0]).toBe("Bearer secret-token");
    expect(request.headers).toEqual([]);
    expect(request.payload).toEqual({ fresh: true });
    server.sockets[0]!.send(
      JSON.stringify({ _tag: "Exit", requestId: request.id, exit: { _tag: "Success", value: { providers: [] } } }),
    );
    await expect(result).resolves.toEqual({ providers: [] });
  });

  it("rejects a request when the server answers with a failure", async () => {
    const { server, client } = setup();
    client.start();
    await new Promise((resolve) => client.onStatus((s) => s === "open" && resolve(s)));
    const result = client.request("orchestration.dispatchCommand", { type: "thread.stop" });
    const request = await server.next(isRequest("orchestration.dispatchCommand"));
    server.sockets[0]!.send(
      JSON.stringify({
        _tag: "Exit",
        requestId: request.id,
        exit: { _tag: "Failure", cause: [{ _tag: "Fail", error: { _tag: "CommandRejected", message: "nope" } }] },
      }),
    );
    await expect(result).rejects.toThrow("CommandRejected: nope");
  });

  it("acks every chunk and handles several messages in one array frame", async () => {
    const { server, client } = setup();
    const values: unknown[] = [];
    client.subscribe("orchestration.subscribeShell", {}, (v) => values.push(v));
    client.start();
    const request = await server.next(isRequest("orchestration.subscribeShell"));
    const id = request.id;
    server.sockets[0]!.send(
      JSON.stringify([
        { _tag: "Chunk", requestId: id, values: [{ kind: "snapshot" }] },
        { _tag: "Chunk", requestId: id, values: [{ kind: "synchronized" }, { kind: "thread.updated" }] },
      ]),
    );
    await server.next((m) => m._tag === "Ack" && server.received.filter((r) => r._tag === "Ack").length === 2);
    expect(server.received.filter((m) => m._tag === "Ack")).toEqual([
      { _tag: "Ack", requestId: id },
      { _tag: "Ack", requestId: id },
    ]);
    expect(values).toEqual([{ kind: "snapshot" }, { kind: "synchronized" }, { kind: "thread.updated" }]);
  });

  it("resubscribes after the server drops the socket", async () => {
    const { server, client } = setup();
    const values: unknown[] = [];
    client.subscribe("subscribeServerConfig", {}, (v) => values.push(v));
    client.start();
    const first = await server.next(isRequest("subscribeServerConfig"));
    const second = server.nextNew(isRequest("subscribeServerConfig"));
    server.sockets[0]!.terminate();
    const again = await second;
    expect(server.sockets).toHaveLength(2);
    expect(again.id).not.toBe(first.id);
    expect(again.headers).toEqual([]);
    server.sockets[1]!.send(JSON.stringify({ _tag: "Chunk", requestId: again.id, values: [{ type: "snapshot" }] }));
    await server.next((m) => m._tag === "Ack" && m.requestId === again.id);
    expect(values).toEqual([{ type: "snapshot" }]);
  });

  it("sends pings and reconnects when pongs stop", async () => {
    const server = fakeServer();
    const client = new RpcClient({
      resolveEndpoint: async () => ({ wsUrl: server.url, token: "t" }),
      pingIntervalMs: 20,
      pongTimeoutMs: 60,
      initialBackoffMs: 10,
    });
    cleanup.push(() => server.close(), () => client.stop());
    client.start();
    await server.next((m) => m._tag === "Ping");
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (server.sockets.length >= 2) {
          clearInterval(timer);
          resolve();
        }
      }, 10);
    });
    expect(server.sockets.length).toBeGreaterThanOrEqual(2);
  });
});
