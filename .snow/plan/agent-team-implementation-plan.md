# 实施计划：Agent Team 群体智能协作 — 剩余待完成项落地

> **基于**: `agent-team-control-plane-blackboard-plan.md` 中 `[ ]` 和 `[~]` 项
> **日期**: 2026-03-11
> **目标**: 将 Agent Team 从"逻辑分波串行 + prompt 软约束"升级为"真实并发 + 运行时强约束"

---

## 待完成项总览

| #   | 项目                          | 计划状态 | 核心瓶颈                | 难度 | 优先级 |
| --- | ----------------------------- | -------- | ----------------------- | ---- | ------ |
| 1   | 多 pending / 真实并发 wave    | `[ ]`    | `pendingProcess` 单槽位 | 高   | **P0** |
| 2   | approval 运行时 gate          | `[ ]`    | 仅 pre-launch gate      | 高   | P1     |
| 3   | ownership 强约束隔离          | `[~]`    | 仅 prompt hint          | 中高 | P1     |
| 4   | wave parallel/adaptive 真并行 | `[~]`    | `for...of await` 串行   | 中   | P2     |

---

## Phase A: 多 pending 基础设施（项目 1 — P0 前置条件）

### A1. RuntimeProcessHandler 多 pending 改造

**文件**: `src/core/nova/agent-manager/RuntimeProcessHandler.ts`

**改动**:

- `pendingProcess: PendingProcessInfo | null` → `pendingProcesses: Map<number, PendingProcessInfo>`（以 proc.pid 为 key）
- `spawnProcess()` 中不再覆写单一 pending，而是 `this.pendingProcesses.set(proc.pid, info)`
- `handleAgentReady()` 中通过 `proc` 引用从 Map 查找匹配的 pending，`this.pendingProcesses.delete(pid)`
- `hasPendingProcess()` → `this.pendingProcesses.size > 0`
- 新增 `hasPendingProcessForSession(desiredSessionId)` 精确查询
- `cancelPendingProcess()` → 支持按 sessionId 取消特定 pending

### A2. AgentRegistry 多 pending session

**文件**: `src/core/nova/agent-manager/AgentRegistry.ts`

**改动**:

- `_pendingSession: PendingSession | null` → `_pendingSessions: Map<string, PendingSession>`（以 desiredSessionId 为 key）
- `setPendingSession()` → `addPendingSession(id, session)`
- `clearPendingSession()` → `removePendingSession(id)`
- `hasPendingSession()` → `this._pendingSessions.size > 0`
- `getPendingSession()` → `getPendingSession(id?)` 支持按 ID 查询

### A3. AgentManagerProvider 等待机制改造

**文件**: `src/core/nova/agent-manager/AgentManagerProvider.ts`

**改动**:

- `waitForPendingSessionToClear()` → `waitForSessionReady(desiredSessionId)`: 等待特定 session 从 pending → active
- 不再阻塞全局，只等待自己关注的 session
- `launchSession` 回调中使用新的按 session 等待机制
- 回调签名中 `onPendingSessionChanged` 适配多 pending 场景

### A4. 状态推送适配

**文件**: `AgentManagerProvider.ts` + Webview 侧

**改动**:

- `postStateToWebview()` 中 `pendingSession` 字段从单个对象改为数组
- Webview 侧 `useAgentManagerMessages.ts` 适配多 pending 展示
- `SessionSidebar.tsx` 支持显示多个 pending session

---

## Phase B: 并发化 + ownership 强约束（项目 3, 4 — 并行实施）

### B1. wave 并发 launch（项目 4）

**文件**: `src/core/nova/agent-manager/AgentTeamCoordinator.ts`

**改动**:

- `launchWave()` 中：
    - `sequential` 策略：保持现有 `for...of await` 串行
    - `parallel` 策略：改为 `await Promise.all(wave.teamMemberIds.map(id => this.launchMember(id)))`
    - `adaptive` 策略：使用 concurrency limiter（按 maxParallel 并发数控制）
- 抽取 `launchMember()` 方法，封装单个成员的 launch 逻辑
- prompt context snapshot 机制保留（已在 launch 前统一收集，并发安全）
- 并发 launch 中部分失败时：标记失败成员，其余继续执行

### B2. ownership path guard（项目 3）

**文件**: `src/core/nova/agent-manager/AgentTeamCoordinator.ts`

**改动**:

- 新增 `validateOwnershipAccess(memberId, targetPath): boolean` 方法
- 在成员操作回调中检查文件路径是否在 ownership.paths 范围内
- 超范围策略：
    - `requireFileSeparation=true` + worktree → 物理隔离已保证，无需额外 guard
    - `requireFileSeparation=false` → 通过 prompt 强化 + 事后冲突检测
- 新增 `detectOwnershipConflicts(run)` 方法：wave 完成后检测是否有多成员写同一文件

### B3. prompt 层面 ownership 强化

**文件**: `src/core/nova/agent-manager/AgentTeamCoordinator.ts` (`buildMemberPrompt`)

**改动**:

- 在 system prompt 中明确列出 ownership paths 并标注"MUST NOT modify files outside these paths"
- 增加 ownership violation 的自检指令

---

## Phase C: 运行时审批增强（项目 2）

### C1. 扩展 approval 触发条件

**文件**: `src/core/nova/agent-manager/AgentTeamCoordinator.ts`

**改动**:

- `shouldPauseForWaveApproval()` 扩展条件：
    - 保留现有：`requireFileSeparation=false` + `implement` 角色
    - 新增：wave 包含 `validator/reviewer` 角色且对高风险变更（删除文件、修改配置等）
    - 可配置：`approvalPolicy: "none" | "high-risk" | "all-writes"` 设置项
- `requestWaveApproval()` 中使用正确的 `kind`（`"tool"` / `"command"`），不再全部用 `"external"`

### C2. approval 状态与 UI 增强

**文件**: `webview-ui/src/nova/agent-manager/components/TeamControlPlane.tsx`

**改动**:

- approval 项增加操作类型图标和描述（tool / command / external）
- 显示受影响的文件范围
- 增加"Approve All Pending"批量操作

---

## 执行依赖关系

```
Phase A (多 pending 基础设施)
  A1: RuntimeProcessHandler ←─── 最先做
  A2: AgentRegistry          ←─── 与 A1 并行
  A3: AgentManagerProvider   ←─── 依赖 A1 + A2
  A4: 状态推送适配           ←─── 依赖 A3

Phase B (并发 + ownership) ←─── 依赖 Phase A 完成
  B1: wave 并发 launch       ←─── 依赖 A1-A3
  B2: ownership path guard   ←─── 独立，可与 B1 并行
  B3: prompt ownership 强化  ←─── 独立，可与 B1 并行

Phase C (审批增强) ←─── 可与 Phase B 并行
  C1: approval 触发扩展      ←─── 独立
  C2: approval UI 增强       ←─── 依赖 C1
```

---

## 验证策略

- 每个 Phase 完成后运行 `pnpm check-types` + 现有测试
- Phase A 完成后：新增多 pending 并发测试用例
- Phase B 完成后：新增 parallel wave launch 测试 + ownership 检测测试
- Phase C 完成后：新增扩展 approval 测试
- 最终：`pnpm build` 全量构建验证
