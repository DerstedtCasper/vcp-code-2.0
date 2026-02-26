import { afterEach, beforeEach, expect, test } from "bun:test"
import { VCPBridgeClient } from "../../src/vcp-bridge/client"

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: MockWebSocket[] = []

  readonly url: string
  readyState = MockWebSocket.CONNECTING
  onopen: ((event: any) => void) | null = null
  onmessage: ((event: any) => void) | null = null
  onerror: ((event: any) => void) | null = null
  onclose: ((event: any) => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(): void {}

  close(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code: 1000, reason: "" })
  }

  triggerOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.({ type: "open" })
  }

  triggerClose(code = 1006, reason = ""): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }
}

let originalWebSocket: typeof globalThis.WebSocket | undefined

beforeEach(() => {
  originalWebSocket = globalThis.WebSocket
  ;(globalThis as any).WebSocket = MockWebSocket
  MockWebSocket.instances = []
})

afterEach(() => {
  if (originalWebSocket) {
    ;(globalThis as any).WebSocket = originalWebSocket
  } else {
    delete (globalThis as any).WebSocket
  }
})

test("normalizes toolbox URL and builds vcpinfo endpoint", () => {
  const client = new VCPBridgeClient({
    toolboxUrl: "http://localhost:5800/",
    toolboxKey: "abc123",
    channels: ["VCPInfo"],
    reconnectInterval: 1000,
  })

  client.connect()

  expect(MockWebSocket.instances.length).toBe(1)
  expect(MockWebSocket.instances[0]!.url).toBe("ws://localhost:5800/vcpinfo/VCP_Key=abc123")
})

test("falls back from /vcpinfo to /VCPlog when first endpoint closes before open", () => {
  const client = new VCPBridgeClient({
    toolboxUrl: "ws://localhost:5800",
    toolboxKey: "abc123",
    channels: ["VCPInfo", "VCPLog"],
    reconnectInterval: 1000,
  })

  client.connect()
  expect(MockWebSocket.instances.length).toBe(1)
  expect(MockWebSocket.instances[0]!.url).toBe("ws://localhost:5800/vcpinfo/VCP_Key=abc123")

  MockWebSocket.instances[0]!.triggerClose(1006, "bad path")

  expect(MockWebSocket.instances.length).toBe(2)
  expect(MockWebSocket.instances[1]!.url).toBe("ws://localhost:5800/VCPlog/VCP_Key=abc123")
})

test("uses full channel URL directly when already provided", () => {
  const client = new VCPBridgeClient({
    toolboxUrl: "ws://localhost:5800/VCPlog/VCP_Key=abc123",
    toolboxKey: "ignored-key",
    channels: ["VCPLog"],
    reconnectInterval: 1000,
  })

  client.connect()

  expect(MockWebSocket.instances.length).toBe(1)
  expect(MockWebSocket.instances[0]!.url).toBe("ws://localhost:5800/VCPlog/VCP_Key=abc123")
})
