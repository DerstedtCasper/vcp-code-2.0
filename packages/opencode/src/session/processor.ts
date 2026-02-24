import { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Session } from "."
import { Agent } from "@/agent/agent"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "./summary"
import { Bus } from "@/bus"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { Config } from "@/config/config"
import { SessionCompaction } from "./compaction"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { Telemetry } from "@kilocode/kilo-telemetry" // kilocode_change
import { VcpContentCompatibility } from "@/kilocode/vcp-content"
import { ToolRegistry } from "@/tool/registry"
import type { Tool } from "@/tool/tool"
import { ulid } from "ulid"
import {
  buildToolCandidates,
  deriveSkillDispatchName,
  isToolAllowed,
  limitToolRequests,
  normalizeToolName,
  resolveBridgeMode,
} from "@/kilocode/vcp-tool-request"

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const log = Log.create({ service: "session.processor" })

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  export function create(input: {
    assistantMessage: MessageV2.Assistant
    sessionID: string
    model: Provider.Model
    abort: AbortSignal
  }) {
    const toolcalls: Record<string, MessageV2.ToolPart> = {}
    let snapshot: string | undefined
    let blocked = false
    let attempt = 0
    let needsCompaction = false
    let stepStart = 0 // kilocode_change
    let cachedBridgeTools: Awaited<ReturnType<typeof ToolRegistry.tools>> | undefined

    function coerceToolRequestArgs(toolID: string, args: unknown): Record<string, unknown> {
      if (args && typeof args === "object" && !Array.isArray(args)) {
        return args as Record<string, unknown>
      }
      if (toolID === "bash" && typeof args === "string") {
        return { command: args }
      }
      if (toolID === "read" && typeof args === "string") {
        return { filePath: args }
      }
      if (toolID === "glob" && typeof args === "string") {
        return { pattern: args }
      }
      if (toolID === "grep" && typeof args === "string") {
        return { pattern: args }
      }
      if (toolID === "websearch" && typeof args === "string") {
        return { query: args }
      }
      if (toolID === "codesearch" && typeof args === "string") {
        return { query: args }
      }
      return {}
    }

    async function executeVcpToolRequests(inputRequests: { tool: string; arguments?: unknown; raw: string }[]) {
      if (inputRequests.length === 0) return

      try {
        const runtimeConfig = await Config.get()
        const policy = runtimeConfig.vcp?.toolRequest
        const memoryRefresh = runtimeConfig.vcp?.memory?.refresh
        const shouldPublishMemoryRefresh = memoryRefresh?.enabled === true && memoryRefresh.afterToolCall === true
        const profileWeight = memoryRefresh?.profileWeight ?? 1
        const folderWeight = memoryRefresh?.folderWeight ?? 1
        if (resolveBridgeMode(policy) !== "execute") return

        const requests = limitToolRequests(inputRequests, policy?.maxPerMessage)
        const skipped = inputRequests.slice(requests.length)
        for (const item of skipped) {
          Bus.publish(Session.Event.VCPToolRequestResult, {
            sessionID: input.sessionID,
            messageID: input.assistantMessage.id,
            tool: item.tool,
            status: "skipped",
            error: "Skipped: reached maxPerMessage limit",
          })
        }

        const sessionInfo = await Session.get(input.sessionID)
        const agent = await Agent.get(input.assistantMessage.agent)
        const messages = await Session.messages({ sessionID: input.sessionID, limit: 300 })
        cachedBridgeTools =
          cachedBridgeTools ??
          (await ToolRegistry.tools({ modelID: input.model.api.id, providerID: input.model.providerID }, agent))

        for (const request of requests) {
          const candidates = buildToolCandidates(request.tool)
          let match = cachedBridgeTools.find((item) => {
            const normalizedID = normalizeToolName(item.id)
            return candidates.includes(item.id) || candidates.includes(normalizedID)
          })
          const skillDispatchName = deriveSkillDispatchName(request.tool)
          if (!match && skillDispatchName) {
            match = cachedBridgeTools.find((item) => normalizeToolName(item.id) === "skill")
          }
          if (!match) {
            Bus.publish(Session.Event.VCPToolRequestResult, {
              sessionID: input.sessionID,
              messageID: input.assistantMessage.id,
              tool: request.tool,
              status: "skipped",
              error: "Skipped: no matching tool registered",
            })
            continue
          }

          const allow = isToolAllowed(match.id, policy)
          if (!allow.allowed) {
            Bus.publish(Session.Event.VCPToolRequestResult, {
              sessionID: input.sessionID,
              messageID: input.assistantMessage.id,
              tool: request.tool,
              resolvedTool: match.id,
              status: "skipped",
              error: `Skipped: ${allow.reason}`,
            })
            continue
          }

          const callID = ulid()
          const initialInput = coerceToolRequestArgs(match.id, request.arguments)
          if (normalizeToolName(match.id) === "skill" && skillDispatchName) {
            if (typeof initialInput.name !== "string" || !initialInput.name.trim()) {
              initialInput.name = skillDispatchName
            }
          }
          let toolPart = (await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: input.assistantMessage.id,
            sessionID: input.assistantMessage.sessionID,
            type: "tool",
            tool: match.id,
            callID,
            state: {
              status: "running",
              input: initialInput,
              metadata: {
                source: "vcp_tool_request",
                requestedTool: request.tool,
                raw: request.raw,
              },
              time: { start: Date.now() },
            },
          })) as MessageV2.ToolPart

          const context: Tool.Context = {
            sessionID: input.sessionID,
            messageID: input.assistantMessage.id,
            agent: input.assistantMessage.agent,
            abort: input.abort,
            callID,
            extra: {
              source: "vcp_tool_request",
              requestedTool: request.tool,
            },
            messages,
            async metadata(meta) {
              if (toolPart.state.status !== "running") return
              toolPart = (await Session.updatePart({
                ...toolPart,
                state: {
                  ...toolPart.state,
                  title: meta.title ?? toolPart.state.title,
                  metadata: meta.metadata ?? toolPart.state.metadata,
                },
              })) as MessageV2.ToolPart
            },
            async ask(req) {
              await PermissionNext.ask({
                ...req,
                sessionID: input.sessionID,
                tool: { messageID: input.assistantMessage.id, callID },
                ruleset: PermissionNext.merge(agent.permission, sessionInfo.permission ?? []),
              })
            },
          }

          try {
            await Plugin.trigger(
              "tool.execute.before",
              {
                tool: match.id,
                sessionID: input.sessionID,
                callID,
              },
              { args: initialInput },
            )

            const result = await match.execute(initialInput, context)

            await Plugin.trigger(
              "tool.execute.after",
              {
                tool: match.id,
                sessionID: input.sessionID,
                callID,
                args: initialInput,
              },
              result,
            )

            toolPart = (await Session.updatePart({
              ...toolPart,
              state: {
                status: "completed",
                input: initialInput,
                output: result.output,
                title: result.title,
                metadata: result.metadata,
                time: {
                  start: toolPart.state.status === "running" ? toolPart.state.time.start : Date.now(),
                  end: Date.now(),
                },
                attachments: result.attachments,
              },
            })) as MessageV2.ToolPart

            Bus.publish(Session.Event.VCPToolRequestResult, {
              sessionID: input.sessionID,
              messageID: input.assistantMessage.id,
              tool: request.tool,
              resolvedTool: match.id,
              status: "completed",
              output: result.output,
            })
            if (shouldPublishMemoryRefresh) {
              Bus.publish(Session.Event.VCPMemoryRefresh, {
                sessionID: input.sessionID,
                messageID: input.assistantMessage.id,
                tool: request.tool,
                resolvedTool: match.id,
                status: "completed",
                trigger: "tool_request_after",
                profileWeight,
                folderWeight,
              })
            }
          } catch (error: any) {
            const message = error instanceof Error ? error.message : String(error)
            await Session.updatePart({
              ...toolPart,
              state: {
                status: "error",
                input: initialInput,
                error: message,
                time: {
                  start: toolPart.state.status === "running" ? toolPart.state.time.start : Date.now(),
                  end: Date.now(),
                },
              },
            })
            Bus.publish(Session.Event.VCPToolRequestResult, {
              sessionID: input.sessionID,
              messageID: input.assistantMessage.id,
              tool: request.tool,
              resolvedTool: match.id,
              status: "error",
              error: message,
            })
            if (shouldPublishMemoryRefresh) {
              Bus.publish(Session.Event.VCPMemoryRefresh, {
                sessionID: input.sessionID,
                messageID: input.assistantMessage.id,
                tool: request.tool,
                resolvedTool: match.id,
                status: "error",
                trigger: "tool_request_after",
                profileWeight,
                folderWeight,
              })
            }
          }
        }
      } catch (error) {
        log.error("vcp tool request bridge failed", { error })
      }
    }

    const result = {
      get message() {
        return input.assistantMessage
      },
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID]
      },
      async process(streamInput: LLM.StreamInput) {
        log.info("process")
        needsCompaction = false
        const runtimeConfig = await Config.get()
        const shouldBreak = runtimeConfig.experimental?.continue_loop_on_deny !== true
        const vcpCompatibility = runtimeConfig.vcp
        while (true) {
          try {
            let currentText: MessageV2.TextPart | undefined
            let reasoningMap: Record<string, MessageV2.ReasoningPart> = {}
            const stream = await LLM.stream(streamInput)

            for await (const value of stream.fullStream) {
              input.abort.throwIfAborted()
              switch (value.type) {
                case "start":
                  SessionStatus.set(input.sessionID, { type: "busy" })
                  break

                case "reasoning-start":
                  if (value.id in reasoningMap) {
                    continue
                  }
                  const reasoningPart = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "reasoning" as const,
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  reasoningMap[value.id] = reasoningPart
                  await Session.updatePart(reasoningPart)
                  break

                case "reasoning-delta":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text += value.text
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    await Session.updatePartDelta({
                      sessionID: part.sessionID,
                      messageID: part.messageID,
                      partID: part.id,
                      field: "text",
                      delta: value.text,
                    })
                  }
                  break

                case "reasoning-end":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text = part.text.trimEnd()

                    part.time = {
                      ...part.time,
                      end: Date.now(),
                    }
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    await Session.updatePart(part)
                    delete reasoningMap[value.id]
                  }
                  break

                case "tool-input-start":
                  const part = await Session.updatePart({
                    id: toolcalls[value.id]?.id ?? Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "tool",
                    tool: value.toolName,
                    callID: value.id,
                    state: {
                      status: "pending",
                      input: {},
                      raw: "",
                    },
                  })
                  toolcalls[value.id] = part as MessageV2.ToolPart
                  break

                case "tool-input-delta":
                  break

                case "tool-input-end":
                  break

                case "tool-call": {
                  const match = toolcalls[value.toolCallId]
                  if (match) {
                    const part = await Session.updatePart({
                      ...match,
                      tool: value.toolName,
                      state: {
                        status: "running",
                        input: value.input,
                        time: {
                          start: Date.now(),
                        },
                      },
                      metadata: value.providerMetadata,
                    })
                    toolcalls[value.toolCallId] = part as MessageV2.ToolPart

                    const parts = await MessageV2.parts(input.assistantMessage.id)
                    const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)

                    if (
                      lastThree.length === DOOM_LOOP_THRESHOLD &&
                      lastThree.every(
                        (p) =>
                          p.type === "tool" &&
                          p.tool === value.toolName &&
                          p.state.status !== "pending" &&
                          JSON.stringify(p.state.input) === JSON.stringify(value.input),
                      )
                    ) {
                      const agent = await Agent.get(input.assistantMessage.agent)
                      await PermissionNext.ask({
                        permission: "doom_loop",
                        patterns: [value.toolName],
                        sessionID: input.assistantMessage.sessionID,
                        metadata: {
                          tool: value.toolName,
                          input: value.input,
                        },
                        always: [value.toolName],
                        ruleset: agent.permission,
                      })
                    }
                  }
                  break
                }
                case "tool-result": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "completed",
                        input: value.input ?? match.state.input,
                        output: value.output.output,
                        metadata: value.output.metadata,
                        title: value.output.title,
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                        attachments: value.output.attachments,
                      },
                    })

                    delete toolcalls[value.toolCallId]
                  }
                  break
                }

                case "tool-error": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "error",
                        input: value.input ?? match.state.input,
                        error: (value.error as any).toString(),
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                      },
                    })

                    if (
                      value.error instanceof PermissionNext.RejectedError ||
                      value.error instanceof Question.RejectedError
                    ) {
                      blocked = shouldBreak
                    }
                    delete toolcalls[value.toolCallId]
                  }
                  break
                }
                case "error":
                  throw value.error

                case "start-step":
                  stepStart = performance.now() // kilocode_change
                  snapshot = await Snapshot.track()
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.sessionID,
                    snapshot,
                    type: "step-start",
                  })
                  break

                case "finish-step":
                  const usage = Session.getUsage({
                    model: input.model,
                    usage: value.usage,
                    metadata: value.providerMetadata,
                  })
                  // kilocode_change start
                  if (
                    usage.tokens.input > 0 ||
                    usage.tokens.output > 0 ||
                    usage.tokens.cache.write > 0 ||
                    usage.tokens.cache.read > 0
                  ) {
                    Telemetry.trackLlmCompletion({
                      taskId: input.sessionID,
                      apiProvider: input.model.providerID,
                      modelId: input.model.id,
                      inputTokens: usage.tokens.input,
                      outputTokens: usage.tokens.output,
                      cacheReadTokens: usage.tokens.cache.read,
                      cacheWriteTokens: usage.tokens.cache.write,
                      cost: usage.cost,
                      completionTime: Math.round(performance.now() - stepStart),
                    })
                  }
                  // kilocode_change end
                  input.assistantMessage.finish = value.finishReason
                  input.assistantMessage.cost += usage.cost
                  input.assistantMessage.tokens = usage.tokens
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    reason: value.finishReason,
                    snapshot: await Snapshot.track(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "step-finish",
                    tokens: usage.tokens,
                    cost: usage.cost,
                  })
                  await Session.updateMessage(input.assistantMessage)
                  if (snapshot) {
                    const patch = await Snapshot.patch(snapshot)
                    if (patch.files.length) {
                      await Session.updatePart({
                        id: Identifier.ascending("part"),
                        messageID: input.assistantMessage.id,
                        sessionID: input.sessionID,
                        type: "patch",
                        hash: patch.hash,
                        files: patch.files,
                      })
                    }
                    snapshot = undefined
                  }
                  SessionSummary.summarize({
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.parentID,
                  })
                  if (await SessionCompaction.isOverflow({ tokens: usage.tokens, model: input.model })) {
                    needsCompaction = true
                  }
                  break

                case "text-start":
                  currentText = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "text",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  await Session.updatePart(currentText)
                  break

                case "text-delta":
                  if (currentText) {
                    currentText.text += value.text
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    await Session.updatePartDelta({
                      sessionID: currentText.sessionID,
                      messageID: currentText.messageID,
                      partID: currentText.id,
                      field: "text",
                      delta: value.text,
                    })
                  }
                  break

                case "text-end":
                  if (currentText) {
                    currentText.text = currentText.text.trimEnd()
                    const vcpProcessed = VcpContentCompatibility.process(currentText.text, vcpCompatibility)
                    currentText.text = vcpProcessed.text
                    for (const content of vcpProcessed.notifications) {
                      Bus.publish(Session.Event.VCPInfo, {
                        sessionID: input.sessionID,
                        messageID: input.assistantMessage.id,
                        content,
                      })
                    }
                    for (const toolRequest of vcpProcessed.toolRequests) {
                      Bus.publish(Session.Event.VCPToolRequest, {
                        sessionID: input.sessionID,
                        messageID: input.assistantMessage.id,
                        tool: toolRequest.tool,
                        arguments: toolRequest.arguments,
                        raw: toolRequest.raw,
                      })
                    }
                    await executeVcpToolRequests(vcpProcessed.toolRequests)
                    const textOutput = await Plugin.trigger(
                      "experimental.text.complete",
                      {
                        sessionID: input.sessionID,
                        messageID: input.assistantMessage.id,
                        partID: currentText.id,
                      },
                      { text: currentText.text },
                    )
                    currentText.text = textOutput.text
                    currentText.time = {
                      start: Date.now(),
                      end: Date.now(),
                    }
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    await Session.updatePart(currentText)
                  }
                  currentText = undefined
                  break

                case "finish":
                  break

                default:
                  log.info("unhandled", {
                    ...value,
                  })
                  continue
              }
              if (needsCompaction) break
            }
          } catch (e: any) {
            log.error("process", {
              error: e,
              stack: JSON.stringify(e.stack),
            })
            const error = MessageV2.fromError(e, { providerID: input.model.providerID })
            if (MessageV2.ContextOverflowError.isInstance(error)) {
              // TODO: Handle context overflow error
            }
            const retry = SessionRetry.retryable(error)
            if (retry !== undefined) {
              attempt++
              const delay = SessionRetry.delay(attempt, error.name === "APIError" ? error : undefined)
              SessionStatus.set(input.sessionID, {
                type: "retry",
                attempt,
                message: retry,
                next: Date.now() + delay,
              })
              await SessionRetry.sleep(delay, input.abort).catch(() => {})
              continue
            }
            input.assistantMessage.error = error
            Bus.publish(Session.Event.Error, {
              sessionID: input.assistantMessage.sessionID,
              error: input.assistantMessage.error,
            })
            SessionStatus.set(input.sessionID, { type: "idle" })
          }
          if (snapshot) {
            const patch = await Snapshot.patch(snapshot)
            if (patch.files.length) {
              await Session.updatePart({
                id: Identifier.ascending("part"),
                messageID: input.assistantMessage.id,
                sessionID: input.sessionID,
                type: "patch",
                hash: patch.hash,
                files: patch.files,
              })
            }
            snapshot = undefined
          }
          const p = await MessageV2.parts(input.assistantMessage.id)
          for (const part of p) {
            if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
              await Session.updatePart({
                ...part,
                state: {
                  ...part.state,
                  status: "error",
                  error: "Tool execution aborted",
                  time: {
                    start: Date.now(),
                    end: Date.now(),
                  },
                },
              })
            }
          }
          input.assistantMessage.time.completed = Date.now()
          await Session.updateMessage(input.assistantMessage)
          if (needsCompaction) return "compact"
          if (blocked) return "stop"
          if (input.assistantMessage.error) return "stop"
          return "continue"
        }
      },
    }
    return result
  }
}
