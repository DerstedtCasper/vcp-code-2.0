# VCP Code 2.0 — 开发 TODO

> **生成日期**: 2026-02-26  
> **来源文档**: VCP-Code-2.0-前端UI修复与优化重构开发文档.md  
> **执行原则**: P0 → P1 → P2 优先级顺序；每完成一项打 ✅ 并记录提交 SHA

---

## 🧹 第一阶段: Git 清理与管理

- [x] **[Git]** 压缩 v7.0.33 之后的提交为单个干净提交 ✅ `aa3227190`
- [x] **[Git]** 重命名 remotes：`origin → upstream`，`origin-user → origin` ✅

---

## 🏷️ 第二阶段: Kilo → Nova 品牌脱钩

### 阶段 A — 目录与文件重命名
- [ ] `packages/kilo-docs/`      → `packages/nova-docs/`
- [ ] `packages/kilo-gateway/`   → `packages/nova-gateway/`
- [ ] `packages/kilo-i18n/`      → `packages/nova-i18n/`
- [ ] `packages/kilo-telemetry/` → `packages/nova-telemetry/`
- [ ] `packages/kilo-ui/`        → `packages/nova-ui/`
- [ ] `packages/kilo-vscode/`    → `packages/nova-vscode/`
- [ ] `packages/opencode/src/kilocode/`     → `novacode/`
- [ ] `packages/opencode/src/kilo-sessions/` → `nova-sessions/`
- [ ] `KiloProvider.ts`          → `NovaProvider.ts`
- [ ] `KiloNotifications.tsx`    → `NovaNotifications.tsx`
- [ ] `kilo-dark.svg`/`kilo-light.svg` → `nova-dark.svg`/`nova-light.svg`
- [ ] `kilo-vscode.json`/`kilo.json` (主题) → `nova-vscode.json`/`nova.json`

### 阶段 B — package.json name 更新
- [ ] `packages/nova-docs/package.json`: `@kilocode/kilo-docs` → `@novacode/nova-docs`
- [ ] `packages/nova-gateway/package.json`: `@kilocode/kilo-gateway` → `@novacode/nova-gateway`
- [ ] `packages/nova-i18n/package.json`: `@kilocode/kilo-i18n` → `@novacode/nova-i18n`
- [ ] `packages/nova-telemetry/package.json`: `@kilocode/kilo-telemetry` → `@novacode/nova-telemetry`
- [ ] `packages/nova-ui/package.json`: `@kilocode/kilo-ui` → `@novacode/nova-ui`
- [ ] 根 `package.json`: `@kilocode/kilo` → `@novacode/nova`

### 阶段 C — 全局 import 路径替换 (Node.js 脚本)
- [ ] 创建并运行 `script/replace-imports.mjs`（UTF-8 安全批量替换）
- [ ] 替换 `@kilocode/kilo-ui` → `@novacode/nova-ui`
- [ ] 替换 `@kilocode/kilo-i18n` → `@novacode/nova-i18n`
- [ ] 替换 `@kilocode/kilo-telemetry` → `@novacode/nova-telemetry`
- [ ] 替换 `@kilocode/kilo-gateway` → `@novacode/nova-gateway`
- [ ] 替换 `@kilocode/plugin` → `@novacode/plugin`
- [ ] 替换 `@kilocode/sdk` → `@novacode/sdk`

### 阶段 D — 代码标识符重命名
- [ ] `KILO_GATEWAY_ID` → `NOVA_GATEWAY_ID`（**仅变量名**，保留字符串值 `"kilo"`）
- [ ] `KILO_AUTO` → `NOVA_AUTO`（**仅变量名**，保留运行时值）
- [ ] `KiloNotifications` 组件引用 → `NovaNotifications`
- [ ] `KiloProvider` 类引用 → `NovaProvider`
- [ ] `kiloEn/kiloZh/...` i18n 变量 → `novaEn/novaZh/...`

### 阶段 E — i18n 变量名清理
- [ ] `language.tsx`：更新三层合并中的变量名与导入路径

