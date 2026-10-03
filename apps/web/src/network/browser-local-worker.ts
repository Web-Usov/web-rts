import type { LocalWorkerFactory } from "./local-game-transport.js";
import type { WorkerToMainMessage } from "./local-protocol.js";

/**
 * Real module worker. Vite bundles this entry only when `new Worker(new URL(...))`
 * appears directly in this call.
 */
export function createBrowserLocalWorker(): ReturnType<LocalWorkerFactory> {
  const worker = new Worker(new URL("./local-simulation.worker.ts", import.meta.url), {
    type: "module",
  });
  let onMessage: (message: WorkerToMainMessage) => void = () => {};
  worker.addEventListener("message", (event: MessageEvent<WorkerToMainMessage>) => {
    onMessage(event.data);
  });
  return {
    postMessage(message) {
      worker.postMessage(message);
    },
    terminate() {
      worker.terminate();
    },
    setOnMessage(listener) {
      onMessage = listener;
    },
  };
}
