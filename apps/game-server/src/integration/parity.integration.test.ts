import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import {
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  STATE_MESSAGE,
  SYNC_MESSAGE,
  type GameEvent,
  type GameStateView,
} from "@web-rts/protocol";
import {
  FOUNDATION_PARITY_FIXTURE,
  SCHEDULING_PARITY_FIXTURE,
  PARITY_FINISH_AFTER_STEPS,
  createFinishingMatchRuntime,
  normalizeGameStateView,
  runParityReference,
} from "@web-rts/testkit";
import { createGameServer } from "../app-config.js";
import {
  COMMAND_MESSAGE,
  EVENT_MESSAGE,
  FOUNDATION_ROOM_NAME,
  START_MESSAGE,
} from "../constants.js";
import { FoundationRoom } from "../rooms/foundation-room.js";
import { installRuntimeProbe } from "./runtime-probe.js";

const compatibleOptions = {
  protocolVersion: PROTOCOL_VERSION,
  gameDataVersion: GAME_DATA_VERSION,
};

type ClientLike = {
  send(type: string, payload?: unknown): void;
  onMessage(type: string, listener: (payload: unknown) => void): unknown;
};

function record(client: ClientLike): { states: GameStateView[]; events: GameEvent[] } {
  const states: GameStateView[] = [];
  const events: GameEvent[] = [];
  client.onMessage(STATE_MESSAGE, (payload) => states.push(payload as GameStateView));
  client.onMessage(EVENT_MESSAGE, (payload) => events.push(payload as GameEvent));
  return { states, events };
}

describe("Local/Remote parity (Remote shell)", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(createGameServer());
  }, 30_000);

  afterAll(async () => {
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it.each([
    SCHEDULING_PARITY_FIXTURE,
    FOUNDATION_PARITY_FIXTURE,
    {
      ...FOUNDATION_PARITY_FIXTURE,
      ticks: 30,
      steps: [
        {
          atTick: 0,
          payload: {
            type: "MOVE",
            commandId: "blocked-target",
            clientSequence: 1,
            entityIds: [1],
            target: { x: 0.8, y: 0.1 },
          },
        },
      ],
      expectedRejections: [],
    },
  ])("matches the shared parity reference for fixture %#", async (fixture) => {
    const room = (await colyseus.createRoom(FOUNDATION_ROOM_NAME, {
      ...compatibleOptions,
      seed: fixture.seed,
      mapId: fixture.mapId,
    })) as FoundationRoom;
    const probe = installRuntimeProbe(room, { held: true });
    const client = await colyseus.connectTo(room, compatibleOptions);
    const inbox = record(client);
    expect(room.slots.getBySessionId(client.sessionId)?.playerId).toBe(fixture.localPlayerId);
    expect(room.startMatch()).toBe(true);

    for (let tick = 0; tick < fixture.ticks; tick += 1) {
      for (const step of fixture.steps.filter((candidate) => candidate.atTick === tick)) {
        const received = room.waitForMessage(COMMAND_MESSAGE);
        client.send(COMMAND_MESSAGE, step.payload);
        await received;
      }
      probe.allowSteps(1);
      await vi.waitFor(() => {
        expect(inbox.states.at(-1)?.tick).toBe(tick + 1);
      });
    }

    const reference = runParityReference(fixture);
    const rejections = inbox.events.flatMap((event) =>
      event.type === "COMMAND_REJECTED"
        ? [{ commandId: event.commandId, reason: event.reason }]
        : [],
    );
    expect(rejections).toEqual(fixture.expectedRejections);
    expect(rejections).toEqual(reference.rejections);
    expect(normalizeGameStateView(inbox.states.at(-1)!)).toEqual(reference.finalView);
  });

  it("reflects START → RUNNING → FINISHED and rejects commands after FINISHED", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    room.matchRuntimeFactory = (setup) => createFinishingMatchRuntime(setup);
    const client = await colyseus.connectTo(room, compatibleOptions);
    const inbox = record(client);

    client.send(SYNC_MESSAGE, {});
    await vi.waitFor(() => {
      expect(inbox.states.at(-1)?.phase).toBe("LOBBY");
    });

    client.send(START_MESSAGE, {});
    await vi.waitFor(() => {
      expect(inbox.states.at(-1)?.phase).toBe("FINISHED");
    });
    const phases = inbox.states
      .map((state) => state.phase)
      .filter((phase, index, all) => {
        return index === 0 || all[index - 1] !== phase;
      });
    expect(phases).toEqual(["LOBBY", "RUNNING", "FINISHED"]);
    expect(room.phase).toBe("FINISHED");
    expect(room.metadata).toMatchObject({ phase: "FINISHED" });

    const rejected = client.waitForMessage(EVENT_MESSAGE);
    client.send(COMMAND_MESSAGE, {
      type: "MOVE",
      commandId: "after-finish",
      clientSequence: 1,
      entityIds: [1],
      target: { x: 1, y: 1 },
    });
    expect(await rejected).toEqual({
      type: "COMMAND_REJECTED",
      commandId: "after-finish",
      reason: "not_running",
    });

    const restart = client.waitForMessage(EVENT_MESSAGE);
    client.send(START_MESSAGE, {});
    expect(await restart).toMatchObject({ commandId: "start", reason: "invalid_phase" });

    const finalSync = client.waitForMessage(STATE_MESSAGE);
    client.send(SYNC_MESSAGE, {});
    const final = (await finalSync) as GameStateView;
    expect(final).toMatchObject({ phase: "FINISHED", tick: PARITY_FINISH_AFTER_STEPS });
    expect(final.entities.length).toBeGreaterThan(0);
  });
});
