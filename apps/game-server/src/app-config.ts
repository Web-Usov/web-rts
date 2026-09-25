import { defineServer, defineRoom, createRouter, createEndpoint } from "colyseus";
import { FOUNDATION_ROOM_NAME } from "./constants.js";
import { FoundationRoom } from "./rooms/foundation-room.js";

/**
 * Colyseus server definition: rooms + minimal health route.
 * No database / Redis — presence stays in-process (Technical Vision non-goals).
 */
export function createGameServer() {
  return defineServer({
    rooms: {
      [FOUNDATION_ROOM_NAME]: defineRoom(FoundationRoom),
    },
    routes: createRouter({
      health: createEndpoint("/health", { method: "GET" }, async () => {
        return { status: "ok" as const };
      }),
    }),
  });
}

export type GameServer = ReturnType<typeof createGameServer>;
