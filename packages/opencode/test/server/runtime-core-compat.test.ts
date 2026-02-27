import { describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"

describe("runtime-core compatibility", () => {
  test("keeps legacy and current session/permission/question/config routes", async () => {
    const spec = await Server.openapi()
    const paths = (spec as { paths?: Record<string, Record<string, unknown>> }).paths ?? {}

    expect(paths["/config"]?.get).toBeDefined()
    expect(paths["/config"]?.patch).toBeDefined()
    expect(paths["/config/providers"]?.get).toBeDefined()

    expect(paths["/session/{sessionID}/message"]?.get).toBeDefined()
    expect(paths["/session/{sessionID}/message"]?.post).toBeDefined()

    // Legacy compatibility endpoint (deprecated but still supported)
    expect(paths["/session/{sessionID}/permissions/{permissionID}"]?.post).toBeDefined()

    // New split endpoints
    expect(paths["/permission/{requestID}/reply"]?.post).toBeDefined()
    expect(paths["/question/{requestID}/reply"]?.post).toBeDefined()
    expect(paths["/question/{requestID}/reject"]?.post).toBeDefined()
  })
})
