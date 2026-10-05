import type { GameTransport } from "@web-rts/protocol";
import { createBrowserLocalWorker } from "./browser-local-worker.js";
import { getBrowserLocalGameTransport } from "./local-game-transport.js";
import { getBrowserGameTransport } from "./remote-game-transport.js";
import { isLocalTransportSearch } from "./transport-mode.js";

/** Picks the page transport. UI and presentation see only {@link GameTransport}. */
export function createPageGameTransport(search: string): GameTransport {
  if (isLocalTransportSearch(search)) {
    return getBrowserLocalGameTransport(createBrowserLocalWorker);
  }
  return getBrowserGameTransport();
}
