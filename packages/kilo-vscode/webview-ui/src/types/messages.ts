/**
 * Types for extension <-> webview message communication
 */

// Connection states
export type ConnectionState = "connecting" | "connected" | "disconnected" | "error"

// Session status (simplified from backend)
export type SessionStatus = "idle" | "busy" | "retry"

// Rich status info for retry countdown and future extensions
export type SessionStatusInfo =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number }

// Tool state for tool parts
export type ToolState =
  | { status: "pending"; input: Record<string, unknown> }
  | { status: "running"; input: Record<string, unknown>; title?: string }
  | { status: "completed"; input: Record<string, unknown>; output: string; title: string }
  | { status: "error"; input: Record<string, unknown>; error: string }

// Base part interface - all parts have these fields
export interface BasePart {
  id: string
  sessionID?: string
  messageID?: string
}

// Part types from the backend
export interface TextPart extends BasePart {
  type: "text"
  text: string
}

export interface ToolPart extends BasePart {
  type: "tool"
  tool: string
  state: ToolState
}

export interface ReasoningPart extends BasePart {
  type: "reasoning"
  text: string
}

// Step parts from the backend
export interface StepStartPart extends BasePart {
  type: "step-start"
}

export interface StepFinishPart extends BasePart {
  type: "step-finish"
  reason?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning?: number
    cache?: { read: number; write: number }
  }
}

export type Part = TextPart | ToolPart | ReasoningPart | StepStartPart | StepFinishPart

// Part delta for streaming updates
export interface PartDelta {
  type: "text-delta"
  textDelta?: string
}

// Token usage for assistant messages
export interface TokenUsage {
  input: number
  output: number
  reasoning?: number
  cache?: { read: number; write: number }
}

// Context usage derived from the last assistant message's tokens
export interface ContextUsage {
  tokens: number
  percentage: number | null
}

// Message structure (simplified for webview)
export interface Message {
  id: string
  sessionID: string
  role: "user" | "assistant"
  content?: string
  parts?: Part[]
  createdAt: string
  cost?: number
  tokens?: TokenUsage
}

// Session info (simplified for webview)
export interface SessionInfo {
  id: string
  title?: string
  createdAt: string
  updatedAt: string
}

// Permission request
export interface PermissionRequest {
  id: string
  sessionID: string
  toolName: string
  patterns: string[]
  args: Record<string, unknown>
  message?: string
  tool?: { messageID: string; callID: string }
}

// Todo item
export interface TodoItem {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed"
}

// Question types
export interface QuestionOption {
  label: string
  description: string
}

