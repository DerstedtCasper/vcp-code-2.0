/**
 * VS Code API context provider
 * Provides access to the VS Code webview API for posting messages
 */

import { createContext, useContext, onCleanup, createSignal } from "solid-js"
import type { ParentComponent, Accessor } from "solid-js"
import type { VSCodeAPI, WebviewMessage, ExtensionMessage, VcpStatusUpdateMessage } from "../types/messages"

// Get the VS Code API (only available in webview context)
let vscodeApi: VSCodeAPI | undefined

export function getVSCodeAPI(): VSCodeAPI {
  if (!vscodeApi) {
    // In VS Code webview, acquireVsCodeApi is available globally
    if (typeof acquireVsCodeApi === "function") {
      vscodeApi = acquireVsCodeApi()
    } else {
      // Mock for development/testing outside VS Code
      console.warn("[Nova New] Running outside VS Code, using mock API")
      vscodeApi = {
        postMessage: (msg) => console.log("[Nova New] Mock postMessage:", msg),
        getState: () => undefined,
        setState: () => {},
      }
    }
  }
  return vscodeApi
}

// Context value type
interface VSCodeContextValue {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
  getState: <T>() => T | undefined
  setState: <T>(state: T) => void
  lastVcpStatus: Accessor<VcpStatusUpdateMessage["payload"] | null>
}

const VSCodeContext = createContext<VSCodeContextValue>()

export const VSCodeProvider: ParentComponent = (props) => {
  const api = getVSCodeAPI()
  const handlers = new Set<(message: ExtensionMessage) => void>()
  const [lastVcpStatus, setLastVcpStatus] = createSignal<VcpStatusUpdateMessage["payload"] | null>(null)

  // Listen for messages from the extension
  const messageListener = (event: MessageEvent) => {
    const message = event.data as ExtensionMessage
    if (message.type === "vcpStatusUpdate") {
      setLastVcpStatus(message.payload)
    }
    handlers.forEach((handler) => handler(message))
  }

  window.addEventListener("message", messageListener)

  onCleanup(() => {
    window.removeEventListener("message", messageListener)
    handlers.clear()
  })

  const value: VSCodeContextValue = {
    postMessage: (message: WebviewMessage) => {
      api.postMessage(message)
    },
    onMessage: (handler: (message: ExtensionMessage) => void) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    getState: <T,>() => api.getState() as T | undefined,
    setState: <T,>(state: T) => api.setState(state),
    lastVcpStatus,
  }

  return <VSCodeContext.Provider value={value}>{props.children}</VSCodeContext.Provider>
}

export function useVSCode(): VSCodeContextValue {
  const context = useContext(VSCodeContext)
  if (!context) {
    throw new Error("useVSCode must be used within a VSCodeProvider")
  }
  return context
}
