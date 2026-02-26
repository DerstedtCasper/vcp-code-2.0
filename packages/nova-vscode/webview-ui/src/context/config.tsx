/**
 * Config context
 * Manages backend configuration state (permissions, agents, providers, etc.)
 * and exposes an updateConfig method to apply partial updates.
 */

import { createContext, useContext, createSignal, onCleanup, ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { Config, ConfigConflictMessage, ConfigUpdatedMessage, ExtensionMessage } from "../types/messages"

interface ConfigContextValue {
  config: Accessor<Config>
  loading: Accessor<boolean>
  updateConfig: (partial: Partial<Config>) => void
}

const ConfigContext = createContext<ConfigContextValue>()

export const ConfigProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [config, setConfig] = createSignal<Config>({})
  const [loading, setLoading] = createSignal(true)
  const [revision, setRevision] = createSignal<number | undefined>(undefined)
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
    setConfig((prev) => mergeConfig(prev as Record<string, unknown>, partial as Record<string, unknown>) as Config)
    // Send to extension for persistence
    enqueueConfigMutation(partial)
  }

  const value: ConfigContextValue = {
    config,
    loading,
    updateConfig,
  }

  return <ConfigContext.Provider value={value}>{props.children}</ConfigContext.Provider>
}

export function useConfig(): ConfigContextValue {
  const context = useContext(ConfigContext)
  if (!context) {
    throw new Error("useConfig must be used within a ConfigProvider")
  }
  return context
}
