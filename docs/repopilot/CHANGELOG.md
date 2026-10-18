# 分阶段修改记录

| Phase | Git commit | 实际变更 |
| --- | --- | --- |
| 0 | `661632097dd3fde7b97a28e4363a5ef31575bc91` | 真实 Karakeep 基线、运行决策、原登录/书签浏览器脚本 |
| 1 | `1a613a80355e0ba39f92bfa5ec32098bf56e68f1` | 登录保护页面、导航、表单骨架、输入校验 |
| 2 | `7399591937e9206242df087e3e9a26b88c76991f` | Drizzle 0095、任务/证据/反馈/事件表、owner tRPC、租约队列 |
| 3 | `93bd0d376ff9370707eeaafbfd8aad48ccb3194b` | GitHub 有界采集、真实录制 fixture、网络异常测试 |
| 4 | `89d7012e379af2fd231ca9475b9fbf825e03d602` | LangGraph、Provider、引用/评分/去重、worker、结构化报告 |
| 5 | `3672739fbddf0125ed0fafbeb81d3e8fd732b5e8` | 完整报告 UI、轮询历史、收藏反馈、Markdown、浏览器 E2E |
| 6 | `56187c7fc0a09dafc917a24b9fb9e3df9bd6323d` | 硬超时、流式限制、预算、稳定分页、安全与恢复测试 |
| 7 | 以 `git log -1` 查询交付提交 | README、PRD、架构、测试报告、演示说明、统一启动器与真实 smoke |

完整提交与文件列表：

```bash
git log --format='%H %s' c184eec6c9bc6df1b61c32e803ceb17dd3480596..HEAD
git diff --stat c184eec6c9bc6df1b61c32e803ceb17dd3480596..HEAD
```

Phase 7 文档无法在同一提交中嵌入该提交自己的 SHA；以最终交付消息和 Git 历史为准。没有 push，没有创建远端 PR。
