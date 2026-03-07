import { render, screen } from "@/utils/test-utils"

import { Markdown } from "../Markdown"

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		vcpConfig: undefined,
	}),
}))

vi.mock("@src/utils/clipboard", () => ({
	useCopyToClipboard: () => ({
		copyWithFeedback: vi.fn(async () => true),
	}),
}))

describe("Chat Markdown", () => {
	beforeEach(() => {
		Object.assign(globalThis.URL, {
			createObjectURL: vi.fn(() => "blob:chat-markdown-preview"),
			revokeObjectURL: vi.fn(),
		})
	})

	it("defaults VCP HTML rendering to enabled when config is missing", () => {
		render(<Markdown markdown={`<div id="vcp-root"><h1>Hello</h1></div>`} />)

		expect(screen.getByTestId("rich-content-preview")).toHaveAttribute("title", "vcp-rich-preview-html")
	})
})
