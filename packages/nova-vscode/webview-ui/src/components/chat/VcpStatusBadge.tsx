/**
 * VcpStatusBadge — 全局状态胶囊与 Token 统计抽屉
 *
 * 挂载在界面右上角（由 App.tsx 添加）。
 * 显示简要状态：当前模型·Agent·运行状态颜色。
 * 点击展开抽屉，显示 Token 统计、最近请求历史和快捷操作。
 */

import { Component, Show, createSignal, createMemo, For } from "solid-js"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { useServer } from "../../context/server"

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

  const [drawerOpen, setDrawerOpen] = createSignal(false)

  const isBusy = () => session.status() === "busy"
  const isConnected = () => server.isConnected()

  const statusClass = createMemo(() => {
    if (!isConnected()) return "vcp-status-badge--error"
    if (isBusy()) return "vcp-status-badge--busy"
    return "vcp-status-badge--idle"
  })

  const statusDot = createMemo(() => {
    if (!isConnected()) return "🔴"
    if (isBusy()) return "🟡"
    return "🟢"
  })

  const modelLabel = createMemo(() => {
    const sel = session.selected()
    if (!sel) return language.t("status.badge.noModel")
    return sel.modelID.split("/").pop() ?? sel.modelID
  })

  const agentLabel = createMemo(() => session.selectedAgent() || "")

  // Token 统计（基于当前会话所有消息）
  const tokenStats = createMemo(() => {
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
        onClick={() => setDrawerOpen((v) => !v)}
        title={drawerOpen() ? language.t("status.drawer.hide") : language.t("status.drawer.show")}
        // eslint-disable-next-line jsx-a11y/aria-proptypes
        aria-expanded={drawerOpen() as boolean | "true" | "false"}
        aria-haspopup="dialog"
      >
        <span class="vcp-status-badge-dot">{statusDot()}</span>
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
              onClick={() => setDrawerOpen(false)}
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
