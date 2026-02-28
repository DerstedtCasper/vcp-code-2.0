// novacode_change - new file

import { processVcpContent } from "../vcp-content"
import { getDefaultVcpConfig } from "../../../../shared/vcp/vcp-types"

describe("vcp-content", () => {
	test("returns original text when vcp is disabled", () => {
		const config = getDefaultVcpConfig()
		const result = processVcpContent("hello", config)
		expect(result.text).toBe("hello")
		expect(result.notifications).toEqual([])
		expect(result.toolRequests).toEqual([])
	})

	test("extracts notifications from VCPINFO blocks", () => {
		const config = { ...getDefaultVcpConfig(), enabled: true }
		const input = 'A<<<[VCPINFO]>>>{"title":"Heads up","body":"check this","level":"warn"}<<<[END_VCPINFO]>>>B'
		const result = processVcpContent(input, config)
		expect(result.notifications).toHaveLength(1)
		expect(result.notifications[0]).toEqual({
			title: "Heads up",
			body: "check this",
			level: "warn",
		})
		expect(result.text).toContain("data-vcp-info")
	})

	test("renders vcp info details while escaping non-vcp html when html rendering is disabled", () => {
		const config = {
			...getDefaultVcpConfig(),
			enabled: true,
			html: { enabled: false },
		}
		const input =
			'prefix <b>bold</b> <<<[VCPINFO]>>>{"title":"Info","body":"<i>safe</i>"}<<<[END_VCPINFO]>>> suffix'
		const result = processVcpContent(input, config)
		expect(result.text).toContain("&lt;b&gt;bold&lt;/b&gt;")
		expect(result.text).toContain('<details data-vcp-info="true">')
		expect(result.text).toContain("&lt;i&gt;safe&lt;/i&gt;")
		expect(result.text).not.toContain("&lt;details")
	})

	test("parses tool requests and removes raw block when keepBlockInText=false", () => {
		const config = {
			...getDefaultVcpConfig(),
			enabled: true,
			toolRequest: {
				...getDefaultVcpConfig().toolRequest,
				keepBlockInText: false,
				maxPerMessage: 3,
			},
		}
		const input =
			'Before<<<[TOOL_REQUEST]>>>{"tool":"read_file","arguments":{"path":"a.ts"}}<<<[END_TOOL_REQUEST]>>>After'
		const result = processVcpContent(input, config)
		expect(result.text).toBe("BeforeAfter")
		expect(result.toolRequests).toEqual([
			{
				toolName: "read_file",
				params: { path: "a.ts" },
				format: "json",
			},
		])
	})

	test("limits parsed tool requests by maxPerMessage", () => {
		const config = {
			...getDefaultVcpConfig(),
			enabled: true,
			toolRequest: {
				...getDefaultVcpConfig().toolRequest,
				maxPerMessage: 1,
				keepBlockInText: false,
			},
		}
		const input = [
			'<<<[TOOL_REQUEST]>>>{"tool":"read_file","arguments":{"path":"a.ts"}}<<<[END_TOOL_REQUEST]>>>',
			'<<<[TOOL_REQUEST]>>>{"tool":"read_file","arguments":{"path":"b.ts"}}<<<[END_TOOL_REQUEST]>>>',
		].join("\n")
		const result = processVcpContent(input, config)
		expect(result.toolRequests).toHaveLength(1)
		expect(result.toolRequests[0].params).toEqual({ path: "a.ts" })
	})

	test("escapes html when html rendering is disabled", () => {
		const config = {
			...getDefaultVcpConfig(),
			enabled: true,
			html: { enabled: false },
		}
		const result = processVcpContent("<div>safe</div>", config)
		expect(result.text).toBe("&lt;div&gt;safe&lt;/div&gt;")
	})
})
