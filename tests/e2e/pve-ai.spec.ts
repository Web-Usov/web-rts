import { test, expect } from "@playwright/test";

// The production spawn/replication flow belongs to G10/G11. This fixture invokes
// production World, navigation, movement and combat through browser buttons.
test("PvE fixture advances, engages locally, breaches Walls and retries STALLED", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/@fs" + process.cwd() + "/tests/e2e/fixtures/g9-pve.html");
  const status = page.locator("#status");
  await page.locator("#ten").click();
  await expect(status).toContainText("ADVANCING");
  for (let i = 0; i < 4; i++) await page.locator("#ten").click();
  await expect(status).toContainText("objective HP 970");
  await page.locator("#local").click();
  await page.locator("#step").click();
  await expect(status).toContainText("local 3");
  for (let i = 0; i < 6; i++) await page.locator("#ten").click();
  await expect(status).toContainText("local —");
  await expect(status).toContainText("ATTACKING");
  await page.locator("#breach").click();
  await page.locator("#step").click();
  await expect(status).toContainText("BREACH_SEARCH");
  await page.locator("#step").click();
  await expect(status).toContainText("blocker 6");
  for (let i = 0; i < 34; i++) await page.locator("#ten").click();
  await expect(status).toContainText("blocker —");
  await expect(status).toContainText("ATTACKING");
  await page.locator("#stall").click();
  await page.locator("#ten").click();
  await expect(status).toContainText("STALLED");
  await expect(status).toContainText("aiQueries 0");
  await page.locator("#open").click();
  await page.locator("#step").click();
  await expect(status).toContainText("ADVANCING");
  await expect(status).toContainText("aiQueries 1");
  expect(errors).toEqual([]);
});
