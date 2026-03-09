# VSCode Workspace 技术汇报：Agent Manager / Agent Runtime 架构与现状

- 工作区：`c:/project/vcpcode`
- 文档目的：说明当前 Agent Manager 的实际技术架构、使用方式、配置方式，以及当前缺陷与边界。
- 结论摘要：当前实现是**主控型多 Agent 会话管理架构**，支持多 session、多 worktree、恢复与独立进程隔离；但它**不是自发式 Agent 间互相沟通架构**，也**尚不能证明已实现真正的跨 Agent 自动编排与结果接力**。

---

## 1. 汇报范围

本报告基于以下实现位置进行分析：

- `src/activate/registerCommands.ts`
- `src/core/nova/agent-manager/AgentManagerProvider.ts`
- `src/core/nova/agent-manager/RuntimeProcessHandler.ts`
- `src/core/nova/agent-manager/AgentRegistry.ts`
- `src/core/nova/agent-manager/WorktreeManager.ts`
- `packages/core-schemas/src/agent-manager/types.ts`
- `packages/agent-runtime/src/process.ts`
- `packages/agent-runtime/src/services/extension.ts`
- `webview-ui/src/nova/agent-manager/components/*`
- `AGENTS.md`

---

## 2. 总体结论

### 2.1 当前能力定位

当前系统更准确的定位是：

> **主控型 Multi-Agent Session Manager**

而不是：

> **自发式 Multi-Agent Orchestrator**

### 2.2 能力边界

当前已具备：

- 多个 Agent session 的创建、运行、停止、恢复
- Agent 进程隔离（每个 Agent 为独立 Node.js 子进程）
- worktree 级隔离（parallel mode）
- 多版本并列运行（multi-version）
- Webview / Extension / Agent Runtime 的状态同步

当前尚不能证明：

- Agent A 自动将结果交给 Agent B
- 基于依赖图的自动任务拆分与调度
- Agent 间 peer-to-peer 自发式通信
- 真正意义上的团队协作流水线（分析 → 实现 → 测试 自动接力）

---

## 3. 正确的技术架构

## 3.1 架构角色划分

### A. VSCode Extension 层

负责：

- 注册命令
- 打开 Agent Manager 面板
- 持有 AgentManagerProvider

关键入口：

- `src/activate/registerCommands.ts`

### B. AgentManagerProvider（主控）

负责：

- 接收 Webview 消息
- 解析 startSession / sendMessage / resumeSession / cancelSession 等命令
- 组织 worktree、providerSettings、modes、secrets 等启动上下文
- 调用 RuntimeProcessHandler 真正拉起 Agent 进程
- 将状态推回 Webview

关键位置：

- `src/core/nova/agent-manager/AgentManagerProvider.ts`

### C. RuntimeProcessHandler（进程调度器）

负责：

- `fork()` 子进程
- 维护 `pendingProcess` 与 `activeSessions`
- 将主控消息通过 Node IPC 发送给 Agent
- 接收 Agent 发回的 `ready / message / stateChange / error`

关键位置：

- `src/core/nova/agent-manager/RuntimeProcessHandler.ts`

### D. AgentRegistry（会话状态仓库）

负责：

- 记录 session 列表
- 记录当前选中 session
- 记录 pending session
- 更新 session 状态、并行模式信息等

关键位置：

- `src/core/nova/agent-manager/AgentRegistry.ts`

### E. Agent Runtime 子进程

负责：

- 读取 `AGENT_CONFIG`
- 创建 `ExtensionService`
- 注入 configuration / secrets / resumeData
- 将 Extension 层消息转回父进程

关键位置：

- `packages/agent-runtime/src/process.ts`

### F. ExtensionService / ExtensionHost / MessageBridge

负责：

- 在无 VSCode UI 的独立子进程中承载扩展逻辑
- 使用事件驱动方式向父进程发出 `ready / message / stateChange / warning / error`
- 将来自父进程的 WebviewMessage 注入到扩展宿主

关键位置：

- `packages/agent-runtime/src/services/extension.ts`

### G. Webview UI

负责：

