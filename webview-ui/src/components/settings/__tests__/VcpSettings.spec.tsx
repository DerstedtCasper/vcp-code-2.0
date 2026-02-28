import { fireEvent, render, screen } from "@/utils/test-utils"
import { getDefaultVcpConfig } from "@roo-code/types"

import { VcpSettings } from "../VcpSettings"

const mockPostMessage = vi.fn()

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: (...args: any[]) => mockPostMessage(...args),
	},
}))

vi.mock("@/components/ui", () => ({
	Button: ({ children, onClick, ...rest }: any) => (
		<button onClick={onClick} {...rest}>
			{children}
		</button>
	),
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ children, checked, onChange, "data-testid": dataTestId }: any) => (
		<label>
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange?.({ target: { checked: e.target.checked } })}
				data-testid={dataTestId}
			/>
			{children}
		</label>
	),
	VSCodeDropdown: ({ children, value, onChange, "data-testid": dataTestId }: any) => (
		<select value={value} onChange={onChange} data-testid={dataTestId}>
			{children}
		</select>
	),
	VSCodeOption: ({ children, value }: any) => <option value={value}>{children}</option>,
	VSCodeTextField: ({ value, onInput, "data-testid": dataTestId, type = "text" }: any) => (
		<input
			type={type}
			value={value}
			onChange={(e) => onInput?.({ target: { value: e.target.value } })}
			data-testid={dataTestId}
		/>
	),
	VSCodeTextArea: ({ value, onInput, onBlur, "data-testid": dataTestId }: any) => (
		<textarea
			value={value}
			onChange={(e) => onInput?.({ target: { value: e.target.value } })}
			onBlur={onBlur}
			data-testid={dataTestId}
		/>
	),
	VSCodeLink: ({ children, href }: any) => <a href={href}>{children}</a>,
}))

describe("VcpSettings", () => {
	const setCachedStateField = vi.fn()
	const setAutocompleteServiceSettingsField = vi.fn()

	beforeEach(() => {
		setCachedStateField.mockReset()
		setAutocompleteServiceSettingsField.mockReset()
		mockPostMessage.mockReset()
	})

	const renderVcpSettings = () =>
		render(
			<VcpSettings
				vcpConfig={getDefaultVcpConfig()}
				vcpBridgeStatus={null as any}
				setCachedStateField={setCachedStateField as any}
				setAutocompleteServiceSettingsField={setAutocompleteServiceSettingsField}
			/>,
		)

	it("renders complete VCP config controls", () => {
		renderVcpSettings()

		expect(screen.getByTestId("vcp-vcpinfo-enabled-checkbox")).toBeInTheDocument()
		expect(screen.getByTestId("vcp-vcpinfo-start-marker-input")).toBeInTheDocument()
		expect(screen.getByTestId("vcp-vcpinfo-end-marker-input")).toBeInTheDocument()
		expect(screen.getByTestId("vcp-html-enabled-checkbox")).toBeInTheDocument()
		expect(screen.getByTestId("vcp-tool-request-allow-tools-input")).toBeInTheDocument()
		expect(screen.getByTestId("vcp-tool-request-deny-tools-input")).toBeInTheDocument()
		expect(screen.getByTestId("vcp-agent-team-members-json-input")).toBeInTheDocument()
		expect(screen.getByTestId("vcp-memory-refresh-interval-ms-input")).toBeInTheDocument()
		expect(screen.getByTestId("vcp-toolbox-reconnect-interval-input")).toBeInTheDocument()
	})

	it("updates nested vcpInfo marker and keeps the full config shape", () => {
		renderVcpSettings()

		fireEvent.change(screen.getByTestId("vcp-vcpinfo-start-marker-input"), {
			target: { value: "<<<[VCP_INFO_NEW]>>>" },
		})

		const latestCall = setCachedStateField.mock.calls.at(-1)
		expect(latestCall?.[0]).toBe("vcpConfig")
		expect(latestCall?.[1].vcpInfo.startMarker).toBe("<<<[VCP_INFO_NEW]>>>")
		expect(latestCall?.[1].toolbox.reconnectInterval).toBe(getDefaultVcpConfig().toolbox.reconnectInterval)
	})

	it("parses allow tools list and updates array values", () => {
		renderVcpSettings()

		fireEvent.change(screen.getByTestId("vcp-tool-request-allow-tools-input"), {
			target: { value: "read_file, write_to_file\nexecute_command" },
		})

		const latestCall = setCachedStateField.mock.calls.at(-1)
		expect(latestCall?.[1].toolRequest.allowTools).toEqual(["read_file", "write_to_file", "execute_command"])
	})

	it("updates agent team members from JSON input on blur", () => {
		renderVcpSettings()

		const membersInput = screen.getByTestId("vcp-agent-team-members-json-input")
		fireEvent.change(membersInput, {
			target: {
				value: JSON.stringify([
					{
						name: "planner",
						providerID: "openrouter",
						modelID: "gpt-4.1",
						rolePrompt: "plan tasks",
					},
				]),
			},
		})
		fireEvent.blur(membersInput)

		const latestCall = setCachedStateField.mock.calls.at(-1)
		expect(latestCall?.[1].agentTeam.members).toEqual([
			{
				name: "planner",
				providerID: "openrouter",
				modelID: "gpt-4.1",
				rolePrompt: "plan tasks",
			},
		])
	})

	it("posts bridge connect messages with toolbox config", () => {
		renderVcpSettings()

		fireEvent.click(screen.getByTestId("vcp-toolbox-connect-button"))

		expect(mockPostMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				type: "updateVcpConfig",
				config: {
					toolbox: getDefaultVcpConfig().toolbox,
				},
			}),
		)
		expect(mockPostMessage).toHaveBeenNthCalledWith(2, { type: "requestVcpBridgeConnect" })
	})
})
