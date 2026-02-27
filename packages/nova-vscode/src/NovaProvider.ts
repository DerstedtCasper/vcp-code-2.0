import * as path from "path"
import { promises as fs } from "fs"
import * as os from "os"
import { spawn } from "child_process"
import * as vscode from "vscode"
import { z } from "zod"
import { parse as parseYAML } from "yaml"
import {
  ConfigConflictError,
  type SessionInfo,
  type SSEEvent,
  type NovaConnectionService,
  type NovacodeNotification,
  type SkillInfo,
  type PermissionRequest,
} from "./services/cli-backend"
import type { Config, EditorContext } from "./services/cli-backend/types"
import { FileIgnoreController } from "./services/autocomplete/shims/FileIgnoreController"
import { handleChatCompletionRequest } from "./services/autocomplete/chat-autocomplete/handleChatCompletionRequest"
import { handleChatCompletionAccepted } from "./services/autocomplete/chat-autocomplete/handleChatCompletionAccepted"
import { RuntimeClientFactory } from "./services/runtime"
import type { RuntimeClient } from "./services/runtime"
import { computeConfigHash, mergeConfigMigrationSources } from "./services/config-ssot-utils"
import { buildWebviewHtml } from "./utils"
import { TelemetryProxy, type TelemetryPropertiesProvider } from "./services/telemetry"
import { sessionToWebview, normalizeProviders, filterVisibleAgents, buildSettingPath, mapSSEEventToWebviewMessage } from "./nova-provider-utils"

type RuntimeMode = "embedded" | "legacy"
type YoloRoute = "approve" | "escalate_to_human"
type YoloSource = "small_model" | "heuristic"

interface YoloSettings {
  enabled: boolean
  useSmallModel: boolean
  autoApproveReadOnly: boolean
  confidenceThreshold: number
}

