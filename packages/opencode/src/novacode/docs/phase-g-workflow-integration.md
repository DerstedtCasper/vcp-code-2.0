# Phase G 工作流接入说明（hooks / 异步任务流 / 快照）

生成时间：2026-02-24

## 已接入点

### 1) hooks 接入

- 文件：`packages/opencode/src/session/processor.ts`
- 在 VCP TOOL_REQUEST 执行路径中触发：
  - `Plugin.trigger("tool.execute.before", ...)`
  - `Plugin.trigger("tool.execute.after", ...)`

### 2) 异步任务流

- Busy 三态 + Prompt Queue 已形成异步排队与自动出队执行链路。
- 相关协议：
  - `requestPromptQueue`
  - `enqueuePrompt`
  - `dequeuePrompt`
  - `reorderPromptQueue`
  - `promptQueueUpdated`

### 3) 快照工作流

- 文件：`packages/opencode/src/session/processor.ts`
- 已接入 `Snapshot.track()` 与 `Snapshot.patch()`，用于会话处理周期内的变更追踪与补丁计算。

## 结论

- hooks、异步任务流、快照工作流在当前 VCP 会话处理主链路中已完成接入，满足 Phase G 该条目要求。
