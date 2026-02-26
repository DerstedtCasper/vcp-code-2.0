/**
 * VcpStatusBadge — 全局状态胶囊与 Token 统计抽屉
 *
 * 挂载在界面右上角（由 App.tsx 添加）。
 * 显示简要状态：当前模型·Agent·运行状态颜色。
 * 点击展开抽屉，显示 Token 统计、最近请求历史、VCP Backend 实时状态和快捷操作。
 */

import { Component, Show, createSignal, createMemo, For } from "solid-js"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { useServer } from "../../context/server"
import { useVSCode } from "../../context/vscode"

interface RunRecord {
  id: string
  model: string
  durationMs: number
  status: "ok" | "error"
  tokensIn: number
  tokensOut: number
  timestamp: number
}

// 模块级运行记录（最多保留 10 条）
const runHistory: RunRecord[] = []

/** 由外部在每次请求结束时调用以记录历史 */
export function pushRunRecord(record: RunRecord): void {
  runHistory.unshift(record)
  if (runHistory.length > 10) runHistory.pop()
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00"
  if (usd < 0.01) return `<$0.01`
  return `$${usd.toFixed(4)}`
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export const VcpStatusBadge: Component = () => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()

  const [drawerOpen, setDrawerOpen] = createSignal(false)

  // novacode_change start — VCP Bridge stats via postMessage (T-10)
  // Instead of directly connecting to the backend SSE, we request stats through
  // the extension host which proxies HTTP requests to the CLI backend.
  const bridgeStats = () => vscode.lastBridgeStats()
  const bridgeStatus = () => vscode.lastBridgeStatus()

  // When drawer opens, tell extension host to start polling bridge stats.
  // When drawer closes, extension host will keep the last state but we don't need live updates.
  const onDrawerToggle = (open: boolean) => {
    setDrawerOpen(open)
    if (open) {
      vscode.postMessage({ type: "requestVcpBridgeStats" })
    }
  }
  // novacode_change end

  const isBusy = () => session.status() === "busy"
  const isConnected = () => server.isConnected()
  const remoteStatus = () => vscode.lastVcpStatus()

  const statusClass = createMemo(() => {
    if (remoteStatus()) {
      if (!remoteStatus()!.connected || remoteStatus()!.status === "error") return "vcp-status-badge--error"
      if (remoteStatus()!.status === "busy") return "vcp-status-badge--busy"
      return "vcp-status-badge--idle"
    }
    if (!isConnected()) return "vcp-status-badge--error"
    if (isBusy()) return "vcp-status-badge--busy"
    return "vcp-status-badge--idle"
  })

  const statusDot = createMemo(() => {
    if (remoteStatus()) {
      if (!remoteStatus()!.connected || remoteStatus()!.status === "error") return "🔴"
      if (remoteStatus()!.status === "busy") return "🟡"
      return "🟢"
    }
    if (!isConnected()) return "🔴"
    if (isBusy()) return "🟡"
    return "🟢"
  })

  const modelLabel = createMemo(() => {
    if (remoteStatus()?.currentModel) {
      return remoteStatus()!.currentModel!.split("/").pop() ?? remoteStatus()!.currentModel!
    }
    const sel = session.selected()
    if (!sel) return language.t("status.badge.noModel")
    return sel.modelID.split("/").pop() ?? sel.modelID
  })

  const agentLabel = createMemo(() => remoteStatus()?.currentAgent || session.selectedAgent() || "")

  /** VCPBridge (VCPToolBox WS) connection indicator: 🟢 connected, 🔴 disconnected, ⚪ not configured */
  const vcpBridgeDot = createMemo(() => {
    const rs = remoteStatus()
    if (rs?.vcpBridgeConnected === true) return "🟢"
    if (rs?.vcpBridgeConnected === false) return "🔴"
    // null / undefined = not configured
    return null
  })

  // Token 统计（基于当前会话所有消息）
  const tokenStats = createMemo(() => {
    if (remoteStatus()) {
      return {
        total: remoteStatus()!.tokens.total,
        cost: session.totalCost(),
      }
    }
    // 通过 totalCost 已有 cost，直接使用 contextUsage 得到 token 总数
    const usage = session.contextUsage()
    const cost = session.totalCost()
    return {
      total: usage?.tokens ?? 0,
      cost,
    }
  })

  const recentRuns = createMemo(() => runHistory.slice(0, 5))

  return (
    <div class="vcp-status-badge-container">
      {/* 状态胶囊 */}
      <button
        type="button"
        class="vcp-status-badge"
        classList={{ [statusClass()]: true }}
        onClick={() => onDrawerToggle(!drawerOpen())}
        title={drawerOpen() ? language.t("status.drawer.hide") : language.t("status.drawer.show")}
        aria-haspopup="dialog"
      >
        <span class="vcp-status-badge-dot">{statusDot()}</span>
        <Show when={vcpBridgeDot()}>
          <span class="vcp-status-badge-bridge-dot" title="VCPToolBox">{vcpBridgeDot()}</span>
        </Show>
        <span class="vcp-status-badge-model">{modelLabel()}</span>
        <Show when={agentLabel()}>
          <span class="vcp-status-badge-sep">·</span>
          <span class="vcp-status-badge-agent">{agentLabel()}</span>
        </Show>
      </button>

      {/* 详情抽屉 */}
      <Show when={drawerOpen()}>
        <div class="vcp-status-drawer" role="dialog" aria-label={language.t("status.drawer.title")}>
          <div class="vcp-status-drawer-header">
            <span class="vcp-status-drawer-title">{language.t("status.drawer.title")}</span>
            <button
              type="button"
              class="vcp-status-drawer-close"
              onClick={() => onDrawerToggle(false)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Token 统计 */}
          <div class="vcp-status-drawer-section">
            <div class="vcp-status-drawer-section-label">
              {language.t("status.drawer.sessionStats")}
            </div>
            <div class="vcp-status-drawer-stats">
              <div class="vcp-status-drawer-stat">
                <span class="vcp-status-drawer-stat-label">{language.t("status.drawer.totalTokens")}</span>
                <span class="vcp-status-drawer-stat-value">{formatTokens(tokenStats().total)}</span>
              </div>
              <div class="vcp-status-drawer-stat">
                <span class="vcp-status-drawer-stat-label">{language.t("status.drawer.cost")}</span>
                <span class="vcp-status-drawer-stat-value">{formatCost(tokenStats().cost)}</span>
              </div>
            </div>
          </div>

          {/* 最近请求历史 */}
          <Show when={recentRuns().length > 0}>
            <div class="vcp-status-drawer-section">
              <div class="vcp-status-drawer-section-label">
                {language.t("status.drawer.recentRuns")}
              </div>
              <div class="vcp-status-drawer-runs">
                <For each={recentRuns()}>
                  {(run) => (
                    <div
                      class="vcp-status-drawer-run"
                      classList={{ "vcp-status-drawer-run--error": run.status === "error" }}
                    >
                      <span class="vcp-status-drawer-run-status">
                        {run.status === "ok" ? "✓" : "✗"}
                      </span>
                      <span class="vcp-status-drawer-run-model">{run.model.split("/").pop()}</span>
                      <span class="vcp-status-drawer-run-tokens">
                        ↑{formatTokens(run.tokensIn)} ↓{formatTokens(run.tokensOut)}
                      </span>
                      <span class="vcp-status-drawer-run-duration">{formatMs(run.durationMs)}</span>
                      <span class="vcp-status-drawer-run-time">{formatTime(run.timestamp)}</span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* novacode_change start — VCP Backend section (T-3.4 ~ T-3.7) */}
          <div class="vcp-status-drawer-section">
            <div class="vcp-status-drawer-section-label">
              {language.t("status.drawer.vcpBackend")}
              <span
                class="vcp-bridge-conn-dot"
                classList={{
                  "vcp-bridge-conn-dot--connected": bridgeStats()?.connected === true,
                  "vcp-bridge-conn-dot--disconnected": bridgeStats()?.connected !== true,
                }}
                title={bridgeStats()?.connected ? language.t("status.drawer.vcpConnected") : language.t("status.drawer.vcpDisconnected")}
              />
            </div>

            {/* Connection status row */}
            <div class="vcp-bridge-status-row">
              <span class="vcp-bridge-status-label">{language.t("status.drawer.vcpConnection")}</span>
              <span class="vcp-bridge-status-value" classList={{
                "vcp-bridge-status-value--ok": bridgeStats()?.connected === true,
                "vcp-bridge-status-value--err": bridgeStats()?.connected !== true,
              }}>
                {bridgeStats()?.connected
                  ? language.t("status.drawer.vcpConnected")
                  : bridgeStatus()?.lastError
                    ? `${language.t("status.drawer.vcpDisconnected")} — ${bridgeStatus()!.lastError!.slice(0, 40)}`
                    : language.t("status.drawer.vcpDisconnected")}
              </span>
            </div>

            {/* Toolbox version / uptime */}
            <Show when={bridgeStats()?.toolboxVersion || bridgeStats()?.uptime}>
              <div class="vcp-bridge-status-row">
                <Show when={bridgeStats()?.toolboxVersion}>
                  <span class="vcp-bridge-status-label">v{bridgeStats()!.toolboxVersion}</span>
                </Show>
                <Show when={bridgeStats()?.uptime}>
                  <span class="vcp-bridge-status-value">
                    {language.t("status.drawer.vcpUptime")}: {formatMs(bridgeStats()!.uptime! * 1000)}
                  </span>
                </Show>
              </div>
            </Show>

            {/* Resource usage */}
            <Show when={bridgeStats()?.resourceUsage}>
              <div class="vcp-bridge-resource-row">
                <Show when={bridgeStats()!.resourceUsage!.memory != null}>
                  <span class="vcp-bridge-resource-item">
                    💾 {(bridgeStats()!.resourceUsage!.memory! / 1024 / 1024).toFixed(0)}MB
                  </span>
                </Show>
                <Show when={bridgeStats()!.resourceUsage!.cpu != null}>
                  <span class="vcp-bridge-resource-item">
                    ⚡ {bridgeStats()!.resourceUsage!.cpu!.toFixed(1)}%
                  </span>
                </Show>
                <Show when={bridgeStats()!.resourceUsage!.activeConnections != null}>
                  <span class="vcp-bridge-resource-item">
                    🔗 {bridgeStats()!.resourceUsage!.activeConnections}
                  </span>
                </Show>
              </div>
            </Show>

            {/* Active Plugins */}
            <Show when={bridgeStats()?.activePlugins && bridgeStats()!.activePlugins.length > 0}>
              <div class="vcp-bridge-plugins">
                <div class="vcp-bridge-sub-label">{language.t("status.drawer.vcpPlugins")} ({bridgeStats()!.activePlugins.length})</div>
                <For each={bridgeStats()!.activePlugins}>
                  {(plugin) => (
                    <div class="vcp-bridge-plugin-row">
                      <span
                        class="vcp-bridge-plugin-dot"
                        classList={{
                          "vcp-bridge-plugin-dot--running": plugin.status === "running",
                          "vcp-bridge-plugin-dot--error": plugin.status === "error",
                          "vcp-bridge-plugin-dot--completed": plugin.status === "completed",
                          "vcp-bridge-plugin-dot--idle": plugin.status === "idle",
                        }}
                      />
                      <span class="vcp-bridge-plugin-name">{plugin.name}</span>
                      <Show when={plugin.currentStep}>
                        <span class="vcp-bridge-plugin-step">{plugin.currentStep}</span>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Distributed Servers */}
            <Show when={bridgeStats()?.distributedServers && bridgeStats()!.distributedServers.length > 0}>
              <div class="vcp-bridge-servers">
                <div class="vcp-bridge-sub-label">{language.t("status.drawer.vcpServers")} ({bridgeStats()!.distributedServers.length})</div>
                <For each={bridgeStats()!.distributedServers}>
                  {(srv) => (
                    <div class="vcp-bridge-server-row">
                      <span
                        class="vcp-bridge-plugin-dot"
                        classList={{
                          "vcp-bridge-plugin-dot--running": srv.status === "online",
                          "vcp-bridge-plugin-dot--error": srv.status === "offline",
                          "vcp-bridge-plugin-dot--idle": srv.status === "connecting",
                        }}
                      />
                      <span class="vcp-bridge-plugin-name">{srv.name}</span>
                      <span class="vcp-bridge-plugin-step">{srv.status}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Recent Logs (last 5) */}
            <Show when={bridgeStats()?.recentLogs && bridgeStats()!.recentLogs.length > 0}>
              <div class="vcp-bridge-logs">
                <div class="vcp-bridge-sub-label">{language.t("status.drawer.vcpLogs")}</div>
                <For each={bridgeStats()!.recentLogs.slice(-5).reverse()}>
                  {(log) => (
                    <div
                      class="vcp-bridge-log-entry"
                      classList={{
                        "vcp-bridge-log-entry--error": log.level === "error",
                        "vcp-bridge-log-entry--warn": log.level === "warn",
                      }}
                    >
                      <span class="vcp-bridge-log-time">{formatTime(log.timestamp)}</span>
                      <Show when={log.plugin}>
                        <span class="vcp-bridge-log-plugin">[{log.plugin}]</span>
                      </Show>
                      <span class="vcp-bridge-log-msg">{log.message.slice(0, 80)}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
          {/* novacode_change end */}

          {/* 快捷操作 */}
          <div class="vcp-status-drawer-section vcp-status-drawer-actions">
            <button
              type="button"
              class="vcp-status-drawer-action-btn"
              onClick={() => {
                // 刷新连接：重新加载服务器信息
                window.dispatchEvent(new CustomEvent("vcpReconnect"))
              }}
            >
              🔄 {language.t("status.action.reconnect")}
            </button>
            <Show when={session.promptQueue().length > 0}>
              <button
                type="button"
                class="vcp-status-drawer-action-btn vcp-status-drawer-action-btn--danger"
                onClick={() => {
                  // 清空所有队列项
                  session.promptQueue().forEach((item) => session.dequeuePrompt(item.id))
                }}
              >
                🗑️ {language.t("status.action.clearQueue")} ({session.promptQueue().length})
              </button>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
