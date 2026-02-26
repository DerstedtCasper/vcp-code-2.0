import * as vscode from "vscode"
import { ServerManager } from "./server-manager"
import { HttpClient } from "./http-client"
import { SSEClient } from "./sse-client"
import type { ServerConfig, SSEEvent } from "./types"
import { resolveEventSessionId as resolveEventSessionIdPure } from "./connection-utils"

export type ConnectionState = "connecting" | "connected" | "disconnected" | "error"
type SSEEventListener = (event: SSEEvent) => void
type StateListener = (state: ConnectionState) => void
type SSEEventFilter = (event: SSEEvent) => boolean
type NotificationDismissListener = (notificationId: string) => void

/** Retry configuration */
const RETRY_CONFIG = {
  maxAttempts: 10,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
} as const

/**
 * Shared connection service that owns the single ServerManager, HttpClient, and SSEClient.
 * Multiple NovaProvider instances subscribe to it for SSE events and state changes.
 *
 * Features:
 * - Exponential-backoff retry on initial connection failure (up to 10 attempts)
 * - Automatic reconnect when SSE drops unexpectedly
 */
export class NovaConnectionService {
  private readonly serverManager: ServerManager
  private client: HttpClient | null = null
  private sseClient: SSEClient | null = null
  private info: { port: number } | null = null
  private config: ServerConfig | null = null
  private state: ConnectionState = "disconnected"
  private connectPromise: Promise<void> | null = null
  private disposed = false

  /** Workspace dir cached from the first connect() call so that reconnect can reuse it. */
  private lastWorkspaceDir: string | null = null

  /** Timer handle for scheduled reconnection attempts. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  /** Current retry attempt counter (resets on success). */
  private retryAttempt = 0

  private readonly eventListeners: Set<SSEEventListener> = new Set()
  private readonly stateListeners: Set<StateListener> = new Set()
  private readonly notificationDismissListeners: Set<NotificationDismissListener> = new Set()

  /**
   * Shared mapping used to resolve session scope for events that don't reliably include a sessionID.
   * Used primarily for message.part.updated where only messageID may be present.
   */
  private readonly messageSessionIdsByMessageId: Map<string, string> = new Map()

  constructor(context: vscode.ExtensionContext) {
    this.serverManager = new ServerManager(context)
  }

