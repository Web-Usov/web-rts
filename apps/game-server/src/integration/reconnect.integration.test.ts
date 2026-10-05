import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import {
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  STATE_MESSAGE,
  SYNC_MESSAGE,
  type GameStateView,
  type MoveCommand,
} from "@web-rts/protocol";
import { createGameServer } from "../app-config.js";
import {
  COMMAND_MESSAGE,
  DEFAULT_RECONNECT_GRACE_SECONDS,
  FOUNDATION_ROOM_NAME,
} from "../constants.js";
import { FoundationRoom } from "../rooms/foundation-room.js";
import { installRuntimeProbe, type RuntimeProbe } from "./runtime-probe.js";

const compatibleOptions = {
  protocolVersion: PROTOCOL_VERSION,
  gameDataVersion: GAME_DATA_VERSION,
};

type SdkRoom = {
  sessionId: string;
  reconnectionToken: string;
  reconnection: { enabled: boolean };
  leave(consented?: boolean): Promise<number>;
  send(type: string, payload?: unknown): void;
  waitForMessage(type: string): Promise<unknown>;
};

function createMove(overrides: Partial<MoveCommand> = {}): MoveCommand {
  return {
    type: "MOVE",
    commandId: "move-1",
    clientSequence: 1,
    entityIds: [1],
    target: { x: 5, y: 6 },
    ...overrides,
  };
}

async function waitForState(
  client: { waitForMessage: (type: string) => Promise<unknown> },
  predicate: (view: GameStateView) => boolean,
  attempts = 40,
): Promise<GameStateView> {
  for (let i = 0; i < attempts; i += 1) {
    const payload = await client.waitForMessage(STATE_MESSAGE);
    const view = payload as GameStateView;
    if (predicate(view)) {
      return view;
    }
  }
  throw new Error("timed out waiting for matching GameStateView");
}

function entityOf(room: FoundationRoom, entityId: number) {
  return room.matchRuntime?.readSnapshot().entities.find((entity) => entity.entityId === entityId);
}

/** Unexpected close. Disables the SDK retry loop so the test owns the resume. */
async function dropUnexpected(client: SdkRoom): Promise<void> {
  client.reconnection.enabled = false;
  await client.leave(false);
}

