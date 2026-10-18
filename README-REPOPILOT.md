# RepoPilot — AI 开源产品创新 Agent

基于真实 Karakeep checkout 的 TypeScript MVP。保留原登录、收藏和导航，新增“公开 AI GitHub 仓库 → 证据采集 → LangGraph 条件补查 → 创新报告 → 收藏/反馈/Markdown 导出”。本地 Mock 闭环已运行；真实 GitHub 采集已验证；真实 LLM 尚未验证。

上游：<https://github.com/karakeep-app/karakeep>，基线 `c184eec6c9bc6df1b61c32e803ceb17dd3480596`。当前分支 `feat/repopilot-mvp`，origin 仍是官方仓库，没有创建个人远端 Fork 或推送。

## 本机运行

工作目录：`E:\RepoPilot\repopilot`（不是父目录）。已验证 Windows、Node **24.18.0**、pnpm **11.2.1**、Next.js **16.4.1**、LangGraph **1.5.1**。其他平台的脚本采用跨平台 Node API，但未实机测试。

```powershell
cd E:\RepoPilot\repopilot
npx --yes pnpm@11.2.1 install --frozen-lockfile
npx --yes pnpm@11.2.1 repopilot:setup
npx --yes pnpm@11.2.1 db:migrate
npx --yes pnpm@11.2.1 repopilot:dev
```

打开 <http://localhost:3000/signup> 注册自己的本地账号，登录后从左侧进入 RepoPilot，或访问 <http://localhost:3000/repopilot>。输入 `https://github.com/langgenius/dify`，选择技能、1/2/4 周、目标，开始研究。无需外部密钥或 Docker。

`repopilot:setup` 生成随机本地会话密钥、data 目录和必要的 `.env` 文件，保留已有文件，不输出密钥。`repopilot:dev` 从根 `.env` 读取配置，强制 Mock，并同时启动 Web 和唯一的 RepoPilot worker。Ctrl+C 停止。数据保存在 `DATA_DIR/db.db`；不要删除该目录，账号、收藏与研究记录都在其中。

Mock 使用实际录制的 Dify/LangGraph 公开响应（录制时间见报告），模型输出是固定演示文本，仍执行真实 LangGraph 分支和数据库保存。仅支持 `langgenius/dify`，其他仓库会得到明确错误，不会换名套用假报告。Mock 可生成三个方向，但每个仅有一个需求样本，置信度为低，未代表市场验证。

## 真实 API 模式

在**根 `.env`** 中自行设置以下服务端字段，不提交文件：

```dotenv
GITHUB_TOKEN=
REPOPILOT_LLM_API_KEY=
REPOPILOT_LLM_BASE_URL=
REPOPILOT_LLM_MODEL=
REPOPILOT_MAX_GITHUB_CALLS=24
REPOPILOT_MAX_LLM_CALLS=5
REPOPILOT_MAX_RUN_SECONDS=180
```

Base URL 为你认可的 HTTPS OpenAI-compatible 地址，通常以 `/v1` 结尾；程序追加 `/chat/completions`。模型需支持 `response_format: json_object` 和 `max_completion_tokens`，没有预设模型。GitHub Token 可空，公开 API 配额更低；不需要 GitHub 写权限。上限可调低，不会超过 24/5/180。未知 usage 或费用显示为空，不猜测成本。

停止已有开发服务后运行：

```powershell
npx --yes pnpm@11.2.1 repopilot:live
```

该命令明确启用 Live；用户开始研究时会调用配置的模型并可能产生费用。真实端到端尚未验收，Provider 兼容性、输出质量、引用相关性须在接入后检查。普通用户不能在页面修改模型地址或 Token。

也可使用上游 `pnpm web` 与 `pnpm workers` 分别运行，此时必须同步各应用自己的 `.env`，并明确设置模式。统一 RepoPilot 启动器优先使用根 `.env`，避免配置副本不一致。

## 测试与演示

```powershell
# 无外部网络的 RepoPilot 单元及集成测试：29 项
npx --yes pnpm@11.2.1 test --filter=@karakeep/shared --filter=@karakeep/shared-server --filter=@karakeep/trpc -- --run repopilot

# 先启动 repopilot:dev；默认使用本机 Microsoft Edge
npx --yes pnpm@11.2.1 repopilot:e2e

# 只调用真实 GitHub，不调用模型
npx --yes pnpm@11.2.1 repopilot:smoke:github

# 明确选择真实模型烟雾测试；缺少配置时输出 SKIPPED
npx --yes pnpm@11.2.1 repopilot:smoke:live
```

E2E 创建独立自测账号，不使用真实用户资料；账号仍保留在本地数据库，测试的研究记录会删除。浏览器可通过 `REPOPILOT_BROWSER_CHANNEL` 配置，服务地址可通过 `REPOPILOT_TEST_URL` 配置。脚本不自动安装浏览器。截图：`data/repopilot-demo/report.png`（本地忽略目录）。

## 已知限制及故障处理

- 一用户仅一个进行中研究；同配置请求复用任务。全局 worker 默认顺序处理。queued 长时间不变时检查 worker；崩溃后的 running 在租约超时后重新执行，最多三次，再转失败。不是节点级断点续跑。
- Mock 启动器只运行研究 worker。点击收藏仍复用 Karakeep 的原书签逻辑，普通抓取任务会排队；开启完整 workers 后处理。不要把“收藏成功”误解为“网页抓取和全文搜索成功”。
- 本机 Docker Linux 引擎未就绪，未配置 Meilisearch；原 crawler 的 DNS 解析报 `ECONNREFUSED`。登录、收藏保存和 RepoPilot 原生 fetch 不受此错误影响；原网页抓取/搜索未验收。不关闭上游 SSRF/DNS 防护绕过错误。
- GitHub 限流返回明确错误或带警告的部分报告；等待提示的时间后手动重试。无凭据、非 AI 仓库、缺失来源、模型 schema 不合规均有失败说明。
- 引用校验能确认 ID/URL 来自已获取数据，不能证明每个推断语义正确、需求仍未解决或技术适配有效；仍需打开来源复核。创意去重是启发式。
- 报告只导出 Markdown，不做 PDF、代码生成、PR 自动发布、多 Agent、P1 功能。目录摘要仅根目录元数据，没有实现逐文件代码分析。
- 包级 format 在本机未修改的 CRLF checkout 文件上失败；本次所有修改的代码文件格式通过。详见测试报告。未运行全仓测试或生产镜像构建。

## 交付文档

- [产品定义](docs/repopilot/PRD.md)
- [实际架构与文件路径](docs/repopilot/ARCHITECTURE.md)
- [真实测试结果](docs/repopilot/TEST_REPORT.md)
- [3–5 分钟演示](docs/repopilot/DEMO_SCRIPT.md)
- [阶段决策与命令](docs/repopilot/DECISIONS.md)
- [分阶段修改记录](docs/repopilot/CHANGELOG.md)

保留 Karakeep 原 AGPL-3.0 许可证和版权声明。
