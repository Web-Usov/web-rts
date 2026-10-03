import { DEFAULT_TICK_HZ } from "@web-rts/simulation";
import { createLocalMatchRuntime } from "./local-match-runtime.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./local-protocol.js";

/**
 * Worker global without the WebWorker lib. The web tsconfig already includes DOM,
 * and DOM + WebWorker lib names collide.
 */
interface LocalWorkerScope {
  postMessage(message: WorkerToMainMessage): void;
  onmessage: ((event: MessageEvent<MainToWorkerMessage>) => void) | null;
}

const scope = globalThis as unknown as LocalWorkerScope;

/**
 * Simulation host for LocalGameTransport.
 * setInterval only wakes the shared fixed tick; it is not gameplay time.
 */
const runtime = createLocalMatchRuntime(
  (message) => {
    scope.postMessage(message);
  },
  (tick) => {
    const timer = setInterval(tick, 1000 / DEFAULT_TICK_HZ);
    return () => {
      clearInterval(timer);
    };
  },
);

scope.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  runtime.handle(event.data);
};