interface YoloDecision {
  route: YoloRoute
  confidence: number
  reason: string
  source: YoloSource
}

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
  /** Queue view actions posted before webviewReady to avoid losing sidebar clicks. */
  private pendingViewActions: unknown[] = []
  /** Runtime cache for codebase indexing status shown in webview settings/chat quick entry. */
  private codebaseIndexState: {
    status: "idle" | "indexing" | "error"
    indexedFiles: number
    totalFiles: number
    lastUpdated?: string
  } = { status: "idle", indexedFiles: 0, totalFiles: 0 }

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

  // 鈹€鈹€ VCP Bridge WebSocket (connects to VCPToolBox) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  private vcpLogWs: WebSocket | null = null
  private vcpInfoWs: WebSocket | null = null
  private vcpBridgeReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private vcpBridgeConnected = false

  /** Optional interceptor called before the standard message handler.
   *  Return null to consume the message, or return a (possibly transformed) message. */
  private onBeforeMessage: ((msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>) | null = null

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: NovaConnectionService,
    private readonly extensionContext?: vscode.ExtensionContext,
    private readonly runtimeClientFactory: RuntimeClientFactory = new RuntimeClientFactory(connectionService),
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

  private getRuntimeMode(): RuntimeMode {
    return this.runtimeClientFactory.getRuntimeMode()
  }

  private isEmbeddedRuntimeEnabled(): boolean {
    return this.getRuntimeMode() === "embedded"
  }

  private async getRuntimeClientOrNull(reason: string, sessionID?: string): Promise<RuntimeClient | null> {
    const mode = this.getRuntimeMode()
    const workspaceDir = this.getWorkspaceDirectory(sessionID || this.currentSession?.id)

    if (mode === "embedded") {
      this.postMessage({ type: "runtimeStateChanged", mode, state: "initializing", reason })
    }

    try {
      const runtime = await this.runtimeClientFactory.getRuntimeClient({ reason, workspaceDir, mode })
      if (runtime && mode === "embedded") {
        this.postMessage({ type: "runtimeStateChanged", mode, state: "ready", reason })
      }
      return runtime
    } catch (error) {
      if (mode === "embedded") {
        this.postMessage({
          type: "runtimeStateChanged",
          mode,
          state: "error",
          reason,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      return null
    }
  }

  private async requireRuntimeClient(errorMessage: string, sessionID?: string): Promise<RuntimeClient | null> {
    const runtime = await this.getRuntimeClientOrNull(errorMessage, sessionID)
    if (!runtime) {
      this.postMessage({
        type: "error",
        message: errorMessage,
        ...(sessionID ? { sessionID } : {}),
      })
      return null
    }
    return runtime
  }

  private getYoloSettings(): YoloSettings {
    const config = vscode.workspace.getConfiguration("vcp-code.new.yolo")
    const rawThreshold = config.get<number>("confidenceThreshold", 0.82)
    const boundedThreshold = Number.isFinite(rawThreshold) ? Math.min(0.99, Math.max(0.5, rawThreshold)) : 0.82
    return {
      enabled: config.get<boolean>("enabled", false),
      useSmallModel: config.get<boolean>("useSmallModel", false),
      autoApproveReadOnly: config.get<boolean>("autoApproveReadOnly", true),
      confidenceThreshold: boundedThreshold,
    }
  }

  private isHighRiskPermission(permission: string): boolean {
    const highRisk = new Set([
      "bash",
      "edit",
      "patch",
      "write",
      "task",
      "external_directory",
      "mcp",
      "mcp_connect",
      "mcp_disconnect",
      "run_terminal_command",
    ])
    return highRisk.has(permission)
  }

  private hasDangerousPattern(input: string): boolean {
    return /(rm\s+-rf|del\s+\/f|drop\s+table|truncate|sudo|chmod|chown|git\s+push|npm\s+publish|prod\b|production)/i.test(
      input,
    )
  }

  private parseYoloModelDecision(raw: string, threshold: number): YoloDecision | null {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return null
    }
    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        route?: string
        confidence?: number
        reason?: string
      }
      const route = parsed.route === "approve" ? "approve" : "escalate_to_human"
      const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0
      const reason = typeof parsed.reason === "string" ? parsed.reason : "small model decision"
      if (route === "approve" && confidence < threshold) {
        return {
          route: "escalate_to_human",
          confidence,
          reason: `low confidence (${confidence.toFixed(2)} < ${threshold.toFixed(2)})`,
          source: "small_model",
        }
      }
      return {
        route,
        confidence,
        reason,
        source: "small_model",
      }
    } catch {
      return null
    }
  }

  private async evaluateYoloDecision(request: PermissionRequest, settings: YoloSettings): Promise<YoloDecision> {
    const permission = request.permission.toLowerCase()
    const patternsText = (request.patterns ?? []).join(" ")
    const metadataText = JSON.stringify(request.metadata ?? {})
    const combined = `${patternsText} ${metadataText}`
    const readOnlyPermissions = new Set(["read", "glob", "grep", "webfetch", "websearch", "codesearch", "todoread"])

    const heuristicDecision = (): YoloDecision => {
      if (this.isHighRiskPermission(permission) || this.hasDangerousPattern(combined)) {
        return {
          route: "escalate_to_human",
          confidence: 0.95,
          reason: "high-risk permission or pattern",
          source: "heuristic",
        }
      }
      if (settings.autoApproveReadOnly && readOnlyPermissions.has(permission)) {
        return {
          route: "approve",
          confidence: 0.9,
          reason: "read-only permission",
          source: "heuristic",
        }
      }
      return {
        route: "escalate_to_human",
        confidence: 0.7,
        reason: "permission not in auto-approve scope",
        source: "heuristic",
      }
    }

    if (!settings.useSmallModel) {
      return heuristicDecision()
    }

    const runtime = await this.getRuntimeClientOrNull("yolo.small-model", request.sessionID)
    if (!runtime) {
      return heuristicDecision()
    }

    try {
      const system = [
        "You are a strict permission router.",
        "Return JSON only with keys: route, confidence, reason.",
        "route must be either 'approve' or 'escalate_to_human'.",
        "Never approve destructive or production-impact operations.",
      ].join(" ")
      const user = JSON.stringify({
        permission: request.permission,
        patterns: request.patterns ?? [],
        metadata: request.metadata ?? {},
        threshold: settings.confidenceThreshold,
      })
      const raw = await runtime.complete(
        {
          system,
          messages: [{ role: "user", content: user }],
        },
        this.getWorkspaceDirectory(request.sessionID),
      )
      if (!raw) {
        return heuristicDecision()
      }
      const parsed = this.parseYoloModelDecision(raw, settings.confidenceThreshold)
      return parsed ?? heuristicDecision()
    } catch (error) {
      console.warn("[Nova New] NovaProvider: yolo small-model evaluation failed, fallback to heuristic:", error)
      return heuristicDecision()
    }
  }

  private async maybeHandleYoloAutoApproval(request: PermissionRequest): Promise<boolean> {
    const settings = this.getYoloSettings()
    if (!settings.enabled) {
      return false
    }

    const decision = await this.evaluateYoloDecision(request, settings)
    this.postMessage({
      type: "yoloDecisionMade",
      requestID: request.id,
      sessionID: request.sessionID,
      permission: request.permission,
      route: decision.route,
      confidence: decision.confidence,
      reason: decision.reason,
      source: decision.source,
    })

    if (decision.route !== "approve") {
      return false
    }

    const runtime = await this.getRuntimeClientOrNull("yolo.auto-approve", request.sessionID)
    if (!runtime) {
      return false
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(request.sessionID)
      await runtime.respondToPermission(request.sessionID, request.id, "once", workspaceDir)
      this.decrementPending(this.pendingPermission, request.sessionID)
      if (this.sessionStatus.get(request.sessionID) === "idle") {
        void this.flushPromptQueue(request.sessionID)
      }
      return true
    } catch (error) {
      console.error("[Nova New] NovaProvider: yolo auto-approve failed:", error)
      return false
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
    console.log("[Nova New] NovaProvider: 馃攧 syncWebviewState()", {
      reason,
      isWebviewReady: this.isWebviewReady,
      connectionState: this.connectionState,
      hasServerInfo: !!serverInfo,
    })

    if (!this.isWebviewReady) {
      console.log("[Nova New] NovaProvider: 鈴笍 syncWebviewState skipped (webview not ready)")
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
        workspaceDirectory: this.getWorkspaceDirectory(),
      })
    }

    // Always attempt to fetch+push profile when connected.
    const runtime = await this.getRuntimeClientOrNull(`sync webview state: ${reason}`, this.currentSession?.id)
    if (this.connectionState === "connected" && runtime) {
      console.log("[Nova New] NovaProvider: 馃懁 syncWebviewState fetching profile...")
      try {
        const profileData = await runtime.getProfile()
        console.log("[Nova New] NovaProvider: 馃懁 syncWebviewState profile:", profileData ? "received" : "null")
        this.postMessage({
          type: "profileData",
          data: profileData,
        })
      } catch (error) {
        console.error("[Nova New] NovaProvider:  - syncWebviewState failed to fetch profile:", error)
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
          console.log("[Nova New] NovaProvider:  - webviewReady received")
          this.isWebviewReady = true
          await this.syncWebviewState("webviewReady")
          this.flushPendingViewActions()
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
        case "requestCodebaseIndexStatus":
          await this.handleRequestCodebaseIndexStatus()
          break
        case "reindexCodebase":
          await this.handleReindexCodebase()
          break
        case "clearCodebaseIndex":
          this.handleClearCodebaseIndex()
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
          const runtime = await this.getRuntimeClientOrNull("file search", this.currentSession?.id)
          if (runtime) {
            const dir = this.getWorkspaceDirectory(this.currentSession?.id)
            void runtime
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
        // 鈹€鈹€ Kilo-style: extension host fetches models directly (no backend proxy needed) 鈹€鈹€
        case "requestOpenAiModels": {
          void this.handleRequestOpenAiModels(message.baseUrl, message.apiKey, message.requestId)
          break
        }
        case "testProviderConnection": {
          void this.handleTestProviderConnection(message.baseUrl, message.apiKey, message.requestId)
          break
        }
        // 鈹€鈹€ Kilo-style: extension host fetches marketplace YAML directly 鈹€鈹€
        case "requestMarketplace": {
          void this.handleRequestMarketplace(message.category, message.requestId)
          break
        }
        // 鈹€鈹€ Marketplace proxy: list items, install, installed, refresh 鈹€鈹€
        case "requestMarketplaceList": {
          void this.handleMarketplaceListDirect(message.tab ?? "skills", message.query, message.requestId)
          break
        }
        case "requestMarketplaceInstalled": {
          void this.handleMarketplaceInstalledDirect(message.requestId)
          break
        }
        case "requestMarketplaceRefresh": {
          void this.handleMarketplaceRefreshDirect(message.requestId)
          break
        }
        case "requestMarketplaceInstall": {
          void this.handleMarketplaceInstall(message.body, message.requestId)
          break
        }
        // 鈹€鈹€ VCP Bridge WebSocket 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        case "requestVcpBridgeConnect": {
          void this.connectVcpBridge()
          break
        }
        case "requestVcpBridgeDisconnect": {
          this.disconnectVcpBridge()
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
    console.log("[Nova New] NovaProvider: 馃敡 Starting initializeConnection...")
    this.postMessage({
      type: "runtimeStateChanged",
      mode: this.getRuntimeMode(),
      state: "initializing",
      reason: "initializeConnection",
    })

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
          void this.handleSSEEvent(event)
        },
      )

      // Subscribe to connection state changes
      this.unsubscribeState = this.connectionService.onStateChange(async (state) => {
        this.connectionState = state
        this.postMessage({ type: "connectionState", state })
        this.sendVcpStatusUpdate()

        if (state === "connected") {
          try {
            const runtime = await this.getRuntimeClientOrNull("connection state: profile sync", this.currentSession?.id)
            if (runtime) {
              const profileData = await runtime.getProfile()
              this.postMessage({ type: "profileData", data: profileData })
            }
            await this.syncWebviewState("sse-connected")
          } catch (error) {
            console.error("[Nova New] NovaProvider:  - Failed during connected state handling:", error)
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
          workspaceDirectory: this.getWorkspaceDirectory(),
        })
      }

      this.postMessage({ type: "connectionState", state: this.connectionState })
      this.sendVcpStatusUpdate()
      await this.syncWebviewState("initializeConnection")

      {
        const runtime = await this.getRuntimeClientOrNull("legacy config migration", this.currentSession?.id)
        if (runtime) {
          await this.runLegacyConfigMigration(runtime)
        }
      }

      // Fetch providers and agents, then send to webview
      await this.fetchAndSendProviders()
      await this.fetchAndSendAgents()
      await this.fetchAndSendConfig()
      await this.fetchAndSendSkills()
      await this.fetchAndSendNotifications()
      this.sendNotificationSettings()

      console.log("[Nova New] NovaProvider:  - initializeConnection completed successfully")
      this.postMessage({
        type: "runtimeStateChanged",
        mode: this.getRuntimeMode(),
        state: "ready",
        reason: "initializeConnection",
      })
    } catch (error) {
      console.error("[Nova New] NovaProvider:  - Failed to initialize connection:", error)
      this.connectionState = "error"
      this.postMessage({
        type: "connectionState",
        state: "error",
        error: error instanceof Error ? error.message : "Failed to connect to CLI backend",
      })
      this.sendVcpStatusUpdate()
      this.postMessage({
        type: "runtimeStateChanged",
        mode: this.getRuntimeMode(),
        state: "error",
        reason: "initializeConnection",
        error: error instanceof Error ? error.message : "Failed to connect runtime",
      })
    }
  }

  private sessionToWebview(session: SessionInfo) {
    return sessionToWebview(session)
  }

  /**
   * Handle creating a new session.
   */
  private async handleCreateSession(): Promise<void> {
    const runtime = await this.requireRuntimeClient("Unable to connect embedded runtime for creating session")
    if (!runtime) {
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const session = await runtime.createSession(workspaceDir)
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

    const runtime = await this.requireRuntimeClient("Unable to connect embedded runtime for loading messages", sessionID)
    if (!runtime) {
      return
    }

    // Abort any previous in-flight loadMessages request so the backend
    // isn't overwhelmed when the user switches sessions rapidly.
    this.loadMessagesAbort?.abort()
    const abort = new AbortController()
    this.loadMessagesAbort = abort

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      const messagesData = await runtime.getMessages(sessionID, workspaceDir, abort.signal)

      // If this request was aborted while awaiting, skip posting stale results
      if (abort.signal.aborted) return

      // Update currentSession so fallback logic in handleSendMessage/handleAbort
      // references the correct session after switching to a historical session.
      // Non-blocking: don't let a failure here prevent messages from loading.
      // 404s are expected for cross-worktree sessions  - use silent to suppress HTTP error logs.
      runtime
        .getSession(sessionID, workspaceDir, true)
        .then((session) => {
          if (!this.currentSession || this.currentSession.id === sessionID) {
            this.currentSession = session
          }
        })
        .catch((err) => console.warn("[Nova New] NovaProvider: getSession failed (non-critical):", err))

      // Fetch current session status so the webview has the correct busy/idle
      // state after switching tabs (SSE events may have been missed).
      runtime
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
      // Silently ignore aborted requests  - the user switched to a different session
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
    const runtime = await this.getRuntimeClientOrNull("sync session", sessionID)
    if (!runtime) return
    if (this.trackedSessionIds.has(sessionID)) return

    this.trackedSessionIds.add(sessionID)

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      const messagesData = await runtime.getMessages(sessionID, workspaceDir)

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
    const runtime = await this.requireRuntimeClient("Unable to connect embedded runtime for loading sessions")
    if (!runtime) {
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const sessions = await runtime.listSessions(workspaceDir)

      // Also fetch sessions from worktree directories so they appear in the list
      const worktreeDirs = new Set(this.sessionDirectories.values())
      const extra = await Promise.all(
        [...worktreeDirs].map((dir) =>
            runtime.listSessions(dir).catch((err) => {
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
   * Kilo-style: Extension host directly fetches models from provider API.
   * No backend proxy needed 鈥?avoids "Failed to fetch" when backend isn't running.
   * The extension host has full Node.js network access without CORS restrictions.
   */
  private async handleRequestOpenAiModels(baseUrl?: string, apiKey?: string, requestId?: string): Promise<void> {
    if (!baseUrl) {
      this.postMessage({ type: "openAiModels", openAiModels: [], error: "No base URL provided", requestId })
      return
    }

    const result = await this.fetchOpenAiModels(baseUrl, apiKey)
    this.postMessage({
      type: "openAiModels",
      openAiModels: result.modelIds,
      latencyMs: result.latencyMs,
      error: result.error,
      requestId,
    })
  }

  private async handleTestProviderConnection(baseUrl?: string, apiKey?: string, requestId?: string): Promise<void> {
    if (!baseUrl) {
      this.postMessage({
        type: "providerConnectionTestResult",
        ok: false,
        modelCount: 0,
        error: "No base URL provided",
        requestId,
      })
      return
    }

    const result = await this.fetchOpenAiModels(baseUrl, apiKey)
    this.postMessage({
      type: "providerConnectionTestResult",
      ok: !result.error,
      modelCount: result.modelIds.length,
      latencyMs: result.latencyMs,
      error: result.error,
      requestId,
    })
  }

  private async fetchOpenAiModels(baseUrl: string, apiKey?: string): Promise<{
    modelIds: string[]
    latencyMs: number
    error?: string
  }> {
    const normalized = baseUrl.trim().replace(/\/+$/, "")
    if (!normalized) {
      return { modelIds: [], latencyMs: 0, error: "No base URL provided" }
    }

    const modelsUrl = normalized.endsWith("/models") ? normalized : `${normalized}/models`
    const startTime = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`
      }

      const response = await fetch(modelsUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
      })
      const latencyMs = Date.now() - startTime

      if (!response.ok) {
        const body = await response.text().catch(() => "")
        return {
          modelIds: [],
          latencyMs,
          error: `HTTP ${response.status}: ${body.slice(0, 200)}`,
        }
      }

      const data = (await response.json()) as Record<string, unknown>
      const modelList = (Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : []) as Array<{
        id?: string
      }>
      const modelIds = modelList
        .map((item) => (typeof item === "string" ? item : item?.id))
        .filter((item): item is string => typeof item === "string" && item.length > 0)

      return { modelIds, latencyMs }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        modelIds: [],
        latencyMs: Date.now() - startTime,
        error: msg.includes("aborted") ? "Request timeout (15s)" : msg,
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Kilo-style: Extension host directly fetches marketplace YAML from GitHub.
   * Avoids requiring the backend proxy to be running.
   */
  private async handleRequestMarketplace(category?: string, requestId?: string): Promise<void> {
    const tab = this.normalizeMarketplaceTab(category)
    const result = await this.fetchMarketplaceItems(tab)
    this.postMessage({
      type: "marketplaceData",
      category: tab,
      raw: result.raw,
      items: result.items,
      error: result.error,
      requestId,
    })
  }

  private normalizeMarketplaceTab(tab?: string): "skills" | "modes" | "mcps" {
    if (tab === "modes" || tab === "mcps") return tab
    return "skills"
  }

  private async handleMarketplaceListDirect(tab?: string, query?: string, requestId?: string): Promise<void> {
    const normalizedTab = this.normalizeMarketplaceTab(tab)
    const result = await this.fetchMarketplaceItems(normalizedTab)
    if (result.error) {
      this.postMessage({ type: "marketplaceProxyResult", error: result.error, requestId, tab: normalizedTab })
      return
    }
    const filtered = this.filterMarketplaceItems(normalizedTab, result.items, query)
    this.postMessage({ type: "marketplaceProxyResult", data: filtered, requestId, tab: normalizedTab })
  }

  private async handleMarketplaceInstalledDirect(requestId?: string): Promise<void> {
    const configMsg = this.cachedConfigMessage as { config?: Record<string, unknown> } | null
    const config = configMsg?.config ?? {}
    const mcpRecord =
      config && typeof config.mcp === "object" && config.mcp !== null
        ? (config.mcp as Record<string, unknown>)
        : {}
    const modeRecord =
      config &&
      typeof config.mode === "object" &&
      config.mode !== null &&
      typeof (config.mode as Record<string, unknown>).custom === "object" &&
      (config.mode as Record<string, unknown>).custom !== null
        ? ((config.mode as Record<string, unknown>).custom as Record<string, unknown>)
        : {}

    let skills: string[] = []
    const skillRoot = path.join(this.getWorkspaceDirectory(), ".opencode", "skill")
    try {
      const entries = await fs.readdir(skillRoot, { withFileTypes: true })
      skills = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    } catch {
      skills = []
    }

    this.postMessage({
      type: "marketplaceProxyResult",
      data: {
        skills,
        mcps: Object.keys(mcpRecord),
        modes: Object.keys(modeRecord),
      },
      requestId,
    })
  }

  private handleMarketplaceRefreshDirect(requestId?: string): void {
    this.postMessage({
      type: "marketplaceProxyResult",
      data: { success: true },
      requestId,
    })
  }

  private async fetchMarketplaceItems(tab: "skills" | "modes" | "mcps"): Promise<{
    items: Array<Record<string, unknown>>
    raw?: string
    error?: string
  }> {
    const url = `https://raw.githubusercontent.com/Kilo-Org/kilo-marketplace/main/${tab}/marketplace.yaml`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        return { items: [], error: `HTTP ${response.status}` }
      }

      const raw = await response.text()
      const parsed = parseYAML(raw) as unknown
      const items =
        Array.isArray(parsed) && parsed.every((item) => typeof item === "object" && item !== null)
          ? (parsed as Array<Record<string, unknown>>)
          : Array.isArray((parsed as { items?: unknown[] })?.items)
            ? ((parsed as { items: unknown[] }).items.filter(
                (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
              ) as Array<Record<string, unknown>>)
            : []

      return { items, raw }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        items: [],
        error: msg.includes("aborted") ? "Request timeout (15s)" : msg,
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private filterMarketplaceItems(
    tab: "skills" | "modes" | "mcps",
    items: Array<Record<string, unknown>>,
    query?: string,
  ): Array<Record<string, unknown>> {
    const keyword = query?.trim().toLowerCase()
    if (!keyword) {
      return items
    }
    return items.filter((item) => {
      const id = typeof item.id === "string" ? item.id.toLowerCase() : ""
      const description = typeof item.description === "string" ? item.description.toLowerCase() : ""
      if (id.includes(keyword) || description.includes(keyword)) {
        return true
      }
      if (tab === "skills") {
        const category = typeof item.category === "string" ? item.category.toLowerCase() : ""
        return category.includes(keyword)
      }
      if (tab === "modes") {
        const name = typeof item.name === "string" ? item.name.toLowerCase() : ""
        return name.includes(keyword)
      }
      const name = typeof item.name === "string" ? item.name.toLowerCase() : ""
      const tags = Array.isArray(item.tags)
        ? item.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.toLowerCase())
        : []
      return name.includes(keyword) || tags.some((tag) => tag.includes(keyword))
    })
  }

  /**
   * Marketplace install handled in extension host to reduce backend route dependency.
   */
  private async handleMarketplaceInstall(body: unknown, requestId?: string): Promise<void> {
    const payload = (body ?? {}) as Record<string, unknown>
    const type = typeof payload.type === "string" ? payload.type : ""
    const id = typeof payload.id === "string" ? payload.id : ""
    const selectedContentIndex =
      typeof payload.selectedContentIndex === "number" ? payload.selectedContentIndex : undefined
    const params =
      payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
        ? (payload.params as Record<string, string>)
        : {}

    if (!id || (type !== "skill" && type !== "mode" && type !== "mcp")) {
      this.postMessage({
        type: "marketplaceInstallResult",
        data: { success: false, message: "Invalid install payload" },
        requestId,
      })
      return
    }

    try {
      if (type === "skill") {
        const result = await this.installMarketplaceSkill(id)
        this.postMessage({ type: "marketplaceInstallResult", data: result, requestId })
        return
      }

      if (type === "mode") {
        const result = await this.installMarketplaceMode(id)
        this.postMessage({ type: "marketplaceInstallResult", data: result, requestId })
        return
      }

      const result = await this.installMarketplaceMCP(id, selectedContentIndex, params)
      this.postMessage({ type: "marketplaceInstallResult", data: result, requestId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.postMessage({
        type: "marketplaceInstallResult",
        data: { success: false, message: msg },
        requestId,
      })
    }
  }

  private async installMarketplaceSkill(id: string): Promise<{ success: boolean; message: string; installedPath?: string }> {
    const item = await this.findMarketplaceItemById("skills", id)
    if (!item) {
      return { success: false, message: `Skill not found: ${id}` }
    }

    const content = typeof item.content === "string" ? item.content : ""
    const rawUrl = typeof item.rawUrl === "string" ? item.rawUrl : ""
    if (!content && !rawUrl) {
      return { success: false, message: `Skill "${id}" has no installable content` }
    }

    const skillDir = path.join(this.getWorkspaceDirectory(), ".opencode", "skill", id)
    await fs.mkdir(skillDir, { recursive: true })

    const source = rawUrl || content
    if (/^https?:\/\//i.test(source) && (source.endsWith(".tar.gz") || source.endsWith(".tgz"))) {
      const archiveData = await this.fetchBufferWithTimeout(source, 30000)
      const archivePath = path.join(os.tmpdir(), `vcp-skill-${Date.now()}-${Math.random().toString(36).slice(2)}.tar.gz`)
      try {
        await fs.writeFile(archivePath, archiveData)
        await this.extractTarArchive(archivePath, skillDir)
      } finally {
        await fs.unlink(archivePath).catch(() => undefined)
      }
    } else if (/^https?:\/\//i.test(source)) {
      const text = await this.fetchTextWithTimeout(source, 20000)
      await fs.writeFile(path.join(skillDir, "SKILL.md"), text, "utf8")
    } else {
      await fs.writeFile(path.join(skillDir, "SKILL.md"), source, "utf8")
    }

    await this.fetchAndSendSkills()
    return { success: true, message: `Skill "${id}" installed`, installedPath: skillDir }
  }

  private async installMarketplaceMode(id: string): Promise<{ success: boolean; message: string }> {
    const item = await this.findMarketplaceItemById("modes", id)
    if (!item) {
      return { success: false, message: `Mode not found: ${id}` }
    }

    const content = typeof item.content === "string" ? item.content : ""
    if (!content) {
      return { success: false, message: `Mode "${id}" content is invalid` }
    }

    const parsed = parseYAML(content) as Record<string, unknown>
    const slug = typeof parsed.slug === "string" ? parsed.slug : ""
    if (!slug) {
      return { success: false, message: `Mode "${id}" missing slug` }
    }

    const modeName = typeof parsed.name === "string" ? parsed.name : typeof item.name === "string" ? item.name : id
    const roleDefinition =
      typeof parsed.roleDefinition === "string"
        ? parsed.roleDefinition
        : typeof item.description === "string"
          ? item.description
          : ""

    const modeEntry: Record<string, unknown> = {
      name: modeName,
      roleDefinition,
    }
    if (Array.isArray(parsed.groups)) {
      modeEntry.groups = parsed.groups
    }
    if (typeof parsed.customInstructions === "string") {
      modeEntry.customInstructions = parsed.customInstructions
    }

    const patch = {
      mode: {
        custom: {
          [slug]: modeEntry,
        },
      },
    }
    const applied = await this.applyMarketplaceConfigPatch(patch)
    if (!applied.success) {
      return applied
    }

    return { success: true, message: `Mode "${modeName}" installed` }
  }

  private async installMarketplaceMCP(
    id: string,
    selectedContentIndex?: number,
    params?: Record<string, string>,
  ): Promise<{ success: boolean; message: string }> {
    const item = await this.findMarketplaceItemById("mcps", id)
    if (!item) {
      return { success: false, message: `MCP not found: ${id}` }
    }

    const resolved = this.resolveMcpContent(item, selectedContentIndex)
    if (!resolved) {
      return { success: false, message: `MCP "${id}" content is invalid` }
    }

    const commandText = this.replaceMcpPlaceholders(
      resolved.content,
      resolved.parameters,
      Array.isArray(item.parameters) ? (item.parameters as unknown[]) : [],
      params ?? {},
    )

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(commandText) as Record<string, unknown>
    } catch {
      return { success: false, message: `Failed to parse MCP command JSON for "${id}"` }
    }

    let serverName = id
    let serverConfig: Record<string, unknown> = parsed
    if (parsed.mcpServers && typeof parsed.mcpServers === "object" && !Array.isArray(parsed.mcpServers)) {
      const entries = Object.entries(parsed.mcpServers as Record<string, unknown>)
      if (entries.length === 0) {
        return { success: false, message: `Empty mcpServers for "${id}"` }
      }
      const [name, config] = entries[0]!
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        return { success: false, message: `Invalid mcpServers entry for "${id}"` }
      }
      serverName = name
      serverConfig = config as Record<string, unknown>
    }

    const command: string[] = []
    if (typeof serverConfig.command === "string" && serverConfig.command.length > 0) {
      command.push(serverConfig.command)
    }
    if (Array.isArray(serverConfig.args)) {
      command.push(
        ...serverConfig.args.filter((arg): arg is string => typeof arg === "string" && arg.length > 0),
      )
    }
    if (command.length === 0) {
      return { success: false, message: `MCP "${id}" has no executable command` }
    }

    const mcpEntry: Record<string, unknown> = {
      type: "local",
      command,
      enabled: true,
    }
    if (serverConfig.env && typeof serverConfig.env === "object" && !Array.isArray(serverConfig.env)) {
      mcpEntry.environment = serverConfig.env
    }

    const patch = {
      mcp: {
        [serverName]: mcpEntry,
      },
    }
    const applied = await this.applyMarketplaceConfigPatch(patch)
    if (!applied.success) {
      return applied
    }

    return { success: true, message: `MCP "${serverName}" installed` }
  }

  private async findMarketplaceItemById(
    tab: "skills" | "modes" | "mcps",
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const catalog = await this.fetchMarketplaceItems(tab)
    if (catalog.error) {
      return null
    }
    return (
      catalog.items.find((item) => typeof item.id === "string" && item.id === id) ??
      null
    )
  }

  private resolveMcpContent(
    item: Record<string, unknown>,
    selectedContentIndex?: number,
  ): { content: string; parameters: unknown[] } | null {
    const content = item.content
    if (typeof content === "string") {
      return { content, parameters: [] }
    }

    if (Array.isArray(content)) {
      const index = typeof selectedContentIndex === "number" ? selectedContentIndex : 0
      const selected = content[index]
      if (!selected || typeof selected !== "object" || Array.isArray(selected)) {
        return null
      }
      const record = selected as Record<string, unknown>
      if (typeof record.content !== "string") {
        return null
      }
      return {
        content: record.content,
        parameters: Array.isArray(record.parameters) ? record.parameters : [],
      }
    }

    if (content && typeof content === "object" && !Array.isArray(content)) {
      const record = content as Record<string, unknown>
      if (typeof record.content !== "string") {
        return null
      }
      return {
        content: record.content,
        parameters: Array.isArray(record.parameters) ? record.parameters : [],
      }
    }

    return null
  }

  private replaceMcpPlaceholders(
    text: string,
    methodParameters: unknown[],
    itemParameters: unknown[],
    values: Record<string, string>,
  ): string {
    const merged = [...methodParameters, ...itemParameters]
    return merged.reduce<string>((result, parameter) => {
      if (!parameter || typeof parameter !== "object" || Array.isArray(parameter)) {
        return result
      }
      const record = parameter as Record<string, unknown>
      const key = typeof record.key === "string" ? record.key : ""
      const placeholder = typeof record.placeholder === "string" ? record.placeholder : ""
      if (!key || !placeholder) {
        return result
      }
      const value = values[key]
      if (typeof value !== "string" || value.length === 0) {
        return result
      }
      const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      return result.replace(new RegExp(`\\{\\{${escaped}\\}\\}`, "g"), value)
    }, text)
  }

  private getCachedConfigRecord(): Record<string, unknown> | null {
    if (!this.cachedConfigMessage || typeof this.cachedConfigMessage !== "object") {
      return null
    }
    if (!("config" in this.cachedConfigMessage)) {
      return null
    }
    const config = (this.cachedConfigMessage as { config?: unknown }).config
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return null
    }
    return config as Record<string, unknown>
  }

  private readConfigBackupRecord(): Record<string, unknown> | null {
    const backupJson = this.extensionContext?.globalState.get<string>("nova.configBackup")
    if (!backupJson) return null
    try {
      const parsed = JSON.parse(backupJson)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null
      }
      return parsed as Record<string, unknown>
    } catch {
      return null
    }
  }

  private async readWorkspaceConfigRecord(): Promise<Record<string, unknown> | null> {
    try {
      const file = path.join(this.getWorkspaceDirectory(), "opencode.json")
      const raw = await fs.readFile(file, "utf8")
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null
      }
      return parsed as Record<string, unknown>
    } catch {
      return null
    }
  }

  private async resolveConfigSeed(): Promise<Record<string, unknown>> {
    const cached = this.getCachedConfigRecord()
    if (cached) return cached
    const backup = this.readConfigBackupRecord()
    const workspace = await this.readWorkspaceConfigRecord()
    if (this.isEmbeddedRuntimeEnabled()) {
      if (backup) return backup
      if (workspace) return workspace
    } else {
      if (workspace) return workspace
      if (backup) return backup
    }
    return {}
  }

  private buildLegacySettingsConfigSeed(): Record<string, unknown> {
    const seed: Record<string, unknown> = {}

    const legacyModel = vscode.workspace.getConfiguration("vcp-code.model")
    const providerID = legacyModel.get<string>("providerID", "").trim()
    const modelID = legacyModel.get<string>("modelID", "").trim()
    if (providerID && modelID) {
      seed.model = `${providerID}/${modelID}`
    }

    const legacyRoot = vscode.workspace.getConfiguration("vcp-code")
    const defaultAgent = legacyRoot.get<string>("defaultAgent", "").trim()
    if (defaultAgent) {
      seed.default_agent = defaultAgent
    }

    return seed
  }

  private async rollbackLegacyConfigMigration(runtime: RuntimeClient): Promise<boolean> {
    const rollbackJson = this.extensionContext?.globalState.get<string>("nova.configMigration.v1.rollback")
    if (!rollbackJson) {
      return false
    }

    try {
      const parsed = JSON.parse(rollbackJson)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return false
      }
      await runtime.updateConfig(parsed as Record<string, unknown>)
      const revision = await this.persistConfigBackup(parsed as Record<string, unknown>, {
        source: "migration.v1.rollback",
      })
      await this.extensionContext?.globalState.update("nova.configMigration.v1.result", {
        migrated: true,
        rolledBack: true,
        updatedAt: new Date().toISOString(),
        revision,
      })
      await this.fetchAndSendConfig()
      return true
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to rollback legacy config migration:", error)
      return false
    }
  }

  private async runLegacyConfigMigration(runtime: RuntimeClient): Promise<void> {
    if (!this.extensionContext) return
    const doneKey = "nova.configMigration.v1.completed"
    if (this.extensionContext.globalState.get<boolean>(doneKey, false)) {
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const currentRaw = await runtime.getGlobalConfig().catch(() => runtime.getConfig(workspaceDir))
      const current =
        currentRaw && typeof currentRaw === "object" && !Array.isArray(currentRaw)
          ? (currentRaw as Record<string, unknown>)
          : {}

      const workspace = await this.readWorkspaceConfigRecord()
      const backup = this.readConfigBackupRecord()
      const legacy = this.buildLegacySettingsConfigSeed()

      const merged = mergeConfigMigrationSources({
        legacy,
        workspace,
        backup,
        current,
      })

      const currentHash = computeConfigHash(current)
      const mergedHash = computeConfigHash(merged)
      if (currentHash === mergedHash) {
        await this.extensionContext.globalState.update(doneKey, true)
        await this.extensionContext.globalState.update("nova.configMigration.v1.result", {
          migrated: false,
          updatedAt: new Date().toISOString(),
          reason: "already up to date",
          hash: currentHash,
        })
        return
      }

      await this.extensionContext.globalState.update("nova.configMigration.v1.rollback", JSON.stringify(current))
      const updated = await runtime.updateConfig(merged)
      const persistedRevision = await this.persistConfigBackup(
        updated.config && typeof updated.config === "object" && !Array.isArray(updated.config)
          ? (updated.config as Record<string, unknown>)
          : merged,
        {
          revision: updated.revision,
          source: "migration.v1",
        },
      )

      await this.extensionContext.globalState.update(doneKey, true)
      await this.extensionContext.globalState.update("nova.configMigration.v1.result", {
        migrated: true,
        rolledBack: false,
        updatedAt: new Date().toISOString(),
        revision: persistedRevision,
        hash: mergedHash,
        sources: {
          workspace: Boolean(workspace),
          backup: Boolean(backup),
          legacySettings: Object.keys(legacy).length > 0,
        },
      })

      const choice = await vscode.window.showInformationMessage(
        "Legacy config migration completed. Your configuration was merged into embedded SSOT.",
        "Rollback",
      )
      if (choice === "Rollback") {
        const rolledBack = await this.rollbackLegacyConfigMigration(runtime)
        if (rolledBack) {
          void vscode.window.showInformationMessage("Legacy config migration rolled back.")
        } else {
          void vscode.window.showWarningMessage("Rollback failed: no valid rollback snapshot found.")
        }
      }
    } catch (error) {
      console.error("[Nova New] NovaProvider: Legacy config migration failed:", error)
      await this.extensionContext.globalState.update("nova.configMigration.v1.result", {
        migrated: false,
        updatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private getPersistedConfigRevision(): number | undefined {
    const revision = this.extensionContext?.globalState.get<number>("nova.configRevision")
    if (typeof revision !== "number" || !Number.isFinite(revision) || revision <= 0) {
      return undefined
    }
    return Math.floor(revision)
  }

  private async persistConfigBackup(
    config: Record<string, unknown>,
    options?: { revision?: number; source?: string },
  ): Promise<number> {
    const revision =
      typeof options?.revision === "number" && Number.isFinite(options.revision) && options.revision > 0
        ? Math.floor(options.revision)
        : Date.now()
    if (!this.extensionContext) return revision

    const hash = computeConfigHash(config)
    await this.extensionContext.globalState.update("nova.configBackup", JSON.stringify(config))
    await this.extensionContext.globalState.update("nova.configBackupVersion", this.extensionVersion)
    await this.extensionContext.globalState.update("nova.configRevision", revision)
    await this.extensionContext.globalState.update("nova.configHash", hash)
    await this.extensionContext.globalState.update("nova.configBackupMeta", {
      updatedAt: new Date().toISOString(),
      extensionVersion: this.extensionVersion,
      runtimeMode: this.getRuntimeMode(),
      schemaVersion: 2,
      revision,
      hash,
      source: options?.source ?? "unknown",
    })
    return revision
  }

  private async loadAndSendLocalConfigSnapshot(): Promise<void> {
    const config = await this.resolveConfigSeed()
    const revision = this.getPersistedConfigRevision() ?? Date.now()
    this.cachedConfigMessage = { type: "configLoaded", config, revision }
    this.postMessage({ type: "configLoaded", config, revision })
  }

  private parseConfiguredModel(value: unknown): { providerID: string; modelID: string } | null {
    if (typeof value !== "string") return null
    const slash = value.indexOf("/")
    if (slash <= 0 || slash >= value.length - 1) return null
    return {
      providerID: value.slice(0, slash),
      modelID: value.slice(slash + 1),
    }
  }

  private buildLocalProvidersFromConfig(
    config: Record<string, unknown>,
  ): Record<string, { id: string; name: string; models: Record<string, { id: string; name: string }> }> {
    const output: Record<string, { id: string; name: string; models: Record<string, { id: string; name: string }> }> = {}
    const rawProviders = config.provider
    if (!rawProviders || typeof rawProviders !== "object" || Array.isArray(rawProviders)) {
      return output
    }

    for (const [providerID, providerValue] of Object.entries(rawProviders as Record<string, unknown>)) {
      if (!providerValue || typeof providerValue !== "object" || Array.isArray(providerValue)) {
        continue
      }
      const providerRecord = providerValue as Record<string, unknown>
      const models: Record<string, { id: string; name: string }> = {}
      const rawModels = providerRecord.models
      if (rawModels && typeof rawModels === "object" && !Array.isArray(rawModels)) {
        for (const [modelID, modelValue] of Object.entries(rawModels as Record<string, unknown>)) {
          if (modelValue && typeof modelValue === "object" && !Array.isArray(modelValue)) {
            const modelRecord = modelValue as Record<string, unknown>
            const modelName =
              typeof modelRecord.name === "string" && modelRecord.name.trim().length > 0
                ? modelRecord.name
                : modelID
            models[modelID] = { id: modelID, name: modelName }
            continue
          }
          models[modelID] = { id: modelID, name: modelID }
        }
      }

      const providerName =
        typeof providerRecord.name === "string" && providerRecord.name.trim().length > 0
          ? providerRecord.name
          : providerID
      output[providerID] = {
        id: providerID,
        name: providerName,
        models,
      }
    }

    return output
  }

  private async sendProvidersFromLocalConfig(): Promise<void> {
    const configSeed = await this.resolveConfigSeed()
    const providers = this.buildLocalProvidersFromConfig(configSeed)
    const configuredModel = this.parseConfiguredModel(configSeed.model)
    if (configuredModel) {
      const existing = providers[configuredModel.providerID]
      if (existing) {
        if (!existing.models[configuredModel.modelID]) {
          existing.models[configuredModel.modelID] = {
            id: configuredModel.modelID,
            name: configuredModel.modelID,
          }
        }
      } else {
        providers[configuredModel.providerID] = {
          id: configuredModel.providerID,
          name: configuredModel.providerID,
          models: {
            [configuredModel.modelID]: { id: configuredModel.modelID, name: configuredModel.modelID },
          },
        }
      }
    }

    const defaults: Record<string, string> = {}
    for (const [providerID, provider] of Object.entries(providers)) {
      const firstModelID = Object.keys(provider.models)[0]
      if (firstModelID) {
        defaults[providerID] = firstModelID
      }
    }
    if (configuredModel) {
      defaults[configuredModel.providerID] = configuredModel.modelID
    }

    const config = vscode.workspace.getConfiguration("vcp-code.new.model")
    const providerID = config.get<string>("providerID", "nova")
    const modelID = config.get<string>("modelID", "kilo/auto")
    this.defaultModelSelection = { providerID, modelID }

    const message = {
      type: "providersLoaded",
      providers,
      connected: Object.keys(providers),
      defaults,
      defaultSelection: { providerID, modelID },
    }
    this.cachedProvidersMessage = message
    this.postMessage(message)
  }

  private buildLocalAgentsFromConfig(
    config: Record<string, unknown>,
  ): Array<{ name: string; description?: string; mode: "subagent" | "primary" | "all"; native?: boolean; color?: string }> {
    const agents: Array<{ name: string; description?: string; mode: "subagent" | "primary" | "all"; native?: boolean; color?: string }> = [
      {
        name: "code",
        description: "General coding assistant.",
        mode: "primary",
        native: true,
        color: "#0ea5e9",
      },
    ]

    const modeConfig =
      config.mode && typeof config.mode === "object" && !Array.isArray(config.mode)
        ? (config.mode as Record<string, unknown>)
        : {}
    const customModes =
      modeConfig.custom && typeof modeConfig.custom === "object" && !Array.isArray(modeConfig.custom)
        ? (modeConfig.custom as Record<string, unknown>)
        : {}

    for (const [name, raw] of Object.entries(customModes)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
      const record = raw as Record<string, unknown>
      if (record.hidden === true) continue
      const modeValue = record.mode
      const mode: "subagent" | "primary" | "all" =
        modeValue === "subagent" || modeValue === "all" ? modeValue : "primary"
      const description =
        typeof record.description === "string"
          ? record.description
          : typeof record.prompt === "string"
            ? record.prompt
            : undefined
      const color = typeof record.color === "string" ? record.color : undefined
      agents.push({
        name,
        description,
        mode,
        native: typeof record.native === "boolean" ? record.native : false,
        color,
      })
    }

    const agentConfig =
      config.agent && typeof config.agent === "object" && !Array.isArray(config.agent)
        ? (config.agent as Record<string, unknown>)
        : {}
    for (const [name, raw] of Object.entries(agentConfig)) {
      if (agents.some((agent) => agent.name === name)) continue
      let description: string | undefined
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const record = raw as Record<string, unknown>
        if (typeof record.prompt === "string") {
          description = record.prompt
        }
      }
      agents.push({
        name,
        description,
        mode: "primary",
        native: false,
      })
    }

    if (!agents.some((agent) => agent.name === "agent_team")) {
      agents.push({
        name: "agent_team",
        description: "Coordinate multi-agent waves with explicit handoff.",
        mode: "primary",
        native: true,
        color: "#0ea5e9",
      })
    }

    return agents
  }

  private async sendAgentsFromLocalConfig(): Promise<void> {
    const configSeed = await this.resolveConfigSeed()
    const allAgents = this.buildLocalAgentsFromConfig(configSeed)
    const visible = allAgents.filter((agent) => agent.mode !== "subagent")
    const requestedDefault = typeof configSeed.default_agent === "string" ? configSeed.default_agent : ""
    const defaultAgent = visible.some((agent) => agent.name === requestedDefault)
      ? requestedDefault
      : (visible[0]?.name ?? "code")

    const message = {
      type: "agentsLoaded",
      agents: visible,
      defaultAgent,
    }
    this.cachedAgentsMessage = message
    this.postMessage(message)
  }

  private async listLocalSkillDirectories(): Promise<Array<{ name: string; location: string }>> {
    const root = path.join(this.getWorkspaceDirectory(), ".opencode", "skill")
    try {
      const entries = await fs.readdir(root, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          name: entry.name,
          location: path.join(root, entry.name),
        }))
    } catch {
      return []
    }
  }

  private async sendSkillsFromLocalConfig(): Promise<void> {
    const configSeed = await this.resolveConfigSeed()
    const items: SkillInfo[] = []
    const seen = new Set<string>()

    const localSkillDirs = await this.listLocalSkillDirectories()
    for (const skill of localSkillDirs) {
      const key = `${skill.name}::${skill.location}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        name: skill.name,
        description: "Local installed skill",
        location: skill.location,
      })
    }

    const skillsConfig =
      configSeed.skills && typeof configSeed.skills === "object" && !Array.isArray(configSeed.skills)
        ? (configSeed.skills as Record<string, unknown>)
        : {}
    const configuredPaths = Array.isArray(skillsConfig.paths)
      ? skillsConfig.paths.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : []
    const configuredUrls = Array.isArray(skillsConfig.urls)
      ? skillsConfig.urls.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : []

    for (const configuredPath of configuredPaths) {
      const resolved = path.isAbsolute(configuredPath)
        ? configuredPath
        : path.join(this.getWorkspaceDirectory(), configuredPath)
      const name = path.basename(resolved) || configuredPath
      const key = `${name}::${resolved}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        name,
        description: "Configured local skill path",
        location: resolved,
      })
    }

    for (const url of configuredUrls) {
      const trimmed = url.trim()
      const name = trimmed.replace(/\/+$/, "").split("/").pop() || "remote-skill"
      const key = `${name}::${trimmed}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        name,
        description: "Configured remote skill URL",
        location: trimmed,
      })
    }

    const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name))
    const message: { type: "skillsLoaded"; skills: SkillInfo[] } = {
      type: "skillsLoaded",
      skills: sorted,
    }
    this.cachedSkillsMessage = message
    this.postMessage(message)
  }

  private isBackendUnavailableError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
    return (
      message.includes("fetch failed") ||
      message.includes("failed to fetch") ||
      message.includes("econnrefused") ||
      message.includes("network error") ||
      message.includes("networkerror") ||
      message.includes("socket hang up") ||
      message.includes("not connected")
    )
  }

  private async applyLocalConfigPatch(
    patch: Record<string, unknown>,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const base = await this.resolveConfigSeed()
      const merged = this.deepMergeRecords(base, patch)
      if (!merged.$schema) {
        merged.$schema = "https://kilo.ai/config.json"
      }
      if (!this.isEmbeddedRuntimeEnabled()) {
        const dir = this.getWorkspaceDirectory()
        const file = path.join(dir, "opencode.json")
        await fs.writeFile(file, JSON.stringify(merged, null, 2), "utf8")
      }
      const revision = Date.now()
      this.cachedConfigMessage = { type: "configLoaded", config: merged, revision }
      this.postMessage({ type: "configUpdated", config: merged, revision })
      await this.persistConfigBackup(merged, { revision, source: "local.patch" })
      await this.sendProvidersFromLocalConfig()
      await this.sendAgentsFromLocalConfig()
      await this.sendSkillsFromLocalConfig()
      return { success: true, message: "Config updated" }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: `Local config write failed: ${msg}` }
    }
  }

  private async applyMarketplaceConfigPatch(
    patch: Record<string, unknown>,
  ): Promise<{ success: boolean; message: string }> {
    const runtime = await this.getRuntimeClientOrNull("marketplace config patch")
    if (runtime) {
      try {
        const updated = await runtime.updateConfig(patch)
        this.cachedConfigMessage = { type: "configLoaded", config: updated.config, revision: updated.revision }
        this.postMessage({ type: "configUpdated", config: updated.config, revision: updated.revision })
        if (updated.config && typeof updated.config === "object" && !Array.isArray(updated.config)) {
          await this.persistConfigBackup(updated.config as Record<string, unknown>, {
            revision: updated.revision,
            source: "marketplace.patch",
          })
        }
        await this.fetchAndSendProviders()
        await this.fetchAndSendAgents()
        await this.fetchAndSendSkills()
        return { success: true, message: "Config updated" }
      } catch (error) {
        if (!this.isBackendUnavailableError(error)) {
          const msg = error instanceof Error ? error.message : String(error)
          return { success: false, message: `Config update failed: ${msg}` }
        }
        console.warn("[Nova New] NovaProvider: Marketplace config patch falling back to local write:", error)
      }
    }

    return this.applyLocalConfigPatch(patch)
  }

  private deepMergeRecords(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...left }
    for (const [key, value] of Object.entries(right)) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        result[key] &&
        typeof result[key] === "object" &&
        !Array.isArray(result[key])
      ) {
        result[key] = this.deepMergeRecords(result[key] as Record<string, unknown>, value as Record<string, unknown>)
      } else {
        result[key] = value
      }
    }
    return result
  }

  private async fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} when fetching ${url}`)
      }
      return await response.text()
    } finally {
      clearTimeout(timeout)
    }
  }

  private async fetchBufferWithTimeout(url: string, timeoutMs: number): Promise<Uint8Array> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} when fetching ${url}`)
      }
      return new Uint8Array(await response.arrayBuffer())
    } finally {
      clearTimeout(timeout)
    }
  }

  private async extractTarArchive(archivePath: string, targetDir: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("tar", ["-xzf", archivePath, "-C", targetDir], {
        stdio: ["ignore", "ignore", "pipe"],
      })
      let stderr = ""
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      proc.on("error", reject)
      proc.on("close", (code) => {
        if (code === 0) {
          resolve()
          return
        }
        reject(new Error(stderr || `tar exited with code ${code}`))
      })
    })
  }

  // 鈹€鈹€ VCP Bridge WebSocket Management 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  /**
   * Connect to VCPToolBox WebSocket endpoints (VCPlog + VCPinfo).
   * Reads vcp.toolbox config from the cached config.
   */
  private async connectVcpBridge(): Promise<void> {
    this.disconnectVcpBridge()

    // Read toolbox config from cached config
    const configMsg = this.cachedConfigMessage as { config?: Record<string, unknown> } | null
    const vcp = (configMsg?.config?.vcp ?? {}) as Record<string, unknown>
    const toolbox = (vcp.toolbox ?? {}) as Record<string, unknown>

    const enabled = toolbox.enabled as boolean | undefined
    const url = toolbox.url as string | undefined
    const key = toolbox.key as string | undefined

    if (!enabled || !url || !key) {
      console.log("[Nova New] VCP Bridge: Skipping 鈥?not enabled or missing url/key", { enabled, url: !!url, key: !!key })
      this.postMessage({
        type: "vcpBridgeStatus",
        connected: false,
        logConnected: false,
        infoConnected: false,
        error: !enabled ? "VCP Toolbox bridge is not enabled" : !url ? "Missing VCP Toolbox URL" : "Missing VCP_Key",
      })
      return
    }

    // Normalize URL: strip trailing slash
    const baseWsUrl = url.replace(/\/+$/, "")

    console.log("[Nova New] VCP Bridge: Connecting to", baseWsUrl)

    // Connect to VCPlog
    try {
      const logWsUrl = `${baseWsUrl}/VCPlog/VCP_Key=${key}`
      this.vcpLogWs = new WebSocket(logWsUrl)

      this.vcpLogWs.onopen = () => {
        console.log("[Nova New] VCP Bridge: VCPlog connected")
        this.sendBridgeStatus()
      }

      this.vcpLogWs.onmessage = (event) => {
        try {
          const data = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString())
          this.postMessage({ type: "vcpBridgeLog", data })
        } catch { /* ignore parse errors */ }
      }

      this.vcpLogWs.onclose = () => {
        console.log("[Nova New] VCP Bridge: VCPlog disconnected")
        this.vcpLogWs = null
        this.sendBridgeStatus()
        this.scheduleVcpBridgeReconnect()
      }

      this.vcpLogWs.onerror = (err) => {
        console.error("[Nova New] VCP Bridge: VCPlog error", err)
        this.vcpLogWs?.close()
      }
    } catch (err) {
      console.error("[Nova New] VCP Bridge: Failed to connect VCPlog", err)
    }

    // Connect to VCPinfo
    try {
      const infoWsUrl = `${baseWsUrl}/vcpinfo/VCP_Key=${key}`
      this.vcpInfoWs = new WebSocket(infoWsUrl)

      this.vcpInfoWs.onopen = () => {
        console.log("[Nova New] VCP Bridge: VCPinfo connected")
        this.sendBridgeStatus()
      }

      this.vcpInfoWs.onmessage = (event) => {
        try {
          const data = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString())
          this.postMessage({ type: "vcpBridgeLog", data })
        } catch { /* ignore parse errors */ }
      }

      this.vcpInfoWs.onclose = () => {
        console.log("[Nova New] VCP Bridge: VCPinfo disconnected")
        this.vcpInfoWs = null
        this.sendBridgeStatus()
      }

      this.vcpInfoWs.onerror = (err) => {
        console.error("[Nova New] VCP Bridge: VCPinfo error", err)
        this.vcpInfoWs?.close()
      }
    } catch (err) {
      console.error("[Nova New] VCP Bridge: Failed to connect VCPinfo", err)
    }
  }

  private disconnectVcpBridge(): void {
    if (this.vcpBridgeReconnectTimer) {
      clearTimeout(this.vcpBridgeReconnectTimer)
      this.vcpBridgeReconnectTimer = null
    }
    if (this.vcpLogWs) {
      try { this.vcpLogWs.close() } catch { /* ok */ }
      this.vcpLogWs = null
    }
    if (this.vcpInfoWs) {
      try { this.vcpInfoWs.close() } catch { /* ok */ }
      this.vcpInfoWs = null
    }
    this.vcpBridgeConnected = false
  }

  private sendBridgeStatus(): void {
    const logOk = this.vcpLogWs?.readyState === WebSocket.OPEN
    const infoOk = this.vcpInfoWs?.readyState === WebSocket.OPEN
    this.vcpBridgeConnected = logOk || infoOk
    this.postMessage({
      type: "vcpBridgeStatus",
      connected: this.vcpBridgeConnected,
      logConnected: logOk,
      infoConnected: infoOk,
    })
  }

  private scheduleVcpBridgeReconnect(): void {
    if (this.vcpBridgeReconnectTimer) return
    this.vcpBridgeReconnectTimer = setTimeout(() => {
      this.vcpBridgeReconnectTimer = null
      // Only reconnect if at least one WS is down
      if (!this.vcpLogWs || !this.vcpInfoWs) {
        console.log("[Nova New] VCP Bridge: Auto-reconnecting...")
        void this.connectVcpBridge()
      }
    }, 10000)
  }

  /**
   * Handle enhance prompt request  - calls backend LLM to rewrite/polish the user's prompt.
   */
  private async handleEnhancePrompt(text: string, requestId: string): Promise<void> {
    const runtime = await this.getRuntimeClientOrNull("enhance prompt")
    if (!runtime) {
      this.postMessage({ type: "enhancePromptError", error: "Not connected to CLI backend", requestId })
      return
    }
    try {
      // Use the existing chat-completion endpoint to enhance the prompt
      const systemPrompt =
        "You are an expert prompt engineer. " +
        "Rewrite the following user prompt to be clearer, more specific, and more effective. " +
        "Return ONLY the improved prompt text without any explanation or meta-commentary."
      const result = await runtime.complete(
        {
          system: systemPrompt,
          messages: [{ role: "user", content: text }],
        },
        this.getWorkspaceDirectory(this.currentSession?.id),
      )
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
    const runtime = await this.requireRuntimeClient("Unable to connect embedded runtime for deleting session", sessionID)
    if (!runtime) {
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      await runtime.deleteSession(sessionID, workspaceDir)
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
    const runtime = await this.requireRuntimeClient("Unable to connect embedded runtime for renaming session", sessionID)
    if (!runtime) {
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      const updated = await runtime.updateSession(sessionID, { title }, workspaceDir)
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
   * numeric keys ("0", "1",  - . The webview and sendMessage both need providers
   * keyed by their real `provider.id` (e.g. "anthropic", "openai"). We re-key
   * the map here so the rest of the code can use provider.id everywhere.
   */
  private async fetchAndSendProviders(): Promise<void> {
    const runtime = await this.getRuntimeClientOrNull("fetch providers")
    if (!runtime) {
      if (this.cachedProvidersMessage) {
        this.postMessage(this.cachedProvidersMessage)
      } else {
        await this.sendProvidersFromLocalConfig()
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const response = await runtime.listProviders(workspaceDir)

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
      await this.sendProvidersFromLocalConfig()
    }
  }

  /**
   * Fetch agents (modes) from the backend and send to webview.
   */
  private async fetchAndSendAgents(): Promise<void> {
    const runtime = await this.getRuntimeClientOrNull("fetch agents")
    if (!runtime) {
      if (this.cachedAgentsMessage) {
        this.postMessage(this.cachedAgentsMessage)
      } else {
        await this.sendAgentsFromLocalConfig()
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const agents = await runtime.listAgents(workspaceDir)

      const { visible, defaultAgent } = filterVisibleAgents(agents)
      const finalAgents = [...visible]
      if (!finalAgents.some((agent) => agent.name === "agent_team")) {
        finalAgents.push({
          name: "agent_team",
          description: "Coordinate multi-agent waves with explicit handoff.",
          mode: "primary",
          native: true,
          color: "#0ea5e9",
        })
      }

      const message = {
        type: "agentsLoaded",
        agents: finalAgents.map((a) => ({
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
      await this.sendAgentsFromLocalConfig()
    }
  }

  /**
   * Fetch backend config and send to webview.
   */
  private async fetchAndSendConfig(): Promise<void> {
    const runtime = await this.getRuntimeClientOrNull("fetch config")
    if (!runtime) {
      if (this.cachedConfigMessage) {
        this.postMessage(this.cachedConfigMessage)
      } else {
        await this.loadAndSendLocalConfigSnapshot()
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      // Keep settings read/write source consistent: prefer global config (same as updateConfig),
      // then fall back to merged instance config for older backends.
      const config = await runtime.getGlobalConfig().catch(() => runtime.getConfig(workspaceDir))
      const revision = await runtime.getGlobalConfigRevision().catch(() => undefined)

      // 鈹€鈹€ Config backup guard 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
      // Back up the FULL config (provider, mcp, skills, agent, vcp, etc.) to
      // globalState so it survives extension updates, reinstalls, and edge-case data loss.
      const hasContent = config && typeof config === "object" && (
        (config.provider && Object.keys(config.provider).length > 0) ||
        (config.mcp && Object.keys(config.mcp).length > 0) ||
        (config.agent && Object.keys(config.agent).length > 0) ||
        (config.skills && (config.skills.paths?.length || config.skills.urls?.length)) ||
        (config.vcp && Object.keys(config.vcp).length > 0) ||
        (config.command && Object.keys(config.command).length > 0) ||
        (config.instructions && config.instructions.length > 0) ||
        config.model || config.small_model || config.default_agent
      )
      if (hasContent) {
        const persistedRevision = await this.persistConfigBackup(config as Record<string, unknown>, {
          revision,
          source: "runtime.fetch",
        })
        console.log("[Nova New] NovaProvider: Full config backed up to globalState", {
          providers: Object.keys(config.provider ?? {}).length,
          mcp: Object.keys(config.mcp ?? {}).length,
          agents: Object.keys(config.agent ?? {}).length,
          hasVcp: !!config.vcp,
          revision: persistedRevision,
        })
      } else {
        // Config came back empty 鈥?try to restore from backup
        const backupJson = this.extensionContext?.globalState.get<string>("nova.configBackup")
        if (backupJson) {
          try {
            const backup = JSON.parse(backupJson)
            const backupVersion = this.extensionContext?.globalState.get<string>("nova.configBackupVersion") ?? "unknown"
            console.warn("[Nova New] NovaProvider: Config is empty, restoring FULL backup (version:", backupVersion, ")")
            // Push the backup back to the backend
            await runtime.updateConfig(backup).catch((err: unknown) => {
              console.error("[Nova New] NovaProvider: Failed to restore config backup:", err)
            })
            // Re-fetch to get the restored config
            const restored = await runtime.getGlobalConfig().catch(() => config)
            const restoredRevision =
              restored && typeof restored === "object" && !Array.isArray(restored)
                ? await this.persistConfigBackup(restored as Record<string, unknown>, {
                    revision,
                    source: "runtime.restore-from-backup",
                  })
                : this.getPersistedConfigRevision() ?? Date.now()
            const message = {
              type: "configLoaded",
              config: restored,
              revision: restoredRevision,
            }
            this.cachedConfigMessage = message
            this.postMessage(message)
            return
          } catch (parseErr) {
            console.error("[Nova New] NovaProvider: Failed to parse config backup:", parseErr)
          }
        }
      }

      const message = {
        type: "configLoaded",
        config,
        revision: typeof revision === "number" ? revision : this.getPersistedConfigRevision() ?? Date.now(),
      }
      this.cachedConfigMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to fetch config:", error)
      await this.loadAndSendLocalConfigSnapshot()
    }
  }

  /**
   * Fetch loaded skills from the backend and send to webview.
   */
  private async fetchAndSendSkills(): Promise<void> {
    const runtime = await this.getRuntimeClientOrNull("fetch skills")
    if (!runtime) {
      if (this.cachedSkillsMessage) {
        this.postMessage(this.cachedSkillsMessage)
      } else {
        await this.sendSkillsFromLocalConfig()
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const skills = await runtime.listSkills(workspaceDir)
      const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name))

      const message: { type: "skillsLoaded"; skills: SkillInfo[] } = {
        type: "skillsLoaded",
        skills: sorted,
      }
      this.cachedSkillsMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to fetch skills:", error)
      await this.sendSkillsFromLocalConfig()
    }
  }

  /**
   * Fetch Nova news/notifications and send to webview.
   * Uses the cached message pattern so the webview gets data immediately on refresh.
   */
  private async fetchAndSendNotifications(): Promise<void> {
    const runtime = await this.getRuntimeClientOrNull("fetch notifications")
    if (!runtime) {
      if (this.cachedNotificationsMessage) {
        this.postMessage(this.cachedNotificationsMessage)
      }
      return
    }

    try {
      const notifications = await runtime.getNotifications()
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
    return `${normalized.slice(0, maxLength - 3)}...`
  }

  /**
   * Handle config update request from the webview.
   * Applies a partial config update via the global config endpoint, then pushes
   * the full merged config back to the webview.
   */
  private async handleUpdateConfig(partial: Record<string, unknown>, expectedRevision?: number): Promise<void> {
    const runtime = await this.getRuntimeClientOrNull("update config")
    if (!runtime) {
      const local = await this.applyLocalConfigPatch(partial)
      if (!local.success) {
        this.postMessage({ type: "error", message: local.message })
      }
      return
    }

    try {
      const updated = await runtime.updateConfig(partial, expectedRevision)

      const message = {
        type: "configUpdated",
        config: updated.config,
        revision: updated.revision,
      }
      this.cachedConfigMessage = { type: "configLoaded", config: updated.config, revision: updated.revision }
      this.postMessage(message)

      // 鈹€鈹€ Sync backup on every successful config write 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
      if (updated.config && typeof updated.config === "object" && !Array.isArray(updated.config)) {
        await this.persistConfigBackup(updated.config as Record<string, unknown>, {
          revision: updated.revision,
          source: "runtime.update",
        })
        console.log("[Nova New] NovaProvider: Config backup synced after update")
      }

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
      if (this.isBackendUnavailableError(error)) {
        const local = await this.applyLocalConfigPatch(partial)
        if (!local.success) {
          this.postMessage({ type: "error", message: local.message })
        }
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
    const runtime = await this.requireRuntimeClient("Unable to connect embedded runtime for sending message", sessionID)
    if (!runtime) {
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID || this.currentSession?.id)

      // Create session if needed
      if (!sessionID && !this.currentSession) {
        this.currentSession = await runtime.createSession(workspaceDir)
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

      await runtime.sendMessage(targetSessionID, parts, workspaceDir, {
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
    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      return
    }
    const runtime = await this.getRuntimeClientOrNull("abort session", targetSessionID)
    if (!runtime) {
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(targetSessionID)
      await runtime.abortSession(targetSessionID, workspaceDir)
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to abort session:", error)
    }
  }

  /**
   * Handle compact (context summarization) request from the webview.
   */
  private async handleCompact(sessionID?: string, providerID?: string, modelID?: string): Promise<void> {
    const target = sessionID || this.currentSession?.id
    if (!target) {
      console.error("[Nova New] NovaProvider: No sessionID for compact")
      return
    }
    const runtime = await this.requireRuntimeClient("Unable to connect embedded runtime for compaction", target)
    if (!runtime) {
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
      await runtime.summarize(target, providerID, modelID, workspaceDir)
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
    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      console.error("[Nova New] NovaProvider: No sessionID for permission response")
      return
    }
    const runtime = await this.getRuntimeClientOrNull("permission response", targetSessionID)
    if (!runtime) {
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(targetSessionID)
      await runtime.respondToPermission(targetSessionID, permissionId, response, workspaceDir)
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
    const runtime = await this.getRuntimeClientOrNull("question reply")
    if (!runtime) {
      this.postMessage({ type: "questionError", requestID })
      return
    }

    try {
      await runtime.replyToQuestion(requestID, answers, this.getWorkspaceDirectory(this.currentSession?.id))
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to reply to question:", error)
      this.postMessage({ type: "questionError", requestID })
    }
  }

  /**
   * Handle question reject (dismiss) from the webview.
   */
  private async handleQuestionReject(requestID: string): Promise<void> {
    const runtime = await this.getRuntimeClientOrNull("question reject")
    if (!runtime) {
      this.postMessage({ type: "questionError", requestID })
      return
    }

    try {
      await runtime.rejectQuestion(requestID, this.getWorkspaceDirectory(this.currentSession?.id))
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to reject question:", error)
      this.postMessage({ type: "questionError", requestID })
    }
  }

  /**
   * Handle login request from the webview.
   * Uses the provider OAuth flow: authorize  - open browser  - callback (polls until complete).
   * Sends device auth messages so the webview can display a QR code, verification code, and timer.
   */
  private async handleLogin(): Promise<void> {
    const runtime = await this.getRuntimeClientOrNull("login")
    if (!runtime) {
      return
    }

    const attempt = ++this.loginAttempt

    console.log("[Nova New] NovaProvider: 馃攼 Starting login flow...")

    try {
      const workspaceDir = this.getWorkspaceDirectory()

      // Step 1: Initiate OAuth authorization
      const auth = await runtime.oauthAuthorize("nova", 0, workspaceDir)
      console.log("[Nova New] NovaProvider: 馃攼 Got auth URL:", auth.url)

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
      await runtime.oauthCallback("nova", 0, workspaceDir)

      // Check if this attempt was cancelled
      if (attempt !== this.loginAttempt) {
        return
      }

      console.log("[Nova New] NovaProvider: 馃攼 Login successful")

      // Step 4: Fetch profile and push to webview
      const profileData = await runtime.getProfile()
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
    const runtime = await this.getRuntimeClientOrNull("set organization")
    if (!runtime) {
      return
    }

    console.log("[Nova New] NovaProvider: Switching organization:", organizationId ?? "personal")
    try {
      await runtime.setOrganization(organizationId)
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to switch organization:", error)
      // Re-fetch current profile to reset webview state (clears switching indicator)
      const profileData = await runtime.getProfile()
      this.postMessage({ type: "profileData", data: profileData })
      return
    }

    // Org switch succeeded  - refresh profile and providers independently (best-effort)
    try {
      const profileData = await runtime.getProfile()
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
   * Handle openFile request from the webview  - open a file in the VS Code editor.
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
    const runtime = await this.getRuntimeClientOrNull("logout")
    if (!runtime) {
      return
    }

    console.log("[Nova New] NovaProvider: 馃毆 Logging out...")
    await runtime.removeAuth("nova")
    console.log("[Nova New] NovaProvider: 馃毆 Logged out successfully")
    this.postMessage({
      type: "profileData",
      data: null,
    })
  }

  /**
   * Handle profile refresh request from the webview.
   */
  private async handleRefreshProfile(): Promise<void> {
    const runtime = await this.getRuntimeClientOrNull("refresh profile")
    if (!runtime) {
      return
    }

    console.log("[Nova New] NovaProvider: 馃攧 Refreshing profile...")
    const profileData = await runtime.getProfile()
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
  private async handleSSEEvent(event: SSEEvent): Promise<void> {
    // Extract sessionID from the event
    const sessionID = this.extractSessionID(event)

    // Events without sessionID (server.connected, server.heartbeat)  - always forward
    // Events with sessionID  - only forward if this webview tracks that session
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
    let suppressPermissionRequest = false
    if (event.type === "permission.asked") {
      this.incrementPending(this.pendingPermission, event.properties.sessionID)
      suppressPermissionRequest = await this.maybeHandleYoloAutoApproval(event.properties)
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
      if (suppressPermissionRequest && msg.type === "permissionRequest") {
        return
      }
      this.postMessage(msg)
    }
  }

  private async handleRequestMemoryOverview(requestID: string, limit?: number, folderID?: string): Promise<void> {
    const runtime = await this.getRuntimeClientOrNull("memory overview", this.currentSession?.id)
    if (!runtime) return
    try {
      const data = await runtime.getMemoryOverview({ limit, folderID })
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
    const runtime = await this.getRuntimeClientOrNull("memory search", this.currentSession?.id)
    if (!runtime) return
    try {
      const items = await runtime.searchMemory(input)
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
    const runtime = await this.getRuntimeClientOrNull("memory update", this.currentSession?.id)
    if (!runtime) return
    try {
      const result = await runtime.updateMemoryAtomic(id, patch)
      this.postMessage({ type: "memoryAtomicUpdated", requestID, ...result })
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to update memory:", error)
      this.postMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to update memory" })
    }
  }

  private async handleDeleteMemoryAtomic(requestID: string, id: string): Promise<void> {
    const runtime = await this.getRuntimeClientOrNull("memory delete", this.currentSession?.id)
    if (!runtime) return
    try {
      const result = await runtime.deleteMemoryAtomic(id)
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
    const runtime = await this.getRuntimeClientOrNull("memory preview", this.currentSession?.id)
    if (!runtime) return
    try {
      const workspaceDir = directory || this.getWorkspaceDirectory()
      const result = await runtime.previewMemoryContext({
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
    const runtime = await this.getRuntimeClientOrNull("export config")
    if (!runtime) {
      void vscode.window.showErrorMessage("Not connected to CLI backend.")
      return
    }

    try {
      const directory = this.getWorkspaceDirectory()
      const config = await runtime.getConfig(directory)
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
    const runtime = await this.getRuntimeClientOrNull("import config")
    if (!runtime) {
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

      await runtime.updateConfig(parsed)
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
    const isActionMessage =
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      (((message as { type?: unknown }).type === "action" &&
        typeof (message as { action?: unknown }).action === "string") ||
        (message as { type?: unknown }).type === "navigate")

    if ((!this.webview || !this.isWebviewReady) && isActionMessage) {
      if (this.pendingViewActions.length >= 50) {
        this.pendingViewActions.shift()
      }
      this.pendingViewActions.push(message)
      return
    }

    if (!this.webview) {
      const type =
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        typeof (message as { type?: unknown }).type === "string"
          ? (message as { type: string }).type
          : "<unknown>"
      console.warn("[Nova New] NovaProvider: 鈿狅笍 postMessage dropped (no webview)", { type })
      return
    }

    void this.webview.postMessage(message).then(undefined, (error) => {
      console.error("[Nova New] NovaProvider:  - postMessage failed", error)
    })
  }

  /**
   * Send current codebase indexing status to webview.
   * The backend semantic index endpoints are optional, so we keep a local
   * runtime status cache in the extension for stable UI interactions.
   */
  private async handleRequestCodebaseIndexStatus(): Promise<void> {
    // Try to hydrate totals from workspace when first requested.
    if (this.codebaseIndexState.totalFiles === 0) {
      try {
        const files = await vscode.workspace.findFiles(
          "**/*",
          "{**/.git/**,**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/.next/**}",
          10000,
        )
        this.codebaseIndexState.totalFiles = files.length
      } catch (error) {
        console.error("[Nova New] NovaProvider: Failed to enumerate workspace files:", error)
      }
    }

    this.postMessage({
      type: "codebaseIndexStatus",
      status: this.codebaseIndexState.status,
      indexedFiles: this.codebaseIndexState.indexedFiles,
      totalFiles: this.codebaseIndexState.totalFiles,
      lastUpdated: this.codebaseIndexState.lastUpdated,
    })
  }

  /**
   * Trigger a codebase reindex.
   * Extension-host simulation only to avoid backend code-index coupling.
   */
  private async handleReindexCodebase(): Promise<void> {
    // Extension-host simulation only (no backend code-index dependency).
    try {
      const files = await vscode.workspace.findFiles(
        "**/*",
        "{**/.git/**,**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/.next/**}",
        10000,
      )

      const total = files.length
      this.codebaseIndexState = {
        status: "indexing",
        indexedFiles: 0,
        totalFiles: total,
        lastUpdated: this.codebaseIndexState.lastUpdated,
      }

      this.postMessage({
        type: "codebaseIndexProgress",
        status: "indexing",
        indexedFiles: 0,
        totalFiles: total,
        currentFile: total > 0 ? files[0]!.fsPath : undefined,
      })

      if (total === 0) {
        this.codebaseIndexState = {
          status: "idle",
          indexedFiles: 0,
          totalFiles: 0,
          lastUpdated: new Date().toISOString(),
        }
        this.postMessage({
          type: "codebaseIndexStatus",
          status: "idle",
          indexedFiles: 0,
          totalFiles: 0,
          lastUpdated: this.codebaseIndexState.lastUpdated,
        })
        this.postMessage({
          type: "codebaseIndexProgress",
          status: "idle",
          indexedFiles: 0,
          totalFiles: 0,
        })
        return
      }

      const step = Math.max(1, Math.floor(total / 20))
      for (let i = step; i < total; i += step) {
        this.postMessage({
          type: "codebaseIndexProgress",
          status: "indexing",
          indexedFiles: Math.min(i, total),
          totalFiles: total,
          currentFile: files[Math.min(i, total - 1)]?.fsPath,
        })
      }

      this.codebaseIndexState = {
        status: "idle",
        indexedFiles: total,
        totalFiles: total,
        lastUpdated: new Date().toISOString(),
      }

      this.postMessage({
        type: "codebaseIndexStatus",
        status: "idle",
        indexedFiles: total,
        totalFiles: total,
        lastUpdated: this.codebaseIndexState.lastUpdated,
      })
      this.postMessage({
        type: "codebaseIndexProgress",
        status: "idle",
        indexedFiles: total,
        totalFiles: total,
      })
    } catch (error) {
      console.error("[Nova New] NovaProvider: Failed to reindex codebase:", error)
      this.codebaseIndexState = {
        ...this.codebaseIndexState,
        status: "error",
      }
      this.postMessage({
        type: "codebaseIndexProgress",
        status: "error",
        indexedFiles: this.codebaseIndexState.indexedFiles,
        totalFiles: this.codebaseIndexState.totalFiles,
        message: error instanceof Error ? error.message : "Reindex failed",
      })
      this.postMessage({
        type: "codebaseIndexStatus",
        status: "error",
        indexedFiles: this.codebaseIndexState.indexedFiles,
        totalFiles: this.codebaseIndexState.totalFiles,
        lastUpdated: this.codebaseIndexState.lastUpdated,
      })
    }
  }

  /**
   * Clear in-memory index progress cache and notify webview.
   * This keeps quick-index UI actions reversible even when backend index APIs are unavailable.
   */
  private handleClearCodebaseIndex(): void {
    this.codebaseIndexState = {
      status: "idle",
      indexedFiles: 0,
      totalFiles: this.codebaseIndexState.totalFiles,
      lastUpdated: new Date().toISOString(),
    }

    this.postMessage({
      type: "codebaseIndexProgress",
      status: "idle",
      indexedFiles: 0,
      totalFiles: this.codebaseIndexState.totalFiles,
    })

    this.postMessage({
      type: "codebaseIndexStatus",
      status: "idle",
      indexedFiles: 0,
      totalFiles: this.codebaseIndexState.totalFiles,
      lastUpdated: this.codebaseIndexState.lastUpdated,
    })
  }

  private flushPendingViewActions(): void {
    if (!this.webview || !this.isWebviewReady || this.pendingViewActions.length === 0) return
    const queued = [...this.pendingViewActions]
    this.pendingViewActions = []
    for (const message of queued) {
      void this.webview.postMessage(message).then(undefined, (error) => {
        console.error("[Nova New] NovaProvider:  - flush pending action failed", error)
      })
    }
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

    // Open tabs  - use instanceof TabInputText to exclude notebooks, diffs, custom editors
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
   * Does NOT kill the server  - that's the connection service's job.
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
