import type { GameTransport } from "@web-rts/protocol";
import { createBrowserLocalWorker } from "./browser-local-worker.js";
import { getBrowserLocalGameTransport } from "./local-game-transport.js";
import { getBrowserGameTransport } from "./remote-game-transport.js";
import { isLocalTransportSearch } from "./transport-mode.js";

/**
 * Browser session helpers the existing lobby uses on top of GameTransport.
 * Presentation still depends only on GameTransport.
 */
export type PageGameTransport = GameTransport & {
  readonly connectedRoomId: string | null;
  hasResumeToken(): boolean;
  startMatch(): void;
};

export function createPageGameTransport(search: string): PageGameTransport {
  if (isLocalTransportSearch(search)) {
    return getBrowserLocalGameTransport(createBrowserLocalWorker);
  }
  return getBrowserGameTransport();
}
