/**
 * Provider/model context
 * Manages available providers, models, and the global default selection.
 * Selection is now per-session — see session.tsx.
 */

import { createContext, useContext, createSignal, createMemo, onCleanup, ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { Provider, ProviderModel, ModelSelection, ExtensionMessage } from "../types/messages"
import { flattenModels, findModel as _findModel } from "./provider-utils"

export type EnrichedModel = ProviderModel & { providerID: string; providerName: string }

interface ProviderContextValue {
  providers: Accessor<Record<string, Provider>>
  connected: Accessor<string[]>
  defaults: Accessor<Record<string, string>>
  defaultSelection: Accessor<ModelSelection>
  models: Accessor<EnrichedModel[]>
  findModel: (selection: ModelSelection | null) => EnrichedModel | undefined
  /**
   * Inject dynamically-fetched models (e.g. from /models API) into a provider
   * so that ModelSelectorBase can display them.
   */
  injectCustomModels: (providerID: string, providerName: string, modelIds: string[]) => void
}

const NOVA_AUTO: ModelSelection = { providerID: "kilo", modelID: "kilo/auto" }

const ProviderContext = createContext<ProviderContextValue>()

export const ProviderProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [providers, setProviders] = createSignal<Record<string, Provider>>({})
  const [connected, setConnected] = createSignal<string[]>([])
  const [defaults, setDefaults] = createSignal<Record<string, string>>({})
  const [defaultSelection, setDefaultSelection] = createSignal<ModelSelection>(NOVA_AUTO)

  const models = createMemo<EnrichedModel[]>(() => flattenModels(providers()))

  function findModel(selection: ModelSelection | null): EnrichedModel | undefined {
    return _findModel(models(), selection)
  }

  /**
   * Merge dynamically-fetched model IDs (from OpenAI-compatible /models API)
   * into the global provider map so that ModelSelectorBase can see them.
   * If the provider already exists we only ADD missing models (never overwrite
   * richer metadata coming from the backend). If the provider doesn't exist
   * yet we create a minimal entry.
   */
  function injectCustomModels(providerID: string, providerName: string, modelIds: string[]): void {
    if (!providerID || modelIds.length === 0) return

    setProviders((prev) => {
      const next = { ...prev }
      const existing = next[providerID]
      const existingModels = existing?.models ?? {}
      const mergedModels: Record<string, import("../types/messages").ProviderModel> = { ...existingModels }

      for (const id of modelIds) {
        if (!mergedModels[id]) {
          mergedModels[id] = { id, name: id }
        }
      }

      next[providerID] = {
        id: providerID,
        name: existing?.name ?? providerName,
        models: mergedModels,
      }
      return next
    })

    // Also mark this provider as connected so visibleModels includes it
    setConnected((prev) => (prev.includes(providerID) ? prev : [...prev, providerID]))
  }

  // Register handler immediately (not in onMount) so we never miss
  // a providersLoaded message that arrives before the DOM mount.
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "providersLoaded") {
      return
    }

    setProviders(message.providers)
    setConnected(message.connected)
    setDefaults(message.defaults)
    setDefaultSelection(message.defaultSelection)
  })

  onCleanup(unsubscribe)

  // Request providers in case the initial push was missed.
  // Retry a few times because the extension's httpClient may
  // not be ready yet when the first request arrives.
  let retries = 0
  const maxRetries = 5
  const retryMs = 500

  vscode.postMessage({ type: "requestProviders" })

  const retryTimer = setInterval(() => {
    retries++
    if (Object.keys(providers()).length > 0 || retries >= maxRetries) {
      clearInterval(retryTimer)
      return
    }
    vscode.postMessage({ type: "requestProviders" })
  }, retryMs)

  onCleanup(() => clearInterval(retryTimer))

  const value: ProviderContextValue = {
    providers,
    connected,
    defaults,
    defaultSelection,
    models,
    findModel,
    injectCustomModels,
  }

  return <ProviderContext.Provider value={value}>{props.children}</ProviderContext.Provider>
}

export function useProvider(): ProviderContextValue {
  const context = useContext(ProviderContext)
  if (!context) {
    throw new Error("useProvider must be used within a ProviderProvider")
  }
  return context
}
