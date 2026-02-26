import { Log } from "../util/log"
import type {
  VCPChannel,
  VCPInfoMessage,
  BridgeStatus,
} from "./types"

/**
 * WebSocket client that connects to VCPToolBox's WebSocket server.
 *
 * VCPToolBox exposes WS at: ws://host:port/vcpinfo/VCP_Key={key}
 * This client subscribes to messages and routes them to registered listeners by channel.
 */

const log = Log.create({ service: "vcp-bridge-client" })

export interface VCPBridgeClientConfig {
  toolboxUrl: string        // e.g. "ws://localhost:5800"
  toolboxKey?: string       // VCP_Key for auth
  channels: VCPChannel[]    // channels to subscribe
  reconnectInterval: number // ms between reconnect attempts
}

type MessageHandler = (msg: VCPInfoMessage) => void

export class VCPBridgeClient {
  private ws: WebSocket | null = null
  private subscribers = new Map<string, Set<MessageHandler>>()
  private globalSubscribers = new Set<MessageHandler>()
  private config: VCPBridgeClientConfig
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private _connected = false
  private _lastConnected: number | undefined
  private _lastError: string | undefined
  private _disposed = false

  constructor(config: VCPBridgeClientConfig) {
    this.config = config
  }

  /**
   * Connect to VCPToolBox WebSocket server
   */
  connect(): void {
    if (this._disposed) return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    const keyPart = this.config.toolboxKey ? `VCP_Key=${this.config.toolboxKey}` : ""
    // VCPToolBox WS path: /vcpinfo/VCP_Key=xxx
    const url = `${this.config.toolboxUrl}/vcpinfo/${keyPart}`

    log.info("connecting to VCPToolBox", { url: url.replace(/VCP_Key=.*/, "VCP_Key=***") })

    try {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        this._connected = true
        this._lastConnected = Date.now()
        this.reconnectAttempts = 0
        log.info("connected to VCPToolBox WebSocket")
      }

      this.ws.onmessage = (event) => {
        try {
          const raw = typeof event.data === "string" ? event.data : event.data.toString()
          const data = JSON.parse(raw) as VCPInfoMessage
          const channel = data.channel || "VCPInfo"

          // Route to channel-specific subscribers
          const channelSubs = this.subscribers.get(channel)
          if (channelSubs) {
            for (const handler of channelSubs) {
              try {
                handler(data)
              } catch (err) {
                log.error("subscriber error", { channel, error: err })
              }
            }
          }

          // Route to global subscribers
          for (const handler of this.globalSubscribers) {
            try {
              handler(data)
            } catch (err) {
              log.error("global subscriber error", { error: err })
            }
          }
        } catch (err) {
          log.warn("failed to parse VCPToolBox message", { error: err })
        }
      }

      this.ws.onerror = (event) => {
        this._lastError = `WebSocket error: ${event.type || "unknown"}`
        log.warn("VCPToolBox WebSocket error", { error: this._lastError })
      }

      this.ws.onclose = (event) => {
        this._connected = false
        log.info("VCPToolBox WebSocket closed", { code: event.code, reason: event.reason })
        this.scheduleReconnect()
      }
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      log.error("failed to create WebSocket connection", { error: this._lastError })
      this.scheduleReconnect()
    }
  }

  /**
   * Disconnect and stop reconnection
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.onclose = null // prevent reconnect on intentional close
      this.ws.close()
      this.ws = null
    }
    this._connected = false
  }

  /**
   * Dispose the client permanently
   */
  dispose(): void {
    this._disposed = true
    this.disconnect()
    this.subscribers.clear()
    this.globalSubscribers.clear()
  }

  /**
   * Subscribe to a specific channel
   * @returns unsubscribe function
   */
  subscribe(channel: string, handler: MessageHandler): () => void {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set())
    }
    this.subscribers.get(channel)!.add(handler)
    return () => {
      this.subscribers.get(channel)?.delete(handler)
    }
  }

  /**
   * Subscribe to ALL messages regardless of channel
   * @returns unsubscribe function
   */
  subscribeAll(handler: MessageHandler): () => void {
    this.globalSubscribers.add(handler)
    return () => {
      this.globalSubscribers.delete(handler)
    }
  }

  /**
   * Send a message to VCPToolBox (if connected)
   */
  send(data: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn("cannot send: not connected to VCPToolBox")
      return false
    }
    try {
      this.ws.send(JSON.stringify(data))
      return true
    } catch (err) {
      log.error("failed to send message", { error: err })
      return false
    }
  }

  /**
   * Get current bridge status
   */
  getStatus(): BridgeStatus {
    return {
      connected: this._connected,
      url: this.config.toolboxUrl,
      channels: [...this.subscribers.keys()] as any,
      reconnectAttempts: this.reconnectAttempts,
      lastConnected: this._lastConnected,
      lastError: this._lastError,
    }
  }

  get connected(): boolean {
    return this._connected
  }

  private scheduleReconnect(): void {
    if (this._disposed) return
    if (this.reconnectTimer) return

    this.reconnectAttempts++
    // Exponential backoff: base * 2^attempts, capped at 60s
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, Math.min(this.reconnectAttempts - 1, 5)),
      60000,
    )

    log.info("scheduling VCPToolBox reconnect", {
      attempt: this.reconnectAttempts,
      delay,
    })

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}