### 阶段 F — 资源文件替换
- [ ] 替换 `assets/icons/nova-dark.svg` 为 Nova/VCP logo
- [ ] 替换 `assets/icons/nova-light.svg` 为 Nova/VCP logo
- [ ] 替换或删除根目录 `kilo.gif`
- [ ] 替换根目录 `logo.png`

### 阶段 G — 构建验证
- [ ] `bun turbo typecheck` → 0 错误
- [ ] `git grep -i "kilo"` 仅返回不可更改项
- [ ] 提交: `brand: complete kilo->nova decoupling across all packages`

---

## 🎨 第三阶段: 前端交互功能优化

### 🔴 P0 — 输入框 (PromptInput)

- [x] **[P0-1]** Slash 命令面板 (`SlashCommandPopover.tsx`) ✅ `40bf52c70`
  - [x] `/new`, `/clear`, `/model`, `/mode`, `/compact`, `/enhance` 命令
  - [x] 执行后气泡反馈（"✨ 提示词增强成功"）
  - [x] 修改 `PromptInput.tsx` handleInput/handleKeyDown
  - [x] 新增 i18n 键: `prompt.slash.*`

- [x] **[P0-2]** Agent @提及（扩展 `useFileMention.ts` → `useAtMention.ts`）✅ `b034ffe28`
  - [x] @ 菜单: 文件 + Agent + 目录 + 特殊类型（clipboard/git/terminal/url/problems）
  - [x] 从 session context 获取 agent 列表
  - [x] 类型徽章区分 (agent/dir/special)

- [x] **[P0-3]** 上下文项 Pill 显示 (`ContextPills.tsx`) ✅ `40bf52c70`
  - [x] 输入框上方显示已选中文件的 pill/tag
  - [x] pill 支持 ✕ 移除

- [x] **[P0-4]** 历史消息导航 ✅ `40bf52c70`
  - [x] 输入框为空时 ↑↓ 键翻阅历史发送记录

### 🔴 P0 — 模型选择 (ModelSelector)

- [x] **[P0-5]** 模型详情 HoverCard (`ModelInfoCard.tsx`) ✅ `b034ffe28`
  - [x] 悬停显示: 输入/输出价格、上下文窗口、能力标签
  
- [x] **[P0-6]** 最近使用模型分组 ✅ `b034ffe28`
  - [x] localStorage 存储最近 5 个选择
  - [x] 列表顶部显示"最近使用"分组

### 🔴 P0 — 上下文添加 (@Mention)

- [x] **[P0-7]** 多类型 @ 菜单（`useAtMention.ts`）✅ `b034ffe28`
  - [x] 类型: 文件 / 目录 / Agent / 特殊（剪贴板、Git、终端、URL、诊断）
  - [ ] 行范围支持: `@file.ts:10-20`（待实现）
  - [ ] Git 子菜单: staged / unstaged / diff / log（待实现）

### 🔴 P0 — 全局状态回报 (VcpStatusBadge)

- [x] **[P0-8]** 角落状态胶囊 (`VcpStatusBadge.tsx`) ✅ `40bf52c70`
  - [x] 显示: 当前模型 + Agent + 状态颜色（🟢/🟡/🔴）
  - [x] 挂载到 `App.tsx`

- [x] **[P0-9]** 详情抽屉 (Drawer) ✅ `40bf52c70`
  - [x] Token 统计: 上传/下载 Token + 预估成本
  - [x] 最近 5 次请求历史
  - [x] 快捷操作: 清空队列、刷新连接
  - [ ] 修改 `session.tsx` 增加 Token 统计状态 ← 已利用现有 contextUsage
  - [x] 补充消息契约 `CompactContextRequest` / `EnhancePromptRequest`（types/messages.ts）

---

### 🟡 P1 — 模型选择增强 (ModelSelector)

- [x] **[P1-1]** 模型标签系统（reasoning/code/general） ✅ `b034ffe28`
- [ ] **[P1-2]** 网关状态指示（触发按钮旁连接状态点）

### 🟡 P1 — 智能体行为 (ModeSwitcher)

