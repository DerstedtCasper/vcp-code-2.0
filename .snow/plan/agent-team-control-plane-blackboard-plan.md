# Implementation Plan: Agent Team 群体智能协作改造方案

## Overview

基于现有主控型 Multi-Agent Session Manager、`agentTeam` 配置骨架与 IDE 群体智能协作调研文档，规划一套可渐进落地的 Agent Team 改造方案。当前文档已根据 **2026-03-08 的实际代码状态** 做过校正，不再把“目标蓝图”与“已实现现状”混写。

## Current Status Snapshot

### Status Legend

- `[x]` 已落实：代码、运行链路与验证已经落地
- `[~]` 部分落实：有骨架/部分行为，但距离设计目标仍有关键缺口
- `[ ]` 未落实：仍停留在计划阶段或仅有 schema/UI 占位

### Reality Check

当前 Agent Team **已经不再是纯 prompt 心理委派**，因为系统会真实拉起多个独立 agent-runtime 子进程，并且 coordinator 已能基于真实 session 的完成、失败、取消事件推进团队状态；同时，handoff / blackboard 也已经具备最小 publish / consume 闭环。

目前更准确的定义是：

> **Coordinator + 多独立 session 的事件驱动 orchestration / 子任务委派层，并带有最小 blackboard consume 协作语义**

而不是：

> **由 blackboard / handoff / approval / 并发控制驱动的完整 Agent Team 协作内核**

### 已落实 / 部分落实 / 未落实摘要

- `[x]` 已扩展 team member / team run / wave / handoff / blackboard 的核心 schema
- `[x]` 已增加 Team Control Plane 基础 UI、team state/event 消息桥与运行态展示
- `[x]` 已引入 `AgentTeamCoordinator`，并在 `mode === "agent_team"` + `agentTeam.enabled` 时接入主路径
- `[x]` 已将 run / handoff / blackboard 快照持久化到 `.snow/agent-team/<run-id>/`
- `[x]` 已为成员会话透传 `teamRunId` / `teamMemberId` / `waveId` / `roleType` / `ownership`
- `[x]` 已完成设置页 Agent Team 配置增强，以及 API/Profile 显式保存边界修复
- `[x]` 已完成版本收敛并产出 `C:/project/vcpcode/bin/vcp-code-1.2.0.vsix`
- `[~]` wave orchestration 已存在，但 `parallel/adaptive` 仍主要是逻辑分波，底层仍偏串行
- `[x]` coordinator 已基于真实 worker/session 的完成、失败、取消事件推进成员状态、handoff、wave 与 run
- `[x]` handoff / blackboard 已形成最小 publish / consume 闭环，支持未消费上下文注入与 `consumedAt` 标记
- `[~]` ownership / requireFileSeparation 已接入 metadata 与 prompt，但未形成强约束隔离策略
- `[ ]` approval 尚未形成运行时 gate
- `[ ]` 多 pending / 真实并发 wave 尚未落地

## Scope Analysis

- Files already modified or confirmed relevant:
    - `packages/types/src/vcp.ts`
    - `packages/types/src/index.ts`
    - `packages/core-schemas/src/agent-manager/types.ts`
    - `packages/core-schemas/src/index.ts`
    - `src/core/webview/webviewMessageHandler.ts`
    - `src/core/prompts/system.ts`
    - `src/core/nova/agent-manager/AgentManagerProvider.ts`
    - `src/core/nova/agent-manager/RuntimeProcessHandler.ts`
    - `src/core/nova/agent-manager/AgentRegistry.ts`
    - `src/core/nova/agent-manager/AgentTeamCoordinator.ts`
    - `src/core/nova/agent-manager/types.ts`
    - `webview-ui/src/components/settings/AgentTeamSettings.tsx`
    - `webview-ui/src/components/settings/SettingsView.tsx`
    - `webview-ui/src/components/settings/ApiConfigManager.tsx`
    - `webview-ui/src/nova/agent-manager/components/*`
    - `webview-ui/src/nova/agent-manager/state/atoms/teamRun.ts`
    - `webview-ui/src/nova/agent-manager/state/atoms/index.ts`
    - `webview-ui/src/nova/agent-manager/state/atoms/sessions.ts`
    - `webview-ui/src/nova/agent-manager/state/hooks/useAgentManagerMessages.ts`
- New files already created:
    - `src/core/nova/agent-manager/AgentTeamCoordinator.ts`
    - `webview-ui/src/nova/agent-manager/components/TeamControlPlane.tsx`
    - `webview-ui/src/nova/agent-manager/state/atoms/teamRun.ts`
    - `.snow/agent-team/<run-id>/*`（运行期工件目录）