  /**
   * Lazily start server + SSE **with exponential-backoff retry**.
   * Multiple callers share the same promise.
   */
  async connect(workspaceDir: string): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise
    }
    if (this.state === "connected") {
      return
    }

    this.lastWorkspaceDir = workspaceDir

    // Mark as connecting early so concurrent callers won't start another connection attempt.
    this.setState("connecting")

    this.connectPromise = this.connectWithRetry(workspaceDir)
    try {
      await this.connectPromise
    } catch (error) {
      // All retries exhausted – surface error.  A future call to connect() can try again.
      this.setState("error")
      throw error
    } finally {
      this.connectPromise = null
    }
  }

  /**
   * Internal: attempt doConnect() up to RETRY_CONFIG.maxAttempts times with exponential backoff.
   */
  private async connectWithRetry(workspaceDir: string): Promise<void> {
    this.retryAttempt = 0
    let lastError: Error | undefined

    for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
      if (this.disposed) {
        throw new Error("Connection service disposed")
      }

      this.retryAttempt = attempt
      console.log(
        `[Nova New] ConnectionService: 🔄 Connection attempt ${attempt}/${RETRY_CONFIG.maxAttempts}...`,
      )

      try {
        await this.doConnect(workspaceDir)
        // Success – reset counter
        this.retryAttempt = 0
        console.log("[Nova New] ConnectionService: ✅ Connected successfully on attempt", attempt)
        return
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        console.warn(
          `[Nova New] ConnectionService: ⚠️ Attempt ${attempt} failed:`,
          lastError.message,
        )

        if (attempt < RETRY_CONFIG.maxAttempts && !this.disposed) {
          const delay = Math.min(
            RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffFactor, attempt - 1),
            RETRY_CONFIG.maxDelayMs,
          )
          console.log(`[Nova New] ConnectionService: ⏳ Retrying in ${delay}ms...`)
          // Let consumers know we are retrying (still "connecting")
          this.setState("connecting")
          await this.sleep(delay)
        }
      }
    }

    throw lastError ?? new Error("All connection attempts failed")
  }

  /**
   * Schedule an automatic reconnection attempt after an unexpected SSE disconnect.
   * Only fires if we had previously been connected.
   */
  private scheduleReconnect(): void {
    if (this.disposed || !this.lastWorkspaceDir) {
      return
    }
    // Don't stack reconnect timers
    if (this.reconnectTimer) {
      return
    }

    const delay = Math.min(
      RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffFactor, this.retryAttempt),
      RETRY_CONFIG.maxDelayMs,
    )
    this.retryAttempt++
    console.log(
      `[Nova New] ConnectionService: 🔁 Scheduling reconnect in ${delay}ms (retry #${this.retryAttempt})`,
    )

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      if (this.disposed || this.state === "connected") {
        return
      }
      try {
        // Force a fresh connection by clearing the existing promise
        this.connectPromise = null
        // Invalidate server instance so ServerManager restarts if the process died
        this.serverManager.invalidate()
        await this.connect(this.lastWorkspaceDir!)
      } catch (error) {
        console.error("[Nova New] ConnectionService: ❌ Reconnect failed:", error)
        // connect() already sets state to "error" and will not throw if retries succeed
      }
    }, delay)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Get the shared HttpClient. Throws if not connected.
   */
  getHttpClient(): HttpClient {
    if (!this.client) {
      throw new Error("Not connected  - call connect() first")
    }
    return this.client
  }

  /**
   * Get server info (port). Returns null if not connected.
   */
  getServerInfo(): { port: number } | null {
    return this.info
  }

  /**
   * Get server config (baseUrl + password). Returns null if not connected.
   * Used by TelemetryProxy to POST events to the CLI server.
   */
  getServerConfig(): ServerConfig | null {
    return this.config
  }

  /**
   * Current connection state.
   */
  getConnectionState(): ConnectionState {
    return this.state
  }

  /**
   * Subscribe to SSE events. Returns unsubscribe function.
   */
  onEvent(listener: SSEEventListener): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  /**
   * Subscribe to SSE events with a filter. The filter runs for every incoming SSE event.
   */
  onEventFiltered(filter: SSEEventFilter, listener: SSEEventListener): () => void {
    const wrapped: SSEEventListener = (event) => {
      if (!filter(event)) {
        return
      }
      listener(event)
    }
    return this.onEvent(wrapped)
  }

  /**
   * Record a messageID  -  sessionID mapping, typically from message.updated or from HTTP message history.
   */
  recordMessageSessionId(messageId: string, sessionId: string): void {
    if (!messageId || !sessionId) {
      return
    }
    this.messageSessionIdsByMessageId.set(messageId, sessionId)
  }

  /**
   * Best-effort sessionID extraction for an SSE event.
   * Returns undefined for global events.
   */
  resolveEventSessionId(event: SSEEvent): string | undefined {
    return resolveEventSessionIdPure(
      event,
      (messageId) => this.messageSessionIdsByMessageId.get(messageId),
      (messageId, sessionId) => this.recordMessageSessionId(messageId, sessionId),
    )
  }

  /**
   * Subscribe to notification dismiss events broadcast from any NovaProvider. Returns unsubscribe function.
   */
  onNotificationDismissed(listener: NotificationDismissListener): () => void {
    this.notificationDismissListeners.add(listener)
    return () => {
      this.notificationDismissListeners.delete(listener)
    }
  }

  /**
   * Broadcast a notification dismiss event to all subscribed NovaProvider instances.
   */
  notifyNotificationDismissed(notificationId: string): void {
    for (const listener of this.notificationDismissListeners) {
      listener(notificationId)
    }
  }

  /**
   * Subscribe to connection state changes. Returns unsubscribe function.
   */
  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  /**
   * Clean up everything: kill server, close SSE, clear listeners, cancel pending reconnects.
   */
  dispose(): void {
    this.disposed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.sseClient?.dispose()
    this.serverManager.dispose()
    this.eventListeners.clear()
    this.stateListeners.clear()
    this.notificationDismissListeners.clear()
    this.messageSessionIdsByMessageId.clear()
    this.client = null
    this.sseClient = null
    this.config = null
    this.info = null
    this.state = "disconnected"
  }

  private setState(state: ConnectionState): void {
    this.state = state
    for (const listener of this.stateListeners) {
      listener(state)
    }
  }

  private async doConnect(workspaceDir: string): Promise<void> {
    // If we reconnect, ensure the previous SSE connection is cleaned up first.
    this.sseClient?.dispose()

    const server = await this.serverManager.getServer()
    this.info = { port: server.port }

    const config: ServerConfig = {
      baseUrl: `http://127.0.0.1:${server.port}`,
      password: server.password,
    }

    this.config = config
    this.client = new HttpClient(config)
    this.sseClient = new SSEClient(config)

    // Wait until SSE actually reaches a terminal state before resolving connect().
    let resolveConnected: (() => void) | null = null
    let rejectConnected: ((error: Error) => void) | null = null
    const connectedPromise = new Promise<void>((resolve, reject) => {
      resolveConnected = resolve
      rejectConnected = reject
    })

    let didConnect = false

    // Wire SSE events  - broadcast to all registered listeners
    this.sseClient.onEvent((event) => {
      for (const listener of this.eventListeners) {
        listener(event)
      }
    })

    this.sseClient.onError((error) => {
      this.setState("error")
      rejectConnected?.(error)
      resolveConnected = null
      rejectConnected = null
    })

    // Wire SSE state  - broadcast to all registered state listeners
    this.sseClient.onStateChange((sseState) => {
      this.setState(sseState)

      if (sseState === "connected") {
        didConnect = true
        this.retryAttempt = 0 // reset on successful connection
        resolveConnected?.()
        resolveConnected = null
        rejectConnected = null
        return
      }

      if (sseState === "disconnected") {
        if (!didConnect) {
          // Never connected – reject the initial promise so the retry loop can retry
          rejectConnected?.(new Error(`SSE connection ended in state: ${sseState}`))
          resolveConnected = null
          rejectConnected = null
        } else {
          // We *were* connected but SSE dropped – trigger automatic reconnect
          console.warn("[Nova New] ConnectionService: ⚠️ SSE disconnected after being connected, scheduling reconnect...")
          this.scheduleReconnect()
        }
      }
    })

    this.sseClient.connect(workspaceDir)

    await connectedPromise
  }
}
