import { describe, expect, it } from "vitest";
import type { OpaqueResumeTokenStore } from "./resume-token-store.js";
import {
  DEFAULT_GAME_SERVER_URL,
  RemoteGameTransport,
  resolveGameServerEndpoint,
} from "./remote-game-transport.js";

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

describe("resolveGameServerEndpoint", () => {
  it("prefers an explicit browser-visible server URL", () => {
    expect(
      resolveGameServerEndpoint({
        explicitUrl: " http://192.168.1.20:3567 ",
        port: "9999",
        location: { protocol: "http:", hostname: "192.168.1.10" },
      }),
    ).toBe("http://192.168.1.20:3567");
  });

  it("uses the page hostname for LAN clients", () => {
    expect(
      resolveGameServerEndpoint({
        location: { protocol: "http:", hostname: "192.168.1.10" },
      }),
    ).toBe("http://192.168.1.10:2567");
  });

  it("uses a configured host port with the page hostname", () => {
    expect(
      resolveGameServerEndpoint({
        port: "3567",
        location: { protocol: "http:", hostname: "web-rts-box.local" },
      }),
    ).toBe("http://web-rts-box.local:3567");
  });

  it("falls back to the development localhost endpoint outside a browser", () => {
    expect(resolveGameServerEndpoint()).toBe(DEFAULT_GAME_SERVER_URL);
    expect(resolveGameServerEndpoint({ port: "not-a-port" })).toBe(DEFAULT_GAME_SERVER_URL);
  });
});

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