- Deferred / not yet created as originally envisioned:
    - `src/core/nova/agent-manager/blackboard/*`（尚未抽离为独立 blackboard 模块）
- Dependencies:
    - 现有 `AgentManagerProvider` 主控入口
    - 现有 `RuntimeProcessHandler` 子进程拉起与 IPC
    - 现有 `agent-runtime` 进程模型与 `AGENT_CONFIG`
    - 现有 `agentTeam` 设置与 VCP 配置持久化
    - 控制平面 / 黑板架构 / 持续笔记 / AX-UX-DX 分层原则
- Estimated complexity: complex

## Target Architecture

### Architecture Summary

目标架构采用 **Control Plane + Blackboard + Orchestrator + Worker Runtime** 的五层模型，避免“多窗口会话拼接”继续演化为不可控复杂度。

### Layer 1: User Intent Layer

- 用户只与单一主入口交互（主聊天/主任务入口）
- 用户不直接管理多个成员会话
- 用户关注目标、约束、审批与方向修正

### Layer 2: Control Plane

- 通过独立控制平面展示 team run、wave、agent tree、handoff、资源消耗、审批项
- 将复杂协作元数据从聊天流中剥离，避免主界面信息过载
- 对应实现重点：`webview-ui/src/nova/agent-manager/components/*`

### Layer 3: Blackboard & Memory

- 以共享黑板承载结构化工件，而不是依赖 agent 间点对点传话
- 黑板至少保存：TaskSpec、WavePlan、Ownership、Handoff、Decision、Risk、OpenQuestion、ArtifactSummary
- 支持持久化、恢复、回放与后续控制平面可视化
- **当前现实**：已实现最小持久化与 UI 数据结构，但尚未实现可消费的共享工作记忆

### Layer 4: Orchestration Kernel

- `AgentTeamCoordinator` 作为控制壳（Control Shell）
- 负责拆任务、排 wave、分 role、分 scope、触发执行、汇总 handoff、回写黑板
- **当前现实**：已具备 team run / wave / member launch 骨架，但调度仍偏“启动 session + 写状态”，距离真正 orchestrator 还有闭环缺口

### Layer 5: Execution Fabric

- 继续复用现有 `AgentManagerProvider`、`RuntimeProcessHandler`、`agent-runtime`
- 每个成员仍通过独立 agent-runtime 子进程执行
- 保留现有 `AGENT_CONFIG`、IPC、worktree 等能力，避免推翻既有运行时
- **当前现实**：worker isolation 已成立，但多 pending / 真并行能力仍未升级

### Target Architecture Diagram

```text
User Intent
   │
   ▼
Main Entry / Coordinator UI
   │
   ├── Control Plane (team run / wave / approvals / telemetry)
   │
   ▼
AgentTeamCoordinator (Control Shell)
   │
   ├── Blackboard Store (shared state, handoff, notes, decisions)
   ├── Wave Planner
   ├── Ownership / Scope Allocator
   └── Runtime Dispatcher
            │
            ├── RuntimeProcessHandler -> Worker Agent A
            ├── RuntimeProcessHandler -> Worker Agent B
            └── RuntimeProcessHandler -> Worker Agent C
```

## Multi-Agent Collaboration Model

### Core Collaboration Principle

采用 **“主控调度 + 黑板共享 + 波次收束 + 专家执行”** 的协作模型，而不是自由对话式 swarm：

- 主控负责决策与收敛
- 黑板负责共享状态与工件沉淀
- Worker 负责在明确 scope 内执行
- 控制平面负责让用户理解并干预整个团队

### Team Roles

建议在运行时上形成以下角色槽位（不要求第一版全部固定暴露到 UI）：

- **Coordinator**：唯一对外主入口，负责总调度与最终汇总
- **Planner / Strategist**：拆任务、建依赖图、定 scope
- **Explorer / Researcher**：收集上下文、检索证据、减少重复劳动
- **Specialist Workers**：按任务类型执行（code / ui / docs / test / debug 等）
- **Validator / Reviewer**：做一致性校验、质量检查、风险识别
- **Memory Curator**：整理笔记、维护黑板摘要、压缩 handoff

### Wave-Based Collaboration

多 Agent 协同目标通过以下波次达成：

1. **Sense / Explore Wave**
    - 收集上下文、形成任务事实基线
