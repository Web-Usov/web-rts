import type { Browser, BrowserContext, BrowserContextOptions, Page } from "@playwright/test";
import { retainReplay, type BrowserEvidence } from "./browser-evidence.js";

export interface BrowserSession {
  actor: string;
  context: BrowserContext;
  page: Page;
}
interface Slot {
  actor: string;
  context: BrowserContext;
  tracing: boolean;
  page?: Page;
}
type ContextFactory = (options: BrowserContextOptions) => Promise<BrowserContext>;

/**
 * Guarded lifecycle: resources are registered as soon as they exist, cleanup runs for each of
 * them independently and evidence.finish() is always reached. Trace is retained on non-PASS or
 * AT7_FULL_REPLAY=1; video is recorded straight into the evidence directory and deleted otherwise.
 */
export async function runBrowserSession(options: {
  browser: Browser;
  evidence: BrowserEvidence;
  actors: string[];
  body: (sessions: BrowserSession[]) => Promise<void>;
  newContext?: ContextFactory;
  fullReplay?: boolean;
}) {
  const { browser, evidence, actors, body } = options;
  const newContext = options.newContext ?? ((o: BrowserContextOptions) => browser.newContext(o));
  const full = options.fullReplay ?? process.env.AT7_FULL_REPLAY === "1";
  const slots: Slot[] = [];
  let failure: unknown;
  try {
    for (const actor of actors) {
      const context = await newContext({
        viewport: { width: 1280, height: 720 },
        recordVideo: { dir: await evidence.artifactPath("video-" + actor) },
      });
      const slot: Slot = { actor, context, tracing: false };
      slots.push(slot);
      await context.tracing.start({ screenshots: true, snapshots: true });
      slot.tracing = true;
      slot.page = await context.newPage();
      evidence.captureErrors(slot.page, actor);
    }
    const sessions = slots.map(({ actor, context, page }) => ({ actor, context, page: page! }));
    try {
      await body(sessions);
    } catch (error) {
      failure = error;
      for (const { page, actor } of sessions)
        await evidence.shot(page, "failure-" + actor).catch(() => {});
    }
  } catch (error) {
    failure = error;
  } finally {
    evidence.retainReplay = false;
    for (const [index, slot] of slots.entries()) {
      const retain = retainReplay(evidence.needsReplay(failure), full);
      const video = slot.page?.video();
      try {
        if (slot.tracing) {
          if (retain) {
            const trace = await evidence.artifactPath("trace-" + index + ".zip");
            await slot.context.tracing.stop({ path: trace });
            evidence.recordArtifact(trace);
          } else await slot.context.tracing.stop();
        }
      } catch (error) {
        failure ??= error;
      }
      await slot.context.close().catch((error) => {
        failure ??= error;
      });
      try {
        if (video) {
          if (retain) evidence.recordArtifact(await video.path());
          else await video.delete();
        }
      } catch (error) {
        failure ??= error;
      }
      if (retain) evidence.retainReplay = true;
    }
  }
  return evidence.finish(failure);
}
