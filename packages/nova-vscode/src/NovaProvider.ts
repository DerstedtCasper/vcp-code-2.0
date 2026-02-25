import * as path from "path"
import { promises as fs } from "fs"
import * as vscode from "vscode"
import { z } from "zod"
import {
  type HttpClient,
  ConfigConflictError,
  type SessionInfo,
  type SSEEvent,
  type NovaConnectionService,
  type NovacodeNotification,
  type SkillInfo,
} from "./services/cli-backend"
import type { Config, EditorContext } from "./services/cli-backend/types"
import { FileIgnoreController } from "./services/autocomplete/shims/FileIgnoreController"
import { handleChatCompletionRequest } from "./services/autocomplete/chat-autocomplete/handleChatCompletionRequest"
import { handleChatCompletionAccepted } from "./services/autocomplete/chat-autocomplete/handleChatCompletionAccepted"
import { buildWebviewHtml } from "./utils"
import { TelemetryProxy, type TelemetryPropertiesProvider } from "./services/telemetry"
import { sessionToWebview, normalizeProviders, filterVisibleAgents, buildSettingPath, mapSSEEventToWebviewMessage } from "./nova-provider-utils"

export class NovaProvider implements vscode.WebviewViewProvider, TelemetryPropertiesProvider {
  public static readonly viewType = "vcp-code.new.sidebarView"

  private webview: vscode.Webview | null = null
  private currentSession: SessionInfo | null = null
  private connectionState: "connecting" | "connected" | "disconnected" | "error" = "connecting"
  private loginAttempt = 0
  private isWebviewReady = false
  private readonly extensionVersion =
    vscode.extensions.getExtension("vcpcode.vcp-code")?.packageJSON?.version ?? "unknown"
  /** Cached providersLoaded payload so requestProviders can be served before httpClient is ready */
  private cachedProvidersMessage: unknown = null
  /** Cached agentsLoaded payload so requestAgents can be served before httpClient is ready */
  private cachedAgentsMessage: unknown = null
  /** Cached configLoaded payload so requestConfig can be served before httpClient is ready */
  private cachedConfigMessage: unknown = null
  /** Cached skillsLoaded payload so requestSkills can be served before httpClient is ready */
  private cachedSkillsMessage: unknown = null
  /** Cached notificationsLoaded payload */
  private cachedNotificationsMessage: unknown = null

  private trackedSessionIds: Set<string> = new Set()
  /** Per-session directory overrides (e.g., worktree paths registered by AgentManagerProvider). */
  private sessionDirectories = new Map<string, string>()
  /** Abort controller for the current loadMessages request; aborted when a new session is selected. */
  private loadMessagesAbort: AbortController | null = null
  private unsubscribeEvent: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private unsubscribeNotificationDismiss: (() => void) | null = null
  private webviewMessageDisposable: vscode.Disposable | null = null
  private sessionStatus = new Map<string, "idle" | "busy" | "retry">()
  private pendingPermission = new Map<string, number>()
  private pendingQuestion = new Map<string, number>()
  private promptQueue = new Map<
    string,
    Array<{
      id: string
      text: string
      files?: Array<{ mime: string; url: string }>
      policy: "guide" | "queue" | "interrupt"
      priority: number
      createdAt: string
      providerID?: string
      modelID?: string
      agent?: string
      variant?: string
    }>
  >()
  /** Session-level token totals for VcpStatusBadge (prompt/completion). */
  private sessionTokenTotals = new Map<string, { in: number; out: number }>()
  /** Assistant message token cache to avoid double-counting on message.updated events. */
  private assistantMessageTokens = new Map<string, { sessionID: string; in: number; out: number }>()
  /** Last known model selection per session (modelID). */
  private sessionModelSelection = new Map<string, string>()
  /** Last known agent selection per session. */
  private sessionAgentSelection = new Map<string, string>()
  /** Default selection used before a session has explicit model metadata. */
  private defaultModelSelection: { providerID: string; modelID: string } = { providerID: "nova", modelID: "kilo/auto" }

  /** Lazily initialized ignore controller for .novacodeignore filtering */
  private ignoreController: FileIgnoreController | null = null
  private ignoreControllerDir: string | null = null

  /** Optional interceptor called before the standard message handler.
   *  Return null to consume the message, or return a (possibly transformed) message. */
  private onBeforeMessage: ((msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>) | null = null

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: NovaConnectionService,
    private readonly extensionContext?: vscode.ExtensionContext,
  ) {
    TelemetryProxy.getInstance().setProvider(this)
  }

  getTelemetryProperties(): Record<string, unknown> {
    return {
      appName: "vcp-code",
      appVersion: this.extensionVersion,
      platform: "vscode",
      editorName: vscode.env.appName,
      vscodeVersion: vscode.version,
      machineId: vscode.env.machineId,
      vscodeIsTelemetryEnabled: vscode.env.isTelemetryEnabled,
    }
  }

  /**
   * Convenience getter that returns the shared HttpClient or null if not yet connected.
   * Preserves the existing null-check pattern used throughout handler methods.
   */
  private get httpClient(): HttpClient | null {
    try {
      return this.connectionService.getHttpClient()
    } catch {
      return null
    }
  }

  private sanitizeTokenCount(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
  }

  private adjustSessionTokenTotals(sessionID: string, deltaIn: number, deltaOut: number): void {
    const prev = this.sessionTokenTotals.get(sessionID) ?? { in: 0, out: 0 }
    const next = {
      in: Math.max(0, prev.in + deltaIn),
      out: Math.max(0, prev.out + deltaOut),
    }
    if (next.in === 0 && next.out === 0) {
      this.sessionTokenTotals.delete(sessionID)
      return
    }
    this.sessionTokenTotals.set(sessionID, next)
  }

  private clearSessionTokenCache(sessionID: string): void {
    for (const [messageID, usage] of this.assistantMessageTokens.entries()) {
      if (usage.sessionID !== sessionID) continue
      this.adjustSessionTokenTotals(sessionID, -usage.in, -usage.out)
      this.assistantMessageTokens.delete(messageID)
    }
    this.sessionTokenTotals.delete(sessionID)
  }

  private upsertAssistantMessageTokens(
    messageID: string,
    sessionID: string,
    tokens: { input?: unknown; output?: unknown } | undefined,
  ): void {
    const nextIn = this.sanitizeTokenCount(tokens?.input)
    const nextOut = this.sanitizeTokenCount(tokens?.output)

    const prev = this.assistantMessageTokens.get(messageID)
    if (prev) {
      this.adjustSessionTokenTotals(prev.sessionID, -prev.in, -prev.out)
    }

    if (nextIn === 0 && nextOut === 0) {
      this.assistantMessageTokens.delete(messageID)
      return
    }

    this.assistantMessageTokens.set(messageID, { sessionID, in: nextIn, out: nextOut })
    this.adjustSessionTokenTotals(sessionID, nextIn, nextOut)
  }

  private hydrateSessionTokenCache(
    sessionID: string,
    messagesData: Array<{ info: { id: string; role: "user" | "assistant"; tokens?: { input?: number; output?: number } } }>,
  ): void {
    this.clearSessionTokenCache(sessionID)
    for (const message of messagesData) {
      if (message.info.role !== "assistant") continue
      this.upsertAssistantMessageTokens(message.info.id, sessionID, message.info.tokens)
    }
  }

  private sendVcpStatusUpdate(sessionID?: string): void {
    const activeSessionID = sessionID ?? this.currentSession?.id
    const activeStatus = activeSessionID ? this.sessionStatus.get(activeSessionID) : undefined
    const connected = this.connectionState === "connected"

    const status: "idle" | "busy" | "error" =
      this.connectionState === "connecting"
        ? "busy"
        : !connected || this.connectionState === "error"
          ? "error"
          : activeStatus === "busy" || activeStatus === "retry"
            ? "busy"
            : "idle"

    const totals = activeSessionID ? (this.sessionTokenTotals.get(activeSessionID) ?? { in: 0, out: 0 }) : { in: 0, out: 0 }

    this.postMessage({
      type: "vcpStatusUpdate",
      payload: {
        status,
        connected,
        currentModel: activeSessionID
          ? (this.sessionModelSelection.get(activeSessionID) ?? this.defaultModelSelection.modelID)
          : this.defaultModelSelection.modelID,
        currentAgent: activeSessionID ? this.sessionAgentSelection.get(activeSessionID) : undefined,
        tokens: {
          in: totals.in,
          out: totals.out,
          total: totals.in + totals.out,
        },
        lastRunId: activeSessionID,
      },
    })
  }