2. **Plan Wave**
    - 生成依赖图、成员分工、ownership、执行顺序
3. **Execute Wave**
    - 多 specialist 按 scope 顺序或并行执行
4. **Validate Wave**
    - reviewer / validator 检查结果与风险
5. **Synthesize Wave**
    - coordinator 汇总最终结果并更新黑板

### How Multi-Agent Achieves the Goal

本方案中，多 Agent 协同不是为了“看起来有很多 agent”，而是为了解决三个真实目标：

- **降低单 agent 上下文压力**：通过黑板和角色分工让上下文分层，而非全部堆进一个窗口
- **提高复杂任务吞吐**：将独立子任务交给 specialist worker，通过 wave 或并发提升效率
- **提高结果正确性**：通过 validator / memory curator / structured handoff 降低“传声筒”与遗漏风险

### Collaboration Realization Path in This Repo

- `packages/types/src/vcp.ts`
    - 承载成员配置与 team run / handoff / blackboard 基础 schema
- `src/core/webview/webviewMessageHandler.ts`
    - 负责 team 配置的持久化与 merge
- `src/core/nova/agent-manager/AgentManagerProvider.ts`
    - 继续作为 VSCode Extension 主控入口
- `src/core/nova/agent-manager/AgentTeamCoordinator.ts`
    - 当前 orchestrator 骨架，连接配置、状态与运行时
- `src/core/nova/agent-manager/RuntimeProcessHandler.ts`
    - 继续负责拉起成员 worker，后续需升级多 pending 支持
- `webview-ui/src/nova/agent-manager/components/*`
    - 作为控制平面 UI 的主要载体

## Execution Phases

### Phase 1: 架构收口与类型建模（已落实）

**Objective**: 将“概念上的 Agent Team”收口为可执行的运行时模型，明确 team run、wave、member capability、handoff、blackboard artifact 的统一 schema。
**Status**: `[x] 已落实`

**Actions**:

- `[x]` 扩展 `VcpAgentTeamMember`，补充 `apiConfigId`、`roleType`、`phaseAffinity`、`capabilities`、`enabled`、`ownership`
- `[x]` 定义 Team Run / Wave / Handoff / Blackboard Artifact 的 schema 与最小字段集合
- `[x]` 让设置层与存储层支持这些新增字段，并保持向后兼容
- `[x]` 明确 `handoffFormat` 的内部 canonical 语义（当前 internal canonical 为 JSON，Markdown 仍偏展示语义）

**Acceptance Criteria**:

- `[x]` 成员配置能够稳定绑定真实 API profile
- `[x]` 运行时核心对象有统一 schema，能够支撑 orchestrator 实现
- `[x]` 现有配置读取与写回逻辑不被破坏
- `[x]` Successful compilation/build
- `[x]` No blocking IDE / type diagnostics in final verified state
- `[x]` Code runs without crashes in validated build path

### Phase 2: 编排内核与黑板 MVP（大部分已落实）

**Objective**: 引入真正的 orchestrator / blackboard，使 Agent Team 从 prompt roster 升级为运行时协作系统。
**Status**: `[x] 核心闭环已落实，剩余并发增强项待后续继续`

**Actions**:

- `[x]` 在主控侧新增 Team Run 概念，支持 wave-based orchestration
- `[x]` 实现 blackboard 持久化与 artifact 化 handoff，并形成最小 publish / consume 闭环（支持未消费上下文注入与 `consumedAt` 标记）
- `[x]` 让 coordinator 使用现有 `RuntimeProcessHandler` 启动 member worker，而不是只在 prompt 中“心理委派”
- `[x]` 首版落地 `sequential` 与 `adaptive` 的逻辑分波（当前物理执行仍偏串行）
- `[~]` 明确 scope/ownership 模型，避免成员越权写入（metadata + prompt 已接入，强约束策略未完成）
- `[x]` 修复 coordinator 原先“launch 后立即标记 done / 生成 handoff”的合成状态问题，改为基于真实 worker/session 完成、失败、取消事件推进
- `[x]` 将 blackboard 抽离为 coordinator 内部统一 publish / consume helper 机制，不再只是 run state 与落盘快照

**Acceptance Criteria**:

- `[x]` 能够创建 team run，并将单个用户目标拆成至少 2 个阶段的内部执行波次
- `[x]` 每个成员输出结构化 handoff，并可被 coordinator 消费
- `[x]` blackboard 能恢复关键中间态，且后续成员能够基于未消费 handoff / blackboard 摘要继续编排
- `[x]` Successful compilation/build
- `[x]` No IDE/type blocking errors in final verified state
- `[x]` Code runs without crashes in validated build path

