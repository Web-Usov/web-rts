import { describe, expect, it } from "vitest";
import type { OpaqueResumeTokenStore } from "./resume-token-store.js";
import { RemoteGameTransport } from "./remote-game-transport.js";

function memoryStore(): OpaqueResumeTokenStore {
  let value: string | null = null;
  return {
    read: () => value,
    write: (token: string) => {
      value = token;
    },
    clear: () => {
      value = null;
    },
  };
}

describe("RemoteGameTransport resume", () => {
  it("reports absent when the tab has no resume token", async () => {
    const store = memoryStore();
    const transport = new RemoteGameTransport({
      defaultEndpoint: "http://127.0.0.1:9",
      resumeTokenStore: store,
    });
    await expect(transport.resumePreviousSession()).resolves.toEqual({ status: "absent" });
    expect(transport.hasResumeToken()).toBe(false);
  });

  it("clears an unusable token and does not require a new room", async () => {
    const store = memoryStore();
    store.write("not-a-valid-token");
    const notices: string[] = [];
    const transport = new RemoteGameTransport({
      defaultEndpoint: "http://127.0.0.1:9",
      resumeTokenStore: store,
    });
    transport.subscribeConnection((notice) => {
      notices.push(notice);
    });

    await expect(transport.resumePreviousSession()).resolves.toEqual({ status: "expired" });
    expect(store.read()).toBeNull();
    expect(notices).toEqual(["reconnecting", "expired"]);
    expect(transport.connectedRoomId).toBeNull();
  });

  it("reports RTT unavailable before a live room exists", () => {
    const transport = new RemoteGameTransport({
      defaultEndpoint: "http://127.0.0.1:9",
      resumeTokenStore: memoryStore(),
    });
    expect(transport.readRoundTripMs()).toBeNull();
  });

  it("clears RTT while the socket is dropped and samples again after reconnect", async () => {
    const resolvers: Array<(value: number) => void> = [];
    let samples = 0;
    const transport = new RemoteGameTransport({
      defaultEndpoint: "http://127.0.0.1:9",
      resumeTokenStore: memoryStore(),
      roundTripProbe: () =>
        new Promise((resolve) => {
          resolvers[samples] = resolve;
          samples += 1;
        }),
    });
    const notices: string[] = [];
    transport.subscribeConnection((notice) => {
      notices.push(notice);
    });

    const dropHandlers: Array<() => void> = [];
    const reconnectHandlers: Array<() => void> = [];
    const room = {
      roomId: "room-1",
      reconnectionToken: "room-1:token",
      reconnection: { minUptime: 0 },
      onMessage() {},
      onDrop(callback: () => void) {
        dropHandlers.push(callback);
      },
      onReconnect(callback: () => void) {
        reconnectHandlers.push(callback);
      },
      onLeave() {},
      send() {},
    };
    (transport as unknown as { attachRoom(liveRoom: typeof room): void }).attachRoom(room);

    resolvers[0]?.(15);
    await Promise.resolve();
    expect(transport.readRoundTripMs()).toBe(15);

    dropHandlers[0]?.();
    expect(transport.readRoundTripMs()).toBeNull();
    expect(notices).toEqual(["reconnecting"]);

    reconnectHandlers[0]?.();
    expect(transport.readRoundTripMs()).toBeNull();
    resolvers[1]?.(8);
    await Promise.resolve();
    expect(transport.readRoundTripMs()).toBe(8);
    await Promise.resolve();
    expect(notices).toEqual(["reconnecting", "reconnected"]);
  });

  it("clears the token on explicit disconnect without opening a socket", async () => {
    const store = memoryStore();
    store.write("room:opaque");
    const notices: string[] = [];
    const transport = new RemoteGameTransport({
      defaultEndpoint: "http://127.0.0.1:9",
      resumeTokenStore: store,
    });
    transport.subscribeConnection((notice) => {
      notices.push(notice);
    });

    await transport.disconnect();
    expect(store.read()).toBeNull();
    expect(notices).toEqual(["left"]);
  });
});
