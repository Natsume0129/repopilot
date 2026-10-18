# RepoPilot 测试报告

日期：**2026-10-19，Asia/Tokyo**。以下均为本次实际执行记录，不是预期结果。测试样本为本地自测；没有真实用户研究结果。

## 环境

- Windows / PowerShell；工作目录 `E:\RepoPilot\repopilot`。
- Node 24.18.0；pnpm 11.2.1（通过 `npx --yes pnpm@11.2.1` 调用）；Git 2.51.0.windows.2。
- Karakeep 上游 SHA：`c184eec6c9bc6df1b61c32e803ceb17dd3480596`。
- Next.js 16.4.1；LangGraph 1.5.1；Vitest 4.1.11；Playwright + 本机 Microsoft Edge headless。
- SQLite 本地库及每个集成用例的新建内存迁移库；没有使用真实用户资料。
- Docker CLI 28.4.0 存在，Linux engine named pipe 不可用。未用 Docker 验收。

下列 `pnpm` 命令实际均使用上述固定版本 npx 前缀。测试文件路径注明 cwd；没有运行全仓测试套件。

## PASS

| 命令 / 操作 | cwd | 实际结果 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 根 | 依赖安装成功；SQLite 原生模块编译成功 |
| `pnpm db:migrate` | 根 | 干净本地库迁移成功；新增 0095 后升级成功 |
| `pnpm exec vitest run auth.test.ts` | packages/trpc | 20/20 |
| `pnpm exec vitest run routers/bookmarks.test.ts` | packages/trpc | 45/45 |
| `node scripts/repopilot-baseline.mjs` | 根 | 浏览器注册、清会话后登录、创建原书签、刷新保留 |
| `node scripts/repopilot-baseline.mjs --repopilot` | 根 | Phase 1 导航、刷新、1280/390 布局、未登录重定向 |
| `pnpm test --filter=@karakeep/shared --filter=@karakeep/shared-server --filter=@karakeep/trpc -- --run repopilot` | 根 | **29/29，5 个文件** |
| `pnpm typecheck --filter=@karakeep/shared --filter=@karakeep/db --filter=@karakeep/shared-server --filter=@karakeep/trpc --filter=@karakeep/workers --filter=@karakeep/web` | 根 | 6/6 包成功 |
| 最后修改后的 `pnpm typecheck --filter=@karakeep/shared-server --filter=@karakeep/trpc --filter=@karakeep/web` | 根 | 3/3 包成功 |
| `pnpm lint` 加上述 6 个包 filter | 根 | 0 errors；Web 23 条未修改上游文件警告 |
| `oxfmt --check`，仅本次 33 个新增/修改 TS/TSX/MJS | 根 | 33 文件通过（Phase 6） |
| `node scripts/repopilot-e2e.mjs` | 根 | 完整 Mock 浏览器闭环通过 |
| `node scripts/repopilot-record-fixture.mjs` | 根 | 实际录制 8 个公开端点，保存 5 条非 PR issue |
| `pnpm repopilot:smoke:github` | 根 | 真实 GitHub 6 请求，README/元数据与 3 条 issue 列表/详情匹配 |
| `node scripts/repopilot-setup.mjs` | 根 | 保留已有 env，准备本地目录成功 |
| `pnpm repopilot:dev` | 根 | 统一启动器启动 Web 与仅 RepoPilot worker 成功 |

29 项 RepoPilot 测试包含：

