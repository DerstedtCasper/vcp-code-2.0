import { beforeEach, describe, expect, it, mock } from "bun:test"
import { EmbeddedRuntimeClient } from "../../src/services/embedded-runtime/embedded-runtime-client"

describe("EmbeddedRuntimeClient", () => {
  const connect = mock(async (_directory: string) => {})
  const createSession = mock(async (directory: string) => ({
    id: "s-1",
    title: "session",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    directory,
  }))
  const sendMessage = mock(async () => {})
  const complete = mock(async () => '{"route":"approve","confidence":0.9,"reason":"ok"}')

  const connectionService = {
    connect,
    getHttpClient: () =>
      ({
        createSession,
        sendMessage,
        complete,
      }) as any,
  } as any

  beforeEach(() => {
    connect.mockClear()
    createSession.mockClear()
    sendMessage.mockClear()
    complete.mockClear()
  })

  it("connects and forwards createSession", async () => {
    const client = new EmbeddedRuntimeClient(connectionService, "D:/workspace")
    const session = await client.createSession("D:/workspace")
    expect(connect).toHaveBeenCalledWith("D:/workspace")
    expect(createSession).toHaveBeenCalledWith("D:/workspace")
    expect(session.id).toBe("s-1")
  })

  it("connects and forwards sendMessage with all arguments", async () => {
    const client = new EmbeddedRuntimeClient(connectionService, "D:/workspace")
    await client.sendMessage(
      "s-1",
      [{ type: "text", text: "hello" }],
      "D:/workspace",
      { providerID: "kilo", modelID: "kilo/auto", agent: "code", variant: "balanced" },
    )
    expect(connect).toHaveBeenCalledWith("D:/workspace")
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("connects and forwards complete", async () => {
    const client = new EmbeddedRuntimeClient(connectionService, "D:/workspace")
    const output = await client.complete(
      {
        system: "rewrite",
        messages: [{ role: "user", content: "improve prompt" }],
      },
      "D:/workspace",
    )
    expect(connect).toHaveBeenCalledWith("D:/workspace")
    expect(complete).toHaveBeenCalledTimes(1)
    expect(output).toContain("approve")
  })
})
