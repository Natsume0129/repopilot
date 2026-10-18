import { randomUUID } from "node:crypto";
import { chromium, expect } from "playwright/test";

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  const email = `repopilot-${randomUUID()}@example.com`;
  const password = randomUUID();
  await page.goto("http://localhost:3000/signup");
  await page
    .getByLabel("Full Name", { exact: true })
    .fill("RepoPilot Baseline");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/bookmarks$/, { timeout: 60000 });
  await page.context().clearCookies();
  await page.goto("http://localhost:3000/signin");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/bookmarks$/, { timeout: 60000 });
  await expect(
    page.getByPlaceholder("Paste a link, write a note or drop an image…"),
  ).toBeVisible();
  await page
    .getByPlaceholder("Paste a link, write a note or drop an image…")
    .fill("https://github.com/karakeep-app/karakeep");
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.locator("[data-bookmark-index]")).toHaveCount(1);
  await page.reload();
  await expect(page.locator("[data-bookmark-index]")).toHaveCount(1);
  console.log(
    "PASS: original Karakeep signup, fresh-session login, bookmark creation and persistence",
  );
  if (process.argv.includes("--repopilot")) {
    await page
      .getByRole("link", { name: "RepoPilot / AI 产品创新", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "RepoPilot / AI 产品创新" }),
    ).toBeVisible();
    await page.reload();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        page.getByRole("button", { name: "开始研究" }),
      ).toBeVisible();
      if (
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        )
      )
        throw new Error("Horizontal overflow");
    }
    await page.context().clearCookies();
    await page.goto("http://localhost:3000/repopilot");
    await expect(page).toHaveURL(/\/signin/);
    console.log(
      "PASS: RepoPilot navigation, refresh, desktop/mobile layout and anonymous redirect",
    );
  }
} finally {
  await browser.close();
}
