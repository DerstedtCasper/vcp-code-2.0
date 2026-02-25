# VCP Code 2.0

VCP Code 2.0 是面向长期工程维护的 AI 编程扩展与运行时组合项目，当前仓库以 VS Code 扩展 `packages/kilo-vscode` 为主交付目标，持续对齐并重构原有交互，同时补充 VCP 协议相关能力。

## 仓库定位

- 目标：在复用成熟能力的基础上，交付可维护、可发布、可扩展的 VCP Code 版本。
- 主要交付：VS Code 扩展（`.vsix`）、设置页交互、对话交互与 VCP 功能映射。
- 协作方式：以 GitHub PR/Issue 为主，面向多人长期维护。

## 目录概览

- `packages/kilo-vscode/`：VS Code 扩展主工程（当前主要开发目录）
- `packages/opencode/`：CLI/服务端运行时
- `packages/app/`：共享 UI 相关实现
- `helloagents/`：规划与知识库文档

## 本地开发

1. 安装依赖

```bash
bun install
```

2. 构建扩展

```bash
cd packages/kilo-vscode
bun run package
```

3. 类型检查与 Lint

```bash
bun run check-types
bun run lint
```

## 打包 VSIX

在 `packages/kilo-vscode` 目录执行：

```bash
bunx @vscode/vsce package --no-dependencies -o vcp-code-<version>.vsix
```

示例产物：`vcp-code-7.0.31.vsix`。

## 反馈与协作

- 项目主页：https://github.com/DerstedtCasper/vcp-code-2.0
- 问题反馈（Issues）：https://github.com/DerstedtCasper/vcp-code-2.0/issues
- 讨论区（Discussions）：https://github.com/DerstedtCasper/vcp-code-2.0/discussions

## 许可证

本项目遵循仓库内 `LICENSE` 文件。
