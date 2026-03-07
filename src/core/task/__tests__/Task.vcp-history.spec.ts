import { Task } from "../Task"

describe("Task VCP history normalization", () => {
	it("strips rendered VCP wrappers before assembling assistant history for the API", () => {
		const fakeTask = {
			api: {
				getModel: () => ({
					info: {},
				}),
			},
		}

		const pollutedHistory = [
			{
				role: "assistant",
				content:
					'<details data-vcp-fold="true"><summary>Context A</summary><div>very large body</div></details>\n' +
					'<details data-vcp-info="true"><summary>Notice</summary><div>payload</div></details>',
			},
		] as any

		const result = (Task.prototype as any).buildCleanConversationHistory.call(fakeTask, pollutedHistory)

		expect(result).toEqual([
			{
				role: "assistant",
				content: "[VCP Fold: Context A]\n[VCPInfo: Notice] payload",
			},
		])
	})
})
