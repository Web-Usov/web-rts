import {
  createMatchRuntime,
  type CommandAdmission,
  type MatchRuntime,
  type MatchSetup,
  type MatchSnapshot,
  type MatchStatus,
  type RuntimeConfig,
} from "@web-rts/simulation";
import type { FoundationRoom } from "../rooms/foundation-room.js";

/**
 * Test-only wrapper installed through `FoundationRoom.matchRuntimeFactory`.
 * It counts runtime reads, can hold the room's scheduler (`step` becomes a no-op
 * until steps are allowed), and can force the FINISHED status that Foundation
 * gameplay cannot reach before G10.
 */
export type RuntimeProbe = {
  readonly setups: MatchSetup[];
  readonly readSnapshotCalls: number;
  /** Real steps executed by the room scheduler. */
  readonly appliedSteps: number;
  /** Scheduler invocations, including held ones. */
  readonly stepCalls: number;
  runtime(): MatchRuntime;
  allowSteps(count: number): void;
  release(): void;
  finish(): void;
};

export function installRuntimeProbe(
  room: FoundationRoom,
  options: { held?: boolean; runtimeConfig?: Partial<RuntimeConfig> } = {},
): RuntimeProbe {
  const setups: MatchSetup[] = [];
  let wrapper: MatchRuntime | null = null;
  let held = options.held ?? false;
  let budget = 0;
  let finished = false;
  let readSnapshotCalls = 0;
  let appliedSteps = 0;
  let stepCalls = 0;

  room.matchRuntimeFactory = (setup) => {
    setups.push(setup);
    const runtime = createMatchRuntime(setup, options.runtimeConfig);
    const status = (): MatchStatus => (finished ? "FINISHED" : runtime.status);
    wrapper = {
      get status() {
        return status();
      },
      submitCommand(actor, command): CommandAdmission {
        if (finished) {
          return { accepted: false, reason: "not_running" };
        }
        return runtime.submitCommand(actor, command);
      },
      step() {
        stepCalls += 1;
        if (finished) {
          return;
        }
        if (held) {
          if (budget <= 0) {
            return;
          }
          budget -= 1;
        }
        appliedSteps += 1;
        runtime.step();
      },
      drainEvents: () => runtime.drainEvents(),
      readSnapshot(): MatchSnapshot {
        readSnapshotCalls += 1;
        return { ...runtime.readSnapshot(), status: status() };
      },
      readMetrics: () => runtime.readMetrics(),
      removePlayer: (playerId) => {
        runtime.removePlayer(playerId);
      },
    };
    return wrapper;
  };

  return {
    setups,
    get readSnapshotCalls() {
      return readSnapshotCalls;
    },
    get appliedSteps() {
      return appliedSteps;
    },
    get stepCalls() {
      return stepCalls;
    },
    runtime() {
      if (!wrapper) {
        throw new Error("match runtime has not been created yet");
      }
      return wrapper;
    },
    allowSteps(count) {
      held = true;
      budget += count;
    },
    release() {
      held = false;
    },
    finish() {
      finished = true;
    },
  };
}