  /**
   * Synchronize current extension-side state to the webview.
   * This is primarily used after a webview refresh where early postMessage calls
   * may have been dropped before the webview registered its message listeners.
   */
  private async syncWebviewState(reason: string): Promise<void> {
    const serverInfo = this.connectionService.getServerInfo()
    console.log("[Nova New] NovaProvider: üîÑ syncWebviewState()", {
      reason,
      isWebviewReady: this.isWebviewReady,
      connectionState: this.connectionState,
      hasHttpClient: !!this.httpClient,
      hasServerInfo: !!serverInfo,
    })

    if (!this.isWebviewReady) {
      console.log("[Nova New] NovaProvider: ‚è≠Ô∏è syncWebviewState skipped (webview not ready)")
      return
    }

    // Always push connection state first so the UI can render appropriately.
    this.postMessage({
      type: "connectionState",
      state: this.connectionState,
    })

    // Re-send ready so the webview can recover after refresh.
    if (serverInfo) {
      const langConfig = vscode.workspace.getConfiguration("vcp-code.new")
      this.postMessage({
        type: "ready",
        serverInfo,
        extensionVersion: this.extensionVersion,
        vscodeLanguage: vscode.env.language,
        languageOverride: langConfig.get<string>("language"),
      })
    }

    // Always attempt to fetch+push profile when connected.
    if (this.connectionState === "connected" && this.httpClient) {
      console.log("[Nova New] NovaProvider: üë§ syncWebviewState fetching profile...")
      try {
        const profileData = await this.httpClient.getProfile()
        console.log("[Nova New] NovaProvider: üë§ syncWebviewState profile:", profileData ? "received" : "null")
        this.postMessage({
          type: "profileData",
          data: profileData,
        })
      } catch (error) {
        console.error("[Nova New] NovaProvider: ‚ù?syncWebviewState failed to fetch profile:", error)
      }
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    // Store the webview references
    this.isWebviewReady = false
    this.webview = webviewView.webview

    // Set up webview options
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    // Set HTML content
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

    // Handle messages from webview (shared handler)
    this.setupWebviewMessageHandler(webviewView.webview)

    // Initialize connection to CLI backend
    this.initializeConnection()
  }

  /**
   * Resolve a WebviewPanel for displaying the Nova webview in an editor tab.
   */
  public resolveWebviewPanel(panel: vscode.WebviewPanel): void {
    // WebviewPanel can be restored/reloaded; ensure we don't treat it as ready prematurely.
    this.isWebviewReady = false
    this.webview = panel.webview

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    panel.webview.html = this._getHtmlForWebview(panel.webview)

    // Handle messages from webview (shared handler)
    this.setupWebviewMessageHandler(panel.webview)

    this.initializeConnection()
  }

  /**
   * Register a session created externally (e.g., worktree sessions from AgentManagerProvider).
   * Sets currentSession, adds to trackedSessionIds, and notifies the webview.
   */
  public registerSession(session: SessionInfo): void {
    this.currentSession = session
    this.trackedSessionIds.add(session.id)
    this.postMessage({
      type: "sessionCreated",
      session: this.sessionToWebview(session),
    })
  }

  /**
   * Add a session ID to the tracked set without changing currentSession.
   * Used to re-register worktree sessions after clearSession wipes the set.
   */
  public trackSession(sessionId: string): void {
    this.trackedSessionIds.add(sessionId)
  }

  /**
   * Register a directory override for a session (e.g., worktree path).
   * When set, all operations for this session use this directory instead of the workspace root.
   */
  public setSessionDirectory(sessionId: string, directory: string): void {
    this.sessionDirectories.set(sessionId, directory)
  }

  public clearSessionDirectory(sessionId: string): void {
    this.sessionDirectories.delete(sessionId)
  }

  /**
   * Re-fetch and send the full session list to the webview.
   * Called by AgentManagerProvider after worktree recovery completes.
   */
  public refreshSessions(): void {
    void this.handleLoadSessions()
  }

  /**
   * Attach to a webview that already has its own HTML set.
   * Sets up message handling and connection without overriding HTML content.
   *
   * @param options.onBeforeMessage - Optional interceptor called before the standard handler.
   *   Return null to consume the message (stop propagation), or return the message
   *   (possibly transformed) to continue with standard handling.
   */
  public attachToWebview(
    webview: vscode.Webview,
    options?: { onBeforeMessage?: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null> },
  ): void {
    this.isWebviewReady = false
    this.webview = webview
    this.onBeforeMessage = options?.onBeforeMessage ?? null
    this.setupWebviewMessageHandler(webview)
    this.initializeConnection()
  }

  /**
   * Set up the shared message handler for both sidebar and tab webviews.
   * Handles ALL message types so tabs have full functionality.
   */
  private setupWebviewMessageHandler(webview: vscode.Webview): void {
    this.webviewMessageDisposable?.dispose()
    this.webviewMessageDisposable = webview.onDidReceiveMessage(async (message) => {
      // Run interceptor if attached (e.g., AgentManagerProvider worktree logic)
      if (this.onBeforeMessage) {
        try {
          const result = await this.onBeforeMessage(message)
          if (result === null) return // consumed by interceptor
          message = result
        } catch (error) {
          console.error("[Nova New] NovaProvider: interceptor error:", error)
          return
        }
      }

      switch (message.type) {
        case "webviewReady":
          console.log("[Nova New] NovaProvider: ‚ú?webviewReady received")
          this.isWebviewReady = true
          await this.syncWebviewState("webviewReady")
          break
        case "sendMessage": {
          const files = z
            .array(
              z.object({
                mime: z.string(),
                url: z.string().refine((u) => u.startsWith("file://") || u.startsWith("data:")),
              }),
            )
            .optional()
            .catch(undefined)
            .parse(message.files)
          await this.handleSendMessage(
            message.text,
            message.sessionID,
            message.providerID,
            message.modelID,
            message.agent,
            message.variant,
            files,
            message.busyMode,
          )
          break
        }
        case "abort":
          await this.handleAbort(message.sessionID)
          break
        case "permissionResponse":
          await this.handlePermissionResponse(message.permissionId, message.sessionID, message.response)
          break
        case "createSession":
          await this.handleCreateSession()
          break
        case "clearSession":
          this.currentSession = null
          this.trackedSessionIds.clear()
          this.sessionStatus.clear()
          this.sessionTokenTotals.clear()
          this.assistantMessageTokens.clear()
          this.sessionModelSelection.clear()
          this.sessionAgentSelection.clear()
          this.sendVcpStatusUpdate()
          break
        case "loadMessages":
          // Don't await: allow parallel loads so rapid session switching
          // isn't blocked by slow responses for earlier sessions.
          void this.handleLoadMessages(message.sessionID)
          break
        case "syncSession":
          await this.handleSyncSession(message.sessionID)
          break
        case "loadSessions":
          await this.handleLoadSessions()
          break
        case "login":
          await this.handleLogin()
          break
        case "cancelLogin":
          this.loginAttempt++
          this.postMessage({ type: "deviceAuthCancelled" })
          break
        case "logout":
          await this.handleLogout()
          break
        case "setOrganization":
          if (typeof message.organizationId === "string" || message.organizationId === null) {
            await this.handleSetOrganization(message.organizationId)
          }
          break
        case "refreshProfile":
          await this.handleRefreshProfile()
          break
        case "openExternal":
          if (message.url) {
            vscode.env.openExternal(vscode.Uri.parse(message.url))
          }
          break
        case "openFile":
          if (message.filePath) {
            this.handleOpenFile(message.filePath, message.line, message.column)
          }
          break
        case "requestProviders":
          await this.fetchAndSendProviders()
          break
        case "compact":
          await this.handleCompact(message.sessionID, message.providerID, message.modelID)
          break
        case "requestAgents":
          await this.fetchAndSendAgents()
          break
        case "questionReply":
          await this.handleQuestionReply(message.requestID, message.answers)
          break
        case "questionReject":
          await this.handleQuestionReject(message.requestID)
          break
        case "requestConfig":
          await this.fetchAndSendConfig()
          break
        case "requestPromptQueue":
          if (typeof message.sessionID === "string") this.sendPromptQueue(message.sessionID)
          break
        case "enqueuePrompt":
          if (typeof message.sessionID === "string" && message.item) this.enqueuePrompt(message.sessionID, message.item)
          break
        case "dequeuePrompt":
          if (typeof message.sessionID === "string") this.dequeuePrompt(message.sessionID, message.itemID)
          break
        case "reorderPromptQueue":
          if (typeof message.sessionID === "string" && Array.isArray(message.itemIDs)) {
            this.reorderPromptQueue(message.sessionID, message.itemIDs)
          }
          break
        case "requestSkills":
          await this.fetchAndSendSkills()
          break
        case "updateConfig":
          await this.handleUpdateConfig(message.config, message.expectedRevision)
          break
        case "requestMemoryOverview":
          await this.handleRequestMemoryOverview(message.requestID, message.limit, message.folderID)
          break
        case "searchMemory":
          await this.handleSearchMemory(message.requestID, message)
          break
        case "updateMemoryAtomic":
          await this.handleUpdateMemoryAtomic(message.requestID, message.id, message)
          break
        case "deleteMemoryAtomic":
          await this.handleDeleteMemoryAtomic(message.requestID, message.id)
          break
        case "previewMemoryContext":
          await this.handlePreviewMemoryContext(
            message.requestID,
            message.query,
            message.directory,
            message.topKAtomic,
            message.maxChars,
            message.removeAtomicIDs,
            message.pinAtomicIDs,
            message.compress,
          )
          break
        case "setLanguage":
          await vscode.workspace
            .getConfiguration("vcp-code.new")
            .update("language", message.locale || undefined, vscode.ConfigurationTarget.Global)
          break
        case "requestAutocompleteSettings":
          this.sendAutocompleteSettings()
          break
        case "updateAutocompleteSetting": {
          const allowedKeys = new Set([
            "enableAutoTrigger",
            "enableSmartInlineTaskKeybinding",
            "enableChatAutocomplete",
          ])
          if (allowedKeys.has(message.key)) {
            await vscode.workspace
              .getConfiguration("vcp-code.new.autocomplete")
              .update(message.key, message.value, vscode.ConfigurationTarget.Global)
            this.sendAutocompleteSettings()
          }
          break
        }
        case "requestChatCompletion":
          void handleChatCompletionRequest(
            { type: "requestChatCompletion", text: message.text, requestId: message.requestId },
            { postMessage: (msg) => this.postMessage(msg) },
            this.connectionService,
          )
          break
        case "requestFileSearch": {
          const client = this.httpClient
          if (client) {
            const dir = this.getWorkspaceDirectory(this.currentSession?.id)
            void client
              .findFiles(message.query, dir)
              .then((paths) => {
                this.postMessage({ type: "fileSearchResult", paths, dir, requestId: message.requestId })
              })
              .catch((error) => {
                console.error("[Nova New] File search failed:", error)
                this.postMessage({ type: "fileSearchResult", paths: [], dir, requestId: message.requestId })
              })
          } else {
            this.postMessage({ type: "fileSearchResult", paths: [], dir: "", requestId: message.requestId })
          }
          break
        }
        case "chatCompletionAccepted":
          handleChatCompletionAccepted({ type: "chatCompletionAccepted", suggestionLength: message.suggestionLength })
          break
        case "deleteSession":
          await this.handleDeleteSession(message.sessionID)
          break
        case "renameSession":
          await this.handleRenameSession(message.sessionID, message.title)
          break
        case "updateSetting":
          await this.handleUpdateSetting(message.key, message.value)
          break
        case "requestBrowserSettings":
          this.sendBrowserSettings()
          break
        case "requestNotificationSettings":
          this.sendNotificationSettings()
          break
        case "requestNotifications":
          await this.fetchAndSendNotifications()
          break
        case "dismissNotification":
          await this.handleDismissNotification(message.notificationId)
          break
        case "resetAllSettings":
          await this.handleResetAllSettings()
          break
        case "telemetry":
          TelemetryProxy.capture(message.event, message.properties)
          break
        case "persistVariant": {
          const stored = this.extensionContext?.globalState.get<Record<string, string>>("variantSelections") ?? {}
          stored[message.key] = message.value
          await this.extensionContext?.globalState.update("variantSelections", stored)
          break
        }
        case "requestVariants": {
          const variants = this.extensionContext?.globalState.get<Record<string, string>>("variantSelections") ?? {}
          this.postMessage({ type: "variantsLoaded", variants })
          break
        }
        case "enhancePrompt": {
          void this.handleEnhancePrompt(
            message.text as string,
            (message.requestId as string | undefined) ?? "enhance-0",
          )
          break
        }
      }
    })
  }

  /**
   * Initialize connection to the CLI backend server.
   * Subscribes to the shared NovaConnectionService.
   */
  private async initializeConnection(): Promise<void> {
    console.log("[Nova New] NovaProvider: üîß Starting initializeConnection...")

    // Clean up any existing subscriptions (e.g., sidebar re-shown)
    this.unsubscribeEvent?.()
    this.unsubscribeState?.()
    this.unsubscribeNotificationDismiss?.()

    try {
      const workspaceDir = this.getWorkspaceDirectory()

      // Connect the shared service (no-op if already connected)
      await this.connectionService.connect(workspaceDir)

      // Subscribe to SSE events for this webview (filtered by tracked sessions)
      this.unsubscribeEvent = this.connectionService.onEventFiltered(
        (event) => {
          const sessionId = this.connectionService.resolveEventSessionId(event)

          // message.part.updated is always session-scoped; if we can't determine the session, drop it.
          if (!sessionId) {
            return event.type !== "message.part.updated"
          }

          return this.trackedSessionIds.has(sessionId)
        },
        (event) => {
          this.handleSSEEvent(event)
        },
      )

      // Subscribe to connection state changes
      this.unsubscribeState = this.connectionService.onStateChange(async (state) => {
        this.connectionState = state
        this.postMessage({ type: "connectionState", state })
        this.sendVcpStatusUpdate()

        if (state === "connected") {
          try {
            const client = this.httpClient
            if (client) {
              const profileData = await client.getProfile()
              this.postMessage({ type: "profileData", data: profileData })
            }
            await this.syncWebviewState("sse-connected")
          } catch (error) {
            console.error("[Nova New] NovaProvider: ‚ù?Failed during connected state handling:", error)
            this.postMessage({
              type: "error",
              message: error instanceof Error ? error.message : "Failed to sync after connecting",
            })
          }
        }
      })

      // Subscribe to notification dismiss broadcast from other NovaProvider instances
      this.unsubscribeNotificationDismiss = this.connectionService.onNotificationDismissed(() => {
        this.fetchAndSendNotifications()
      })

      // Get current state and push to webview
      const serverInfo = this.connectionService.getServerInfo()
      this.connectionState = this.connectionService.getConnectionState()

      if (serverInfo) {
        const langConfig = vscode.workspace.getConfiguration("vcp-code.new")
        this.postMessage({
          type: "ready",
          serverInfo,
          extensionVersion: this.extensionVersion,
          vscodeLanguage: vscode.env.language,
          languageOverride: langConfig.get<string>("language"),
        })
      }

      this.postMessage({ type: "connectionState", state: this.connectionState })
      this.sendVcpStatusUpdate()
      await this.syncWebviewState("initializeConnection")

      // Fetch providers and agents, then send to webview
      await this.fetchAndSendProviders()
      await this.fetchAndSendAgents()
      await this.fetchAndSendConfig()
      await this.fetchAndSendSkills()
      await this.fetchAndSendNotifications()
      this.sendNotificationSettings()

      console.log("[Nova New] NovaProvider: ‚ú?initializeConnection completed successfully")
    } catch (error) {
      console.error("[Nova New] NovaProvider: ‚ù?Failed to initialize connection:", error)
      this.connectionState = "error"
      this.postMessage({
        type: "connectionState",
        state: "error",
        error: error instanceof Error ? error.message : "Failed to connect to CLI backend",
      })
      this.sendVcpStatusUpdate()
    }
  }

  private sessionToWebview(session: SessionInfo) {
    return sessionToWebview(session)
  }

  /**
   * Handle creating a new session.
   */
  private async handleCreateSession(): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const session = await this.httpClient.createSession(workspaceDir)
      this.currentSession = session
      this.trackedSessionIds.add(session.id)

      // Notify webview of the new session
      this.postMessage({
        type: "sessionCreated",
        session: this.sessionToWebview(session),
      })
      this.sendVcpStatusUpdate(session.id)
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to create session:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to create session",
      })
    }
  }

  /**
   * Handle loading messages for a session.
   */
  private async handleLoadMessages(sessionID: string): Promise<void> {
    // Track the session so we receive its SSE events
    this.trackedSessionIds.add(sessionID)

    if (!this.httpClient) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
        sessionID,
      })
      return
    }

    // Abort any previous in-flight loadMessages request so the backend
    // isn't overwhelmed when the user switches sessions rapidly.
    this.loadMessagesAbort?.abort()
    const abort = new AbortController()
    this.loadMessagesAbort = abort

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      const messagesData = await this.httpClient.getMessages(sessionID, workspaceDir, abort.signal)

      // If this request was aborted while awaiting, skip posting stale results
      if (abort.signal.aborted) return

      // Update currentSession so fallback logic in handleSendMessage/handleAbort
      // references the correct session after switching to a historical session.
      // Non-blocking: don't let a failure here prevent messages from loading.
      // 404s are expected for cross-worktree sessions ‚Ä?use silent to suppress HTTP error logs.
      this.httpClient
        .getSession(sessionID, workspaceDir, true)
        .then((session) => {
          if (!this.currentSession || this.currentSession.id === sessionID) {
            this.currentSession = session
          }
        })
        .catch((err) => console.warn("[Nova New] NovaProvider: getSession failed (non-critical):", err))

      // Fetch current session status so the webview has the correct busy/idle
      // state after switching tabs (SSE events may have been missed).
      this.httpClient
        .getSessionStatuses(workspaceDir)
        .then((statuses) => {
          for (const [sid, info] of Object.entries(statuses)) {
            if (!this.trackedSessionIds.has(sid)) continue
            this.sessionStatus.set(sid, info.type)
            this.postMessage({
              type: "sessionStatus",
              sessionID: sid,
              status: info.type,
              ...(info.type === "retry" ? { attempt: info.attempt, message: info.message, next: info.next } : {}),
            })
            this.sendVcpStatusUpdate(sid)
          }
        })
        .catch((err) => console.error("[Nova New] NovaProvider: Failed to fetch session statuses:", err))

      this.hydrateSessionTokenCache(sessionID, messagesData)

      // Convert to webview format, including cost/tokens for assistant messages
      const messages = messagesData.map((m) => ({
        id: m.info.id,
        sessionID: m.info.sessionID,
        role: m.info.role,
        parts: m.parts,
        createdAt: new Date(m.info.time.created).toISOString(),
        cost: m.info.cost,
        tokens: m.info.tokens,
      }))

      for (const message of messages) {
        this.connectionService.recordMessageSessionId(message.id, message.sessionID)
      }

      this.postMessage({
        type: "messagesLoaded",
        sessionID,
        messages,
      })
      this.sendVcpStatusUpdate(sessionID)
    } catch (error) {
      // Silently ignore aborted requests ‚Ä?the user switched to a different session
      if (abort.signal.aborted) return
      console.error("[Nova New] NovaProvider: Failed to load messages:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load messages",
        sessionID,
      })
    }
  }

  /**
   * Handle syncing a child session (e.g. spawned by the task tool).
   * Tracks the session for SSE events and fetches its messages.
   */
  private async handleSyncSession(sessionID: string): Promise<void> {
    if (!this.httpClient) return
    if (this.trackedSessionIds.has(sessionID)) return

    this.trackedSessionIds.add(sessionID)

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      const messagesData = await this.httpClient.getMessages(sessionID, workspaceDir)

      const messages = messagesData.map((m) => ({
        id: m.info.id,
        sessionID: m.info.sessionID,
        role: m.info.role,
        parts: m.parts,
        createdAt: new Date(m.info.time.created).toISOString(),
        cost: m.info.cost,
        tokens: m.info.tokens,
      }))

      for (const message of messages) {
        this.connectionService.recordMessageSessionId(message.id, message.sessionID)
      }

      this.postMessage({
        type: "messagesLoaded",
        sessionID,
        messages,
      })
    } catch (err) {
      console.error("[Nova New] NovaProvider: Failed to sync child session:", err)
    }
  }

  /**
   * Handle loading all sessions.
   */
  private async handleLoadSessions(): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const sessions = await this.httpClient.listSessions(workspaceDir)

      // Also fetch sessions from worktree directories so they appear in the list
      const worktreeDirs = new Set(this.sessionDirectories.values())
      const extra = await Promise.all(
        [...worktreeDirs].map((dir) =>
          this.httpClient!.listSessions(dir).catch((err) => {
            console.error(`[Nova New] NovaProvider: Failed to list sessions for ${dir}:`, err)
            return [] as SessionInfo[]
          }),
        ),
      )
      const seen = new Set(sessions.map((s) => s.id))
      for (const batch of extra) {
        for (const s of batch) {
          if (!seen.has(s.id)) {
            sessions.push(s)
            seen.add(s.id)
          }
        }
      }

      this.postMessage({
        type: "sessionsLoaded",
        sessions: sessions.map((s) => this.sessionToWebview(s)),
      })
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to load sessions:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load sessions",
      })
    }
  }

  /**
   * Handle enhance prompt request ‚Ä?calls backend LLM to rewrite/polish the user's prompt.
   */
  private async handleEnhancePrompt(text: string, requestId: string): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({ type: "enhancePromptError", error: "Not connected to CLI backend", requestId })
      return
    }
    try {
      // Use the existing chat-completion endpoint to enhance the prompt
      const systemPrompt =
        "You are an expert prompt engineer. " +
        "Rewrite the following user prompt to be clearer, more specific, and more effective. " +
        "Return ONLY the improved prompt text without any explanation or meta-commentary."
      const result = await (this.httpClient as unknown as { complete?: (opts: unknown) => Promise<string> }).complete?.({
        system: systemPrompt,
        messages: [{ role: "user", content: text }],
      })
      if (result) {
        this.postMessage({ type: "enhancePromptResult", text: result, requestId })
      } else {
        // Fallback: just echo back (backend doesn't support complete())
        this.postMessage({ type: "enhancePromptResult", text, requestId })
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      this.postMessage({ type: "enhancePromptError", error: err, requestId })
    }
  }

  /**
   * Handle deleting a session.
   */
  private async handleDeleteSession(sessionID: string): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      await this.httpClient.deleteSession(sessionID, workspaceDir)
      this.trackedSessionIds.delete(sessionID)
      this.sessionDirectories.delete(sessionID)
      this.sessionStatus.delete(sessionID)
      this.clearSessionTokenCache(sessionID)
      this.sessionModelSelection.delete(sessionID)
      this.sessionAgentSelection.delete(sessionID)
      if (this.currentSession?.id === sessionID) {
        this.currentSession = null
      }
      this.postMessage({ type: "sessionDeleted", sessionID })
      this.sendVcpStatusUpdate()
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to delete session:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to delete session",
      })
    }
  }

  /**
   * Handle renaming a session.
   */
  private async handleRenameSession(sessionID: string, title: string): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      const updated = await this.httpClient.updateSession(sessionID, { title }, workspaceDir)
      if (this.currentSession?.id === sessionID) {
        this.currentSession = updated
      }
      this.postMessage({ type: "sessionUpdated", session: this.sessionToWebview(updated) })
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to rename session:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to rename session",
      })
    }
  }

  /**
   * Fetch providers from the backend and send to webview.
   *
   * The backend `/provider` endpoint returns `all` as an array-like object with
   * numeric keys ("0", "1", ‚Ä?. The webview and sendMessage both need providers
   * keyed by their real `provider.id` (e.g. "anthropic", "openai"). We re-key
   * the map here so the rest of the code can use provider.id everywhere.
   */
  private async fetchAndSendProviders(): Promise<void> {
    if (!this.httpClient) {
      // httpClient not ready ‚Ä?serve from cache if available
      if (this.cachedProvidersMessage) {
        this.postMessage(this.cachedProvidersMessage)
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const response = await this.httpClient.listProviders(workspaceDir)

      const normalized = normalizeProviders(response.all)

      const config = vscode.workspace.getConfiguration("vcp-code.new.model")
      const providerID = config.get<string>("providerID", "nova")
      const modelID = config.get<string>("modelID", "kilo/auto")

      this.defaultModelSelection = { providerID, modelID }

      const message = {
        type: "providersLoaded",
        providers: normalized,
        connected: response.connected,
        defaults: response.default,
        defaultSelection: { providerID, modelID },
      }
      this.cachedProvidersMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to fetch providers:", error)
    }
  }

  /**
   * Fetch agents (modes) from the backend and send to webview.
   */
  private async fetchAndSendAgents(): Promise<void> {
    if (!this.httpClient) {
      if (this.cachedAgentsMessage) {
        this.postMessage(this.cachedAgentsMessage)
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const agents = await this.httpClient.listAgents(workspaceDir)

      const { visible, defaultAgent } = filterVisibleAgents(agents)

      const message = {
        type: "agentsLoaded",
        agents: visible.map((a) => ({
          name: a.name,
          description: a.description,
          mode: a.mode,
          native: a.native,
          color: a.color,
        })),
        defaultAgent,
      }
      this.cachedAgentsMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to fetch agents:", error)
    }
  }

  /**
   * Fetch backend config and send to webview.
   */
  private async fetchAndSendConfig(): Promise<void> {
    if (!this.httpClient) {
      if (this.cachedConfigMessage) {
        this.postMessage(this.cachedConfigMessage)
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const config = await this.httpClient.getConfig(workspaceDir)
      const revision = await this.httpClient.getGlobalConfigRevision().catch(() => undefined)

      const message = {
        type: "configLoaded",
        config,
        revision,
      }
      this.cachedConfigMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to fetch config:", error)
    }
  }

  /**
   * Fetch loaded skills from the backend and send to webview.
   */
  private async fetchAndSendSkills(): Promise<void> {
    if (!this.httpClient) {
      if (this.cachedSkillsMessage) {
        this.postMessage(this.cachedSkillsMessage)
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const skills = await this.httpClient.listSkills(workspaceDir)
      const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name))

      const message: { type: "skillsLoaded"; skills: SkillInfo[] } = {
        type: "skillsLoaded",
        skills: sorted,
      }
      this.cachedSkillsMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to fetch skills:", error)
    }
  }

  /**
   * Fetch Nova news/notifications and send to webview.
   * Uses the cached message pattern so the webview gets data immediately on refresh.
   */
  private async fetchAndSendNotifications(): Promise<void> {
    if (!this.httpClient) {
      if (this.cachedNotificationsMessage) {
        this.postMessage(this.cachedNotificationsMessage)
      }
      return
    }

    try {
      const notifications = await this.httpClient.getNotifications()
      const existing = this.extensionContext?.globalState.get<string[]>("nova.dismissedNotificationIds", []) ?? []
      const active = new Set(notifications.map((n) => n.id))
      const dismissedIds = existing.filter((id) => active.has(id))
      if (dismissedIds.length !== existing.length) {
        await this.extensionContext?.globalState.update("nova.dismissedNotificationIds", dismissedIds)
      }
      const message = { type: "notificationsLoaded", notifications, dismissedIds }
      this.cachedNotificationsMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to fetch notifications:", error)
    }
  }

  /**
   * Persist a dismissed notification ID in globalState and push updated lists to webview.
   */
  private async handleDismissNotification(notificationId: string): Promise<void> {
    if (!this.extensionContext) return
    const existing = this.extensionContext.globalState.get<string[]>("nova.dismissedNotificationIds", [])
    if (!existing.includes(notificationId)) {
      await this.extensionContext.globalState.update("nova.dismissedNotificationIds", [...existing, notificationId])
    }
    await this.fetchAndSendNotifications()
    this.connectionService.notifyNotificationDismissed(notificationId)
  }

  /**
   * Read notification/sound settings from VS Code config and push to webview.
   */
  private sendNotificationSettings(): void {
    const notifications = vscode.workspace.getConfiguration("vcp-code.new.notifications")
    const sounds = vscode.workspace.getConfiguration("vcp-code.new.sounds")
    this.postMessage({
      type: "notificationSettingsLoaded",
      settings: {
        notifyAgent: notifications.get<boolean>("agent", true),
        notifyPermissions: notifications.get<boolean>("permissions", true),
        notifyErrors: notifications.get<boolean>("errors", true),
        soundAgent: sounds.get<string>("agent", "default"),
        soundPermissions: sounds.get<string>("permissions", "default"),
        soundErrors: sounds.get<string>("errors", "default"),
      },
    })
  }

  private shouldNotifyAgentEvents(): boolean {
    return vscode.workspace.getConfiguration("vcp-code.new.notifications").get<boolean>("agent", true)
  }

  private summarizeNotificationText(text: string, maxLength = 180): string {
    const normalized = text.replace(/\s+/g, " ").trim()
    if (normalized.length <= maxLength) {
      return normalized
    }
    return `${normalized.slice(0, maxLength - 1)}‚Ä¶`
  }

  /**
   * Handle config update request from the webview.
   * Applies a partial config update via the global config endpoint, then pushes
   * the full merged config back to the webview.
   */
  private async handleUpdateConfig(partial: Record<string, unknown>, expectedRevision?: number): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }

    try {
      const updated = await this.httpClient.updateConfig(partial, expectedRevision)

      const message = {
        type: "configUpdated",
        config: updated.config,
        revision: updated.revision,
      }
      this.cachedConfigMessage = { type: "configLoaded", config: updated.config, revision: updated.revision }
      this.postMessage(message)
      await this.fetchAndSendSkills()
    } catch (error) {
      if (error instanceof ConfigConflictError) {
        this.postMessage({
          type: "configConflict",
          error: error.payload.error,
          code: error.payload.code,
          config: error.payload.config,
          revision: error.payload.revision,
          expectedRevision: error.payload.expectedRevision,
        })
        return
      }
      console.error("[Nova New] NovaProvider: Failed to update config:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to update config",
      })
    }
  }

  /**
   * Handle sending a message from the webview.
   */
  private async handleSendMessage(
    text: string,
    sessionID?: string,
    providerID?: string,
    modelID?: string,
    agent?: string,
    variant?: string,
    files?: Array<{ mime: string; url: string }>,
    busyMode?: "guide" | "queue" | "interrupt",
  ): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID || this.currentSession?.id)

      // Create session if needed
      if (!sessionID && !this.currentSession) {
        this.currentSession = await this.httpClient.createSession(workspaceDir)
        this.trackedSessionIds.add(this.currentSession.id)
        // Notify webview of the new session
        this.postMessage({
          type: "sessionCreated",
          session: this.sessionToWebview(this.currentSession),
        })
      }

      const targetSessionID = sessionID || this.currentSession?.id
      if (!targetSessionID) {
        throw new Error("No session available")
      }
      if (modelID) {
        this.sessionModelSelection.set(targetSessionID, modelID)
      }
      if (agent) {
        this.sessionAgentSelection.set(targetSessionID, agent)
      }
      this.sendVcpStatusUpdate(targetSessionID)

      if (busyMode === "queue" && this.sessionStatus.get(targetSessionID) === "busy") {
        this.enqueuePrompt(targetSessionID, {
          text,
          files,
          policy: "queue",
          priority: 0,
          providerID,
          modelID,
          agent,
          variant,
        })
        return
      }
      if (busyMode === "interrupt" && this.sessionStatus.get(targetSessionID) === "busy") {
        await this.handleAbort(targetSessionID)
      }

      // Build parts array with file context and user text
      const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }> = []

      // Add any explicitly attached files from the webview
      if (files) {
        for (const f of files) {
          parts.push({ type: "file", mime: f.mime, url: f.url })
        }
      }

      parts.push({ type: "text", text })

      const editorContext = await this.gatherEditorContext()

      await this.httpClient.sendMessage(targetSessionID, parts, workspaceDir, {
        providerID,
        modelID,
        agent,
        variant,
        editorContext,
      })
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to send message:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to send message",
      })
    }
  }

  /**
   * Handle abort request from the webview.
   */
  private async handleAbort(sessionID?: string): Promise<void> {
    if (!this.httpClient) {
      return
    }

    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(targetSessionID)
      await this.httpClient.abortSession(targetSessionID, workspaceDir)
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to abort session:", error)
    }
  }

  /**
   * Handle compact (context summarization) request from the webview.
   */
  private async handleCompact(sessionID?: string, providerID?: string, modelID?: string): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    const target = sessionID || this.currentSession?.id
    if (!target) {
      console.error("[Nova New] NovaProvider: No sessionID for compact")
      return
    }

    if (!providerID || !modelID) {
      console.error("[Nova New] NovaProvider: No model selected for compact")
      this.postMessage({
        type: "error",
        message: "No model selected. Connect a provider to compact this session.",
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(target)
      await this.httpClient.summarize(target, providerID, modelID, workspaceDir)
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to compact session:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to compact session",
      })
    }
  }

  /**
   * Handle permission response from the webview.
   */
  private async handlePermissionResponse(
    permissionId: string,
    sessionID: string,
    response: "once" | "always" | "reject",
  ): Promise<void> {
    if (!this.httpClient) {
      return
    }

    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      console.error("[Nova New] NovaProvider: No sessionID for permission response")
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(targetSessionID)
      await this.httpClient.respondToPermission(targetSessionID, permissionId, response, workspaceDir)
      this.decrementPending(this.pendingPermission, targetSessionID)
      if (this.sessionStatus.get(targetSessionID) === "idle") {
        void this.flushPromptQueue(targetSessionID)
      }
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to respond to permission:", error)
    }
  }

  /**
   * Handle question reply from the webview.
   */
  private async handleQuestionReply(requestID: string, answers: string[][]): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({ type: "questionError", requestID })
      return
    }

    try {
      await this.httpClient.replyToQuestion(requestID, answers, this.getWorkspaceDirectory(this.currentSession?.id))
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to reply to question:", error)
      this.postMessage({ type: "questionError", requestID })
    }
  }

  /**
   * Handle question reject (dismiss) from the webview.
   */
  private async handleQuestionReject(requestID: string): Promise<void> {
    if (!this.httpClient) {
      this.postMessage({ type: "questionError", requestID })
      return
    }

    try {
      await this.httpClient.rejectQuestion(requestID, this.getWorkspaceDirectory(this.currentSession?.id))
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to reject question:", error)
      this.postMessage({ type: "questionError", requestID })
    }
  }

  /**
   * Handle login request from the webview.
   * Uses the provider OAuth flow: authorize ‚Ü?open browser ‚Ü?callback (polls until complete).
   * Sends device auth messages so the webview can display a QR code, verification code, and timer.
   */
  private async handleLogin(): Promise<void> {
    if (!this.httpClient) {
      return
    }

    const attempt = ++this.loginAttempt

    console.log("[Nova New] NovaProvider: üîê Starting login flow...")

    try {
      const workspaceDir = this.getWorkspaceDirectory()

      // Step 1: Initiate OAuth authorization
      const auth = await this.httpClient.oauthAuthorize("nova", 0, workspaceDir)
      console.log("[Nova New] NovaProvider: üîê Got auth URL:", auth.url)

      // Parse code from instructions (format: "Open URL and enter code: ABCD-1234")
      const codeMatch = auth.instructions?.match(/code:\s*(\S+)/i)
      const code = codeMatch ? codeMatch[1] : undefined

      // Step 2: Open browser for user to authorize
      vscode.env.openExternal(vscode.Uri.parse(auth.url))

      // Send device auth details to webview
      this.postMessage({
        type: "deviceAuthStarted",
        code,
        verificationUrl: auth.url,
        expiresIn: 900, // 15 minutes default
      })

      // Step 3: Wait for callback (blocks until polling completes)
      await this.httpClient.oauthCallback("nova", 0, workspaceDir)

      // Check if this attempt was cancelled
      if (attempt !== this.loginAttempt) {
        return
      }

      console.log("[Nova New] NovaProvider: üîê Login successful")

      // Step 4: Fetch profile and push to webview
      const profileData = await this.httpClient.getProfile()
      this.postMessage({ type: "profileData", data: profileData })
      this.postMessage({ type: "deviceAuthComplete" })

      // Step 5: If user has organizations, navigate to profile view so they can pick one
      if (profileData?.profile.organizations && profileData.profile.organizations.length > 0) {
        this.postMessage({ type: "navigate", view: "profile" })
      }
    } catch (error) {
      if (attempt !== this.loginAttempt) {
        return
      }
      this.postMessage({
        type: "deviceAuthFailed",
        error: error instanceof Error ? error.message : "Login failed",
      })
    }
  }

  /**
   * Handle organization switch request from the webview.
   * Persists the selection and refreshes profile + providers since both change with org context.
   */
  private async handleSetOrganization(organizationId: string | null): Promise<void> {
    const client = this.httpClient
    if (!client) {
      return
    }

    console.log("[Nova New] NovaProvider: Switching organization:", organizationId ?? "personal")
    try {
      await client.setOrganization(organizationId)
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to switch organization:", error)
      // Re-fetch current profile to reset webview state (clears switching indicator)
      const profileData = await client.getProfile()
      this.postMessage({ type: "profileData", data: profileData })
      return
    }

    // Org switch succeeded ‚Ä?refresh profile and providers independently (best-effort)
    try {
      const profileData = await client.getProfile()
      this.postMessage({ type: "profileData", data: profileData })
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to refresh profile after org switch:", error)
    }
    try {
      await this.fetchAndSendProviders()
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to refresh providers after org switch:", error)
    }
  }

  /**
   * Handle openFile request from the webview ‚Ä?open a file in the VS Code editor.
   */
  private handleOpenFile(filePath: string, line?: number, column?: number): void {
    const absolute = /^(?:\/|[a-zA-Z]:[\\/])/.test(filePath)
    const uri = absolute
      ? vscode.Uri.file(filePath)
      : vscode.Uri.joinPath(vscode.Uri.file(this.getWorkspaceDirectory()), filePath)
    vscode.workspace.openTextDocument(uri).then(
      (doc) => {
        const options: vscode.TextDocumentShowOptions = { preview: true }
        if (line !== undefined && line > 0) {
          const col = column !== undefined && column > 0 ? column - 1 : 0
          const pos = new vscode.Position(line - 1, col)
          options.selection = new vscode.Range(pos, pos)
        }
        vscode.window.showTextDocument(doc, options)
      },
      (err) => console.error("[Nova New] NovaProvider: Failed to open file:", uri.fsPath, err),
    )
  }

  /**
   * Handle logout request from the webview.
   */
  private async handleLogout(): Promise<void> {
    if (!this.httpClient) {
      return
    }

    console.log("[Nova New] NovaProvider: üö™ Logging out...")
    await this.httpClient.removeAuth("nova")
    console.log("[Nova New] NovaProvider: üö™ Logged out successfully")
    this.postMessage({
      type: "profileData",
      data: null,
    })
  }

  /**
   * Handle profile refresh request from the webview.
   */
  private async handleRefreshProfile(): Promise<void> {
    if (!this.httpClient) {
      return
    }

    console.log("[Nova New] NovaProvider: üîÑ Refreshing profile...")
    const profileData = await this.httpClient.getProfile()
    this.postMessage({
      type: "profileData",
      data: profileData,
    })
  }

  /**
   * Handle a generic setting update from the webview.
   * The key uses dot notation relative to `vcp-code.new` (e.g. "browserAutomation.enabled").
   */
  private async handleUpdateSetting(key: string, value: unknown): Promise<void> {
    const { section, leaf } = buildSettingPath(key)
    const config = vscode.workspace.getConfiguration(`vcp-code.new${section ? `.${section}` : ""}`)
    await config.update(leaf, value, vscode.ConfigurationTarget.Global)
  }

  /**
   * Reset all "vcp-code.new.*" extension settings to their defaults by reading
   * contributes.configuration from the extension's package.json at runtime.
   * Only resets settings under the "vcp-code.new." namespace to avoid touching
   * settings from the previous version of the extension which shares the same
   * extension ID and "vcp-code.*" namespace.
   */
  // novacode_change start
  private async handleResetAllSettings(): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      "Reset all VCP Code 2.0 extension settings to defaults?",
      { modal: true },
      "Reset",
    )
    if (confirmed !== "Reset") return

    const prefix = "vcp-code.new."
    const ext = vscode.extensions.getExtension("vcpcode.vcp-code")
    const properties = ext?.packageJSON?.contributes?.configuration?.properties as Record<string, unknown> | undefined
    if (!properties) return

    for (const key of Object.keys(properties)) {
      if (!key.startsWith(prefix)) continue
      const parts = key.split(".")
      const section = parts.slice(0, -1).join(".")
      const leaf = parts[parts.length - 1]
      const config = vscode.workspace.getConfiguration(section)
      await config.update(leaf, undefined, vscode.ConfigurationTarget.Global)
    }

    // Re-send all settings to the webview so the UI reflects the reset
    this.sendAutocompleteSettings()
    this.sendBrowserSettings()
    this.sendNotificationSettings()
  }
  // novacode_change end

  /**
   * Read the current browser automation settings and push them to the webview.
   */
  private sendBrowserSettings(): void {
    const config = vscode.workspace.getConfiguration("vcp-code.new.browserAutomation")
    this.postMessage({
      type: "browserSettingsLoaded",
      settings: {
        enabled: config.get<boolean>("enabled", false),
        useSystemChrome: config.get<boolean>("useSystemChrome", true),
        headless: config.get<boolean>("headless", false),
      },
    })
  }

  /**
   * Extract sessionID from an SSE event, if applicable.
   * Returns undefined for global events (server.connected, server.heartbeat).
   */
  private extractSessionID(event: SSEEvent): string | undefined {
    return this.connectionService.resolveEventSessionId(event)
  }

  /**
   * Handle SSE events from the CLI backend.
   * Filters events by tracked session IDs so each webview only sees its own sessions.
   */
  private handleSSEEvent(event: SSEEvent): void {
    // Extract sessionID from the event
    const sessionID = this.extractSessionID(event)

    // Events without sessionID (server.connected, server.heartbeat) ‚Ü?always forward
    // Events with sessionID ‚Ü?only forward if this webview tracks that session
    // message.part.updated is always session-scoped; if we can't determine the session, drop it to avoid cross-webview leakage.
    if (!sessionID && event.type === "message.part.updated") {
      return
    }
    if (sessionID && !this.trackedSessionIds.has(sessionID)) {
      return
    }

    // Forward relevant events to webview
    // Side effects that must happen before the webview message is sent
    if (event.type === "session.status") {
      this.sessionStatus.set(event.properties.sessionID, event.properties.status.type)
      if (event.properties.status.type === "idle") {
        void this.flushPromptQueue(event.properties.sessionID)
      }
      this.sendVcpStatusUpdate(event.properties.sessionID)
    }
    if (event.type === "permission.asked") {
      this.incrementPending(this.pendingPermission, event.properties.sessionID)
    }
    if (event.type === "permission.replied") {
      this.decrementPending(this.pendingPermission, event.properties.sessionID)
      if (this.sessionStatus.get(event.properties.sessionID) === "idle") {
        void this.flushPromptQueue(event.properties.sessionID)
      }
    }
    if (event.type === "question.asked") {
      this.incrementPending(this.pendingQuestion, event.properties.sessionID)
    }
    if (event.type === "question.replied" || event.type === "question.rejected") {
      this.decrementPending(this.pendingQuestion, event.properties.sessionID)
      if (this.sessionStatus.get(event.properties.sessionID) === "idle") {
        void this.flushPromptQueue(event.properties.sessionID)
      }
    }
    if (event.type === "session.created" && !this.currentSession) {
      this.currentSession = event.properties.info
      this.trackedSessionIds.add(event.properties.info.id)
    }
    if (event.type === "session.updated" && this.currentSession?.id === event.properties.info.id) {
      this.currentSession = event.properties.info
    }
    if (event.type === "message.updated" && event.properties.info.role === "assistant") {
      this.upsertAssistantMessageTokens(
        event.properties.info.id,
        event.properties.info.sessionID,
        event.properties.info.tokens,
      )
      this.sendVcpStatusUpdate(event.properties.info.sessionID)
    }
    if (event.type === "session.vcpinfo" && this.shouldNotifyAgentEvents()) {
      void vscode.window.showInformationMessage(`VCPInfo: ${this.summarizeNotificationText(event.properties.content)}`)
    }
    if (event.type === "session.vcp.toolrequest" && this.shouldNotifyAgentEvents()) {
      const tool = this.summarizeNotificationText(event.properties.tool, 64)
      void vscode.window.showInformationMessage(`VCP Tool Request: ${tool}`)
    }
    if (event.type === "session.vcp.toolrequest.result" && this.shouldNotifyAgentEvents()) {
      const resolved = this.summarizeNotificationText(event.properties.resolvedTool ?? event.properties.tool, 64)
      if (event.properties.status === "completed") {
        void vscode.window.showInformationMessage(`VCP Tool Result: ${resolved} completed`)
      } else if (event.properties.status === "error") {
        const reason = this.summarizeNotificationText(event.properties.error ?? "unknown error", 96)
        void vscode.window.showWarningMessage(`VCP Tool Result: ${resolved} failed (${reason})`)
      } else {
        const reason = this.summarizeNotificationText(event.properties.error ?? "skipped", 96)
        void vscode.window.showInformationMessage(`VCP Tool Result: ${resolved} skipped (${reason})`)
      }
    }
    if (event.type === "session.vcp.memory.refresh" && this.shouldNotifyAgentEvents()) {
      const resolved = this.summarizeNotificationText(event.properties.resolvedTool ?? event.properties.tool, 64)
      const profileWeight = event.properties.profileWeight.toFixed(2)
      const folderWeight = event.properties.folderWeight.toFixed(2)
      void vscode.window.showInformationMessage(
        `VCP Memory Refresh: ${resolved} (${event.properties.status}) [p=${profileWeight}, f=${folderWeight}]`,
      )
    }

    const msg = mapSSEEventToWebviewMessage(event, sessionID)
    if (msg) {
      this.postMessage(msg)
    }
  }

  private async handleRequestMemoryOverview(requestID: string, limit?: number, folderID?: string): Promise<void> {
    if (!this.httpClient) return
    try {
      const data = await this.httpClient.getMemoryOverview({ limit, folderID })
      this.postMessage({ type: "memoryOverview", requestID, data })
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to load memory overview:", error)
      this.postMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to load memory overview" })
    }
  }

  private async handleSearchMemory(
    requestID: string,
    input: {
      query: string
      topK?: number
      scope?: "user" | "folder" | "both"
      folderID?: string
      tagsAny?: string[]
      timeFrom?: string | number
      timeTo?: string | number
    },
  ): Promise<void> {
    if (!this.httpClient) return
    try {
      const items = await this.httpClient.searchMemory(input)
      this.postMessage({ type: "memorySearchResult", requestID, items })
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to search memory:", error)
      this.postMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to search memory" })
    }
  }

  private async handleUpdateMemoryAtomic(
    requestID: string,
    id: string,
    patch: {
      text?: string
      tags?: string[]
      scope?: "user" | "folder"
      folderID?: string
    },
  ): Promise<void> {
    if (!this.httpClient) return
    try {
      const result = await this.httpClient.updateMemoryAtomic(id, patch)
      this.postMessage({ type: "memoryAtomicUpdated", requestID, ...result })
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to update memory:", error)
      this.postMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to update memory" })
    }
  }

  private async handleDeleteMemoryAtomic(requestID: string, id: string): Promise<void> {
    if (!this.httpClient) return
    try {
      const result = await this.httpClient.deleteMemoryAtomic(id)
      this.postMessage({ type: "memoryAtomicDeleted", requestID, ...result })
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to delete memory:", error)
      this.postMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to delete memory" })
    }
  }

  private async handlePreviewMemoryContext(
    requestID: string,
    query: string,
    directory?: string,
    topKAtomic?: number,
    maxChars?: number,
    removeAtomicIDs?: string[],
    pinAtomicIDs?: string[],
    compress?: boolean,
  ): Promise<void> {
    if (!this.httpClient) return
    try {
      const workspaceDir = directory || this.getWorkspaceDirectory()
      const result = await this.httpClient.previewMemoryContext({
        query,
        directory: workspaceDir,
        topKAtomic,
        maxChars,
        removeAtomicIDs,
        pinAtomicIDs,
        compress,
      })
      this.postMessage({ type: "memoryContextPreview", requestID, preview: result.preview })
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to preview memory context:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to preview memory context",
      })
    }
  }

  public async exportGlobalConfig(): Promise<void> {
    if (!this.httpClient) {
      void vscode.window.showErrorMessage("Not connected to CLI backend.")
      return
    }

    try {
      const directory = this.getWorkspaceDirectory()
      const config = await this.httpClient.getConfig(directory)
      const target = await vscode.window.showSaveDialog({
        title: "Export VCP Code Config",
        filters: { JSON: ["json"] },
        saveLabel: "Export",
        defaultUri: vscode.Uri.file(path.join(directory, "vcp-code.config.json")),
      })
      if (!target) return
      await fs.writeFile(target.fsPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
      void vscode.window.showInformationMessage(`Config exported to ${target.fsPath}`)
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to export config:", error)
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : "Failed to export config")
    }
  }

  public async importGlobalConfig(): Promise<void> {
    if (!this.httpClient) {
      void vscode.window.showErrorMessage("Not connected to CLI backend.")
      return
    }

    try {
      const picked = await vscode.window.showOpenDialog({
        title: "Import VCP Code Config",
        canSelectMany: false,
        filters: { JSON: ["json"] },
      })
      const file = picked?.[0]
      if (!file) return

      const raw = await fs.readFile(file.fsPath, "utf8")
      const parsed = JSON.parse(raw) as Partial<Config>
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Invalid config JSON: expected an object.")
      }

      await this.httpClient.updateConfig(parsed)
      await this.fetchAndSendConfig()
      void vscode.window.showInformationMessage(`Config imported from ${file.fsPath}`)
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to import config:", error)
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : "Failed to import config")
    }
  }

  private sendPromptQueue(sessionID: string): void {
    this.postMessage({
      type: "promptQueueUpdated",
      sessionID,
      items: this.promptQueue.get(sessionID) ?? [],
    })
  }

  private incrementPending(map: Map<string, number>, sessionID: string): void {
    map.set(sessionID, (map.get(sessionID) ?? 0) + 1)
  }

  private decrementPending(map: Map<string, number>, sessionID: string): void {
    const current = map.get(sessionID) ?? 0
    if (current <= 1) {
      map.delete(sessionID)
      return
    }
    map.set(sessionID, current - 1)
  }

  private isPromptQueuePaused(sessionID: string): boolean {
    return (this.pendingPermission.get(sessionID) ?? 0) > 0 || (this.pendingQuestion.get(sessionID) ?? 0) > 0
  }

  private enqueuePrompt(
    sessionID: string,
    item: {
      text: string
      files?: Array<{ mime: string; url: string }>
      policy: "guide" | "queue" | "interrupt"
      priority?: number
      providerID?: string
      modelID?: string
      agent?: string
      variant?: string
    },
  ): void {
    const current = this.promptQueue.get(sessionID) ?? []
    const next = [
      ...current,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: item.text,
        files: item.files,
        policy: item.policy,
        priority: item.priority ?? 0,
        createdAt: new Date().toISOString(),
        providerID: item.providerID,
        modelID: item.modelID,
        agent: item.agent,
        variant: item.variant,
      },
    ]
    this.promptQueue.set(sessionID, next)
    this.sendPromptQueue(sessionID)
  }

  private dequeuePrompt(sessionID: string, itemID?: string): void {
    const current = this.promptQueue.get(sessionID) ?? []
    if (current.length === 0) {
      this.sendPromptQueue(sessionID)
      return
    }
    const next = itemID ? current.filter((item) => item.id !== itemID) : current.slice(1)
    this.promptQueue.set(sessionID, next)
    this.sendPromptQueue(sessionID)
  }

  private reorderPromptQueue(sessionID: string, itemIDs: string[]): void {
    const current = this.promptQueue.get(sessionID) ?? []
    const byId = new Map(current.map((item) => [item.id, item]))
    const ordered = itemIDs.map((id) => byId.get(id)).filter((item) => !!item)
    const missing = current.filter((item) => !itemIDs.includes(item.id))
    this.promptQueue.set(sessionID, [...ordered, ...missing])
    this.sendPromptQueue(sessionID)
  }

  private async flushPromptQueue(sessionID: string): Promise<void> {
    if (this.sessionStatus.get(sessionID) === "busy") return
    if (this.isPromptQueuePaused(sessionID)) return
    const queue = this.promptQueue.get(sessionID) ?? []
    const item = queue[0]
    if (!item) return
    this.dequeuePrompt(sessionID, item.id)
    await this.handleSendMessage(
      item.text,
      sessionID,
      item.providerID,
      item.modelID,
      item.agent,
      item.variant,
      item.files,
      "guide",
    )
  }

  /**
   * Read autocomplete settings from VS Code configuration and push to the webview.
   */
  private sendAutocompleteSettings(): void {
    const config = vscode.workspace.getConfiguration("vcp-code.new.autocomplete")
    this.postMessage({
      type: "autocompleteSettingsLoaded",
      settings: {
        enableAutoTrigger: config.get<boolean>("enableAutoTrigger", true),
        enableSmartInlineTaskKeybinding: config.get<boolean>("enableSmartInlineTaskKeybinding", false),
        enableChatAutocomplete: config.get<boolean>("enableChatAutocomplete", false),
      },
    })
  }

  /**
   * Post a message to the webview.
   * Public so toolbar button commands can send messages.
   */
  public postMessage(message: unknown): void {
    if (!this.webview) {
      const type =
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        typeof (message as { type?: unknown }).type === "string"
          ? (message as { type: string }).type
          : "<unknown>"
      console.warn("[Nova New] NovaProvider: ‚ö†Ô∏è postMessage dropped (no webview)", { type })
      return
    }

    void this.webview.postMessage(message).then(undefined, (error) => {
      console.error("[Nova New] NovaProvider: ‚ù?postMessage failed", error)
    })
  }

  /**
   * Gather VS Code editor context to send alongside messages to the CLI backend.
   */
  /**
   * Get or create a FileIgnoreController for the current workspace directory.
   * Reinitializes if the workspace directory has changed.
   */
  private async getIgnoreController(workspaceDir: string): Promise<FileIgnoreController> {
    if (this.ignoreController && this.ignoreControllerDir === workspaceDir) {
      return this.ignoreController
    }
    const controller = new FileIgnoreController(workspaceDir)
    await controller.initialize()
    this.ignoreController = controller
    this.ignoreControllerDir = workspaceDir
    return controller
  }

  private async gatherEditorContext(): Promise<EditorContext> {
    const workspaceDir = this.getWorkspaceDirectory()
    const controller = await this.getIgnoreController(workspaceDir)

    const toRelative = (fsPath: string): string | undefined => {
      if (!workspaceDir) {
        return undefined
      }
      const relative = path.relative(workspaceDir, fsPath)
      if (relative.startsWith("..")) {
        return undefined
      }
      return relative
    }

    // Visible files (capped to avoid bloating context, filtered through .novacodeignore)
    const visibleFiles = vscode.window.visibleTextEditors
      .map((e) => e.document.uri)
      .filter((uri) => uri.scheme === "file")
      .map((uri) => toRelative(uri.fsPath))
      .filter((p): p is string => p !== undefined && controller.validateAccess(path.resolve(workspaceDir, p)))
      .slice(0, 200)

    // Open tabs ‚Ä?use instanceof TabInputText to exclude notebooks, diffs, custom editors
    const openTabSet = new Set<string>()
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          const uri = tab.input.uri
          if (uri.scheme === "file") {
            const rel = toRelative(uri.fsPath)
            if (rel && controller.validateAccess(uri.fsPath)) {
              openTabSet.add(rel)
            }
          }
        }
      }
    }
    const openTabs = [...openTabSet].slice(0, 20)

    // Active file (also filtered through .novacodeignore)
    const activeEditor = vscode.window.activeTextEditor
    const activeRel =
      activeEditor?.document.uri.scheme === "file" ? toRelative(activeEditor.document.uri.fsPath) : undefined
    const activeFile =
      activeRel && controller.validateAccess(activeEditor!.document.uri.fsPath) ? activeRel : undefined

    // Shell
    const shell = vscode.env.shell || undefined

    // Timezone
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined

    return {
      ...(visibleFiles.length > 0 ? { visibleFiles } : {}),
      ...(openTabs.length > 0 ? { openTabs } : {}),
      ...(activeFile ? { activeFile } : {}),
      ...(shell ? { shell } : {}),
      ...(timezone ? { timezone } : {}),
    }
  }

  /**
   * Get the workspace directory for a session.
   * Checks session directory overrides first (e.g., worktree paths), then falls back to workspace root.
   */
  private getWorkspaceDirectory(sessionId?: string): string {
    if (sessionId) {
      const dir = this.sessionDirectories.get(sessionId)
      if (dir) return dir
    }
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders && workspaceFolders.length > 0) {
      return workspaceFolders[0].uri.fsPath
    }
    return process.cwd()
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      title: "VCP Code 2.0",
      port: this.connectionService.getServerInfo()?.port,
      extraStyles: `.container { height: 100%; display: flex; flex-direction: column; height: 100vh; }`,
    })
  }

  /**
   * Dispose of the provider and clean up subscriptions.
   * Does NOT kill the server ‚Ä?that's the connection service's job.
   */
  dispose(): void {
    this.unsubscribeEvent?.()
    this.unsubscribeState?.()
    this.unsubscribeNotificationDismiss?.()
    this.webviewMessageDisposable?.dispose()
    this.trackedSessionIds.clear()
    this.sessionDirectories.clear()
    this.ignoreController?.dispose()
    this.sessionTokenTotals.clear()
    this.assistantMessageTokens.clear()
    this.sessionModelSelection.clear()
    this.sessionAgentSelection.clear()
  }
}
