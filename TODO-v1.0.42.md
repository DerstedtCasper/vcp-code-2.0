# VCP-Code v1.0.42 修复清单

## Issue 1: VCP 后端 Log/Info WebSocket 未连接 (重点)
- **现象**: 图1显示 "VCP 后端 ● 连接: 未连接" + "刷新连接" 按钮无反应
- **根因**: VCP-Code 扩展的 NovaProvider/connection-service 只通过 SSE 连接内部 CLI backend，
  没有建立到外部 VCPToolBox WebSocket 服务器 (`ws://host:port/VCPlog/VCP_Key=xxx` 和 `/vcpinfo/VCP_Key=xxx`) 的连接。
  当前 VCP 扩展里根本没有 WebSocket 客户端代码。
- **方案**: 在 NovaProvider 中增加 WebSocket 客户端管理，读取 config 中的 VCP 连接配置（host/port/VCP_Key），
  建立到 VCPToolBox 的 WebSocket 连接，转发 log/info 到 webview。

## Issue 2: Agent Team 可配置项不足
- **现象**: 图2 agent_team 下拉选择后只有模型覆盖、自定义提示词、温度、TopP、最大步数
- **需求**: 增加配置参与的 agent 数量，每个 agent 可配置独立的：
  - 提供商/模型选择
  - Agent ID
  - Agent Prompt (角色级提示词，非附加系统提示词)
  - 用加号按钮动态添加参与的 agent
- **方案**: 在 VcpAgentTeamConfig 增加 `members` 数组，每个 member 包含 `{id, model, prompt, role}`，
  AgentBehaviourTab VCP 子页增加 members 编辑器。

## Issue 3: 斜杠/命令未关联已安装 MCP 和 Skill (重点)
- **现象**: `/` 命令面板只有硬编码的 6 个命令 (new, clear, model, mode, compact, enhance)，
  不显示已安装的 MCP 服务器工具和 Skill 命令
- **参考 Kilo**: Kilo 的 `Command.all()` 遍历 MCP prompts + Skill，注册为 slash 命令；
  前端 `slashCommands` memo 合并 builtin + custom (source: mcp/skill)
- **方案**: 
  1. 后端已有 `requestSkills` 和 skillsLoaded，利用这些数据
  2. 增加 `requestCommands` 消息，让后端返回所有可用命令（含 MCP prompts + Skills）
  3. SlashCommandPopover 从 configLoaded 的 mcp/command 配置 + loadedSkills 动态生成命令列表
  4. 每个命令显示 badge: "mcp" / "skill" / "custom"

## Issue 4: 配置在扩展更新后丢失 (重点)
- **现象**: 用户设置的所有配置（provider、mcp、skill、各界面配置）在更新扩展后全部重置
- **根因**: config backup 机制只在 `hasProviders` 时备份，且恢复只发生在 config 为空时。
  但实际更新扩展后 CLI backend 的 opencode.json 可能被覆盖/删除。
  mcp 和 skill 配置没有单独备份。
- **参考 Kilo**: Kilo 的 config 持久化到 `~/.config/kilo/opencode.json`（全局），不依赖扩展目录。
- **方案**: 
  1. 扩大 globalState 备份范围：不只备份 provider，备份完整 config
  2. 恢复时检查所有关键字段（provider、mcp、skills、agent、vcp）
  3. 每次成功保存都同步更新 globalState 备份
  4. 增加 marketplace installed list 的持久化（也存 globalState）

## Issue 5: 切换配置页卡顿 + Select 选项不即时反应
- **现象**: 
  - 切换配置标签页/保存配置有卡顿
  - Select 下拉选项点选后不会立即反映到列表栏（图3 显示 "ask" dropdown 但选项未更新）
- **根因**: ProvidersTab 等使用 `draft` + `mergedConfig` 模式，stage() 合并后需要 saveDraft() 才写入
  后端，中间有 HTTP 往返延迟。Select onSelect 更新 signal 后 UI 依赖 mergedConfig() 但 memo 未触发。
- **方案**:
  1. Select onSelect 回调中立即 stage() 到 draft，确保 mergedConfig memo 立即更新
  2. 减少不必要的 createEffect 和 createMemo 嵌套
  3. 优化 ProvidersTab 的 Show/For 避免大块 DOM 重建
  4. 考虑 debounced auto-save 替代手动 save button

---

## 修复优先级
1. ✅ Issue 4 (配置丢失) — 影响所有用户的核心体验
2. ✅ Issue 1 (WS连接) — VCP 核心功能
3. ✅ Issue 3 (slash命令) — 重要交互功能
4. ✅ Issue 5 (UI卡顿) — 用户体验
5. ✅ Issue 2 (agent team) — 功能增强
