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
} finally {
  await browser.close();
}
