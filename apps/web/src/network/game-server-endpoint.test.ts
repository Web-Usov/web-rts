import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_SERVER_URL, resolveGameServerEndpoint } from "./game-server-endpoint.js";

describe("resolveGameServerEndpoint", () => {
  it("uses an explicit URL ahead of the page hostname and port", () => {
    expect(
      resolveGameServerEndpoint({
        explicitUrl: "https://game.example/colyseus",
        pageHostname: "192.168.1.20",
        configuredPort: "18081",
      }),
    ).toBe("https://game.example/colyseus");
  });

  it("trims an explicit URL", () => {
    expect(
      resolveGameServerEndpoint({
        explicitUrl: "  http://10.0.0.8:9999  ",
        pageHostname: "192.168.1.20",
      }),
    ).toBe("http://10.0.0.8:9999");
  });

  it("uses the page hostname and the default game-server port", () => {
    expect(
      resolveGameServerEndpoint({
        pageHostname: "192.168.1.20",
      }),
    ).toBe("http://192.168.1.20:2567");
  });

  it("uses a custom game-server port with the page hostname", () => {
    expect(
      resolveGameServerEndpoint({
        pageHostname: "lan-host.local",
        configuredPort: "18081",
      }),
    ).toBe("http://lan-host.local:18081");
  });

  it("treats an empty explicit URL as unset and keeps the LAN hostname", () => {
    expect(
      resolveGameServerEndpoint({
        explicitUrl: "   ",
        pageHostname: "192.168.0.15",
        configuredPort: 2570,
      }),
    ).toBe("http://192.168.0.15:2570");
  });

  it("falls back to localhost when there is no page hostname", () => {
    expect(resolveGameServerEndpoint()).toBe(DEFAULT_GAME_SERVER_URL);
    expect(
      resolveGameServerEndpoint({
        explicitUrl: "",
        pageHostname: "   ",
        configuredPort: "18081",
      }),
    ).toBe("http://localhost:2567");
  });

  it("falls back to port 2567 when the configured port is invalid", () => {
    const cases = ["nope", "0", "65536", "2567abc", "1.5", -1, 0, 65536, 2567.5, Number.NaN];
    for (const configuredPort of cases) {
      expect(
        resolveGameServerEndpoint({
          pageHostname: "192.168.1.20",
          configuredPort,
        }),
      ).toBe("http://192.168.1.20:2567");
    }
  });

  it("wraps an IPv6 page hostname", () => {
    expect(
      resolveGameServerEndpoint({
        pageHostname: "2001:db8::1",
        configuredPort: "2567",
      }),
    ).toBe("http://[2001:db8::1]:2567");
  });
});
