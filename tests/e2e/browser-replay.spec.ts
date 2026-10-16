import { expect, test, type Page } from "@playwright/test";
import { BrowserEvidence } from "./helpers/browser-evidence.js";
import { runBrowserSession } from "./helpers/browser-session.js";
import {
  CANVAS_CLICK,
  MIN_UNIT_MOVE_CSS_PX,
  MAX_OBJECTIVE_DRIFT_CSS_PX,
  canvasLeftClick,
  canvasRightClick,
  cssDistance,
  expectObjectiveOnCanvas,
  findLocalUnitCentroid,
  selectLocalUnitByCanvasClick,
} from "./helpers/canvas.js";
import { expectHud, hudValue } from "./helpers/hud.js";

// Trace/video are managed by runBrowserSession (retain-on-failure or AT7_FULL_REPLAY=1).
test.use({ trace: "off", video: "off" });
async function value(page: Page, label: string) {
  const text = (await hudValue(page, label).textContent())?.trim();
  if (!text) throw new Error("missing HUD: " + label);
  return text;
}
async function tick(page: Page) {
  const text = await page
    .getByTestId("debug-overlay")
    .locator("dl div")
    .filter({ has: page.locator("dt", { hasText: "Server tick" }) })
    .locator("dd")
    .textContent();
  const number = Number(text?.trim());
  if (!text || !Number.isSafeInteger(number) || number < 0) throw new Error("missing visible tick");
  return number;
}
async function running(page: Page, actor: string, players: string, evidence: BrowserEvidence) {
  await expectHud(page, "Phase", "RUNNING");
  await expectHud(page, "Players", players);
  await expectHud(page, "Objectives", "1");
  const hud = {
    phase: await value(page, "Phase"),
    players: await value(page, "Players"),
    objectives: await value(page, "Objectives"),
    localPlayer: await value(page, "Local player"),
  };
  evidence.observe(actor, "running", hud);
  evidence.check(
    "running-" + actor,
    { phase: "RUNNING", players, objectives: "1" },
    { phase: hud.phase, players: hud.players, objectives: hud.objectives },
    "visible match setup",
  );
}