- [x] **[P1-3]** 增强 ModeSwitcher 弹出面板 ✅ `b034ffe28`
  - [x] 展示模式描述文字
  - [x] 颜色点 + 类型标签（built-in / mode tag）
  - [ ] "创建自定义模式..." 入口

- [ ] **[P1-4]** Agent 能力面板（工具列表、系统提示摘要、自动审批规则）

### 🟡 P1 — 代码库索引 (Codebase Indexing)

- [ ] **[P1-5]** 索引状态指示器（设置面板/状态栏）
  - [ ] 显示: 已索引文件数、上次更新时间、[重新索引] 按钮

- [ ] **[P1-6]** 索引进度面板
  - [ ] 进度条 + 当前处理文件 + 已索引/总数

### 🟡 P1 — 配置项引导 (SettingsRow)

- [x] **[P1-7]** `SettingsRow.tsx` 增加 `helpHint`, `example`, `isDirty` 属性 ✅ `b034ffe28`
  - [x] Hover `?` 图标（title tooltip）
  - [x] 未保存时显示橙色点 + 标题变色

- [x] **[P1-8]** 粘性保存栏 `StickySaveBar.tsx` ✅ `b034ffe28`
  - [x] `isDirty` 控制显示/隐藏
  - [x] 滑入动画 + 保存/丢弃按钮

---

### 🟢 P2 — 增强提示词 (Enhance Prompt)

- [x] **[P2-1]** 输入框 ✨ 增强按钮 ✅ `b034ffe28`
  - [x] 加载状态动画（旋转 SVG）
  - [x] 替换成功后更新 textarea

- [x] **[P2-2]** `useEnhancePrompt.ts` hook ✅ `b034ffe28`
  - [x] `vscode.postMessage({ type: "enhancePrompt", text, requestId })` 调用
  - [x] 补充消息契约: `EnhancePromptRequest` / `EnhancePromptResultMessage` / `EnhancePromptErrorMessage`

- [x] **[P2-3]** 后端 LLM 增强处理 ✅ `b034ffe28`
  - [x] `KiloProvider.ts` 监听 `enhancePrompt` 消息
  - [x] `handleEnhancePrompt` 方法（system prompt 模板）

### 🟢 P2 — 其他

- [ ] **[P2-4]** ModeSwitcher: 自定义模式编辑器（嵌入式）
- [ ] **[P2-5]** Codebase Index: 索引配置 UI（包含/排除路径、文件大小、存储位置）

---

## 📋 数据契约补充清单

- [ ] `VcpStatusUpdateMessage` (Extension → Webview): 状态/Token 推送
- [ ] `EnhancePromptRequest` (Webview → Extension): 增强请求
- [ ] `EnhancePromptResponse` (Extension → Webview): 增强结果
- [ ] 在 `vscode.tsx` 消息处理层注册上述契约

---

## ✅ 验证标准

| 检查项 | 通过标准 |
|--------|---------|
| TypeScript | `tsc --noEmit` 0 错误 |
| 品牌残留 | `git grep -i "kilo"` 仅返回不可更改运行时值 |
| i18n 完整性 | 16 个 locale 文件键数一致 |
| 运行时 | 扩展加载无报错，所有设置页面正常显示 |
| UI 交互 | 所有新增组件可正常操作 |

---

## 📅 变更记录

| 日期 | 内容 |
|------|------|
| 2026-02-26 | 根据开发文档 v2.1 生成初始 TODO |
| 2026-02-26 | ✅ Git 清理完成（压缩提交 + 重命名 remotes） |
| 2026-02-26 | ✅ P0 完成：SlashCommandPopover / ContextPills / VcpStatusBadge / 历史导航 / i18n / CSS / 消息契约（`40bf52c70`） |
| 2026-02-26 | ✅ P0-2/5/6/7 + P1-1/3/7/8 + P2-1/2/3 完成：useAtMention / ModelInfoCard / Recent模型 / ModeSwitcher增强 / SettingsRow v2 / StickySaveBar / EnhancePrompt（`b034ffe28`） |
