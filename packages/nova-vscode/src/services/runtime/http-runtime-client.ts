import type { HttpClient } from "../cli-backend"
import type {
  AgentInfo,
  Config,
  EditorContext,
  MemoryAtomicItem,
  MemoryOverviewResponse,
  NovacodeNotification,
  ProfileData,
  ProviderAuthAuthorization,
  ProviderListResponse,
  SessionInfo,
  SessionStatusInfo,
  SkillInfo,
} from "../cli-backend/types"
import type { RuntimeClient } from "./runtime-client"

export class HttpRuntimeClient implements RuntimeClient {
  constructor(private readonly client: HttpClient) {}

  createSession(directory: string): Promise<SessionInfo> {
    return this.client.createSession(directory)
  }

  getSession(sessionID: string, directory: string, silent?: boolean): Promise<SessionInfo> {
    return this.client.getSession(sessionID, directory, silent)
  }

  listSessions(directory: string): Promise<SessionInfo[]> {
    return this.client.listSessions(directory)
  }

  getSessionStatuses(directory: string): Promise<Record<string, SessionStatusInfo>> {
    return this.client.getSessionStatuses(directory)
  }

  deleteSession(sessionID: string, directory: string): Promise<void> {
    return this.client.deleteSession(sessionID, directory)
  }

  updateSession(sessionID: string, updates: { title?: string }, directory: string): Promise<SessionInfo> {
    return this.client.updateSession(sessionID, updates, directory)
  }

  getMessages(sessionID: string, directory: string, signal?: AbortSignal) {
    return this.client.getMessages(sessionID, directory, signal)
  }

  abortSession(sessionID: string, directory: string): Promise<boolean> {
    return this.client.abortSession(sessionID, directory)
  }

  summarize(sessionID: string, providerID: string, modelID: string, directory: string): Promise<boolean> {
    return this.client.summarize(sessionID, providerID, modelID, directory)
  }

  respondToPermission(
    sessionID: string,
    permissionID: string,
    response: "once" | "always" | "reject",
    directory: string,
  ): Promise<boolean> {
    return this.client.respondToPermission(sessionID, permissionID, response, directory)
  }

  replyToQuestion(requestID: string, answers: string[][], directory: string): Promise<void> {
    return this.client.replyToQuestion(requestID, answers, directory)
  }

  rejectQuestion(requestID: string, directory: string): Promise<void> {
    return this.client.rejectQuestion(requestID, directory)
  }

  listProviders(directory: string): Promise<ProviderListResponse> {
    return this.client.listProviders(directory)
  }

  listAgents(directory: string): Promise<AgentInfo[]> {
    return this.client.listAgents(directory)
  }

  listSkills(directory: string): Promise<SkillInfo[]> {
    return this.client.listSkills(directory)
  }

  findFiles(query: string, directory: string): Promise<string[]> {
    return this.client.findFiles(query, directory)
  }

  getConfig(directory: string): Promise<Config> {
    return this.client.getConfig(directory)
  }

  getGlobalConfig(): Promise<Config> {
    return this.client.getGlobalConfig()
  }

  getGlobalConfigRevision(): Promise<number> {
    return this.client.getGlobalConfigRevision()
  }

  getNotifications(): Promise<NovacodeNotification[]> {
    return this.client.getNotifications()
  }

  getProfile(): Promise<ProfileData | null> {
    return this.client.getProfile()
  }

  oauthAuthorize(providerID: string, method: number, directory: string): Promise<ProviderAuthAuthorization> {
    return this.client.oauthAuthorize(providerID, method, directory)
  }

  oauthCallback(providerID: string, method: number, directory: string): Promise<boolean> {
    return this.client.oauthCallback(providerID, method, directory)
  }

  setOrganization(organizationID: string | null): Promise<void> {
    return this.client.setOrganization(organizationID)
  }

  removeAuth(providerID: string): Promise<boolean> {
    return this.client.removeAuth(providerID)
  }

  getMemoryOverview(input?: { limit?: number; folderID?: string }): Promise<MemoryOverviewResponse> {
    return this.client.getMemoryOverview(input)
  }

  searchMemory(input: {
    query: string
    topK?: number
    scope?: "user" | "folder" | "both"
    folderID?: string
    tagsAny?: string[]
    timeFrom?: string | number
    timeTo?: string | number
  }): Promise<Array<{ item: MemoryAtomicItem; score: number }>> {
    return this.client.searchMemory(input)
  }

  updateMemoryAtomic(
    id: string,
    patch: {
      text?: string
      tags?: string[]
      scope?: "user" | "folder"
      folderID?: string
    },
  ): Promise<{ ok: boolean; item?: MemoryAtomicItem }> {
    return this.client.updateMemoryAtomic(id, patch)
  }

  deleteMemoryAtomic(id: string): Promise<{ ok: boolean }> {
    return this.client.deleteMemoryAtomic(id)
  }

  previewMemoryContext(input: {
    query: string
    directory: string
    topKAtomic?: number
    maxChars?: number
    removeAtomicIDs?: string[]
    pinAtomicIDs?: string[]
    compress?: boolean
  }): Promise<{ preview?: string }> {
    return this.client.previewMemoryContext(input)
  }

  sendMessage(
    sessionID: string,
    parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }>,
    directory: string,
    input?: {
      providerID?: string
      modelID?: string
      agent?: string
      variant?: string
      editorContext?: EditorContext
    },
  ): Promise<void> {
    return this.client.sendMessage(sessionID, parts, directory, input)
  }

  complete(
    input: {
      system: string
      messages: Array<{ role: "user"; content: string }>
    },
    _directory?: string,
  ): Promise<string | undefined> {
    const complete = (this.client as unknown as {
      complete?: (opts: { system: string; messages: Array<{ role: "user"; content: string }> }) => Promise<string>
    }).complete
    if (!complete) return Promise.resolve(undefined)
    return complete(input)
  }

  updateConfig(config: Partial<Config>, expectedRevision?: number): Promise<{ config: Config; revision: number }> {
    return this.client.updateConfig(config, expectedRevision)
  }
}