/** Scenario selection uses Playwright --grep; no JSON DSL or runtime control hook. */
for (const mode of ["local", "remote"] as const) {
  test(`AT7 MOVE ${mode}`, async ({ browser }, info) => {
    const evidence = new BrowserEvidence(mode, info);
    const status = await runBrowserSession({
      browser,
      evidence,
      actors: mode === "local" ? ["A"] : ["A", "B"],
      body: async (sessions) => {
        const pages = sessions.map(({ page, actor }) => ({ page, actor }));
        const a = pages[0]!.page;
        const b = pages[1]?.page ?? null;
        const gameSockets: string[] = [];
        a.on("websocket", (socket) => {
          if (/:(2567|2568)\b/.test(socket.url())) gameSockets.push("game-server");
        });
        await a.goto(mode === "local" ? "/?transport=local" : "/");
        evidence.action("A", "open");
        const worker = mode === "local" ? a.waitForEvent("worker", { timeout: 20_000 }) : null;
        await a.getByRole("button", { name: "Create room", exact: true }).click();
        evidence.action("A", "create-room");
        if (worker) {
          const actual = await worker;
          evidence.check(
            "worker",
            true,
            /local-simulation|worker/i.test(actual.url()) && a.workers().length > 0,
            "real WebWorker",
          );
        }
        await expectHud(a, "Status", "connected");
        if (b) {
          await b.goto("/");
          await b.getByLabel("Join room id").fill(await value(a, "Room"));
          await b.getByRole("button", { name: "Join room", exact: true }).click();
          await expectHud(b, "Status", "connected");
          evidence.action("B", "join-room");
          await expectHud(a, "Players", "2");
        }
        await a.getByRole("button", { name: "Start", exact: true }).click();
        evidence.action("A", "start");
        const objectives = new Map<string, Awaited<ReturnType<typeof expectObjectiveOnCanvas>>>();
        const before = new Map<string, Awaited<ReturnType<typeof findLocalUnitCentroid>>>();
        for (const { page, actor } of pages) {
          await running(page, actor, b ? "2" : "1", evidence);
          const objective = await expectObjectiveOnCanvas(page);
          objectives.set(actor, objective);
          evidence.check(
            "objective-before-" + actor,
            true,
            objective.count >= 80,
            "Sacred Site pixels visible",
          );
          before.set(actor, await findLocalUnitCentroid(page));
          await evidence.shot(page, "before-" + actor);
        }
        await selectLocalUnitByCanvasClick(a);
        const selected = await value(a, "Selected");
        evidence.action("A", "select-owned-unit", { ...before.get("A")! });
        evidence.check(
          "selection-A",
          true,
          selected !== "none",
          "same visible blue proxy selected by its owner",
        );
        if (b) {
          // Same fixed camera and verified pixel region; A successfully selected here.
          const point = await findLocalUnitCentroid(b);
          await canvasLeftClick(a, point);
          await expectHud(a, "Selected", selected);
          evidence.action("A", "verify-peer-click-point", { ...point });
          evidence.check(
            "foreign-hit-proof",
            selected,
            await value(a, "Selected"),
            "exact B click coordinate successfully selects the same unit in A camera",
          );
          await canvasLeftClick(b, point);
          evidence.action("B", "attempt-foreign-selection", { ...point });
          await expectHud(b, "Selected", "none");
          evidence.check(
            "foreign-selection",
            "none",
            await value(b, "Selected"),
            "foreign proxy click clears selection",
          );
          const startTick = await tick(b);
          await canvasRightClick(b, CANVAS_CLICK.moveTerrain);
          evidence.action("B", "attempt-foreign-move", CANVAS_CLICK.moveTerrain);
          await expectHud(b, "Destination", "none");
          evidence.check(
            "foreign-destination",
            "none",
            await value(b, "Destination"),
            "UI emits no MOVE without control",
          );
          // Observe multiple updates, no arbitrary sleep and no assertion on exact causal tick.
          const samples: { tick: number; driftA: number; driftB: number }[] = [];
          for (let index = 1; index <= 3; index++) {
            await expect.poll(() => tick(b)).toBeGreaterThanOrEqual(startTick + index * 3);
            samples.push({
              tick: await tick(b),
              driftA: cssDistance(before.get("A")!, await findLocalUnitCentroid(a)),
              driftB: cssDistance(before.get("B")!, await findLocalUnitCentroid(b)),
            });
          }
          evidence.sample("B", "foreign-negative", { ticks: samples.map((s) => s.tick) });
          evidence.observe("B", "foreign-negative", {
            samples: samples.map(({ driftA, driftB }) => ({ driftA, driftB })),
            selected: await value(b, "Selected"),
            destination: await value(b, "Destination"),
          });
          evidence.check(
            "foreign-stationary",
            true,
            samples.every((s) => s.driftA < 2 && s.driftB < 2),
            "A proxy remains stationary on both recipients across at least nine observed ticks",
          );
          await evidence.shot(b, "foreign-negative-B");
          await evidence.shot(a, "foreign-negative-A");
        }
        await canvasRightClick(a, CANVAS_CLICK.moveTerrain);
        evidence.action("A", "MOVE", CANVAS_CLICK.moveTerrain);
        await expectHud(a, "Destination", "marked");
        evidence.check(
          "destination-A",
          "marked",
          await value(a, "Destination"),
          "pointer ground command feedback",
        );
        for (const { page, actor } of pages) {
          await expect
            .poll(async () => cssDistance(before.get(actor)!, await findLocalUnitCentroid(page)), {
              timeout: 20_000,
              intervals: [400, 700, 1000],
            })
            .toBeGreaterThanOrEqual(MIN_UNIT_MOVE_CSS_PX);
          const after = await findLocalUnitCentroid(page);
          const displacement = cssDistance(before.get(actor)!, after);
          evidence.observe(actor, "move", {
            before: { ...before.get(actor)! },
            after: { ...after },
            displacementCssPx: displacement,
          });
          evidence.sample(actor, "move", { observedTick: await tick(page) });
          evidence.check(
            "movement-" + actor,
            true,
            displacement >= MIN_UNIT_MOVE_CSS_PX,
            actor === "B"
              ? "peer receives authoritative movement"
              : "owned MOVE visibly moves proxy",
          );
          await expectHud(page, "Objectives", "1");
          const objective = await expectObjectiveOnCanvas(page);
          evidence.check(
            "objective-after-" + actor,
            true,
            cssDistance(objectives.get(actor)!, objective) < MAX_OBJECTIVE_DRIFT_CSS_PX,
            "objective pixels remain in place; HUD still 1",
          );
          await expectHud(page, "Last event", "—");
          evidence.check(
            "event-" + actor,
            "—",
            await value(page, "Last event"),
            "no recipient-visible rejection",
          );
          await evidence.shot(page, "after-" + actor);
        }
        if (mode === "local")
          evidence.check("no-game-socket", [], gameSockets, "Local stays in Worker");
        if (process.env.AT7_WRONG_EXPECTATION === "1")
          evidence.check(
            "controlled-wrong-expectation",
            "FINISHED",
            await value(a, "Phase"),
            "controlled oracle negative: running match must fail FINISHED expectation",
          );
      },
    });
    expect(status, "see browser-evidence.json").toBe("PASS");
  });
}