- 展示 session 列表、消息、状态、模式、模型、worktree 信息
- 发起 start / stop / resume / sendMessage / finishWorktreeSession / create PR 等操作

关键位置：

- `webview-ui/src/nova/agent-manager/components/*`

---

## 3.2 实际架构图（正确版本）

```text
┌─────────────────────────────────────────────────────────┐
│                    VSCode Extension                     │
│                                                         │
│  registerCommands.ts                                    │
│          │                                              │
│          ▼                                              │
│  AgentManagerProvider  ───────►  AgentRegistry          │
│          │                        (session state)        │
│          │                                              │
│          ├──────────────► RuntimeProcessHandler         │
│          │                     │                         │
│          │                     │ fork() + IPC            │
└──────────┼─────────────────────┼─────────────────────────┘
           │                     │
           │ Webview messages    ▼
           │               ┌─────────────── Child Process ────────────────┐
           │               │ packages/agent-runtime/src/process.ts        │
           │               │                                               │
           │               │   AGENT_CONFIG                                │
           │               │      │                                        │
           │               │      ▼                                        │
           │               │   ExtensionService                            │
           │               │      │                                        │
           │               │      ├── ExtensionHost                        │
           │               │      └── MessageBridge                        │
           │               └───────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│                     Webview UI                          │
│ SessionDetail / ChatInput / MessageList / ModeSelector  │
└─────────────────────────────────────────────────────────┘
```

---

## 3.3 时序图：启动一个 Agent Session

```text
User/Webview
  → agentManager.startSession
AgentManagerProvider
  → 解析参数、准备 workspace / model / mode / images
  → 如 parallelMode=true，则先创建 worktree
  → spawnAgentWithCommonSetup(...)
RuntimeProcessHandler
  → buildAgentConfig(...)
  → fork(agent-runtime-process)
Child Process (process.ts)
  → 读取 AGENT_CONFIG
  → createExtensionService(...)
  → initialize()
  → ready 后 injectConfiguration / injectSecrets / resumeData
  → sendToParent({ type: "ready" })
RuntimeProcessHandler
  → handleAgentReady(...)
  → 创建 registry session
  → activeSessions.set(sessionId, process)
  → sendMessage({ type: "newTask", text: prompt })
Child Process
  → extensionHost 收到 newTask
  → 产生 message / stateChange
  → 通过 IPC 回传给父进程
AgentManagerProvider
  → postStateToWebview / postMessage(...)
Webview UI
  → 展示会话、状态、消息
```

---

## 3.4 关键事实：这是主控型，不是自发式

### 主控型的证据

1. 所有启动入口都收敛到 `AgentManagerProvider.handleStartSession(...)`
2. 所有子进程由 `RuntimeProcessHandler.spawnProcess(...)` 显式 `fork()`
3. 所有向 Agent 的消息都通过：
    - `RuntimeProcessHandler.sendMessage(sessionId, message)`
4. 所有 session 状态由：
    - `AgentRegistry`
    - `AgentManagerProvider`
      统一管理

### 没有看到的能力

- Agent A 直接向 Agent B 发消息
- 跨 session 自动 handoff
- 依赖图驱动的 orchestrator / scheduler / planner
- 自组织型 Agent 网络

因此，当前正确结论是：

> **多 Agent 的存在是真实的，但协同方式是中心主控，不是 Agent 间自治互联。**

---

## 4. 实际使用方式

## 4.1 用户入口

Agent Manager 在扩展启动时注册，命令入口为：

- `agentManagerOpen`

相关代码：

- `src/activate/registerCommands.ts:159-160`

使用方式：

1. 在 VSCode 中打开本工作区
2. 触发 Agent Manager 面板
3. 在面板中创建 session、查看 session、切换 session、发送消息

---

## 4.2 startSession 可配置项

启动消息 schema 定义：

- `packages/core-schemas/src/agent-manager/types.ts`

### 可配置字段

- `prompt: string`：任务文本
- `parallelMode?: boolean`：是否启用 worktree 并行模式
- `existingBranch?: string`：使用已有分支
- `model?: string`：指定模型
- `mode?: string`：指定模式（如 `code`、`architect`）
- `versions?: number`：多版本数量
- `labels?: string[]`：多版本标签
- `images?: string[]`：图片输入
- `yoloMode?: boolean`：自动批准倾向

