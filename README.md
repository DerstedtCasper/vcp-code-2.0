<p align="center">
  <img src="assets/icons/nova-dark.svg" width="120" alt="VCP Code Logo" />
</p>

<h1 align="center">VCP Code 2.0</h1>

<p align="center">
  <strong>一站式 AI 编码智能体 — 基于 Nova 架构</strong>
</p>

<p align="center">
  <a href="https://github.com/DerstedtCasper/vcp-code-2.0/releases/latest"><img src="https://img.shields.io/github/v/release/DerstedtCasper/vcp-code-2.0?style=flat&label=Release&color=blue" alt="Latest Release"></a>
  <a href="https://github.com/DerstedtCasper/vcp-code-2.0"><img src="https://img.shields.io/github/stars/DerstedtCasper/vcp-code-2.0?style=flat" alt="GitHub Stars"></a>
  <a href="https://github.com/DerstedtCasper/vcp-code-2.0/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat" alt="MIT License"></a>
</p>

---

## 简介

**VCP Code 2.0** 是一个功能丰富的 VS Code AI 编码助手扩展，基于开源项目 [Kilo Code](https://github.com/Kilo-Org/kilocode) 进行深度定制与品牌重构（Nova 架构）。它将大语言模型的能力直接嵌入编辑器，帮助开发者更高效地编写、重构、调试和理解代码。

### 核心能力

| 能力 | 说明 |
|------|------|
| 🧠 **多模型支持** | 接入 500+ AI 模型（Claude、GPT、Gemini、DeepSeek 等），自由切换 |
| 💬 **对话式编码** | 在侧边栏与 AI 对话，生成代码、解释逻辑、排查问题 |
| ⚡ **内联自动补全** | 基于上下文的智能代码补全，边写边提示 |
| 🔀 **多 Agent 模式** | Code / Architect / Ask / Debug / Orchestrator，按任务切换最佳策略 |
| 📎 **丰富上下文** | @文件、@目录、@剪贴板、@git、@终端 — 精确控制 AI 看到的信息 |
| 🔧 **工具调用** | AI 可自主读写文件、执行终端命令、搜索代码库 |
| 🌐 **浏览器自动化** | 通过 Playwright MCP 实现网页交互与测试 |
| ✨ **提示词增强** | 一键将简单描述转化为结构化的高质量 Prompt |
| 📊 **状态与统计** | 实时显示连接状态、Token 消耗和运行历史 |

---

## 快速开始

### 方式一：安装 VSIX

1. 前往 [Releases](https://github.com/DerstedtCasper/vcp-code-2.0/releases/latest) 下载最新的 `.vsix` 文件
2. 在 VS Code 中：`Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. 选择下载的 `.vsix` 文件，安装完成后重载窗口
4. 在侧边栏找到 VCP Code 图标，开始使用

### 方式二：从源码构建

```bash
# 克隆仓库
git clone https://github.com/DerstedtCasper/vcp-code-2.0.git
cd vcp-code-2.0

# 安装依赖（需要 Bun）
bun install

# 构建扩展
cd packages/nova-vscode
bun run package

# 打包 VSIX
npx @vscode/vsce package --no-dependencies --allow-missing-repository
```

---

## 项目架构

```
vcp-code-2.0/
├── packages/
│   ├── nova-vscode/      ← VS Code 扩展主包（SolidJS WebView + TS 后端）
│   ├── nova-ui/          ← 共享 UI 组件库
│   ├── nova-i18n/        ← 国际化覆盖层（16 种语言）
│   ├── nova-gateway/     ← API 网关客户端
│   ├── nova-telemetry/   ← 遥测服务
│   ├── nova-docs/        ← 文档站
│   ├── opencode/         ← 核心后端（CLI + Server）
│   ├── app/              ← 新架构前端（Desktop/Web）
│   └── desktop/          ← Tauri 桌面应用
└── 构建工具: Bun + Turbo + esbuild
```

---

## 特色功能

### 🎯 Slash 命令

在输入框输入 `/` 快速执行操作：

| 命令 | 功能 |
|------|------|
| `/new` | 新建会话 |
| `/clear` | 清除当前对话 |
| `/model` | 切换模型 |
| `/mode` | 切换 Agent 模式 |
| `/compact` | 压缩上下文 |
| `/enhance` | AI 增强提示词 |

### 📌 上下文 @提及

在输入框输入 `@` 精确添加上下文：

- `@文件名` — 引用项目文件
- `@目录/` — 引用整个目录
- `@clipboard` — 引用剪贴板内容
- `@git` — 引用 Git 变更
- `@terminal` — 引用终端输出
- `@problems` — 引用诊断问题

### 🔀 Agent 模式

| 模式 | 用途 | 典型场景 |
|------|------|---------|
| **Code** | 智能编码 | 写功能、修 Bug、重构 |
| **Architect** | 系统设计 | 技术方案、架构评审 |
| **Ask** | 知识问答 | 解释代码、学习概念 |
| **Debug** | 调试专家 | 定位错误、分析日志 |
| **Orchestrator** | 自动编排 | 复杂多步骤任务 |

支持自定义模式：配置专属的系统提示、工具权限和审批策略。

---

## 与上游的关系

VCP Code 2.0 是 [Kilo Code](https://github.com/Kilo-Org/kilocode) 的独立分支，进行了以下定制：

- **品牌重构**：全面从 Kilo 品牌脱钩为 Nova/VCP 品牌
- **前端交互增强**：Slash 命令、多类型上下文提及、模型详情卡片、Agent 能力面板、状态徽章等
- **中文本地化**：优化中文翻译覆盖

上游仓库以 `upstream` remote 保留，便于同步社区更新。

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Bun 1.3.9 |
| 构建 | Turbo 2.5.6 + esbuild |
| 前端框架 | SolidJS 1.9 |
| 语言 | TypeScript 5.8 |
| 扩展宿主 | VS Code Extension API |
| 桌面端 | Tauri |

---

## 贡献

欢迎提交 Issue 和 Pull Request。

开发前请阅读 [Contributing Guide](/CONTRIBUTING.md)，了解环境搭建和代码规范。

## 许可证

本项目基于 [MIT License](/LICENSE) 开源。
