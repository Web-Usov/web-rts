import { afterEach, describe, expect, it, vi } from "vitest";
import { RoundTripMonitor, normalizeRoundTripMs, probeLiveRoomPing } from "./round-trip.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("probeLiveRoomPing", () => {
  it("resolves the callback sample without a server", async () => {
    await expect(
      probeLiveRoomPing({
        ping(callback) {
          callback(14);
        },
      }),
    ).resolves.toBe(14);
  });

  it("rejects when the live room never answers", async () => {
    vi.useFakeTimers();
    const pending = probeLiveRoomPing({ ping() {} }, 500);
    const assertion = expect(pending).rejects.toThrow("ping_timeout");
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it("rejects when ping throws", async () => {
    await expect(
      probeLiveRoomPing({
        ping() {
          throw new Error("socket_closed");
        },
      }),
    ).rejects.toThrow("socket_closed");
  });
});

describe("RoundTripMonitor", () => {
  it("uses the default browser timer without throwing", async () => {
    const monitor = new RoundTripMonitor(60_000);
    monitor.start(async () => 4);
    await Promise.resolve();
    expect(monitor.read()).toBe(4);
    monitor.stop();
    expect(monitor.read()).toBeNull();
  });

  it("stays null when the transport has no probe", () => {
    const monitor = new RoundTripMonitor(
      1_000,
      () => 1 as ReturnType<typeof setInterval>,
      () => {},
    );
    monitor.start(null);
    expect(monitor.read()).toBeNull();
  });

  it("keeps the last good sample when a later probe fails", async () => {
    const scheduled: Array<() => void> = [];
    const monitor = new RoundTripMonitor(
      1_000,
      (callback) => {
        scheduled.push(callback);
        return scheduled.length as unknown as ReturnType<typeof setInterval>;
      },
      () => {},
    );

    let next: number | Error = 12.4;
    monitor.start(async () => {
      if (next instanceof Error) {
        throw next;
      }
      return next;
    });

    await Promise.resolve();
    expect(monitor.read()).toBe(12.4);

    next = new Error("down");
    scheduled[0]?.();
    await Promise.resolve();
    expect(monitor.read()).toBe(12.4);

    monitor.stop();
    expect(monitor.read()).toBeNull();
  });

  it("does not let a probe that resolves after stop/start clear the next session", async () => {
    const started: number[] = [];
    const resolvers: Array<(value: number) => void> = [];
    const scheduled: Array<() => void> = [];
    const monitor = new RoundTripMonitor(
      1_000,
      (callback) => {
        scheduled.push(callback);
        return scheduled.length as unknown as ReturnType<typeof setInterval>;
      },
      () => {},
    );

    const probe = (id: number) => () => {
      started.push(id);
      return new Promise<number>((resolve) => {
        resolvers[id] = resolve;
      });
    };

    monitor.start(probe(1));
    monitor.start(probe(2));
    expect(started).toEqual([1, 2]);

    resolvers[1]?.(10);
    await Promise.resolve();
    expect(monitor.read()).toBeNull();

    scheduled.at(-1)?.();
    expect(started).toEqual([1, 2]);

    resolvers[2]?.(30);
    await Promise.resolve();
    expect(monitor.read()).toBe(30);
  });

  it("does not let a rejected previous probe clear the next session", async () => {
    const started: number[] = [];
    const rejecters: Array<(error: Error) => void> = [];
    const scheduled: Array<() => void> = [];
    const monitor = new RoundTripMonitor(
      1_000,
      (callback) => {
        scheduled.push(callback);
        return scheduled.length as unknown as ReturnType<typeof setInterval>;
      },
      () => {},
    );

    const probe = (id: number) => () => {
      started.push(id);
      return new Promise<number>((_resolve, reject) => {
        rejecters[id] = reject;
      });
    };

    monitor.start(probe(1));
    monitor.start(probe(2));
    rejecters[1]?.(new Error("stale"));
    await Promise.resolve();

    scheduled.at(-1)?.();
    expect(started).toEqual([1, 2]);
    expect(monitor.read()).toBeNull();
  });

  it("ignores negative and non-finite samples", () => {
    expect(normalizeRoundTripMs(0)).toBe(0);
    expect(normalizeRoundTripMs(-1)).toBeNull();
    expect(normalizeRoundTripMs(Number.NaN)).toBeNull();
  });
});