---

## 4.3 单 Session 使用

适合：

- 单个任务
- 单条实现路线
- 不需要版本比较

推荐配置：

- `versions = 1`
- `parallelMode = false`（如果确认不会与其他 session 冲突）
- 或 `parallelMode = true`（更安全）

---

## 4.4 多版本使用

适合：

- 一个 prompt 想比较多个实现路线
- 生成多个独立版本进行人工筛选

关键事实：

- `versions > 1` 时进入 multi-version 模式
- 最多 `4` 个版本
- 多版本时会强制 `parallelMode = true`

注意：

> 这不是自动任务分工，而是同一个 prompt 的多个独立候选版本。

---

## 4.5 并行 / worktree 使用

`parallelMode = true` 时：

- AgentManagerProvider 会先创建独立 worktree
- 然后将该 worktree path 作为实际 workspace 启动 agent 进程
- RuntimeProcessHandler 以该路径作为 `cwd`

好处：

- 降低多个 session 在同一工作区直接互相覆盖的风险
- 便于单 session 完成后执行 `Finish to Branch`

---

## 4.6 会话内操作

Webview 中实际支持：

- `agentManager.sendMessage`
- `agentManager.messageQueued`
- `agentManager.resumeSession`
- `agentManager.cancelSession`
- `agentManager.finishWorktreeSession`
- `agentManager.showTerminal`
- `agentManager.setMode`

这说明当前系统主要面向：

> **用户 ↔ 指定 session 的交互**

而不是：

> **session ↔ session 的自动交互**

---

## 5. 设置方式

## 5.1 推荐设置策略

### 场景 A：只做单任务开发

推荐：

- `versions = 1`
- `parallelMode = false` 或 `true`
- `mode = code`

### 场景 B：对比多个实现版本

推荐：

- `versions = 2~4`
- `parallelMode = true`
- 为每个版本配置 `labels`
- 使用同一 `prompt`，人工比对输出

### 场景 C：需要安全并行

推荐：

- **始终开启 `parallelMode = true`**

原因：

- 不开启时，多个 session 默认可能使用同一 workspace
- 这会增加文件改动冲突、命令冲突、git 状态干扰的风险

---

## 5.2 mode / model / secrets 的设置方式

### model

- 从 Webview 传入 `model`
- 由 AgentManagerProvider 传入 `spawnProcess(...)`

### mode

- 从 Webview 传入 `mode`
- 启动时还会额外读取 `customModes`
- 一并注入 agent process

### secrets

- 某些 provider（如 `openai-codex`）需要主扩展从 `context.secrets` 中读取凭据
- AgentManagerProvider 会将 secrets 注入 agent 子进程

这说明当前系统不是在子进程里重新读全局设置，而是：

> **主控读取配置，再把必要配置显式注入子进程。**

---

## 6. 当前缺陷与技术边界

## 6.1 最大缺陷：不是“真正的多 Agent 协同编排”

当前架构没有足够证据证明以下能力已实现：

- Agent A 输出自动转给 Agent B
- 跨 session handoff
- 基于任务依赖的自动调度
- team planner / orchestrator / scheduler

因此，当前准确定位应为：

> **多 Agent 会话管理系统**

而不是：

> **真正的多 Agent 协同编排系统**

---

## 6.2 启动阶段只支持单 pending process

从当前实现可见：

- `RuntimeProcessHandler` 只有一个 `pendingProcess`
- `AgentRegistry` 只有一个 `_pendingSession`
- 多版本模式需要顺序等待前一个 pending session 清空，再拉起下一个

影响：

- 运行时可有多个 active session
- 但启动阶段不是强并发调度模型

---

## 6.3 `parallelMode` 解决的是隔离，不是协同

worktree 能解决：

- 并行 session 对同一工作区的直接修改冲突
- branch / worktree 隔离

worktree 不能解决：

- Agent 间自动协同
- 结果接力
- 自动分工

---

## 6.4 协议与实现存在漂移风险

分析过程中发现：

