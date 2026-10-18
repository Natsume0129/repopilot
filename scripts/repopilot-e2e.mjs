import { randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { chromium, expect } from "playwright/test";

const base = process.env.REPOPILOT_TEST_URL ?? "http://localhost:3000";
const browser = await chromium.launch({
  channel: process.env.REPOPILOT_BROWSER_CHANNEL ?? "msedge",
  headless: true,
});
async function signup(page) {
  await page.goto(`${base}/signup`);
  const password = randomUUID();
  await page
    .getByLabel("Full Name", { exact: true })
    .fill("RepoPilot Self Test");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`repopilot-e2e-${randomUUID()}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/bookmarks$/, { timeout: 60000 });
}
try {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await signup(page);
  await page
    .getByRole("link", { name: "RepoPilot / AI 产品创新", exact: true })
    .first()
    .click();
  await expect(page.getByText(/演示模式：/)).toBeVisible();
  await page
    .getByLabel("公开 GitHub 仓库")
    .fill("https://github.com/langgenius/dify");
  await page.getByRole("checkbox", { name: "Python", exact: true }).check();
  await page.getByLabel("开发周期").selectOption("2");
  await page.getByRole("button", { name: "开始研究", exact: true }).click();
  await expect(page).toHaveURL(/\/repopilot\/runs\//, { timeout: 30000 });
  const detailUrl = page.url();
  await page.reload();
  await expect(page.getByTestId("opportunity")).toHaveCount(3, {
    timeout: 60000,
  });
  await expect(page.getByText(/定向补充检索 · 成功/)).toBeVisible();
  const links = await page
    .getByTestId("opportunity")
    .locator('a[href*="/issues/"]')
    .evaluateAll((nodes) => nodes.map((n) => n.href));
  expect(links).toHaveLength(3);
  expect(
    links.every((url) =>
      /^https:\/\/github\.com\/langgenius\/dify\/issues\/\d+$/.test(url),
    ),
  ).toBe(true);
  page.on("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "保存 GitHub 项目到 Karakeep", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "已收藏 · 再次确认" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "已收藏 · 再次确认" }).click();
  await expect(
    page.getByText("已保存到 Karakeep", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "有帮助", exact: true })
    .first()
    .click();
  await expect(page.getByText(/已记录：有帮助/)).toBeVisible();
  await page
    .getByRole("button", { name: "标记采纳", exact: true })
    .first()
    .click();
  await expect(page.getByText(/已记录：有帮助.*已采纳/)).toBeVisible();
  await page
    .getByRole("button", { name: "复制 Markdown", exact: true })
    .click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(links[0]);
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下载 Markdown", exact: true })
    .click();
  const download = await downloadPromise;
  const exported = await readFile(await download.path(), "utf8");
  // Windows clipboard normalizes LF to CRLF; compare text with normalized EOLs.
  expect(exported.replace(/\r\n/g, "\n")).toBe(copied.replace(/\r\n/g, "\n"));
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw new Error(`Report overflow at ${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole("heading", { name: "langgenius/dify · 研究报告", exact: true })
    .scrollIntoViewIfNeeded();
  await mkdir("data/repopilot-demo", { recursive: true });
  await page.screenshot({
    path: "data/repopilot-demo/report.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "返回研究列表", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "langgenius/dify", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("link", { name: "langgenius/dify", exact: true })
    .click();
  await expect(page.getByTestId("opportunity")).toHaveCount(3);
  await page.goto(`${base}/dashboard/bookmarks`);
  await expect(page.locator("[data-bookmark-index]")).toHaveCount(1);
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signup(otherPage);
  await otherPage.goto(detailUrl);
  await expect(
    otherPage.getByRole("alert").filter({ hasText: "研究任务不存在" }),
  ).toBeVisible();
  await other.close();
  await page.goto(`${base}/repopilot`);
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText("暂无研究任务。", { exact: true })).toBeVisible();
  await context.clearCookies();
  await page.goto(detailUrl);
  await expect(page).toHaveURL(/\/signin/);
  console.log(
    "PASS: signup → research → refresh → 3 cited opportunities → real supplement trace → bookmark idempotency → feedback/adoption → clipboard/download → history → second-user denial → delete → anonymous redirect. Desktop/mobile no overflow. Screenshot: data/repopilot-demo/report.png",
  );
} finally {
  await browser.close();
}