export interface QuestionInfo {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface QuestionRequest {
  id: string
  sessionID: string
  questions: QuestionInfo[]
  tool?: {
    messageID: string
    callID: string
  }
}

// Agent/mode info from CLI backend
export interface AgentInfo {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  color?: string
}

export interface SkillInfo {
  name: string
  description: string
  location: string
}

// Server info
export interface ServerInfo {
  port: number
  version?: string
}

// Device auth flow status
export type DeviceAuthStatus = "idle" | "initiating" | "pending" | "success" | "error" | "cancelled"

// Device auth state
export interface DeviceAuthState {
  status: DeviceAuthStatus
  code?: string
  verificationUrl?: string
  expiresIn?: number
  error?: string
}

// Kilo notification types (mirrored from kilo-gateway)
export interface KilocodeNotificationAction {
  actionText: string
  actionURL: string
}

export interface KilocodeNotification {
  id: string
  title: string
  message: string
  action?: KilocodeNotificationAction
  showIn?: string[]
}

// Profile types from kilo-gateway
export interface KilocodeBalance {
  balance: number
}

export interface ProfileData {
  profile: {
    email: string
    name?: string
    organizations?: Array<{ id: string; name: string; role: string }>
  }
  balance: KilocodeBalance | null
  currentOrgId: string | null
}

// Provider/model types for model selector

export interface ProviderModel {
  id: string
  name: string
  inputPrice?: number
  outputPrice?: number
  contextLength?: number
  releaseDate?: string
  latest?: boolean
  // Actual shape returned by the server (Provider.Model)
  limit?: { context: number; input?: number; output: number }
  variants?: Record<string, Record<string, unknown>>
  capabilities?: { reasoning: boolean }
}

export interface Provider {
  id: string
  name: string
  models: Record<string, ProviderModel>
}

export interface ProviderAuthMethod {
  type: "oauth" | "api"
  label: string
}

export interface ProviderAuthAuthorization {
  url: string
  method: "auto" | "code"
  instructions: string
}

export interface ModelSelection {
  providerID: string
  modelID: string
}

// ============================================
// Backend Config Types (mirrored for webview)
// ============================================

export type PermissionLevel = "allow" | "ask" | "deny"

export type PermissionConfig = Partial<Record<string, PermissionLevel>>

export interface AgentConfig {
  model?: string
  prompt?: string
  temperature?: number
  top_p?: number
  steps?: number
  permission?: PermissionConfig
}

export interface ProviderConfig {
  name?: string
  env?: string[]
  npm?: string
  api?: string
  api_key?: string
  base_url?: string
  models?: Record<string, unknown>
  options?: {
    apiKey?: string
    baseURL?: string
    modelsPath?: string
    modelsURL?: string
    headers?: Record<string, string>
    stream?: boolean
    includeMaxTokens?: boolean
    useAzure?: boolean
    azureApiVersion?: string
    reasoningEffort?: string
    maxOutputTokens?: number
    contextWindow?: number
    includeUsage?: boolean
    enterpriseUrl?: string
    setCacheKey?: boolean
    timeout?: number | false
    [key: string]: unknown
  }
}

export interface McpConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export interface CommandConfig {
  template: string
  description?: string
  agent?: string
  model?: string
  subtask?: boolean
}

export interface SkillsConfig {
  paths?: string[]
  urls?: string[]
}

export interface CompactionConfig {
  auto?: boolean
  prune?: boolean
}

export interface WatcherConfig {
  ignore?: string[]
}

export interface ExperimentalConfig {
  disable_paste_summary?: boolean
  batch_tool?: boolean
  primary_tools?: string[]
  continue_loop_on_deny?: boolean
  mcp_timeout?: number
}

export interface KeybindsConfig {
  terminal_suspend?: string
  terminal_title_toggle?: string
}

export interface TuiConfig {
  scroll_speed?: number
  diff_style?: "auto" | "stacked"
}

export interface VcpContextFoldConfig {
  enabled?: boolean
  startMarker?: string
  endMarker?: string
  outputStyle?: "details" | "plain"
}

export interface VcpInfoConfig {
  enabled?: boolean
  startMarker?: string
  endMarker?: string
}

export interface VcpHtmlConfig {
  enabled?: boolean
}

export interface VcpToolRequestConfig {
  enabled?: boolean
  startMarker?: string
  endMarker?: string
  keepBlockInText?: boolean
  bridgeMode?: "event" | "execute"
  maxPerMessage?: number
  allowTools?: string[]
  denyTools?: string[]
}

export interface VcpAgentTeamConfig {
  enabled?: boolean
  maxParallel?: number
  waveStrategy?: "auto" | "conservative" | "aggressive"
  requireFileSeparation?: boolean
  handoffFormat?: "summary" | "checklist"
}

export interface VcpMemoryPassiveConfig {
  enabled?: boolean
  includeProfile?: boolean
  includeFolderDoc?: boolean
  includeSessionSnippets?: boolean
  topKAtomic?: number
  topKSession?: number
  maxChars?: number
}

export interface VcpMemoryWriterConfig {
  enabled?: boolean
  minChars?: number
  maxAtomic?: number
  maxPerMessage?: number
  forceFirstMessage?: boolean
  updateProfile?: boolean
  updateFolderDoc?: boolean
}

export interface VcpMemoryRetrievalConfig {
  enabled?: boolean
  semanticWeight?: number
  timeWeight?: number
  defaultTopK?: number
}

export interface VcpMemoryRefreshConfig {
  enabled?: boolean
  afterToolCall?: boolean
  profileWeight?: number
  folderWeight?: number
}

export interface VcpMemoryConfig {
  enabled?: boolean
  passive?: VcpMemoryPassiveConfig
  writer?: VcpMemoryWriterConfig
  retrieval?: VcpMemoryRetrievalConfig
  refresh?: VcpMemoryRefreshConfig
}

export interface VcpConfig {
  enabled?: boolean
  contextFold?: VcpContextFoldConfig
  vcpInfo?: VcpInfoConfig
  html?: VcpHtmlConfig
  toolRequest?: VcpToolRequestConfig
  agentTeam?: VcpAgentTeamConfig
  memory?: VcpMemoryConfig
}

export interface Config {
  permission?: PermissionConfig
  model?: string
  small_model?: string
  default_agent?: string
  agent?: Record<string, AgentConfig>
  provider?: Record<string, ProviderConfig>
  disabled_providers?: string[]
  enabled_providers?: string[]
  mcp?: Record<string, McpConfig>
  command?: Record<string, CommandConfig>
  instructions?: string[]
  skills?: SkillsConfig
  snapshot?: boolean
  share?: "manual" | "auto" | "disabled"
  username?: string
  watcher?: WatcherConfig
  formatter?: false | Record<string, unknown>
  lsp?: false | Record<string, unknown>
  compaction?: CompactionConfig
  tools?: Record<string, boolean>
  layout?: "auto" | "stretch"
  experimental?: ExperimentalConfig
  keybinds?: KeybindsConfig
  tui?: TuiConfig
  vcp?: VcpConfig
}

// ============================================
// Messages FROM extension TO webview
// ============================================

export interface ReadyMessage {
  type: "ready"
  serverInfo?: ServerInfo
  extensionVersion?: string
  vscodeLanguage?: string
  languageOverride?: string
}

export interface ConnectionStateMessage {
  type: "connectionState"
  state: ConnectionState
  error?: string
}

export interface ErrorMessage {
  type: "error"
  message: string
  code?: string
  sessionID?: string
}

export interface PartUpdatedMessage {
  type: "partUpdated"
  sessionID?: string
  messageID?: string
  part: Part
  delta?: PartDelta
}

export interface SessionStatusMessage {
  type: "sessionStatus"
  sessionID: string
  status: SessionStatus
  // Retry fields (present when status === "retry")
  attempt?: number
  message?: string
  next?: number
}

export interface PermissionRequestMessage {
  type: "permissionRequest"
  permission: PermissionRequest
}

export interface TodoUpdatedMessage {
  type: "todoUpdated"
  sessionID: string
  items: TodoItem[]
}

export interface SessionCreatedMessage {
  type: "sessionCreated"
  session: SessionInfo
}

export interface SessionUpdatedMessage {
  type: "sessionUpdated"
  session: SessionInfo
}

export interface SessionDeletedMessage {
  type: "sessionDeleted"
  sessionID: string
}

export interface MessagesLoadedMessage {
  type: "messagesLoaded"
  sessionID: string
  messages: Message[]
}

export interface MessageCreatedMessage {
  type: "messageCreated"
  message: Message
}

export interface SessionsLoadedMessage {
  type: "sessionsLoaded"
  sessions: SessionInfo[]
}

export interface ActionMessage {
  type: "action"
  action: string
}

export interface SetChatBoxMessage {
  type: "setChatBoxMessage"
  text: string
}

export interface TriggerTaskMessage {
  type: "triggerTask"
  text: string
}

export interface ProfileDataMessage {
  type: "profileData"
  data: ProfileData | null
}

export interface DeviceAuthStartedMessage {
  type: "deviceAuthStarted"
  code?: string
  verificationUrl: string
  expiresIn: number
}

export interface DeviceAuthCompleteMessage {
  type: "deviceAuthComplete"
}

export interface DeviceAuthFailedMessage {
  type: "deviceAuthFailed"
  error: string
}

export interface DeviceAuthCancelledMessage {
  type: "deviceAuthCancelled"
}

export interface NavigateMessage {
  type: "navigate"
  view: "newTask" | "marketplace" | "history" | "profile" | "settings" | "vcp"
}

export interface ProvidersLoadedMessage {
  type: "providersLoaded"
  providers: Record<string, Provider>
  connected: string[]
  defaults: Record<string, string>
  defaultSelection: ModelSelection
  providerAuth: Record<string, ProviderAuthMethod[]>
}

export interface ProviderActionResultMessage {
  type: "providerActionResult"
  requestId: string
  providerID: string
  stage: "apiKey" | "oauthAuthorize" | "oauthCallback" | "disconnect"
  ok: boolean
  authorization?: ProviderAuthAuthorization
  error?: string
}

export interface AgentsLoadedMessage {
  type: "agentsLoaded"
  agents: AgentInfo[]
  defaultAgent: string
}

export interface SkillsLoadedMessage {
  type: "skillsLoaded"
  skills: SkillInfo[]
}

export interface AutocompleteSettingsLoadedMessage {
  type: "autocompleteSettingsLoaded"
  settings: {
    enableAutoTrigger: boolean
    enableSmartInlineTaskKeybinding: boolean
    enableChatAutocomplete: boolean
  }
}

export interface ChatCompletionResultMessage {
  type: "chatCompletionResult"
  text: string
  requestId: string
}

export interface FileSearchResultMessage {
  type: "fileSearchResult"
  paths: string[]
  dir: string
  requestId: string
}

export interface QuestionRequestMessage {
  type: "questionRequest"
  question: QuestionRequest
}

export interface QuestionResolvedMessage {
  type: "questionResolved"
  requestID: string
}

export interface QuestionErrorMessage {
  type: "questionError"
  requestID: string
}

export interface BrowserSettings {
  enabled: boolean
  useSystemChrome: boolean
  headless: boolean
}

export interface BrowserSettingsLoadedMessage {
  type: "browserSettingsLoaded"
  settings: BrowserSettings
}

export interface ConfigLoadedMessage {
  type: "configLoaded"
  config: Config
  revision?: number
}

export interface ConfigUpdatedMessage {
  type: "configUpdated"
  config: Config
  revision?: number
}

export interface ConfigConflictMessage {
  type: "configConflict"
  error: string
  code: "config_conflict"
  config: Config
  revision: number
  expectedRevision?: number
}

export interface PromptQueueUpdatedMessage {
  type: "promptQueueUpdated"
  sessionID: string
  items: PromptQueueItem[]
}

export interface MemoryAtomicItem {
  id: string
  text: string
  tags: string[]
  scope: "user" | "folder"
  role: "user" | "assistant"
  folderID?: string
  sessionID: string
  messageID: string
  createdAt: number
  updatedAt: number
}

export interface MemoryFolderDoc {
  folderID: string
  summary: string
  highlights: string[]
  updatedAt: number
}

export interface MemoryProfile {
  preferences: string[]
  style: string[]
  facts: string[]
  updatedAt: number
}

export interface MemoryOverviewMessage {
  type: "memoryOverview"
  requestID: string
  data: {
    atomicTotal: number
    profile: MemoryProfile
    folders: MemoryFolderDoc[]
    recentAtomic: MemoryAtomicItem[]
  }
}

export interface MemorySearchResultMessage {
  type: "memorySearchResult"
  requestID: string
  items: Array<{
    item: MemoryAtomicItem
    score: number
  }>
}

export interface MemoryAtomicUpdatedMessage {
  type: "memoryAtomicUpdated"
  requestID: string
  ok: boolean
  item?: MemoryAtomicItem
}

export interface MemoryAtomicDeletedMessage {
  type: "memoryAtomicDeleted"
  requestID: string
  ok: boolean
}

export interface MemoryContextPreviewMessage {
  type: "memoryContextPreview"
  requestID: string
  preview?: string
}

export interface NotificationSettingsLoadedMessage {
  type: "notificationSettingsLoaded"
  settings: {
    notifyAgent: boolean
    notifyPermissions: boolean
    notifyErrors: boolean
    soundAgent: string
    soundPermissions: string
    soundErrors: string
  }
}

export interface NotificationsLoadedMessage {
  type: "notificationsLoaded"
  notifications: KilocodeNotification[]
  dismissedIds: string[]
}

export interface VcpInfoMessage {
  type: "vcpInfo"
  sessionID: string
  messageID: string
  content: string
}

export interface VcpToolRequestMessage {
  type: "vcpToolRequest"
  sessionID: string
  messageID: string
  tool: string
  arguments?: unknown
  raw: string
}

export interface VcpToolRequestResultMessage {
  type: "vcpToolRequestResult"
  sessionID: string
  messageID: string
  tool: string
  resolvedTool?: string
  status: "completed" | "error" | "skipped"
  output?: string
  error?: string
}

export interface VcpMemoryRefreshMessage {
  type: "vcpMemoryRefresh"
  sessionID: string
  messageID: string
  tool: string
  resolvedTool?: string
  status: "completed" | "error" | "skipped"
  trigger: "tool_request_after"
  profileWeight: number
  folderWeight: number
}

// Agent Manager worktree session metadata
export interface AgentManagerSessionMetaMessage {
  type: "agentManager.sessionMeta"
  sessionId: string
  mode: import("../context/worktree-mode").SessionMode
  branch?: string
  path?: string
  parentBranch?: string
}

// Agent Manager repo info (current branch of the main workspace)
export interface AgentManagerRepoInfoMessage {
  type: "agentManager.repoInfo"
  branch: string
}

// Agent Manager worktree setup progress
export interface AgentManagerWorktreeSetupMessage {
  type: "agentManager.worktreeSetup"
  status: "creating" | "starting" | "ready" | "error"
  message: string
  sessionId?: string
  branch?: string
  worktreeId?: string
}

// Agent Manager worktree state types (mirrored from WorktreeStateManager)
export interface WorktreeState {
  id: string
  branch: string
  path: string
  parentBranch: string
  createdAt: string
  /** Shared identifier for worktrees created together via multi-version mode. */
  groupId?: string
  /** User-provided display name for the worktree. */
  label?: string
}

export interface ManagedSessionState {
  id: string
  worktreeId: string | null
  createdAt: string
}

// Agent Manager session added to an existing worktree (no setup overlay needed)
export interface AgentManagerSessionAddedMessage {
  type: "agentManager.sessionAdded"
  sessionId: string
  worktreeId: string
}

// Full state push from extension to webview
export interface AgentManagerStateMessage {
  type: "agentManager.state"
  worktrees: WorktreeState[]
  sessions: ManagedSessionState[]
  tabOrder?: Record<string, string[]>
  sessionsCollapsed?: boolean
  isGitRepo?: boolean
}

// Resolved keybindings for agent manager actions
export interface AgentManagerKeybindingsMessage {
  type: "agentManager.keybindings"
  bindings: Record<string, string>
}

// Multi-version creation progress (extension → webview)
export interface AgentManagerMultiVersionProgressMessage {
  type: "agentManager.multiVersionProgress"
  status: "creating" | "done"
  total: number
  completed: number
  groupId?: string
}

// Stored variant selections loaded from extension globalState (extension → webview)
export interface VariantsLoadedMessage {
  type: "variantsLoaded"
  variants: Record<string, string>
}

// Request webview to send initial prompt to a newly created session (extension → webview)
export interface AgentManagerSendInitialMessage {
  type: "agentManager.sendInitialMessage"
  sessionId: string
  worktreeId: string
  text: string
  providerID?: string
  modelID?: string
  agent?: string
  files?: Array<{ mime: string; url: string }>
}

export type ExtensionMessage =
  | ReadyMessage
  | ConnectionStateMessage
  | ErrorMessage
  | PartUpdatedMessage
  | SessionStatusMessage
  | PermissionRequestMessage
  | TodoUpdatedMessage
  | SessionCreatedMessage
  | SessionUpdatedMessage
  | SessionDeletedMessage
  | MessagesLoadedMessage
  | MessageCreatedMessage
  | SessionsLoadedMessage
  | ActionMessage
  | ProfileDataMessage
  | DeviceAuthStartedMessage
  | DeviceAuthCompleteMessage
  | DeviceAuthFailedMessage
  | DeviceAuthCancelledMessage
  | NavigateMessage
  | ProvidersLoadedMessage
  | ProviderActionResultMessage
  | AgentsLoadedMessage
  | SkillsLoadedMessage
  | AutocompleteSettingsLoadedMessage
  | ChatCompletionResultMessage
  | FileSearchResultMessage
  | QuestionRequestMessage
  | QuestionResolvedMessage
  | QuestionErrorMessage
  | BrowserSettingsLoadedMessage
  | ConfigLoadedMessage
  | ConfigUpdatedMessage
  | ConfigConflictMessage
  | PromptQueueUpdatedMessage
  | MemoryOverviewMessage
  | MemorySearchResultMessage
  | MemoryAtomicUpdatedMessage
  | MemoryAtomicDeletedMessage
  | MemoryContextPreviewMessage
  | NotificationSettingsLoadedMessage
  | NotificationsLoadedMessage
  | VcpInfoMessage
  | VcpToolRequestMessage
  | VcpToolRequestResultMessage
  | VcpMemoryRefreshMessage
  | AgentManagerSessionMetaMessage
  | AgentManagerRepoInfoMessage
  | AgentManagerWorktreeSetupMessage
  | AgentManagerSessionAddedMessage
  | AgentManagerStateMessage
  | AgentManagerKeybindingsMessage
  | AgentManagerMultiVersionProgressMessage
  | AgentManagerSendInitialMessage
  | SetChatBoxMessage
  | TriggerTaskMessage
  | VariantsLoadedMessage

// ============================================
// Messages FROM webview TO extension
// ============================================

export interface FileAttachment {
  mime: string
  url: string
}

export type BusyInsertMode = "guide" | "queue" | "interrupt"

export interface PromptQueueItem {
  id: string
  text: string
  files?: FileAttachment[]
  policy: BusyInsertMode
  priority: number
  createdAt: string
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
}

export interface SendMessageRequest {
  type: "sendMessage"
  text: string
  sessionID?: string
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
  files?: FileAttachment[]
  busyMode?: BusyInsertMode
}

export interface AbortRequest {
  type: "abort"
  sessionID: string
}

export interface PermissionResponseRequest {
  type: "permissionResponse"
  permissionId: string
  sessionID: string
  response: "once" | "always" | "reject"
}

export interface CreateSessionRequest {
  type: "createSession"
}

export interface ClearSessionRequest {
  type: "clearSession"
}

export interface LoadMessagesRequest {
  type: "loadMessages"
  sessionID: string
}

export interface LoadSessionsRequest {
  type: "loadSessions"
}

export interface LoginRequest {
  type: "login"
}

export interface LogoutRequest {
  type: "logout"
}

export interface RefreshProfileRequest {
  type: "refreshProfile"
}

export interface OpenExternalRequest {
  type: "openExternal"
  url: string
}

export interface OpenFileRequest {
  type: "openFile"
  filePath: string
  line?: number
  column?: number
}

export interface CancelLoginRequest {
  type: "cancelLogin"
}

export interface SetOrganizationRequest {
  type: "setOrganization"
  organizationId: string | null
}

export interface WebviewReadyRequest {
  type: "webviewReady"
}

export interface RequestProvidersMessage {
  type: "requestProviders"
}

export interface ProviderSetApiKeyMessage {
  type: "providerSetApiKey"
  requestId: string
  providerID: string
  apiKey: string
}

export interface ProviderOauthAuthorizeMessage {
  type: "providerOauthAuthorize"
  requestId: string
  providerID: string
  method: number
}

export interface ProviderOauthCallbackMessage {
  type: "providerOauthCallback"
  requestId: string
  providerID: string
  method: number
  code?: string
}

export interface ProviderDisconnectMessage {
  type: "providerDisconnect"
  requestId: string
  providerID: string
}

export interface CompactRequest {
  type: "compact"
  sessionID: string
  providerID?: string
  modelID?: string
}

export interface SessionUndoRequest {
  type: "sessionUndo"
  sessionID: string
  messageID?: string
}

export interface SessionRedoRequest {
  type: "sessionRedo"
  sessionID: string
}

export interface SessionForkRequest {
  type: "sessionFork"
  sessionID: string
  messageID?: string
}

export interface SessionShareRequest {
  type: "sessionShare"
  sessionID: string
}

export interface SessionUnshareRequest {
  type: "sessionUnshare"
  sessionID: string
}

export interface RequestAgentsMessage {
  type: "requestAgents"
}

export interface RequestSkillsMessage {
  type: "requestSkills"
}

export interface SetLanguageRequest {
  type: "setLanguage"
  locale: string
}

export interface QuestionReplyRequest {
  type: "questionReply"
  requestID: string
  answers: string[][]
}

export interface QuestionRejectRequest {
  type: "questionReject"
  requestID: string
}

export interface DeleteSessionRequest {
  type: "deleteSession"
  sessionID: string
}

export interface RenameSessionRequest {
  type: "renameSession"
  sessionID: string
  title: string
}

export interface RequestAutocompleteSettingsMessage {
  type: "requestAutocompleteSettings"
}

export interface UpdateAutocompleteSettingMessage {
  type: "updateAutocompleteSetting"
  key: "enableAutoTrigger" | "enableSmartInlineTaskKeybinding" | "enableChatAutocomplete"
  value: boolean
}

export interface RequestChatCompletionMessage {
  type: "requestChatCompletion"
  text: string
  requestId: string
}

export interface RequestFileSearchMessage {
  type: "requestFileSearch"
  query: string
  requestId: string
}

export interface ChatCompletionAcceptedMessage {
  type: "chatCompletionAccepted"
  suggestionLength?: number
}
export interface UpdateSettingRequest {
  type: "updateSetting"
  key: string
  value: unknown
}

export interface RequestBrowserSettingsMessage {
  type: "requestBrowserSettings"
}

export interface RequestConfigMessage {
  type: "requestConfig"
}

export interface RequestPromptQueueMessage {
  type: "requestPromptQueue"
  sessionID: string
}

export interface EnqueuePromptMessage {
  type: "enqueuePrompt"
  sessionID: string
  item: Omit<PromptQueueItem, "id" | "createdAt">
}

export interface DequeuePromptMessage {
  type: "dequeuePrompt"
  sessionID: string
  itemID?: string
}

export interface ReorderPromptQueueMessage {
  type: "reorderPromptQueue"
  sessionID: string
  itemIDs: string[]
}

export interface UpdateConfigMessage {
  type: "updateConfig"
  config: Partial<Config>
  expectedRevision?: number
}

export interface RequestMemoryOverviewMessage {
  type: "requestMemoryOverview"
  requestID: string
  limit?: number
  folderID?: string
}

export interface SearchMemoryMessage {
  type: "searchMemory"
  requestID: string
  query: string
  topK?: number
  scope?: "user" | "folder" | "both"
  folderID?: string
  tagsAny?: string[]
  timeFrom?: string | number
  timeTo?: string | number
}

export interface UpdateMemoryAtomicMessage {
  type: "updateMemoryAtomic"
  requestID: string
  id: string
  text?: string
  tags?: string[]
  scope?: "user" | "folder"
  folderID?: string
}

export interface DeleteMemoryAtomicMessage {
  type: "deleteMemoryAtomic"
  requestID: string
  id: string
}

export interface PreviewMemoryContextMessage {
  type: "previewMemoryContext"
  requestID: string
  query: string
  directory?: string
  topKAtomic?: number
  maxChars?: number
  removeAtomicIDs?: string[]
  pinAtomicIDs?: string[]
  compress?: boolean
}

export interface RequestNotificationSettingsMessage {
  type: "requestNotificationSettings"
}

export interface ResetAllSettingsRequest {
  type: "resetAllSettings"
}

export interface RequestNotificationsMessage {
  type: "requestNotifications"
}

export interface DismissNotificationMessage {
  type: "dismissNotification"
  notificationId: string
}

export interface SyncSessionRequest {
  type: "syncSession"
  sessionID: string
}

// Agent Manager worktree messages
export interface CreateWorktreeSessionRequest {
  type: "agentManager.createWorktreeSession"
  text: string
  providerID?: string
  modelID?: string
  agent?: string
  files?: FileAttachment[]
}

export interface TelemetryRequest {
  type: "telemetry"
  event: string
  properties?: Record<string, unknown>
}

// Create a new worktree (with auto-created first session)
export interface CreateWorktreeRequest {
  type: "agentManager.createWorktree"
}

// Delete a worktree and dissociate its sessions
export interface DeleteWorktreeRequest {
  type: "agentManager.deleteWorktree"
  worktreeId: string
}

// Promote a session: create a worktree and move the session into it
export interface PromoteSessionRequest {
  type: "agentManager.promoteSession"
  sessionId: string
}

// Add a new session to an existing worktree
export interface AddSessionToWorktreeRequest {
  type: "agentManager.addSessionToWorktree"
  worktreeId: string
}

// Close (remove) a session from its worktree
export interface CloseSessionRequest {
  type: "agentManager.closeSession"
  sessionId: string
}

export interface RequestRepoInfoMessage {
  type: "agentManager.requestRepoInfo"
}

export interface RequestStateMessage {
  type: "agentManager.requestState"
}

// Configure worktree setup script
export interface ConfigureSetupScriptRequest {
  type: "agentManager.configureSetupScript"
}

// Show terminal for a session
export interface ShowTerminalRequest {
  type: "agentManager.showTerminal"
  sessionId: string
}

// Create multiple worktree sessions for the same prompt (multi-version mode)
export interface CreateMultiVersionRequest {
  type: "agentManager.createMultiVersion"
  text: string
  versions: number
  providerID?: string
  modelID?: string
  agent?: string
  files?: FileAttachment[]
  baseBranch?: string
}

// Persist tab order for a context (worktree ID or "local")
export interface SetTabOrderRequest {
  type: "agentManager.setTabOrder"
  key: string
  order: string[]
}

// Persist sessions collapsed state
export interface SetSessionsCollapsedRequest {
  type: "agentManager.setSessionsCollapsed"
  collapsed: boolean
}

// Variant persistence (webview → extension)
export interface PersistVariantRequest {
  type: "persistVariant"
  key: string
  value: string
}

// Request stored variants from extension (webview → extension)
export interface RequestVariantsMessage {
  type: "requestVariants"
}

export type WebviewMessage =
  | SendMessageRequest
  | AbortRequest
  | PermissionResponseRequest
  | CreateSessionRequest
  | ClearSessionRequest
  | LoadMessagesRequest
  | LoadSessionsRequest
  | LoginRequest
  | LogoutRequest
  | RefreshProfileRequest
  | OpenExternalRequest
  | OpenFileRequest
  | CancelLoginRequest
  | SetOrganizationRequest
  | WebviewReadyRequest
  | RequestProvidersMessage
  | ProviderSetApiKeyMessage
  | ProviderOauthAuthorizeMessage
  | ProviderOauthCallbackMessage
  | ProviderDisconnectMessage
  | CompactRequest
  | SessionUndoRequest
  | SessionRedoRequest
  | SessionForkRequest
  | SessionShareRequest
  | SessionUnshareRequest
  | RequestAgentsMessage
  | RequestSkillsMessage
  | SetLanguageRequest
  | QuestionReplyRequest
  | QuestionRejectRequest
  | DeleteSessionRequest
  | RenameSessionRequest
  | RequestAutocompleteSettingsMessage
  | UpdateAutocompleteSettingMessage
  | RequestChatCompletionMessage
  | RequestFileSearchMessage
  | ChatCompletionAcceptedMessage
  | UpdateSettingRequest
  | RequestBrowserSettingsMessage
  | RequestConfigMessage
  | RequestPromptQueueMessage
  | EnqueuePromptMessage
  | DequeuePromptMessage
  | ReorderPromptQueueMessage
  | UpdateConfigMessage
  | RequestMemoryOverviewMessage
  | SearchMemoryMessage
  | UpdateMemoryAtomicMessage
  | DeleteMemoryAtomicMessage
  | PreviewMemoryContextMessage
  | RequestNotificationSettingsMessage
  | ResetAllSettingsRequest
  | SyncSessionRequest
  | CreateWorktreeSessionRequest
  | RequestNotificationsMessage
  | DismissNotificationMessage
  | CreateWorktreeRequest
  | DeleteWorktreeRequest
  | PromoteSessionRequest
  | AddSessionToWorktreeRequest
  | CloseSessionRequest
  | TelemetryRequest
  | RequestRepoInfoMessage
  | RequestStateMessage
  | ConfigureSetupScriptRequest
  | ShowTerminalRequest
  | CreateMultiVersionRequest
  | SetTabOrderRequest
  | SetSessionsCollapsedRequest
  | PersistVariantRequest
  | RequestVariantsMessage

// ============================================
// VS Code API type
// ============================================

export interface VSCodeAPI {
  postMessage(message: WebviewMessage): void
  getState(): unknown
  setState(state: unknown): void
}

declare global {
  function acquireVsCodeApi(): VSCodeAPI
}
