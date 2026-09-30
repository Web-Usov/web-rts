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