- 输入 13 项：URL/fullName、大小写、`.git`、恶意主机、路径/查询注入、空值。
- GitHub 4 组：真实形状 fixture、缓存、零网络、分页、PR 排除、去重、正文上限、空 issue、缺 README、private 拒绝、redirect 拒绝、429 重试等待、请求预算、超时。
- Graph 3 组：真实 LangGraph 补查分支且一次、模型请求 3 次、引用存在、三个不同痛点、评分求和、伪造引用去除、重复方案不填充、技能/周期降级、abort、非 AI 判断。
- 安全 4 组：恶意文本仅在 JSON 数据块中、系统指令未被替换、模型内容不含 API Key、输出 schema 重试上限、HTTP 错误不显示原始响应、流式大小限制、Mock 模型预算、Markdown 转义。
- 集成 5 组：匿名拒绝、所有 owner 保护操作、创建/list/get/delete、单用户并发约束与去重、租约回收及旧令牌拒绝、重试新 run、原收藏重复安全、反馈验证、completed 持久化、缺 Live 配置 failed、永不返回 Provider 的硬超时、最大恢复次数、同时间戳分页、关联删除。

浏览器闭环实际验证：新用户注册 → 输入 Dify/技能/两周 → 发起研究 → 详情刷新 → 三个方向与真实补查轨迹 → 引用 URL → 确认收藏两次但仅一个书签 → 有帮助/采纳 → 剪贴板/下载一致 → 历史刷新 → 另一用户被拒绝 → 删除 → 清除会话后直接访问被重定向。桌面 1280 和手机 390 宽度无横向溢出。

实际生成截图：`E:\RepoPilot\repopilot\data\repopilot-demo\report.png`。没有录制视频。

真实 GitHub 烟雾核对来源：

- <https://github.com/langgenius/dify/issues/44292>
- <https://github.com/langgenius/dify/issues/43455>
- <https://github.com/langgenius/dify/issues/44289>

核对的是公开 API 列表与详情的标题/URL 一致，不是“所有建议语义正确”的证明。

## FAIL / 已修复的执行问题

1. Git Bash pre-commit 找不到 pnpm（环境只有 `.cmd` shim）。完成针对性检查后用进程局部 `HUSKY=0` 提交，记录在 DECISIONS；没有声称 hook 通过。
2. 新依赖和 liteque 的 Zod 4.6.5 与 shared 锁定 4.3.6 类型不兼容。修复跨包版本、清理旧增量缓存，类型检查最终通过。
3. 书签 `type` 最初用了字符串而非上游 enum；修复为 `BookmarkTypes.LINK`，最终类型检查通过。
4. 第一次 E2E 剪贴板是 CRLF、下载是 LF。仅规范化测试比较的换行，未绕过内容检查；随后发现查询重试延迟权限错误，UI 改为不重试不可恢复错误，E2E 最终通过。
5. 初版烟雾脚本根目录 CJS 不支持 top-level await，且根目录不链接 shared-server workspace。改成 async main + 相对源码入口，真实 GitHub 烟雾最终通过。

## 未解决 / SKIPPED

- **包级 format：FAIL。** `pnpm format` 加上述 6 个 filter 全部报告未改上游文件格式差异。`git ls-files --eol` 确认这些文件是 index LF / worktree CRLF；示例 `packages/shared/assetdb.ts`、`packages/db/drizzle.ts`、`apps/web/server/auth.ts` 没有代码 diff。本次改动单独格式检查 PASS；没有批量修改无关文件。
- **真实 LLM 端到端：SKIPPED（未配置 API Key/Base URL/模型名）。** 实际执行 `pnpm repopilot:smoke:live` 输出 SKIPPED。Mock 不等价于 Live 成功。
- **Meilisearch 全文搜索：SKIPPED（服务未配置）。**
- **原 crawler 对 GitHub 网页抓取：FAIL（上游 DNS helper 的 ECONNREFUSED）。** worker 进程启动和原书签创建/持久化 PASS，但网页内容抓取不算通过。未通过关闭 SSRF/IP 验证绕过。
- 生产镜像/生产构建、Linux/macOS 实机、全仓套件、进程强杀后真实时间恢复演练：未执行。恢复逻辑以租约/超时集成测试验证。
- 未进行真实用户访谈、创新价值评测、引用语义有效率评测、成本统计。事件仅支持后续本地分析，不提供虚构增长指标。

结论：**可运行的本地 Mock MVP 和真实 GitHub 采集已验证；完整 Live 与原抓取/搜索环境仍待验收。**
