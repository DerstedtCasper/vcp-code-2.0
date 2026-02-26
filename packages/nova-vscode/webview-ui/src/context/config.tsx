/**
 * Config context — lightweight, Kilo-style
 * ==========================================
 * Manages backend configuration state (permissions, agents, providers, etc.)
 * and exposes an updateConfig method to apply partial updates.
 *
 * Design (matches Kilo Code upstream):
 *   1. Optimistic local merge via shallow spread (instant UI feedback)
 *   2. Fire-and-forget postMessage to extension for persistence
 *   3. Backend pushes authoritative configUpdated/configLoaded; we always accept it
 *   4. Scoped drafts for tabs with a Save/Discard button (AgentBehaviour, etc.)
 *
 * NO CAS queue, NO revision tracking, NO inflight promise — zero async blocking.
 */

import { createContext, useContext, createSignal, onCleanup, ParentComponent, Accessor, createMemo } from "solid-js"
import { useVSCode } from "./vscode"
import type { Config, ExtensionMessage } from "../types/messages"

interface ConfigContextValue {
  config: Accessor<Config>
  loading: Accessor<boolean>
  updateConfig: (partial: Partial<Config>) => void
  updateScopedConfig: (scopeID: string, partial: Partial<Config>) => void
  getScopedConfig: (scopeID: string) => Config
  hasScopedDraft: (scopeID: string) => boolean
  saveScopedConfig: (scopeID: string) => void
  discardScopedConfig: (scopeID: string) => void
  saveAllScopedConfig: () => void
  hasAnyScopedDraft: Accessor<boolean>
}

const ConfigContext = createContext<ConfigContextValue>()
const ConfigScopeContext = createContext<Accessor<string | undefined>>()

// ── helpers ──────────────────────────────────────────────────────────
const hasPatch = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.keys(value).length > 0
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

/** Deep merge (right wins). Used only for scoped drafts accumulation. */
const deepMerge = <T extends Record<string, unknown>>(left: T, right: Partial<T>): T => {
  const next: Record<string, unknown> = { ...left }
  for (const [key, value] of Object.entries(right) as [string, unknown][]) {
    if (value === undefined) continue
    const prev = next[key]
    next[key] = isRecord(prev) && isRecord(value) ? deepMerge(prev, value) : value
  }
  return next as T
}

const mergePatch = (left: Partial<Config>, right: Partial<Config>): Partial<Config> =>
  deepMerge(left as Record<string, unknown>, right as Record<string, unknown>) as Partial<Config>

// ── providers ────────────────────────────────────────────────────────
export const ConfigScopeProvider: ParentComponent<{ scopeID: string }> = (props) => {
  const value = () => props.scopeID
  return <ConfigScopeContext.Provider value={value}>{props.children}</ConfigScopeContext.Provider>
}

export const ConfigProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [config, setConfig] = createSignal<Config>({})
  const [loading, setLoading] = createSignal(true)
  const [scopedDrafts, setScopedDrafts] = createSignal<Record<string, Partial<Config>>>({})

  // ── core update: optimistic + fire-and-forget ────────────────────
  function updateConfig(partial: Partial<Config>) {
    // 1. Optimistic: shallow merge for instant UI feedback
    setConfig((prev) => ({ ...prev, ...partial }))
    // 2. Send to extension for persistence (fire-and-forget)
    vscode.postMessage({ type: "updateConfig", config: partial })
  }

  // ── scoped drafts (for tabs with Save / Discard buttons) ─────────
  const updateScopedConfig = (scopeID: string, partial: Partial<Config>) => {
    if (!scopeID) return
    setScopedDrafts((prev) => ({
      ...prev,
      [scopeID]: mergePatch(prev[scopeID] ?? {}, partial),
    }))
  }

  const getScopedConfig = (scopeID: string): Config => {
    const draft = scopedDrafts()[scopeID]
    if (!draft || !hasPatch(draft)) return config()
    return deepMerge(config() as Record<string, unknown>, draft as Record<string, unknown>) as Config
  }

  const hasScopedDraft = (scopeID: string): boolean => hasPatch(scopedDrafts()[scopeID])

  const saveScopedConfig = (scopeID: string) => {
    const patch = scopedDrafts()[scopeID]
    if (!patch || !hasPatch(patch)) return
    setScopedDrafts((prev) => { const next = { ...prev }; delete next[scopeID]; return next })
    updateConfig(patch)
  }

  const discardScopedConfig = (scopeID: string) => {
    if (!hasPatch(scopedDrafts()[scopeID])) return
    setScopedDrafts((prev) => { const next = { ...prev }; delete next[scopeID]; return next })
  }

  const saveAllScopedConfig = () => {
    const drafts = scopedDrafts()
    const entries = Object.values(drafts).filter((patch) => hasPatch(patch))
    if (entries.length === 0) return
    const merged = entries.reduce<Partial<Config>>((acc, patch) => mergePatch(acc, patch), {})
    setScopedDrafts({})
    updateConfig(merged)
  }

  // ── message handler (accept authoritative state from backend) ────
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "configLoaded") {
      setConfig(message.config)
      setLoading(false)
      return
    }
    if (message.type === "configUpdated") {
      // Backend is authoritative — always accept
      setConfig(message.config)
      return
    }
    // configConflict: backend resolved a conflict, accept its state
    if (message.type === "configConflict") {
      setConfig(message.config)
      return
    }
  })

  onCleanup(unsubscribe)

  // Request config in case the initial push was missed.
  // Retry a few times because the extension's httpClient may
  // not be ready yet when the first request arrives.
  let retries = 0
  const maxRetries = 5
  const retryMs = 500

  vscode.postMessage({ type: "requestConfig" })

  const retryTimer = setInterval(() => {
    retries++
    if (!loading() || retries >= maxRetries) {
      clearInterval(retryTimer)
      return
    }
    vscode.postMessage({ type: "requestConfig" })
  }, retryMs)

  onCleanup(() => clearInterval(retryTimer))

  const hasAnyScopedDraft = createMemo(() =>
    Object.values(scopedDrafts()).some((patch) => hasPatch(patch)),
  )

  const value: ConfigContextValue = {
    config,
    loading,
    updateConfig,
    updateScopedConfig,
    getScopedConfig,
    hasScopedDraft,
    saveScopedConfig,
    discardScopedConfig,
    saveAllScopedConfig,
    hasAnyScopedDraft,
  }

  return <ConfigContext.Provider value={value}>{props.children}</ConfigContext.Provider>
}

export function useConfig(): ConfigContextValue {
  const context = useContext(ConfigContext)
  if (!context) {
    throw new Error("useConfig must be used within a ConfigProvider")
  }
  const scopeIDAccessor = useContext(ConfigScopeContext)
  if (!scopeIDAccessor) {
    return context
  }

  const scopedConfig = createMemo(() => {
    const scopeID = scopeIDAccessor()
    return scopeID ? context.getScopedConfig(scopeID) : context.config()
  })

  const scopedValue: ConfigContextValue = {
    ...context,
    config: scopedConfig,
    updateConfig: (partial) => {
      const scopeID = scopeIDAccessor()
      if (scopeID) {
        context.updateScopedConfig(scopeID, partial)
        return
      }
      context.updateConfig(partial)
    },
  }

  return scopedValue
}
