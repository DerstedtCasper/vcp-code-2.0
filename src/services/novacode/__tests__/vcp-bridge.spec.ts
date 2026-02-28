import nock from "nock"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WebSocketServer } from "ws"

import { allowNetConnect } from "../../../vitest.setup"

vi.mock("vscode", () => {
	class MockEventEmitter<T> {
		private listeners: Array<(value: T) => void> = []

		event = (listener: (value: T) => void) => {
			this.listeners.push(listener)
			return {
				dispose: () => {
					this.listeners = this.listeners.filter((item) => item !== listener)
				},
			}
		}

		fire(value: T) {
			for (const listener of this.listeners) {
				listener(value)
			}
		}

		dispose() {
			this.listeners = []
		}
	}

	return {
		EventEmitter: MockEventEmitter,
	}
})

import { VcpBridgeService } from "../vcp-bridge"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("VcpBridgeService", () => {
	beforeEach(() => {
		allowNetConnect(/127\.0\.0\.1/)
	})

	afterEach(() => {
		nock.cleanAll()
		nock.disableNetConnect()
		vi.restoreAllMocks()
	})

	it("connects to log/info channels and updates status", async () => {
		const wss = new WebSocketServer({ port: 0 })
		const address = wss.address()
		const port = typeof address === "object" && address ? address.port : 0
		const seenChannels: string[] = []

		wss.on("connection", (socket, request) => {
			const targetUrl = new URL(request.url ?? "/", `ws://127.0.0.1:${port}`)
			const channel = targetUrl.searchParams.get("channel") ?? ""
			seenChannels.push(channel)

			if (channel === "info") {
				socket.send(
					JSON.stringify({
						version: "1.2.3",
						activePlugins: [{ name: "bridge", version: "1.0.0", status: "active" }],
						distributedServers: [],
					}),
				)
			}
		})

		const service = new VcpBridgeService({
			enabled: true,
			url: `ws://127.0.0.1:${port}`,
			key: "",
			reconnectInterval: 500,
		})

		await service.connect()
		await sleep(50)

		expect(service.status.connected).toBe(true)
		expect(service.status.version).toBe("1.2.3")
		expect(seenChannels).toEqual(expect.arrayContaining(["log", "info"]))

		service.disconnect()
		expect(service.status.connected).toBe(false)

		service.dispose()
		await new Promise<void>((resolve) => wss.close(() => resolve()))
	})
})
