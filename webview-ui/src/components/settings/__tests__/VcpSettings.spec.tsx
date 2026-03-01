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

	const renderVcpSettings = (vcpConfig = getDefaultVcpConfig()) =>
		render(
			<VcpSettings
				vcpConfig={vcpConfig}
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
		expect(screen.getByTestId("vcp-toolbox-reconnect-interval-input")).toBeInTheDocument()
		expect(screen.getByTestId("vcp-snow-compat-enabled-checkbox")).toBeInTheDocument()
		expect(screen.getByTestId("vcp-snow-compat-basic-model-input")).toBeInTheDocument()
		expect(
			screen.getByText(/Agent Team 设置已迁移到「代理行为」页面，Memory 设置已迁移到「上下文管理」页面/i),
		).toBeInTheDocument()
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

	it("supports updating legacy vcp config objects that do not contain snowCompat", () => {
		const legacyConfig: any = {
			...getDefaultVcpConfig(),
			memory: {
				passive: { enabled: false, maxItems: 100 },
				writer: { enabled: false, triggerTokens: 1000 },
				retrieval: { enabled: false, topK: 5, decayFactor: 0.95 },
				refresh: { enabled: false, intervalMs: 3_600_000 },
			},
		}
		delete legacyConfig.snowCompat

		renderVcpSettings(legacyConfig)

		fireEvent.change(screen.getByTestId("vcp-toolbox-url-input"), {
			target: { value: "ws://127.0.0.1:9000" },
		})

		const latestCall = setCachedStateField.mock.calls.at(-1)
		expect(latestCall?.[1].toolbox.url).toBe("ws://127.0.0.1:9000")
		expect(latestCall?.[1].snowCompat).toEqual(getDefaultVcpConfig().snowCompat)
	})
})
