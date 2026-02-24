# A(5.9) / B(latest) 并行验收门槛与白名单

生成时间：2026-02-24

## A/B 定义

- A（5.9 parity）：与 Kilo 5.9 已有交互对齐能力。
- B（latest delta）：VCP 专区、Agent Team、Busy 队列、Memory 中心等增量能力。

## 验收门槛（Gate）

### Gate A（5.9 parity）

- 导航动作链路完整：`plus/marketplace/history/profile/vcp/settings/prompts`
- 设置页关键子页可用：`Prompts/Terminal/AgentBehaviour.rules/workflows`
- 类型检查通过：`packages/kilo-vscode check-types`

### Gate B（latest delta）

- Busy 三态 + 提示队列：协议、后端 API、前端可视化一致
- Agent Team：`agent_team` 模式可选、诊断接口可读
- Memory 中心：CRUD + Preview（Pin/Exclude/Compress）链路可用
- 类型检查通过：`packages/opencode typecheck` + `bun turbo typecheck`

## 白名单（允许短期差异）

- `marketplace` 仍为占位视图（Dummy），不阻塞核心链路验收
- 文案层面允许非核心页面暂存 Kilo 历史命名（需持续清理）

## 失败判定

- 任一 Gate 的核心链路缺失或类型检查失败，即判定本轮验收不通过。
