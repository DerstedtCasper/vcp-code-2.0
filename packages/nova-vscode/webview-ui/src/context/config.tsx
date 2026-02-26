/**
 * Config context
 * Manages backend configuration state (permissions, agents, providers, etc.)
 * and exposes an updateConfig method to apply partial updates.
 */

import { createContext, useContext, createSignal, onCleanup, ParentComponent, Accessor, createMemo } from "solid-js"
import { useVSCode } from "./vscode"
import type { Config, ConfigConflictMessage, ConfigUpdatedMessage, ExtensionMessage } from "../types/messages"

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

const hasPatch = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.keys(value).length > 0
}

export const ConfigScopeProvider: ParentComponent<{ scopeID: string }> = (props) => {
  const value = () => props.scopeID
  return <ConfigScopeContext.Provider value={value}>{props.children}</ConfigScopeContext.Provider>
}

export const ConfigProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [config, setConfig] = createSignal<Config>({})
  const [loading, setLoading] = createSignal(true)
  const [revision, setRevision] = createSignal<number | undefined>(undefined)
  const [scopedDrafts, setScopedDrafts] = createSignal<Record<string, Partial<Config>>>({})
  let staged: Partial<Config> | null = null
  let running = false
  let nextMutationID = 0
  let inflight:
    | {
        mutationID: number
        resolve: (value: ConfigUpdatedMessage) => void
        reject: (reason: ConfigConflictMessage | Error) => void
      }
    | null = null

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value)

  const mergeConfig = <T extends Record<string, unknown>>(left: T, right: Partial<T>): T => {
    const next: Record<string, unknown> = { ...left }
    for (const [key, value] of Object.entries(right) as [string, unknown][]) {
      if (value === undefined) continue
      const prev = next[key]
      next[key] =
        isRecord(prev) && isRecord(value)
          ? mergeConfig(prev, value)
          : value
    }
    return next as T
  }

  const mergePatch = (left: Partial<Config>, right: Partial<Config>): Partial<Config> =>
    mergeConfig(left as Record<string, unknown>, right as Record<string, unknown>) as Partial<Config>

  const applyLocalConfig = (partial: Partial<Config>) => {
    setConfig((prev) => mergeConfig(prev as Record<string, unknown>, partial as Record<string, unknown>) as Config)
  }

  const waitConfigMutation = (mutationID: number) =>
    new Promise<ConfigUpdatedMessage>((resolve, reject) => {
      inflight = { mutationID, resolve, reject }
    })

  const sendNext = async () => {
    if (!staged) {
      running = false
      return
    }

    const patch = staged
    staged = null
    const mutationID = ++nextMutationID
    const expectedRevision = revision()
    console.debug("[Nova New] Config queue: send", { mutationID, expectedRevision, hasPending: !!staged })
    const waiter = waitConfigMutation(mutationID)
    vscode.postMessage({
      type: "updateConfig",
      config: patch,
      expectedRevision,
    })

    try {
      const updated = await waiter
      setConfig(updated.config)
      setRevision(updated.revision ?? revision())
    } catch (error) {
      if (typeof error === "object" && error !== null && "type" in error && error.type === "configConflict") {
        const conflict = error as ConfigConflictMessage
        console.warn("[Nova New] Config queue: conflict", {
          mutationID,
          revision: conflict.revision,
        })
        setConfig(conflict.config)
        setRevision(conflict.revision)
      } else {
        console.error("[Nova New] Config update failed", error)
      }
    }

    await sendNext()
  }

  const enqueueConfigMutation = (partial: Partial<Config>) => {
    const current = staged ?? {}
    staged = mergeConfig(current as Record<string, unknown>, partial as Record<string, unknown>) as Partial<Config>
    console.debug("[Nova New] Config queue: enqueue", { running, hasPending: !!staged })
    if (running) return
    running = true
    void sendNext()
  }

  const updateScopedConfig = (scopeID: string, partial: Partial<Config>) => {
    if (!scopeID) return
    setScopedDrafts((prev) => {
      const current = prev[scopeID] ?? {}
      return {
        ...prev,
        [scopeID]: mergePatch(current, partial),
      }
    })
  }

  const getScopedConfig = (scopeID: string): Config => {
    const draft = scopedDrafts()[scopeID]
    if (!draft || !hasPatch(draft)) return config()
    return mergeConfig(config() as Record<string, unknown>, draft as Record<string, unknown>) as Config
  }

  const hasScopedDraft = (scopeID: string): boolean => hasPatch(scopedDrafts()[scopeID])

  const saveScopedConfig = (scopeID: string) => {
    const patch = scopedDrafts()[scopeID]
    if (!patch || !hasPatch(patch)) return
    setScopedDrafts((prev) => {
      const next = { ...prev }
      delete next[scopeID]
      return next
    })
    applyLocalConfig(patch)
    enqueueConfigMutation(patch)
  }

  const discardScopedConfig = (scopeID: string) => {
    if (!hasPatch(scopedDrafts()[scopeID])) return
    setScopedDrafts((prev) => {
      const next = { ...prev }
      delete next[scopeID]
      return next
    })
  }

  const saveAllScopedConfig = () => {
    const drafts = scopedDrafts()
    const entries = Object.values(drafts).filter((patch) => hasPatch(patch))
    if (entries.length === 0) return
    const merged = entries.reduce<Partial<Config>>((acc, patch) => mergePatch(acc, patch), {})
    setScopedDrafts({})
    applyLocalConfig(merged)
    enqueueConfigMutation(merged)
  }

  // Register handler immediately (not in onMount) so we never miss
  // a configLoaded message that arrives before the DOM mount.
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "configLoaded") {
      setConfig(message.config)
      setRevision(message.revision)
      setLoading(false)
      return
    }
    if (message.type === "configUpdated") {
      if (!inflight) {
        console.debug("[Nova New] Config queue: stale configUpdated dropped (no inflight)")
        return
      }
      if (
        typeof message.revision === "number" &&
        typeof revision() === "number" &&
        message.revision < (revision() as number)
      ) {
        console.warn("[Nova New] Config queue: stale configUpdated dropped", {
          inflightMutationID: inflight.mutationID,
          incomingRevision: message.revision,
          currentRevision: revision(),
        })
        inflight.reject(new Error("Stale config update response dropped"))
        inflight = null
        return
      }
      setConfig(message.config)
      setRevision(message.revision)
      inflight?.resolve(message)
      inflight = null
      return
    }
    if (message.type === "configConflict") {
      if (!inflight) {
        console.debug("[Nova New] Config queue: stale configConflict dropped (no inflight)")
        return
      }
      setConfig(message.config)
      setRevision(message.revision)
      inflight?.reject(message)
      inflight = null
      return
    }
    if (message.type === "error") {
      inflight?.reject(new Error(message.message))
      inflight = null
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

  function updateConfig(partial: Partial<Config>) {
    // Optimistically update local state
    applyLocalConfig(partial)
    // Send to extension for persistence
    enqueueConfigMutation(partial)
  }

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
