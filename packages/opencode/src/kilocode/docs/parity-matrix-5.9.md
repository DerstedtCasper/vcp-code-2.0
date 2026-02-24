# Kilo 5.9 Parity Matrix（VCP Code 2.0）

生成时间：2026-02-24

## 1) 页面/视图矩阵

| 视图 ID | 当前状态 | 入口动作 |
|---|---|---|
| `newTask` | 已实现 | `plusButtonClicked` |
| `marketplace` | 占位页（Dummy） | `marketplaceButtonClicked` |
| `history` | 已实现 | `historyButtonClicked` |
| `profile` | 已实现 | `profileButtonClicked` |
| `settings` | 已实现 | `settingsButtonClicked` / `promptsButtonClicked` |
| `vcp` | 已实现 | `vcpButtonClicked` |

## 2) 命令/动作矩阵（核心导航）

| 命令 | Extension 侧 | App 侧动作处理 |
|---|---|---|
| `vcp-code.new.plusButtonClicked` | ✅ | ✅ |
| `vcp-code.new.marketplaceButtonClicked` | ✅ | ✅ |
| `vcp-code.new.historyButtonClicked` | ✅ | ✅ |
| `vcp-code.new.profileButtonClicked` | ✅ | ✅ |
| `vcp-code.new.vcpButtonClicked` | ✅ | ✅ |
| `vcp-code.new.settingsButtonClicked` | ✅ | ✅ |
| `vcp-code.new.promptsButtonClicked` | ✅ | ✅ |
| `vcp-code.new.helpButtonClicked` | ✅（外链文档） | N/A |
| `vcp-code.new.popoutButtonClicked` | ✅（新标签页） | N/A |
| `vcp-code.new.openInNewTab` | ✅（新标签页） | N/A |
| `vcp-code.new.importConfig` | ✅ | N/A |
| `vcp-code.new.exportConfig` | ✅ | N/A |

## 3) 状态机与运行态（最小基线）

- 会话状态：`idle | busy | retry`
- Busy 插话模式：`guide | queue | interrupt`
- Prompt 队列协议：`requestPromptQueue/enqueuePrompt/dequeuePrompt/reorderPromptQueue/promptQueueUpdated`
- 配置写入保护：`expectedRevision + config_conflict + stale response drop`

## 4) 快捷键与命令贡献（基线）

- `package.json` 已注册 `vcp-code.new.*` 命令（含导航、agent manager、代码动作、终端动作）。
- 导航命令已在 view/title 与 editor/title 菜单暴露关键入口。

## 5) i18n 基线

- `webview-ui/src/i18n/en.ts`：`889` keys（基准）。
- 本轮新增 `vcp.view.*` 与 `view.marketplace.title`，用于去除 VCP 页硬编码文案。

## 6) 备注

- 该矩阵作为 5.9 对齐验收基线文档；后续变更需同步更新本文件。
