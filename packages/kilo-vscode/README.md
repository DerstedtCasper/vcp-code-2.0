# VCP Code 2.0 VS Code Extension

这是 VCP Code 2.0 的 VS Code 扩展工程目录。

## 目标

- 对齐并复用成熟的交互体验（会话、设置、模型与提供商配置）
- 在此基础上补充 VCP 协议与运行态可视化能力
- 保障可发布（VSIX）、可维护（多人协作）

## 开发命令

```bash
# 在本目录
bun run package
bun run check-types
bun run lint
```

## 生成 VSIX

```bash
bunx @vscode/vsce package --no-dependencies -o vcp-code-<version>.vsix
```

## 相关链接

- 仓库主页：https://github.com/DerstedtCasper/vcp-code-2.0
- Issues：https://github.com/DerstedtCasper/vcp-code-2.0/issues
- Discussions：https://github.com/DerstedtCasper/vcp-code-2.0/discussions

## 维护说明

对外文案、跳转链接与品牌命名统一使用 **VCP Code / VCP Code 2.0**，避免历史命名残留造成维护与用户认知偏差。
