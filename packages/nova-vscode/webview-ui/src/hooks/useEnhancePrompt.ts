/**
 * useEnhancePrompt — Prompt 增强钩子
 *
 * 点击 ✨ 按钮时，将当前 prompt 文本发送给后端进行润色增强，
 * 后端通过 enhancePromptResult 消息返回增强后的文本。
 *
 * Usage:
 *   const enhance = useEnhancePrompt(vscode)
 *   enhance.enhance(currentText, contextItems)   // 触发增强
 *   enhance.isEnhancing()                         // loading 状态
 *   enhance.lastError()                           // 错误信息
 */

import { createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { WebviewMessage, ExtensionMessage, EnhancePromptResponse } from "../types/messages"
import type { ContextItem } from "../components/chat/ContextPills"

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

export interface EnhancePrompt {
  isEnhancing: Accessor<boolean>
  lastError: Accessor<string | null>
  enhance: (text: string, contextItems?: ContextItem[]) => void
  cancelEnhance: () => void
}

let enhanceCounter = 0

export function useEnhancePrompt(
  vscode: VSCodeContext,
  onResult: (enhanced: string) => void,
): EnhancePrompt {
  const [isEnhancing, setIsEnhancing] = createSignal(false)
  const [lastError, setLastError] = createSignal<string | null>(null)
  let currentRequestId = ""

  const unsubscribe = vscode.onMessage((message) => {
    const enhanceMessage = message as EnhancePromptResponse
    // 增强成功
    if (enhanceMessage.type === "enhancePromptResult") {
      const result = enhanceMessage
      if (result.requestId === currentRequestId) {
        setIsEnhancing(false)
        setLastError(null)
        onResult(result.text)
      }
      return
    }
    // 增强失败
    if (enhanceMessage.type === "enhancePromptError") {
      const err = enhanceMessage
      if (err.requestId === currentRequestId) {
        setIsEnhancing(false)
        setLastError(err.error)
      }
    }
  })

  onCleanup(() => {
    unsubscribe()
  })

  const enhance = (text: string, contextItems?: ContextItem[]) => {
    if (!text.trim()) return
    enhanceCounter++
    currentRequestId = `enhance-${enhanceCounter}`
    setIsEnhancing(true)
    setLastError(null)
    vscode.postMessage({
      type: "enhancePrompt",
      text,
      contextItems: contextItems?.map((c) => ({ type: c.type, label: c.label, path: c.path })),
      requestId: currentRequestId,
    } as unknown as WebviewMessage)
  }

  const cancelEnhance = () => {
    currentRequestId = ""
    setIsEnhancing(false)
  }

  return { isEnhancing, lastError, enhance, cancelEnhance }
}
