import { Agent } from "@/agent/agent"
import { PermissionNext } from "@/permission/next"
import { Session } from "@/session"
import { SessionCompaction } from "@/session/compaction"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import z from "zod"

export class SessionRuntimeService {
  static async list(input: {
    directory?: string
    roots?: boolean
    start?: number
    search?: string
    limit?: number
  }): Promise<Session.Info[]> {
    const sessions: Session.Info[] = []
    for await (const session of Session.list(input)) {
      sessions.push(session)
    }
    return sessions
  }

  static getStatus() {
    return SessionStatus.list()
  }

  static async get(sessionID: string) {
    return Session.get(sessionID)
  }

  static async children(sessionID: string) {
    return Session.children(sessionID)
  }

  static async getTodos(sessionID: string) {
    return Todo.get(sessionID)
  }

  static async create(input: { parentID?: string; title?: string; permission?: Session.Info["permission"] }) {
    return Session.create(input)
  }

  static async remove(sessionID: string) {
    await Session.remove(sessionID)
    return true
  }

  static async update(
    sessionID: string,
    updates: {
      title?: string
      time?: {
        archived?: number
      }
    },
  ) {
    let session = await Session.get(sessionID)
    if (updates.title !== undefined) {
      session = await Session.setTitle({ sessionID, title: updates.title })
    }
    if (updates.time?.archived !== undefined) {
      session = await Session.setArchived({ sessionID, time: updates.time.archived })
    }
    return session
  }

  static abort(sessionID: string) {
    SessionPrompt.cancel(sessionID)
    return true
  }

  static async summarize(input: {
    sessionID: string
    providerID: string
    modelID: string
    auto?: boolean
  }) {
    const session = await Session.get(input.sessionID)
    await SessionRevert.cleanup(session)
    const msgs = await Session.messages({ sessionID: input.sessionID })
    let currentAgent = await Agent.defaultAgent()
    for (let i = msgs.length - 1; i >= 0; i--) {
      const info = msgs[i].info
      if (info.role === "user") {
        currentAgent = info.agent || (await Agent.defaultAgent())
        break
      }
    }
    await SessionCompaction.create({
      sessionID: input.sessionID,
      agent: currentAgent,
      model: {
        providerID: input.providerID,
        modelID: input.modelID,
      },
      auto: input.auto ?? false,
    })
    await SessionPrompt.loop({ sessionID: input.sessionID })
    return true
  }

  static async messages(input: { sessionID: string; limit?: number }) {
    return Session.messages(input)
  }

  static async getMessage(input: { sessionID: string; messageID: string }) {
    return MessageV2.get(input)
  }

  static async initialize(input: { sessionID: string; modelID: string; providerID: string; messageID: string }) {
    await Session.initialize(input)
    return true
  }

  static async fork(input: { sessionID: string; messageID?: string }) {
    return Session.fork(input)
  }

  static async share(sessionID: string) {
    await Session.share(sessionID)
    return Session.get(sessionID)
  }

  static async diff(input: { sessionID: string; messageID?: string }) {
    return SessionSummary.diff(input)
  }

  static async unshare(sessionID: string) {
    await Session.unshare(sessionID)
    return Session.get(sessionID)
  }

  static async removePart(input: { sessionID: string; messageID: string; partID: string }) {
    await Session.removePart(input)
    return true
  }

  static async updatePart(part: z.output<typeof MessageV2.Part>) {
    return Session.updatePart(part)
  }

  static async prompt(input: z.output<typeof SessionPrompt.PromptInput>) {
    return SessionPrompt.prompt(input)
  }

  static promptAsync(input: z.output<typeof SessionPrompt.PromptInput>) {
    SessionPrompt.prompt(input)
    return true
  }

  static async command(input: z.output<typeof SessionPrompt.CommandInput>) {
    return SessionPrompt.command(input)
  }

  static async shell(input: z.output<typeof SessionPrompt.ShellInput>) {
    return SessionPrompt.shell(input)
  }

  static async revert(input: z.output<typeof SessionRevert.RevertInput>) {
    return SessionRevert.revert(input)
  }

  static async unrevert(input: { sessionID: string }) {
    return SessionRevert.unrevert(input)
  }

  static async respondToPermission(input: { requestID: string; reply: "once" | "always" | "reject" }) {
    await PermissionNext.reply(input)
    return true
  }
}
