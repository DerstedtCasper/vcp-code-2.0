import { test, expect } from "bun:test"
import { VcpContentCompatibility } from "../../src/novacode/vcp-content"

test("renders VCP context fold block as details when enabled", () => {
  const input = [
    "before",
    "<<<[VCP_DYNAMIC_FOLD]>>>",
    JSON.stringify({
      fold_blocks: [
        {
          title: "Weather",
          content: "Rain alert",
        },
      ],
    }),
    "<<<[END_VCP_DYNAMIC_FOLD]>>>",
    "after",
  ].join("\n")

  const result = VcpContentCompatibility.process(input, {
    enabled: true,
    contextFold: {
      enabled: true,
      outputStyle: "details",
    },
  })

  expect(result.text).toContain("<details data-vcp-fold=\"true\">")
  expect(result.text).toContain("Weather")
  expect(result.text).toContain("Rain alert")
  expect(result.toolRequests).toEqual([])
})

test("extracts VCPInfo block and returns notifications", () => {
  const input = [
    "hello",
    "<<<[VCPINFO]>>>",
    "sync completed",
    "<<<[END_VCPINFO]>>>",
  ].join("\n")

  const result = VcpContentCompatibility.process(input, {
    enabled: true,
    vcpInfo: {
      enabled: true,
    },
  })

  expect(result.notifications).toEqual(["sync completed"])
  expect(result.text).toContain("data-vcp-info=\"true\"")
  expect(result.toolRequests).toEqual([])
})

test("escapes html when vcp html rendering is disabled", () => {
  const input = "<div>raw</div>"
  const result = VcpContentCompatibility.process(input, {
    enabled: true,
    html: {
      enabled: false,
    },
  })

  expect(result.text).toBe("&lt;div&gt;raw&lt;/div&gt;")
  expect(result.toolRequests).toEqual([])
})

test("parses TOOL_REQUEST json block and strips it by default", () => {
  const input = [
    "before",
    "<<<[TOOL_REQUEST]>>>",
    JSON.stringify({
      tool: "search_memory",
      arguments: {
        query: "recent decisions",
        scope: "folder",
      },
    }),
    "<<<[END_TOOL_REQUEST]>>>",
    "after",
  ].join("\n")

  const result = VcpContentCompatibility.process(input, {
    enabled: true,
    toolRequest: {
      enabled: true,
    },
  })

  expect(result.text).toContain("before")
  expect(result.text).toContain("after")
  expect(result.text).not.toContain("TOOL_REQUEST")
  expect(result.toolRequests).toEqual([
    {
      tool: "search_memory",
      arguments: {
        query: "recent decisions",
        scope: "folder",
      },
      raw: JSON.stringify({
        tool: "search_memory",
        arguments: {
          query: "recent decisions",
          scope: "folder",
        },
      }),
    },
  ])
})

test("parses TOOL_REQUEST with wrapped arguments markers", () => {
  const input = [
    "<<<[TOOL_REQUEST]>>>",
    "tool: call_vcp_tool",
    "arguments: 「始」{\"tool\":\"open_file\",\"path\":\"src/app.ts\"}「末」",
    "<<<[END_TOOL_REQUEST]>>>",
  ].join("\n")

  const result = VcpContentCompatibility.process(input, {
    enabled: true,
    toolRequest: {
      enabled: true,
    },
  })

  expect(result.toolRequests).toEqual([
    {
      tool: "call_vcp_tool",
      arguments: {
        tool: "open_file",
        path: "src/app.ts",
      },
      raw: [
        "tool: call_vcp_tool",
        "arguments: 「始」{\"tool\":\"open_file\",\"path\":\"src/app.ts\"}「末」",
      ].join("\n"),
    },
  ])
})