### Phase 3: 控制平面 UI 与可观测性（部分落实）

**Objective**: 将群体智能协作从“后台存在”升级为“用户可理解、可干预、可审批”的控制平面体验。
**Status**: `[~] 部分落实`

**Actions**:

- `[x]` 新增 Team Control Plane 视图，展示 run / wave / member / handoff / event 等基础信息
- `[x]` 将复杂协作元数据从聊天流中剥离到控制平面消息与状态原子
- `[x]` 后端已稳定提供真实 team run / team event 链路，控制平面可看到真实成员完成、取消、失败与 handoff/blackboard 更新
- `[~]` 支持用户在控制平面查看未决问题、审批项、冲突项（审批/风险/问题等高级块仍未形成完整 runtime 数据闭环）
- `[~]` 在设置层增加 capability / ownership / wave strategy 等说明；preset / 更完整 adaptive 语义说明仍可继续补强

**Acceptance Criteria**:

- `[x]` 用户可在单主交互入口外，通过控制平面看到 Team Run 的全局状态
- `[x]` 不需要依赖多个聊天窗口理解 agent team 的运行情况
- `[x]` 关键运行态（波次、成员状态、handoff、取消/失败事件）已通过 teamRunState / teamRunEvent 实时可视化
- `[x]` Successful compilation/build
- `[x]` No IDE/type blocking errors in final verified state
- `[x]` Code runs without crashes in validated build path

### Phase 4: 并发安全、冲突控制与质量闭环（未落实）

**Objective**: 将系统从“能协作”提升到“可安全并发、可验证交付”。
**Status**: `[ ] 未落实`

**Actions**:

- `[ ]` 将单 `pendingProcess` 升级为多 pending / batch-ready 模型，支持真实 parallel wave
- `[ ]` 将 `requireFileSeparation` 与 ownership/worktree 策略打通
- `[ ]` 对高风险写操作、并发冲突、审批流建立闭环
- `[~]` 增加 orchestrator / blackboard / control plane / conflict policy 的测试（本轮先补充了 wave prompt context snapshot 回归测试）

**Acceptance Criteria**:

- `[ ]` `parallel/adaptive` 不再只是 UI 配置，而能真实驱动安全并发
- `[ ]` 并行写入不会默认落到同一工作区造成未受控冲突
- `[ ]` 系统具备基础测试覆盖与质量回归能力
- `[ ]` Successful compilation/build
- `[ ]` No IDE diagnostic errors
- `[ ]` Code runs without crashes

## Verification Strategy

- `[x]` Build/compile verification completed for the delivered 1.2.0 state
- `[x]` `pnpm check-types` / `pnpm lint` / `src: pnpm test` / `pnpm vsix` 已完成
- `[x]` 产物确认：`C:/project/vcpcode/bin/vcp-code-1.2.0.vsix`
- `[x]` 本轮新增 `src/core/nova/agent-manager/__tests__/AgentTeamCoordinator.spec.ts` 与 `AgentManagerProvider.spec.ts`，验证真实 session outcome 驱动、handoff consume 与 provider 去重路由
- `[x]` 本轮已重新验证：`src: pnpm check-types`、定向 `vitest`、`webview-ui: pnpm check-types`、`packages/core-schemas: pnpm check-types`
- `[~]` 针对 approval / multi-pending / 真并发 wave 的自动化验证仍需补充（本轮新增了 wave prompt context snapshot 回归测试，用于降低未来并发 wave 的上下文竞争风险）

## Potential Risks

- `RuntimeProcessHandler` 仍只有单 pending process，阻碍真实并发：当前 `parallel/adaptive` 容易制造“已支持团队并发”的错觉。
- 当前 blackboard consume 已形成最小 publish / consume 闭环，但仍未发展为更完整的共享工作记忆与跨轮决策内核。
- ownership / requireFileSeparation 若不继续与 worktree / 写入策略打通，并发写文件仍可能制造未受控冲突。
- approval schema/UI 若长期没有 runtime gate，对用户会形成“看起来支持审批、实际不起作用”的预期落差。

## Rollback Plan

- 将 orchestrator / control plane 逻辑继续保持在独立模块，避免侵入式替换现有 session manager 主路径
- 在配置层保留 `agentTeam.enabled=false` 的纯旧行为回退路径
- 以 feature flag / config gate 控制新能力，确保必要时可快速回到现有主控型多 session 模式
