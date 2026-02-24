# VCP 全链路回归 Smoke Report

Generated: 2026-02-24T08:43:10.282Z
Result: PASS (5/5)

- [x] 配置一致性（单入口写入）: AgentBehaviour 记忆入口已只读迁移，避免多入口写同 key
- [x] 队列行为协议: Prompt 队列协议字段已存在
- [x] Agent Team 模式: agent_team prompt 与 status 路由已存在
- [x] VCP 入口导航: VCP 入口命令存在，且 parity baseline 覆盖率满足 >=95%
- [x] Context 记忆中心: ContextTab 五分区 + memory preview + 工具后记忆刷新事件语义已贯通
