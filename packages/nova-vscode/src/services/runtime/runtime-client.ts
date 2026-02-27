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

export interface RuntimeClient {
  createSession(directory: string): Promise<SessionInfo>
  getSession(sessionID: string, directory: string, silent?: boolean): Promise<SessionInfo>
  listSessions(directory: string): Promise<SessionInfo[]>
  getSessionStatuses(directory: string): Promise<Record<string, SessionStatusInfo>>
  deleteSession(sessionID: string, directory: string): Promise<void>
  updateSession(sessionID: string, updates: { title?: string }, directory: string): Promise<SessionInfo>
  getMessages(sessionID: string, directory: string, signal?: AbortSignal): Promise<
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
  >
  abortSession(sessionID: string, directory: string): Promise<boolean>
  summarize(sessionID: string, providerID: string, modelID: string, directory: string): Promise<boolean>
  respondToPermission(
    sessionID: string,
    permissionID: string,
    response: "once" | "always" | "reject",
    directory: string,
  ): Promise<boolean>
  replyToQuestion(requestID: string, answers: string[][], directory: string): Promise<void>
  rejectQuestion(requestID: string, directory: string): Promise<void>
  listProviders(directory: string): Promise<ProviderListResponse>
  listAgents(directory: string): Promise<AgentInfo[]>
  listSkills(directory: string): Promise<SkillInfo[]>
  findFiles(query: string, directory: string): Promise<string[]>
  getConfig(directory: string): Promise<Config>
  getGlobalConfig(): Promise<Config>
  getGlobalConfigRevision(): Promise<number>
  getNotifications(): Promise<NovacodeNotification[]>
  getProfile(): Promise<ProfileData | null>
  oauthAuthorize(providerID: string, method: number, directory: string): Promise<ProviderAuthAuthorization>
  oauthCallback(providerID: string, method: number, directory: string): Promise<boolean>
  setOrganization(organizationID: string | null): Promise<void>
  removeAuth(providerID: string): Promise<boolean>
  getMemoryOverview(input?: { limit?: number; folderID?: string }): Promise<MemoryOverviewResponse>
  searchMemory(input: {
    query: string
    topK?: number
    scope?: "user" | "folder" | "both"
    folderID?: string
    tagsAny?: string[]
    timeFrom?: string | number
    timeTo?: string | number
  }): Promise<Array<{ item: MemoryAtomicItem; score: number }>>
  updateMemoryAtomic(
    id: string,
    patch: {
      text?: string
      tags?: string[]
      scope?: "user" | "folder"
      folderID?: string
    },
  ): Promise<{ ok: boolean; item?: MemoryAtomicItem }>
  deleteMemoryAtomic(id: string): Promise<{ ok: boolean }>
  previewMemoryContext(input: {
    query: string
    directory: string
    topKAtomic?: number
    maxChars?: number
    removeAtomicIDs?: string[]
    pinAtomicIDs?: string[]
    compress?: boolean
  }): Promise<{ preview?: string }>
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
  ): Promise<void>
  complete(
    input: {
      system: string
      messages: Array<{ role: "user"; content: string }>
    },
    directory?: string,
  ): Promise<string | undefined>
  updateConfig(config: Partial<Config>, expectedRevision?: number): Promise<{ config: Config; revision: number }>
}