- schema 定义与 UI / Provider 实际消息并不完全一致
- 某些消息在 UI 已发送，但后端处理不完全一致
- 某些恢复、warning、rename 等链路存在不完全闭环的风险

这意味着：

- 当前系统可用，但并非“完全严密无歧义”

---

## 6.5 `AGENTS.md` 对“无文件 I/O 冲突”的表述偏理想化

`AGENTS.md` 中的描述更偏向：

- 配置与状态隔离

但实际情况应更精确表达为：

- **进程状态隔离是真实的**
- **文件写隔离只有在 worktree/parallel mode 下才更可靠**

如果多个 agent 不走 worktree，仍可能共享同一工作区并产生冲突。

---

## 6.6 用户感知收益不足：当前复杂度高于可见优势

从当前实现形态看，系统已经引入了较高的工程复杂度，包括：

- Webview UI、AgentManagerProvider、RuntimeProcessHandler、AgentRegistry 等控制层组件
- Agent Runtime 子进程、ExtensionService、ExtensionHost、MessageBridge 等运行时组件
- multi-version、parallelMode、worktree、resume、message queue、mode/model 注入等扩展机制

但从用户角度可直接感知的收益，当前主要仍集中在：

- 可以并列启动多个 session
- 可以通过 worktree 降低直接文件冲突风险
- 可以对同一 prompt 做多版本比较

问题在于，这些收益更多属于“多会话管理”和“并行隔离”，而不是用户通常期待的“多 Agent 自动协同”。在缺少自动拆任务、自动分工、自动汇总和跨 Agent handoff 的情况下，用户很容易感知为：

> **系统要求用户自己扮演项目经理，手动管理多个 Agent 会话；复杂度已经先出现，但协同红利尚未真正兑现。**

因此，对当前工作区更准确的评价应为：

- **底层多 Agent 基础设施已基本成型**
- **产品层面的自动协同优势尚不明显**
- **当前复杂度已高于普通用户可直观看到的收益**

这也是本系统当前最大的产品化落差之一。

---

## 7. 是否靠谱：最终技术判断

## 7.1 作为主控型多 Session 管理器

**靠谱。**

理由：

- 有明确入口
- 有真实子进程拉起
- 有 IPC 回传
- 有会话注册与状态同步
- 有 worktree 隔离
- 有恢复逻辑

## 7.2 作为真正的多 Agent 团队协同系统

**目前不够靠谱。**

理由：

- 缺少跨 Agent 编排证据
- 缺少 handoff 证据
- 缺少依赖调度证据
- 当前更像人工控制多个并列 Agent，而不是 Agent 自治协作

---

## 8. 建议的正确表述

如果需要在汇报、评审或对外沟通中准确描述本系统，推荐使用如下表达：

### 推荐表达

> 当前 `vcpcode` 的 Agent Manager 已实现**主控型多 Agent Session 管理架构**。  
> 系统支持通过 VSCode Extension 主控层统一拉起多个独立 Agent 子进程，支持会话恢复、模式与模型注入、worktree 隔离以及多版本并列执行。  
> 但从当前实现看，系统尚不能证明已实现 Agent 间自发协同、跨 Agent 结果传递和依赖驱动的自动编排，因此更适合定位为 **Multi-Agent Session Manager**，而不是 **Autonomous Multi-Agent Orchestrator**。

---

## 9. 后续建议

### 如果目标是“更可靠地使用现有系统”

建议：

- 多 session 并行时默认开启 `parallelMode`
- 将多版本模式用于“版本对比”，不要误当自动分工
- 将最终收尾操作限定在单个选中 session 中执行

### 如果目标是“升级为真正多 Agent 协同系统”

需要补充：

- Orchestrator / Planner / Scheduler
- 跨 session handoff 机制
- 任务依赖图
- Agent-to-Agent result routing
- 更完整的一致性 schema 与事件闭环

---

## 10. 文档结论

本工作区中的 Agent Manager：

- **实现是真实的**
- **架构是主控型的**
- **多 Agent 能力存在**
- **协同能力主要靠主控与人工操作串联**
- **尚不是自发式真正团队协同系统**
