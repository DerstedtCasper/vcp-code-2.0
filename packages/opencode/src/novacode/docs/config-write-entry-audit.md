# Config 写入口审计（VCP Code 2.0）

生成时间：2026-02-24

## 审计范围

- `packages/nova-vscode/webview-ui/src/components/settings/ContextTab.tsx`
- `packages/nova-vscode/webview-ui/src/components/settings/AgentBehaviourTab.tsx`
- `packages/nova-vscode/webview-ui/src/components/settings/*Tab.tsx`（其余设置页）

## 结论

- `vcp.memory.*`：已收敛为 **ContextTab 单入口可写**。
- AgentBehaviour 的 VCP 子页不再直接写入 `vcp.memory.*`，改为只读迁移提示。
- 当前未发现同一 key 在多个设置入口同时可写的冲突项（以 `updateConfig` 直接路径写入为准）。

## 关键条目

- `vcp.memory.enabled`
- `vcp.memory.passive.*`
- `vcp.memory.writer.*`
- `vcp.memory.retrieval.*`
- `vcp.memory.refresh.*`

以上条目均由 `ContextTab` 写入。

## 风险与后续

- 若后续新增设置页，请在合并前执行同级审计，确保新增 key 不复用已有写入口。
- 建议在 CI 增加轻量规则：新增 `updateConfig` 路径时，检查是否命中已登记的独占 key。
