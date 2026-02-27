import type { NovaConnectionService } from "../cli-backend"
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
import { HttpRuntimeClient } from "../runtime/http-runtime-client"
import type { RuntimeClient } from "../runtime/runtime-client"

export class EmbeddedRuntimeClient implements RuntimeClient {
  constructor(
    private readonly connectionService: NovaConnectionService,
    private readonly defaultDirectory: string,
  ) {}

  private async withRuntime<T>(
    action: (runtime: HttpRuntimeClient) => Promise<T>,
    directory?: string,
  ): Promise<T> {
    await this.connectionService.connect(directory ?? this.defaultDirectory)
    const runtime = new HttpRuntimeClient(this.connectionService.getHttpClient())
    return action(runtime)
  }

  createSession(directory: string): Promise<SessionInfo> {
    return this.withRuntime((runtime) => runtime.createSession(directory), directory)
  }

  getSession(sessionID: string, directory: string, silent?: boolean): Promise<SessionInfo> {
    return this.withRuntime((runtime) => runtime.getSession(sessionID, directory, silent), directory)
  }

  listSessions(directory: string): Promise<SessionInfo[]> {
    return this.withRuntime((runtime) => runtime.listSessions(directory), directory)
  }

  getSessionStatuses(directory: string): Promise<Record<string, SessionStatusInfo>> {
    return this.withRuntime((runtime) => runtime.getSessionStatuses(directory), directory)
  }

  deleteSession(sessionID: string, directory: string): Promise<void> {
    return this.withRuntime((runtime) => runtime.deleteSession(sessionID, directory), directory)
  }

  updateSession(sessionID: string, updates: { title?: string }, directory: string): Promise<SessionInfo> {
    return this.withRuntime((runtime) => runtime.updateSession(sessionID, updates, directory), directory)
  }

  getMessages(
    sessionID: string,
    directory: string,
    signal?: AbortSignal,
  ): Promise<
    Array<{
      info: {
        id: string
        sessionID: string
        role: "user" | "assistant"
        time: { created: number; completed?: number }
        cost?: number
        tokens?: {
          input: number
          output: number
          reasoning?: number
          cache?: { read: number; write: number }
        }
      }
      parts: unknown[]
    }>
  > {
    return this.withRuntime((runtime) => runtime.getMessages(sessionID, directory, signal), directory)
  }

  abortSession(sessionID: string, directory: string): Promise<boolean> {
    return this.withRuntime((runtime) => runtime.abortSession(sessionID, directory), directory)
  }

  summarize(sessionID: string, providerID: string, modelID: string, directory: string): Promise<boolean> {
    return this.withRuntime((runtime) => runtime.summarize(sessionID, providerID, modelID, directory), directory)
  }

  respondToPermission(
    sessionID: string,
    permissionID: string,
    response: "once" | "always" | "reject",
    directory: string,
  ): Promise<boolean> {
    return this.withRuntime((runtime) => runtime.respondToPermission(sessionID, permissionID, response, directory), directory)
  }

  replyToQuestion(requestID: string, answers: string[][], directory: string): Promise<void> {
    return this.withRuntime((runtime) => runtime.replyToQuestion(requestID, answers, directory), directory)
  }

  rejectQuestion(requestID: string, directory: string): Promise<void> {
    return this.withRuntime((runtime) => runtime.rejectQuestion(requestID, directory), directory)
  }

  listProviders(directory: string): Promise<ProviderListResponse> {
    return this.withRuntime((runtime) => runtime.listProviders(directory), directory)
  }

  listAgents(directory: string): Promise<AgentInfo[]> {
    return this.withRuntime((runtime) => runtime.listAgents(directory), directory)
  }

  listSkills(directory: string): Promise<SkillInfo[]> {
    return this.withRuntime((runtime) => runtime.listSkills(directory), directory)
  }

  findFiles(query: string, directory: string): Promise<string[]> {
    return this.withRuntime((runtime) => runtime.findFiles(query, directory), directory)
  }

  getConfig(directory: string): Promise<Config> {
    return this.withRuntime((runtime) => runtime.getConfig(directory), directory)
  }

  getGlobalConfig(): Promise<Config> {
    return this.withRuntime((runtime) => runtime.getGlobalConfig())
  }

  getGlobalConfigRevision(): Promise<number> {
    return this.withRuntime((runtime) => runtime.getGlobalConfigRevision())
  }

  getNotifications(): Promise<NovacodeNotification[]> {
    return this.withRuntime((runtime) => runtime.getNotifications())
  }

  getProfile(): Promise<ProfileData | null> {
    return this.withRuntime((runtime) => runtime.getProfile())
  }

  oauthAuthorize(providerID: string, method: number, directory: string): Promise<ProviderAuthAuthorization> {
    return this.withRuntime((runtime) => runtime.oauthAuthorize(providerID, method, directory), directory)
  }

  oauthCallback(providerID: string, method: number, directory: string): Promise<boolean> {
    return this.withRuntime((runtime) => runtime.oauthCallback(providerID, method, directory), directory)
  }

  setOrganization(organizationID: string | null): Promise<void> {
    return this.withRuntime((runtime) => runtime.setOrganization(organizationID))
  }

  removeAuth(providerID: string): Promise<boolean> {
    return this.withRuntime((runtime) => runtime.removeAuth(providerID))
  }

  getMemoryOverview(input?: { limit?: number; folderID?: string }): Promise<MemoryOverviewResponse> {
    return this.withRuntime((runtime) => runtime.getMemoryOverview(input))
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
    return this.withRuntime((runtime) => runtime.searchMemory(input))
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
    return this.withRuntime((runtime) => runtime.updateMemoryAtomic(id, patch))
  }

  deleteMemoryAtomic(id: string): Promise<{ ok: boolean }> {
    return this.withRuntime((runtime) => runtime.deleteMemoryAtomic(id))
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
    return this.withRuntime((runtime) => runtime.previewMemoryContext(input), input.directory)
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
    return this.withRuntime((runtime) => runtime.sendMessage(sessionID, parts, directory, input), directory)
  }

  complete(
    input: {
      system: string
      messages: Array<{ role: "user"; content: string }>
    },
    directory?: string,
  ): Promise<string | undefined> {
    return this.withRuntime((runtime) => runtime.complete(input, directory), directory)
  }

  updateConfig(config: Partial<Config>, expectedRevision?: number): Promise<{ config: Config; revision: number }> {
    return this.withRuntime((runtime) => runtime.updateConfig(config, expectedRevision))
  }
}
