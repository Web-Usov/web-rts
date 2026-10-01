/**
 * Network-neutral RTT helpers.
 * `null` means this transport cannot measure a round trip (future LocalGameTransport,
 * or no live session). RemoteGameTransport fills the probe from Colyseus `Room.ping`.
 */
export type RoundTripReading = number | null;

export type LiveRoomPing = {
  ping(callback: (milliseconds: number) => void): void;
};

const DEFAULT_PING_TIMEOUT_MS = 2_000;

export function normalizeRoundTripMs(value: number): RoundTripReading {
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

/**
 * One Colyseus 0.18 `Room.ping` sample.
 * The SDK callback is skipped when the socket is not open, so a timeout rejects
 * instead of leaving the caller pending.
 */
export function probeLiveRoomPing(
  room: LiveRoomPing,
  timeoutMs = DEFAULT_PING_TIMEOUT_MS,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error("ping_timeout"));
    }, timeoutMs);

    try {
      room.ping((milliseconds) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(milliseconds);
      });
    } catch (error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error("ping_failed"));
    }
  });
}

type IntervalHandle = ReturnType<typeof setInterval>;

/**
 * Caches the latest successful probe. A null probe means RTT is unavailable.
 * Failed probes keep the previous successful reading.
 */
export class RoundTripMonitor {
  private reading: RoundTripReading = null;
  private timer: IntervalHandle | null = null;
  private generation = 0;
  private inFlight = false;

  constructor(
    private readonly intervalMs: number,
    /**
     * Defaults are free calls. `setInterval()` as a method throws
     * "Illegal invocation" in browsers because `this` is no longer `window`.
     */
    private readonly schedule: (callback: () => void, intervalMs: number) => IntervalHandle = (
      callback,
      intervalMs,
    ) => setInterval(callback, intervalMs),
    private readonly cancel: (handle: IntervalHandle) => void = (handle) => {
      clearInterval(handle);
    },
  ) {}

  read(): RoundTripReading {
    return this.reading;
  }

  start(probe: (() => Promise<number>) | null): void {
    this.stop();
    if (!probe) {
      return;
    }

    const generation = this.generation;
    const sample = (): void => {
      if (this.inFlight || generation !== this.generation) {
        return;
      }
      this.inFlight = true;
      void probe().then(
        (value) => {
          this.inFlight = false;
          if (generation !== this.generation) {
            return;
          }
          const normalized = normalizeRoundTripMs(value);
          if (normalized !== null) {
            this.reading = normalized;
          }
        },
        () => {
          this.inFlight = false;
        },
      );
    };

    sample();
    const schedule = this.schedule;
    this.timer = schedule(sample, this.intervalMs);
  }

  stop(): void {
    this.generation += 1;
    this.inFlight = false;
    if (this.timer !== null) {
      const cancel = this.cancel;
      cancel(this.timer);
      this.timer = null;
    }
    this.reading = null;
  }
}
