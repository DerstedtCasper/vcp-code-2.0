# VCP Code 2.0 全量开发 TODO（总规划执行基线）

> 目标：按 `vcpcode开发文档 + helloagents/wiki/vcp` 全量落地，直到规划项全部完成。

## Phase A | 双基线差异冻结

- [x] 生成 Kilo 5.9 Parity Matrix（页面/命令/action/状态机/快捷键/i18n 键）
- [x] 生成 Latest Delta Backlog（与上游最新增量差异）
- [x] 建立 A(5.9)/B(latest) 并行验收门槛与白名单

## Phase B | Kilo 5.9 交互补齐

- [x] 补齐缺失命令：`prompts/help/popout/openInNewTab/import/export` 等
- [x] 扩展 `App` 视图与导航动作对齐 5.9
- [x] `PromptsTab` 从 placeholder 升级为功能页
- [x] `TerminalTab` 从 placeholder 升级为功能页
- [x] `AgentBehaviour.rules/workflows` 从 placeholder 升级为功能页
- [x] parity e2e 基线回归（目标 >=95%）

## Phase C | VCP 独立侧边栏专区

- [x] 新增 `vcp` 视图类型与导航动作
- [x] 侧栏标题增加 `vcpButtonClicked` 入口
- [x] 新增 `VCP 控制中心` 页面骨架
- [x] 协议桥接状态面板（contextFold/vcpInfo/toolRequest/html）
- [x] 分布式状态与通知策略面板
- [x] 高级诊断面板（serverId/clientId/重试链路）

## Phase D | Agent Team 主模式化

- [x] 保留 `vcp.agentTeam` 配置并接入 orchestration policy 注入
- [x] 新增 primary agent：`agent_team`
- [x] 新增 `agent-team` 独立 prompt
- [x] `agent_team` 模式权限模板（task/todo/read/grep/glob/list/必要bash）
- [x] `ModeSwitcher` 可显示 `agent_team`（通过 primary agent 暴露）
- [x] `vcp.agentTeam` 运行态诊断接口 `/experimental/vcp/agent-team/*`

## Phase E | Busy 插话三态 + 队列自动发送

- [x] `busyMode` 协议字段：`guide | queue | interrupt`
- [x] PromptInput 新增 busy 三态选择交互（立即插入/加入队列/中断并发送）
- [x] 扩展消息协议：`requestPromptQueue/enqueuePrompt/dequeuePrompt/reorderPromptQueue/promptQueueUpdated`
- [x] 扩展端内存队列与 idle 自动出队发送
- [x] 后端队列 API `/experimental/vcp/queue/*`
- [x] 队列暂停策略（权限询问/问题询问未决时暂停）
- [x] 队列可视化重排与置顶

## Phase F | 配置统一入口 + 竞态防护

- [x] 全局配置 `revision/CAS`：`expectedRevision` + `config_conflict`
- [x] `GET /experimental/vcp/config/revision`
- [x] Webview `ConfigMutationQueue` 串行提交
- [x] key-path 深合并与冲突回滚
- [x] 统一配置入口审计：同一 key 单入口可写，其它入口只读跳转
- [x] 过期响应丢弃与写队列可观测日志

## Phase G | Snow + VCPChat 工程化补齐

- [x] hooks、异步任务流、快照工作流接入
- [x] 技能分发策略与 VCP 工具协同
- [x] WindowSensor/ScreenPilot 观测链路可视化
- [x] vcp_dynamic_fold 运行态可视化
- [x] 工具后 RAG/记忆刷新事件语义统一

## Phase H | Context 记忆控制中心重构

- [x] `ContextTab` 重构为 5 分区（基础压缩/记忆注入/记忆写入/记忆库管理/上下文盒规则）
- [x] AgentBehaviour 中记忆配置迁移为只读跳转
- [x] Memory CRUD 消息协议：overview/search/update/delete
- [x] Memory API 路由组 `/experimental/vcp/memory/*`
- [x] `memory-runtime` 扩展 CRUD 与 context box preview
- [x] `vcp.memory.retrieval` 参数化（语义路/时间路）
- [x] `vcp.memory.refresh` 参数化（工具后刷新与权重）
- [x] Context Box 可视化预览与手动干预（移除/压缩/Pin）

## 品牌与 i18n 收口

- [x] 清理 VCP 页面硬编码英文
- [x] `zh/en` parity 校验
- [x] 全局文案去 Kilo 残留

## 验证与发布门槛

- [x] `packages/opencode` 定向 typecheck 通过
- [x] `packages/nova-vscode` 定向 check-types 通过
- [x] 全仓 `bun turbo typecheck` 通过
- [x] 全链路回归：配置一致性/队列行为/Agent Team 模式/VCP 入口/Context 记忆中心

## 当前阻断

- [x] 阻断修复：`packages/app/src/custom-elements.d.ts` TS1128（已修复）
