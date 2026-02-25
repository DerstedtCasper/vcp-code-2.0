# Change Log

All notable changes to the "kilo-code" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release

## [7.0.33] - 2026-02-24

- 完成 VCP Code 2.0 全量重构规划落地（Phase A-H）
- 新增 Context 记忆控制中心五分区与 Memory CRUD/Preview（Pin/Exclude/Compress）
- AgentBehaviour 记忆配置迁移为只读提示，统一写入口到 ContextTab
- 补齐 5.9 导航交互命令链路（prompts/help/popout/openInNewTab/import/export）
- 新增 Agent Team 运行态诊断与 Memory API 路由组
- 新增工具后记忆刷新事件语义 `session.vcp.memory.refresh`
- VCP 控制中心增加 `vcp_dynamic_fold` 与 WindowSensor/ScreenPilot 观测可视化
- 完成品牌与 i18n 收口（VCP 页面硬编码清理、zh/en parity 校验）
- 完成 parity e2e 基线与全链路回归 smoke 验证