describe("reconnect integration", () => {
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

  async function startRunningPair(
    graceSeconds = DEFAULT_RECONNECT_GRACE_SECONDS,
    options: { held?: boolean } = {},
  ) {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    room.reconnectGraceSeconds = graceSeconds;
    const probe: RuntimeProbe = installRuntimeProbe(room, options);
    const clientA = (await colyseus.connectTo(room, compatibleOptions)) as unknown as SdkRoom;
    const clientB = (await colyseus.connectTo(room, compatibleOptions)) as unknown as SdkRoom;
    expect(room.startMatch()).toBe(true);
    const runtime = room.matchRuntime;
    expect(runtime).not.toBeNull();
    const sessionA = clientA.sessionId;
    const playerA = room.slots.getBySessionId(sessionA)?.playerId;
    expect(playerA).toBeDefined();
    const unitA = runtime!
      .readSnapshot()
      .entities.find(
        (entity) => entity.kind === "unit" && entity.ownerPlayerId === playerA,
      )?.entityId;
    expect(unitA).toBeDefined();
    const objectiveId = runtime!
      .readSnapshot()
      .entities.find((entity) => entity.kind === "objective")?.entityId;
    expect(objectiveId).toBeDefined();
    return {
      room,
      probe,
      clientA,
      clientB,
      runtime: runtime!,
      sessionA,
      playerA: playerA!,
      unitA: unitA!,
      objectiveId: objectiveId!,
    };
  }

  async function sendPendingMove(room: FoundationRoom, client: SdkRoom, unitId: number) {
    const start = entityOf(room, unitId)!;
    const waitServer = room.waitForMessage(COMMAND_MESSAGE);
    client.send(
      COMMAND_MESSAGE,
      createMove({
        commandId: "pending",
        entityIds: [unitId],
        target: { x: start.x + 2, y: start.y },
      }),
    );
    await waitServer;
    expect(room.matchRuntime!.readMetrics().pendingCommandCount).toBe(1);
    return start;
  }

  it("ignores a client-supplied reconnect grace", async () => {
    const room = (await colyseus.createRoom(FOUNDATION_ROOM_NAME, {
      ...compatibleOptions,
      reconnectGraceSeconds: 999_999,
    })) as FoundationRoom;
    expect(room.reconnectGraceSeconds).toBe(DEFAULT_RECONNECT_GRACE_SECONDS);

    await colyseus.connectTo(room, {
      ...compatibleOptions,
      reconnectGraceSeconds: 1,
    });
    expect(room.reconnectGraceSeconds).toBe(30);
  });

  it("reserves the slot, unit, owner, and controller on unexpected disconnect", async () => {
    const { room, clientA, clientB, runtime, sessionA, playerA, unitA } = await startRunningPair();
    const seenByPeer = waitForState(
      clientB,
      (view) =>
        view.players.some((player) => player.playerId === playerA && player.connected === false) &&
        view.entities.some(
          (entity) =>
            entity.entityId === unitA &&
            entity.ownerPlayerId === playerA &&
            entity.controllerPlayerId === playerA,
        ),
    );

    await dropUnexpected(clientA);

    const view = await seenByPeer;
    expect(room.slots.size).toBe(2);
    expect(room.slots.getBySessionId(sessionA)).toMatchObject({
      playerId: playerA,
      connected: false,
    });
    expect(room.clients.length).toBe(1);
    expect(entityOf(room, unitA)).toMatchObject({
      ownerPlayerId: playerA,
      controllerPlayerId: playerA,
    });
    expect(view.phase).toBe("RUNNING");
    expect(room.phase).toBe("RUNNING");
    expect(room.matchRuntime).toBe(runtime);
  });

  it("keeps the fixed timestep running and replicating while a player is disconnected", async () => {
    const { room, clientA, clientB, runtime } = await startRunningPair();
    const tickBefore = runtime.readMetrics().tick;
    await dropUnexpected(clientA);

    await room.waitForNextTimestep();
    expect(runtime.readMetrics().tick).toBeGreaterThan(tickBefore);
    expect(room.matchRuntime).toBe(runtime);
    expect(room.phase).toBe("RUNNING");

    const later = await waitForState(clientB, (view) => view.tick > tickBefore);
    expect(later.tick).toBeGreaterThan(tickBefore);
    expect(later.players.some((player) => player.connected === false)).toBe(true);
  });

  it("reconnects the same session and accepts MOVE that the peer observes", async () => {
    const { room, clientA, clientB, runtime, sessionA, playerA, unitA } = await startRunningPair();
    const token = clientA.reconnectionToken;
    expect(token.includes(":")).toBe(true);

    await dropUnexpected(clientA);
    await vi.waitFor(
      () => {
        expect(room.slots.getBySessionId(sessionA)?.connected).toBe(false);
      },
      { timeout: 2_000, interval: 20 },
    );
    expect(room.slots.size).toBe(2);

    const restored = (await colyseus.sdk.reconnect(token)) as unknown as SdkRoom;
    expect(restored.sessionId).toBe(sessionA);
    expect(room.slots.size).toBe(2);
    expect(room.slots.getBySessionId(sessionA)).toMatchObject({
      playerId: playerA,
      connected: true,
    });
    expect(room.matchRuntime).toBe(runtime);
    expect(entityOf(room, unitA)).toMatchObject({
      ownerPlayerId: playerA,
      controllerPlayerId: playerA,
    });

    const resumed = waitForState(
      restored,
      (view) =>
        view.roomId === room.roomId &&
        view.phase === "RUNNING" &&
        view.localPlayerId === playerA &&
        view.players.some((player) => player.playerId === playerA && player.connected) &&
        view.entities.some(
          (entity) =>
            entity.entityId === unitA &&
            entity.ownerPlayerId === playerA &&
            entity.controllerPlayerId === playerA,
        ),
    );
    restored.send(SYNC_MESSAGE, {});
    const view = await resumed;
    expect(view.entities.filter((entity) => entity.kind === "objective")).toHaveLength(1);

    const start = entityOf(room, unitA)!;
    const target = { x: start.x + 2, y: start.y };
    const peerSeesMove = waitForState(clientB, (peerView) => {
      const entity = peerView.entities.find((candidate) => candidate.entityId === unitA);
      return (
        entity !== undefined &&
        Math.abs(entity.x - target.x) < 1e-6 &&
        Math.abs(entity.y - target.y) < 1e-6 &&
        entity.controllerPlayerId === playerA
      );
    });
    restored.send(
      COMMAND_MESSAGE,
      createMove({ commandId: "after-reconnect", entityIds: [unitA], target }),
    );

    const peerView = await peerSeesMove;
    const moved = peerView.entities.find((entity) => entity.entityId === unitA);
    expect(moved?.x).toBeCloseTo(target.x, 5);
    expect(moved?.controllerPlayerId).toBe(playerA);
    expect(moved?.ownerPlayerId).toBe(playerA);
  });

  it("locks new joins after START while a reserved reconnect in grace still works", async () => {
    const { room, clientA, clientB, sessionA, playerA } = await startRunningPair();
    expect(room.locked).toBe(true);
    await expect(colyseus.connectTo(room, compatibleOptions)).rejects.toThrow();

    const token = clientA.reconnectionToken;
    await dropUnexpected(clientA);
    await vi.waitFor(
      () => {
        expect(room.slots.getBySessionId(sessionA)?.connected).toBe(false);
      },
      { timeout: 2_000, interval: 20 },
    );
    // A free-looking room during grace is still closed to new players.
    await expect(colyseus.connectTo(room, compatibleOptions)).rejects.toThrow();

    const restored = (await colyseus.sdk.reconnect(token)) as unknown as SdkRoom;
    expect(restored.sessionId).toBe(sessionA);
    expect(room.slots.getBySessionId(sessionA)).toMatchObject({
      playerId: playerA,
      connected: true,
    });

    // A permanent leave frees a slot, but the match stays locked.
    await clientB.leave(true);
    await vi.waitFor(() => {
      expect(room.slots.size).toBe(1);
    });
    await expect(colyseus.connectTo(room, compatibleOptions)).rejects.toThrow();
    expect(room.slots.size).toBe(1);
    expect(room.phase).toBe("RUNNING");
  });

  it("releases the slot and Controller after the grace timeout without deleting the unit", async () => {
    const { room, clientA, clientB, runtime, sessionA, playerA, unitA, objectiveId } =
      await startRunningPair(2);

    await dropUnexpected(clientA);
    await vi.waitFor(
      () => {
        expect(room.slots.getBySessionId(sessionA)?.connected).toBe(false);
      },
      { timeout: 1_000, interval: 20 },
    );
    expect(room.slots.size).toBe(2);
    expect(entityOf(room, unitA)?.controllerPlayerId).toBe(playerA);

    await vi.waitFor(
      () => {
        expect(room.slots.getBySessionId(sessionA)).toBeUndefined();
      },
      { timeout: 4_000, interval: 50 },
    );

    expect(room.slots.size).toBe(1);
    expect(entityOf(room, unitA)).toMatchObject({
      ownerPlayerId: playerA,
      controllerPlayerId: null,
    });
    expect(entityOf(room, objectiveId)).toMatchObject({
      kind: "objective",
      controllerPlayerId: null,
    });
    expect(room.phase).toBe("RUNNING");
    expect(room.matchRuntime).toBe(runtime);

    const pending = waitForState(clientB, (view) => {
      const entity = view.entities.find((candidate) => candidate.entityId === unitA);
      return (
        entity !== undefined &&
        entity.ownerPlayerId === playerA &&
        entity.controllerPlayerId === null &&
        !view.players.some((player) => player.playerId === playerA)
      );
    });
    clientB.send(SYNC_MESSAGE, {});
    const view = await pending;
    expect(view.entities.some((entity) => entity.entityId === objectiveId)).toBe(true);
  });

  it("keeps pending commands during reconnect grace and applies them on the next step", async () => {
    const { room, probe, clientA, sessionA, unitA } = await startRunningPair(30, { held: true });
    const start = await sendPendingMove(room, clientA, unitA);

    await dropUnexpected(clientA);
    await vi.waitFor(() => {
      expect(room.slots.getBySessionId(sessionA)?.connected).toBe(false);
    });
    expect(room.matchRuntime!.readMetrics().pendingCommandCount).toBe(1);

    probe.allowSteps(1);
    await vi.waitFor(() => {
      expect(probe.appliedSteps).toBe(1);
    });
    expect(room.matchRuntime!.readMetrics().pendingCommandCount).toBe(0);
    expect(entityOf(room, unitA)!.x).toBeGreaterThan(start.x);
  });

  it("discards pending commands when the grace period times out", async () => {
    const { room, probe, clientA, sessionA, playerA, unitA } = await startRunningPair(1, {
      held: true,
    });
    const start = await sendPendingMove(room, clientA, unitA);

    await dropUnexpected(clientA);
    await vi.waitFor(
      () => {
        expect(room.slots.getBySessionId(sessionA)).toBeUndefined();
      },
      { timeout: 4_000, interval: 50 },
    );
    expect(room.matchRuntime!.readMetrics().pendingCommandCount).toBe(0);

    probe.allowSteps(2);
    await vi.waitFor(() => {
      expect(probe.appliedSteps).toBe(2);
    });
    expect(entityOf(room, unitA)).toMatchObject({
      x: start.x,
      y: start.y,
      ownerPlayerId: playerA,
      controllerPlayerId: null,
    });
  });

  it("treats consented Disconnect as an immediate permanent leave", async () => {
    const { room, clientA, sessionA, playerA, unitA } = await startRunningPair();
    expect(room.reconnectGraceSeconds).toBe(30);

    await clientA.leave(true);

    await vi.waitFor(
      () => {
        expect(room.slots.getBySessionId(sessionA)).toBeUndefined();
      },
      { timeout: 2_000, interval: 20 },
    );
    expect(room.slots.size).toBe(1);
    expect(entityOf(room, unitA)).toMatchObject({
      ownerPlayerId: playerA,
      controllerPlayerId: null,
    });
    expect(room.phase).toBe("RUNNING");
  });

  it("rejects an expired resume token without allocating a new player", async () => {
    const { room, clientA, clientB, sessionA } = await startRunningPair(1);
    const token = clientA.reconnectionToken;
    const remainingBefore = room.slots
      .list()
      .filter((slot) => slot.sessionId !== sessionA)
      .map((slot) => slot.playerId);

    await dropUnexpected(clientA);
    await vi.waitFor(
      () => {
        expect(room.slots.getBySessionId(sessionA)).toBeUndefined();
      },
      { timeout: 4_000, interval: 50 },
    );
    const sizeAfterTimeout = room.slots.size;

    await expect(colyseus.sdk.reconnect(token)).rejects.toThrow();
    expect(room.slots.size).toBe(sizeAfterTimeout);
    expect(room.slots.list().map((slot) => slot.playerId)).toEqual(remainingBefore);
    expect(room.slots.getBySessionId(clientB.sessionId)?.connected).toBe(true);
    expect(room.clients.length).toBe(1);
  });
});
