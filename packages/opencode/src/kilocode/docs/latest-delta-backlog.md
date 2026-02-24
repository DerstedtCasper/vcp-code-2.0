# Latest Delta Backlog（对上游最新增量）

生成时间：2026-02-24

## 已落地增量（摘要）

- B 段：`prompts/help/popout/openInNewTab/import/export` 命令链路已补齐。
- D 段：`agent_team` 主模式与 `/experimental/vcp/agent-team/status` 诊断接口已落地。
- E 段：busy 三态、提示队列协议、后端队列 API 与可视化重排已落地。
- F 段：CAS revision、写队列、冲突回滚、stale 响应丢弃与写入口审计已落地。
- H 段：Context 记忆中心（5 分区）、Memory CRUD、preview 手动干预（Pin/Exclude/Compress）已落地。

## 待落地增量（当前 backlog）

### P0

- Phase B: parity e2e 基线回归（目标 >=95%）
- 验证门槛：全链路回归（配置一致性/队列行为/Agent Team 模式/VCP 入口/Context 记忆中心）

### P1

- Phase G: hooks、异步任务流、快照工作流接入
- Phase G: 技能分发策略与 VCP 工具协同
- Phase G: WindowSensor/ScreenPilot 观测链路可视化
- Phase G: vcp_dynamic_fold 运行态可视化
- Phase G: 工具后 RAG/记忆刷新事件语义统一

### P2

- 品牌与文案：全局文案去 Kilo 残留（非 VCP 页）

## 变更策略

- 每完成一个 backlog 条目，需同步更新 `unlanded-todo.md` 与本文件。
