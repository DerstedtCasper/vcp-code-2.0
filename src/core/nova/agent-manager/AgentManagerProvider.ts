import * as vscode from "vscode"
import * as fs from "node:fs"
import * as path from "node:path"
import { t } from "i18next"
import { AgentRegistry } from "./AgentRegistry"
import { renameMapKey } from "./mapUtils"
import {
	buildParallelModeWorktreePath,
	parseParallelModeBranch,
	parseParallelModeWorktreePath,
	isParallelModeCompletionMessage,
	parseParallelModeCompletionBranch,
} from "./parallelModeParser"
import { WorktreeManager, WorktreeError } from "./WorktreeManager"
import { SetupScriptService } from "./SetupScriptService"
import { SetupScriptRunner } from "./SetupScriptRunner"
import { AgentTaskRunner, AgentTasks } from "./AgentTaskRunner"
import { RuntimeProcessHandler, type RuntimeProcessHandlerCallbacks } from "./RuntimeProcessHandler"
import { AgentTeamCoordinator, type TeamSessionOutcome } from "./AgentTeamCoordinator"
import type { StreamEvent, NovacodeStreamEvent, NovacodePayload, WelcomeStreamEvent } from "./CliOutputParser"
import { extractRawText, tryParsePayloadJson } from "./askErrorParser"
import { RemoteSessionService } from "./RemoteSessionService"
import { NovacodeEventProcessor } from "./NovacodeEventProcessor"
import type { RemoteSession, AgentSession } from "./types"
import { getUri } from "../../webview/getUri"
import { getNonce } from "../../webview/getNonce"
import { getViteDevServerConfig } from "../../webview/getViteDevServerConfig"
import { getRemoteUrl } from "../../../services/code-index/managed/git-utils"
import { normalizeGitUrl } from "./normalizeGitUrl"
import type { ClineMessage, VcpAgentTeamConfig } from "@roo-code/types"
import { getModelId, type ModeConfig, type ProviderSettings } from "@roo-code/types"
import { DEFAULT_MODE_SLUG, DEFAULT_MODES } from "@roo-code/types"
import {
	captureAgentManagerOpened,
	captureAgentManagerSessionStarted,
	captureAgentManagerSessionCompleted,
	captureAgentManagerSessionStopped,
	captureAgentManagerSessionError,
	captureAgentManagerLoginIssue,
	getPlatformDiagnostics,
} from "./telemetry"
import type { ClineProvider } from "../../webview/ClineProvider"
import { extractSessionConfigs, MAX_VERSION_COUNT } from "./multiVersionUtils"
import { SessionManager } from "../../../shared/nova/cli-sessions/core/SessionManager"
import { WorkspaceGitService } from "./WorkspaceGitService"
import { SessionTerminalManager } from "./SessionTerminalManager"
import {
	startSessionMessageSchema,
	respondToTeamApprovalMessageSchema,
	cancelTeamRunMessageSchema,
	cancelTeamMemberMessageSchema,
	type StartSessionMessage,
} from "./types"
import { openImage } from "../../../integrations/misc/image-handler"
import { getModelsFromCache } from "../../../api/providers/fetchers/modelCache"
import { isRouterName, type ModelRecord } from "../../../shared/api"
import { OPENAI_CODEX_CREDENTIALS_KEY } from "../../../integrations/openai-codex/oauth"
import { Package } from "../../../shared/package"

/**
 * Message format for sending responses to the agent runtime via IPC.
 * Used for user messages, approval responses, and other interactions.
 */
interface StdinAskResponseMessage {
	type: "askResponse"
	askResponse: "messageResponse" | "yesButtonClicked" | "noButtonClicked"
	text: string
	images?: string[]
}

/**
 * AgentManagerProvider
 *
 * Manages the Agent Manager webview panel and orchestrates novacode agents.
 * Each agent runs as a CLI process using `novacode --auto --json`.
 */
export class AgentManagerProvider implements vscode.Disposable {
	public static readonly viewType = `${Package.name}.AgentManagerPanel`

	private panel: vscode.WebviewPanel | undefined
	private disposables: vscode.Disposable[] = []
	private registry: AgentRegistry
	private remoteSessionService: RemoteSessionService
	private processHandler: RuntimeProcessHandler
	private eventProcessor: NovacodeEventProcessor
	private terminalManager: SessionTerminalManager
	private sessionMessages: Map<string, ClineMessage[]> = new Map()
	// Track first api_req_started per session to filter user-input echoes
	private firstApiReqStarted: Map<string, boolean> = new Map()
	// Track the current workspace's git URL for filtering sessions
	private currentGitUrl: string | undefined
	private lastAuthErrorMessage: string | undefined
	// Track process start times to filter out replayed history events
	private processStartTimes: Map<string, number> = new Map()
	// Track currently sending message per session (for one-at-a-time constraint)
	private sendingMessageMap: Map<string, string> = new Map()
	// Worktree manager for parallel mode sessions (lazy initialized)
	private worktreeManager: WorktreeManager | undefined
	// Setup script service for worktree initialization (lazy initialized)
	private setupScriptService: SetupScriptService | undefined
	// Cached available models from extension (fetched on panel open)
	private availableModels: { provider: string; currentModel: string; models: ModelRecord } | null = null
	// Flag to track if models are being fetched
	private fetchingModels: boolean = false
	private teamCoordinator: AgentTeamCoordinator
	private teamRunEvents: import("./types").TeamRunEvent[] = []
	private readonly teamSessionSettlement = new Map<string, { completedSignalReceived: boolean; finalized: boolean }>()

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly outputChannel: vscode.OutputChannel,
		private readonly provider: ClineProvider,
	) {
		this.registry = new AgentRegistry()
		this.remoteSessionService = new RemoteSessionService({ outputChannel })
		this.terminalManager = new SessionTerminalManager(this.registry, this.outputChannel)

		// Initialize currentGitUrl from workspace
		void this.initializeCurrentGitUrl()

		const callbacks: RuntimeProcessHandlerCallbacks = {
			onLog: (message) => this.outputChannel.appendLine(`[AgentManager] ${message}`),
			onSessionLog: (sessionId, line) => this.log(sessionId, line),
			onStateChanged: () => this.postStateToWebview(),
			onPendingSessionChanged: (pendingSession) => {
				this.postMessage({ type: "agentManager.pendingSession", pendingSession })
			},
			onStartSessionFailed: (error) => {
				this.postMessage({ type: "agentManager.startSessionFailed" })
				if (error?.type === "payment_required") {
					this.showPaymentRequiredPrompt(error.payload ?? { text: error.message })
					return
				}
				if (error?.type === "api_req_failed") {
					this.handleStartSessionApiFailure(error)
					return
				}
				this.showAgentError(error)
			},
			onChatMessages: (sessionId, messages) => {
				// Merge incoming messages with existing history (for resumed sessions)
				// Use timestamp as key to deduplicate and preserve order
				const existingMessages = this.sessionMessages.get(sessionId) || []
				const existingByTs = new Map(existingMessages.map((m) => [m.ts, m]))

				// Add incoming messages, updating existing ones by timestamp
				for (const msg of messages) {
					existingByTs.set(msg.ts, msg)
				}

				// Sort by timestamp and cache
				const mergedMessages = Array.from(existingByTs.values()).sort((a, b) => a.ts - b.ts)
				this.sessionMessages.set(sessionId, mergedMessages)
				this.postMessage({ type: "agentManager.chatMessages", sessionId, messages: mergedMessages })
			},
			onSessionCreated: (sawApiReqStarted: boolean, resumeInfo?: { prompt: string; images?: string[] }) => {
				// Initialize messages for the new session with the initial prompt
				const sessions = this.registry.getSessions()
				if (sessions.length > 0) {
					const latestSession = sessions[0]
					const existingMessages = this.sessionMessages.get(latestSession.sessionId) || []
					const isResumedSession = existingMessages.length > 0

					this.outputChannel.appendLine(
						`[AgentManager] onSessionCreated: sessionId=${latestSession.sessionId}, existingMessages=${
							existingMessages.length
						}, isResumed=${isResumedSession}, hasResumeInfo=${!!resumeInfo}`,
					)

					// For resumed sessions, preserve existing history
					// For new sessions, start with empty array - the agent will send user_feedback
					// Note: We no longer add the initial message here because the agent-runtime
					// extension now properly emits user_feedback for the initial prompt
					// (including for resumed sessions - resumeTaskFromHistory calls say("user_feedback"))
					const updatedMessages = isResumedSession ? [...existingMessages] : []

					this.sessionMessages.set(latestSession.sessionId, updatedMessages)

					// Post messages to webview (important for resumed sessions with history)
					this.postMessage({
						type: "agentManager.chatMessages",
						sessionId: latestSession.sessionId,
						messages: updatedMessages,
					})

					// Transfer api_req_started flag captured during pending phase
					// This ensures NovacodeEventProcessor knows the user echo already happened
					// For resumed sessions, always set this flag to prevent the agent's first
					// response from being skipped as "user echo"
					if (sawApiReqStarted || isResumedSession) {
						this.firstApiReqStarted.set(latestSession.sessionId, true)
					}

					// Track session started telemetry
					captureAgentManagerSessionStarted(
						latestSession.sessionId,
						latestSession.parallelMode?.enabled ?? false,
					)
				}
			},
			onSessionCompleted: (sessionId, exitCode) => {
				void this.handleRuntimeSessionCompleted(sessionId, exitCode)
			},
			onPaymentRequiredPrompt: (payload) => this.showPaymentRequiredPrompt(payload),
			onSessionRenamed: (oldId, newId) => this.handleSessionRenamed(oldId, newId),
			onModeChanged: (sessionId, mode, previousMode) => {
				this.outputChannel.appendLine(
					`[AgentManager] Mode changed for session ${sessionId}: ${previousMode} -> ${mode}`,
				)
				// Update session mode in registry
				this.registry.updateSessionMode(sessionId, mode)
				// Notify webview of mode change
				this.postMessage({
					type: "agentManager.modeChanged",
					sessionId,
					mode,
					previousMode,
				})
				// Also post updated state to ensure UI is in sync
				this.postStateToWebview()
			},
			onWorktreeSessionCreated: (sessionId, worktreePath) => {
				void this.handleWorktreeSessionCreated(sessionId, worktreePath)
			},
		}

		// Pass extension path for agent-runtime resolution in development
		const extensionPath = this.context.extensionUri.fsPath
		// Pass VS Code app root for finding bundled binaries (ripgrep, etc.)
		const vscodeAppRoot = vscode.env.appRoot
		this.processHandler = new RuntimeProcessHandler(this.registry, callbacks, extensionPath, vscodeAppRoot)
		this.eventProcessor = new NovacodeEventProcessor({
			processHandler: this.processHandler,
			registry: this.registry,
			sessionMessages: this.sessionMessages,
			firstApiReqStarted: this.firstApiReqStarted,
			log: (sessionId, line) => this.log(sessionId, line),
			postChatMessages: (sessionId, messages) =>
				this.postMessage({ type: "agentManager.chatMessages", sessionId, messages }),
			postState: () => this.postStateToWebview(),
			postStateEvent: (sessionId, payload) => void this.handleStateEventFromProcessor(sessionId, payload),
			onPaymentRequiredPrompt: (payload) => this.showPaymentRequiredPrompt(payload),
		})
		this.teamCoordinator = new AgentTeamCoordinator({
			workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || this.context.extensionUri.fsPath,
			readProviderState: async () => {
				const state = await this.provider.getState()
				return { listApiConfigMeta: state.listApiConfigMeta }
			},
			resolveProviderProfile: ({ id }) => this.provider.providerSettingsManager.getProfile({ id }),
			launchSession: async ({
				prompt,
				label,
				mode,
				model,
				apiConfigurationOverride,
				parallelMode,
				teamRunId,
				teamMemberId,
				waveId,
				roleType,
				ownership,
			}) => {
				const beforeIds = new Set(this.registry.getSessions().map((session) => session.sessionId))
				const sessionCountBefore = this.registry.getSessions().length
				await this.startAgentSession(prompt, {
					parallelMode,
					labelOverride: label,
					mode,
					model,
					apiConfigurationOverride,
					teamRunId,
					teamMemberId,
					waveId,
					roleType,
					ownership,
				})
				await this.waitForPendingSessionToClear(sessionCountBefore)
				const afterSessions = this.registry.getSessions()
				const createdSession =
					afterSessions.find((session) => !beforeIds.has(session.sessionId)) ?? afterSessions[0]
				if (!createdSession) {
					throw new Error("Failed to capture launched team session")
				}
				return { sessionId: createdSession.sessionId }
			},
			cancelSession: (sessionId) => this.cancelSession(sessionId),
			onStateUpdated: () => this.postTeamRunStateToWebview(),
			onEvent: (event) => {
				this.teamRunEvents = [event, ...this.teamRunEvents].slice(0, 40)
				this.postMessage({ type: "agentManager.teamRunEvent", event })
			},
			log: (message) => this.outputChannel.appendLine(message),
		})
	}

	/**
	 * Build a message for RuntimeProcessHandler with base64 images directly.
	 * The agent-runtime extension expects base64 data URLs.
	 */
	private buildRuntimeMessage(content: string, images?: string[]): StdinAskResponseMessage {
		const message: StdinAskResponseMessage = {
			type: "askResponse",
			askResponse: "messageResponse",
			text: content,
		}

		if (images && images.length > 0) {
			// Pass base64 data URLs directly - the extension expects this format
			message.images = images
			this.outputChannel.appendLine(
				`[AgentManager] buildRuntimeMessage: attaching ${images.length} images, first image length: ${
					images[0]?.length || 0
				}`,
			)
		}

		return message
	}

	/**
	 * Open or focus the Agent Manager panel
	 */
	public async openPanel(): Promise<void> {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.One)
			return
		}

		this.panel = vscode.window.createWebviewPanel(
			AgentManagerProvider.viewType,
			"Agent Manager",
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [this.context.extensionUri],
			},
		)

		this.panel.iconPath = {
			light: vscode.Uri.joinPath(this.context.extensionUri, "assets", "icons", "nova-light.svg"),
			dark: vscode.Uri.joinPath(this.context.extensionUri, "assets", "icons", "nova-dark.svg"),
		}

		this.panel.webview.html =
			this.context.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent(this.panel.webview)
				: this.getHtmlContent(this.panel.webview)

		this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, this.disposables)

		this.panel.onDidDispose(
			() => {
				this.panel = undefined
				this.stopAllAgents()
			},
			null,
			this.disposables,
		)

		this.outputChannel.appendLine("Agent Manager panel opened")

		// Track Agent Manager panel opened
		captureAgentManagerOpened()
	}

	/** Rename session key in all session-keyed maps when provisional session is upgraded. */
	private handleSessionRenamed(oldId: string, newId: string): void {
		this.outputChannel.appendLine(`[AgentManager] Renaming session: ${oldId} -> ${newId}`)

		renameMapKey(this.sessionMessages, oldId, newId)
		renameMapKey(this.firstApiReqStarted, oldId, newId)
		renameMapKey(this.processStartTimes, oldId, newId)
		renameMapKey(this.sendingMessageMap, oldId, newId)

		const messages = this.sessionMessages.get(newId)
		if (messages) {
			this.postMessage({ type: "agentManager.chatMessages", sessionId: newId, messages })
		}
	}

	/**
	 * Handle worktree session creation by writing the task ID to the worktree.
	 * This enables session recovery after extension restarts.
	 */
	private async handleWorktreeSessionCreated(sessionId: string, worktreePath: string): Promise<void> {
		try {
			const manager = this.getWorktreeManager()
			await manager.writeSessionId(worktreePath, sessionId)
			this.outputChannel.appendLine(`[AgentManager] Wrote session ID ${sessionId} to worktree ${worktreePath}`)
		} catch (error) {
			this.outputChannel.appendLine(
				`[AgentManager] Failed to write session ID to worktree: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	private async handleMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
		this.outputChannel.appendLine(`Agent Manager received message: ${JSON.stringify(message)}`)

		try {
			switch (message.type) {
				case "agentManager.webviewReady":
					this.postStateToWebview()
					void this.fetchAndPostRemoteSessions()
					void this.fetchAndPostAvailableModels()
					void this.fetchAndPostAvailableModes()
					break
				case "agentManager.refreshModels":
					void this.fetchAndPostAvailableModels(true)
					break
				case "agentManager.startSession":
					void this.handleStartSession(message)
					break
				case "agentManager.stopSession":
					this.stopAgentSession(message.sessionId as string)
					break
				case "agentManager.finishWorktreeSession":
					void this.finishWorktreeSession(message.sessionId as string)
					break
				case "agentManager.sendMessage":
					void this.sendMessage(
						message.sessionId as string,
						message.content as string,
						message.sessionLabel as string | undefined,
						message.images as string[] | undefined,
					)
					break
				case "agentManager.messageQueued":
					void this.handleQueuedMessage(
						message.sessionId as string,
						message.messageId as string,
						message.content as string,
						message.sessionLabel as string | undefined,
						message.images as string[] | undefined,
					)
					break
				case "agentManager.resumeSession":
					void this.resumeSession(
						message.sessionId as string,
						message.content as string,
						message.sessionLabel as string | undefined,
						message.images as string[] | undefined,
					)
					break
				case "agentManager.cancelSession":
					void this.cancelSession(message.sessionId as string)
					break
				case "agentManager.respondToApproval":
					void this.respondToApproval(
						message.sessionId as string,
						message.approved as boolean,
						message.text as string | undefined,
					)
					break
				case "agentManager.respondToTeamApproval": {
					const parsedMessage = respondToTeamApprovalMessageSchema.safeParse(message)
					if (!parsedMessage.success) {
						this.outputChannel.appendLine(
							`[AgentManager] Invalid respondToTeamApproval message: ${parsedMessage.error.message}`,
						)
						break
					}
					await this.respondToTeamApproval(
						parsedMessage.data.runId,
						parsedMessage.data.approvalId,
						parsedMessage.data.approved,
						parsedMessage.data.reason,
					)
					break
				}
				case "agentManager.cancelTeamRun": {
					const parsed = cancelTeamRunMessageSchema.safeParse(message)
					if (!parsed.success) {
						this.outputChannel.appendLine(
							`[AgentManager] Invalid cancelTeamRun message: ${parsed.error.message}`,
						)
						break
					}
					if (this.teamCoordinator && parsed.data.runId) {
						await this.teamCoordinator.cancelTeamRun(parsed.data.runId)
						this.postTeamRunStateToWebview()
					}
					break
				}
				case "agentManager.cancelTeamMember": {
					const parsed = cancelTeamMemberMessageSchema.safeParse(message)
					if (!parsed.success) {
						this.outputChannel.appendLine(
							`[AgentManager] Invalid cancelTeamMember message: ${parsed.error.message}`,
						)
						break
					}
					if (this.teamCoordinator && parsed.data.runId && parsed.data.teamMemberId) {
						await this.teamCoordinator.cancelTeamMember(parsed.data.runId, parsed.data.teamMemberId)
						this.postTeamRunStateToWebview()
					}
					break
				}
				case "agentManager.removeSession":
					this.removeSession(message.sessionId as string)
					break
				case "agentManager.cancelPendingSession":
					this.cancelPendingSession()
					break
				case "agentManager.selectSession":
					this.selectSession(message.sessionId as string | null)
					break
				case "agentManager.refreshRemoteSessions":
					void this.fetchAndPostRemoteSessions()
					break
				case "agentManager.listBranches":
					void this.handleListBranches()
					break
				case "agentManager.refreshSessionMessages":
					void this.refreshSessionMessages(message.sessionId as string)
					break
				case "agentManager.showTerminal":
					this.terminalManager.showTerminal(message.sessionId as string)
					break
				case "agentManager.configureSetupScript":
					void this.configureSetupScript()
					break
				case "agentManager.sessionShare":
					SessionManager.init()
						?.shareSession(message.sessionId as string)
						.then((result) => {
							const shareUrl = `https://app.nova.ai/share/${result.share_id}`

							void vscode.env.clipboard.writeText(shareUrl)
							vscode.window.showInformationMessage(
								t("common:info.session_share_link_copied_with_url", { url: shareUrl }),
							)
						})
						.catch((error) => {
							const errorMessage = error instanceof Error ? error.message : String(error)
							vscode.window.showErrorMessage(`Failed to share session: ${errorMessage}`)
						})
					break
				case "openImage":
					// Handle image click from ImageThumbnail component
					void openImage(message.text as string)
					break
				case "agentManager.setMode":
					void this.setSessionMode(message.sessionId as string, message.mode as string)
					break
			}
		} catch (error) {
			this.outputChannel.appendLine(`Error handling message: ${error}`)
		}
	}

	/**
	 * Handle start session message from webview.
	 * Supports multi-version mode: when versions > 1, spawns multiple sessions sequentially.
	 */
	private async handleStartSession(message: { [key: string]: unknown }): Promise<void> {
		this.lastAuthErrorMessage = undefined

		const parseResult = startSessionMessageSchema.safeParse(message)
		if (!parseResult.success) {
			this.outputChannel.appendLine(`[AgentManager] Invalid startSession message: ${parseResult.error.message}`)
			this.postMessage({ type: "agentManager.startSessionFailed" })
			return
		}

		const validatedMessage: StartSessionMessage = parseResult.data
		const { prompt, parallelMode = false, existingBranch, model, mode, images } = validatedMessage
		if (images && images.length > 0) {
			this.outputChannel.appendLine(`[AgentManager] Passing ${images.length} images (base64) to new session`)
		}

		const providerState = await this.provider.getState()
		const teamConfig = providerState.vcpConfig?.agentTeam
		if (mode === "agent_team" && teamConfig?.enabled) {
			const typedTeamConfig: VcpAgentTeamConfig = teamConfig
			await this.teamCoordinator.startRun(typedTeamConfig, {
				prompt,
				mode,
				requestedModel: model,
			})
			this.postTeamRunStateToWebview()
			return
		}

		const rawVersions = validatedMessage.versions ?? 1
		const versions = Math.min(Math.max(rawVersions, 1), MAX_VERSION_COUNT)
		const rawLabels = validatedMessage.labels
		const labels = rawLabels?.length === versions ? rawLabels : undefined
		const configs = extractSessionConfigs({ prompt, versions, labels, parallelMode, existingBranch })

		if (configs.length === 1) {
			const config = configs[0]
			await this.startAgentSession(config.prompt, {
				parallelMode: config.parallelMode,
				labelOverride: config.label,
				existingBranch: config.existingBranch,
				model,
				mode,
				images,
			})
			return
		}

		this.outputChannel.appendLine(`[AgentManager] Starting ${configs.length} versions in multi-version mode`)
		for (let i = 0; i < configs.length; i++) {
			const config = configs[i]
			this.outputChannel.appendLine(`[AgentManager] Starting version ${i + 1}/${configs.length}: ${config.label}`)
			const sessionCountBefore = this.registry.getSessions().length
			await this.startAgentSession(config.prompt, {
				parallelMode: config.parallelMode,
				labelOverride: config.label,
				existingBranch: config.existingBranch,
				model,
				mode,
				images,
			})
			if (i < configs.length - 1) {
				await this.waitForPendingSessionToClear(sessionCountBefore)
			}
		}

		this.outputChannel.appendLine(`[AgentManager] All ${configs.length} versions started`)
	}

	/**
	 * Wait for any pending session to transition to active/error state.
	 * Returns immediately if no session is pending.
	 * When sessionCountBefore is provided, waits until a new session appears
	 * (used by team coordinator to detect specific session creation).
	 */
	private waitForPendingSessionToClear(sessionCountBefore?: number): Promise<void> {
		return new Promise((resolve) => {
			const isDone = () => {
				if (sessionCountBefore !== undefined) {
					// Wait for a new session to appear beyond the snapshot count
					return this.registry.getSessions().length > sessionCountBefore
				}
				// Legacy behavior: wait for all pending to clear
				return !this.registry.pendingSession && !this.processHandler?.hasPendingProcess()
			}

			if (isDone()) {
				resolve()
				return
			}

			let timeoutId: ReturnType<typeof setTimeout> | undefined

			const checkInterval = setInterval(() => {
				if (isDone()) {
					clearInterval(checkInterval)
					if (timeoutId) {
						clearTimeout(timeoutId)
					}
					resolve()
				}
			}, 100)

			timeoutId = setTimeout(() => {
				clearInterval(checkInterval)
				this.outputChannel.appendLine(`[AgentManager] Timeout waiting for pending session to clear`)
				resolve()
			}, 30000)
		})
	}

	private async initializeCurrentGitUrl(): Promise<void> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!workspaceFolder) {
			return
		}

		try {
			const rawGitUrl = await getRemoteUrl(workspaceFolder)
			this.currentGitUrl = normalizeGitUrl(rawGitUrl)
			this.outputChannel.appendLine(`[AgentManager] Current git URL: ${this.currentGitUrl}`)
		} catch (error) {
			this.outputChannel.appendLine(
				`[AgentManager] Could not get git URL for workspace: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	/**
	 * Get or create WorktreeManager for the current workspace
	 */
	private getWorktreeManager(): WorktreeManager {
		if (!this.worktreeManager) {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
			if (!workspaceFolder) {
				throw new Error("No workspace folder open")
			}
			this.worktreeManager = new WorktreeManager(workspaceFolder, this.outputChannel)
		}
		return this.worktreeManager
	}

	/**
	 * Get or create SetupScriptService for the current workspace
	 */
	private getSetupScriptService(): SetupScriptService {
		if (!this.setupScriptService) {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
			if (!workspaceFolder) {
				throw new Error("No workspace folder open")
			}
			this.setupScriptService = new SetupScriptService(workspaceFolder)
		}
		return this.setupScriptService
	}

	/**
	 * Run the setup script for a new worktree session.
	 * Non-blocking - script failures don't prevent session start.
	 */
	private async runSetupScriptForWorktree(worktreePath: string): Promise<void> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!workspaceFolder) {
			return
		}

		try {
			const setupScriptService = this.getSetupScriptService()
			const runner = new SetupScriptRunner(this.outputChannel, setupScriptService)

			await runner.runIfConfigured({
				worktreePath,
				repoPath: workspaceFolder,
			})
		} catch (error) {
			// Non-blocking - log error but don't fail session start
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[AgentManager] Setup script error (non-blocking): ${errorMsg}`)
		}
	}

	/**
	 * Open the setup script configuration in VS Code editor.
	 * Creates a default template if no script exists.
	 */
	private async configureSetupScript(): Promise<void> {
		try {
			const setupScriptService = this.getSetupScriptService()
			await setupScriptService.openInEditor()
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[AgentManager] Failed to open setup script: ${errorMsg}`)
			void vscode.window.showErrorMessage(`Failed to open setup script: ${errorMsg}`)
		}
	}

	/**
	 * Start a new agent session using the novacode CLI
	 * @param prompt - The task prompt for the agent
	 */
	private async startAgentSession(
		prompt: string,
		options?: {
			parallelMode?: boolean
			labelOverride?: string
			existingBranch?: string
			model?: string
			mode?: string // Mode slug (e.g., "code", "architect")
			images?: string[] // Image file paths to include with the initial prompt
			apiConfigurationOverride?: ProviderSettings
			teamRunId?: string
			teamMemberId?: string
			waveId?: string
			roleType?: AgentSession["roleType"]
			ownership?: AgentSession["ownership"]
		},
	): Promise<void> {
		if (!prompt) {
			this.outputChannel.appendLine("ERROR: prompt is empty")
			return
		}

		// Get workspace folder early to fetch git URL before spawning
		// Note: we intentionally allow starting parallel mode from within an existing git worktree.
		// Git worktrees share a common .git dir, so `git worktree add/remove` still works from a worktree root.
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

		// Get git URL for the workspace (used for filtering sessions)
		let gitUrl: string | undefined
		if (workspaceFolder) {
			try {
				gitUrl = normalizeGitUrl(await getRemoteUrl(workspaceFolder))
				// Update currentGitUrl to ensure consistency between session gitUrl and filter
				// This fixes a race condition where initializeCurrentGitUrl() hasn't completed yet
				if (gitUrl && !this.currentGitUrl) {
					this.currentGitUrl = gitUrl
					this.outputChannel.appendLine(`[AgentManager] Updated current git URL: ${gitUrl}`)
				}
			} catch (error) {
				this.outputChannel.appendLine(
					`[AgentManager] Could not get git URL: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		const onSetupFailed = () => {
			if (!workspaceFolder) {
				void vscode.window.showErrorMessage("Please open a folder before starting an agent.")
			}
			this.postMessage({ type: "agentManager.startSessionFailed" })
		}

		let effectiveWorkspace = workspaceFolder
		let worktreeInfo: { branch: string; path: string; parentBranch: string } | undefined

		if (options?.parallelMode && workspaceFolder) {
			worktreeInfo = await this.prepareWorktreeForSession(prompt, options.existingBranch)
			if (!worktreeInfo) {
				onSetupFailed()
				return
			}
			effectiveWorkspace = worktreeInfo.path

			// Run setup script for new worktree sessions (non-blocking)
			// Only run for new sessions, not when resuming (existingBranch indicates resume)
			if (!options.existingBranch) {
				await this.runSetupScriptForWorktree(worktreeInfo.path)
			}
		}

		await this.spawnAgentWithCommonSetup(
			prompt,
			{
				parallelMode: options?.parallelMode,
				label: options?.labelOverride,
				gitUrl,
				existingBranch: options?.existingBranch,
				worktreeInfo,
				effectiveWorkspace,
				model: options?.model,
				mode: options?.mode,
				images: options?.images, // Images are sent with prompt via stdin newTask message
				apiConfigurationOverride: options?.apiConfigurationOverride,
				teamRunId: options?.teamRunId,
				teamMemberId: options?.teamMemberId,
				waveId: options?.waveId,
				roleType: options?.roleType,
				ownership: options?.ownership,
			},
			onSetupFailed,
		)
	}

	private async getApiConfigurationForCli(): Promise<ProviderSettings | undefined> {
		const { apiConfiguration } = await this.provider.getState()
		// Log API configuration details for debugging
		const hasNovacodeToken = !!apiConfiguration?.novacodeToken
		const apiProvider = apiConfiguration?.apiProvider || "none"
		this.outputChannel.appendLine(
			`[AgentManager] getApiConfigurationForCli: provider=${apiProvider}, hasNovacodeToken=${hasNovacodeToken}`,
		)
		return apiConfiguration
	}

	/**
	 * Creates a worktree for parallel mode sessions.
	 * Returns worktree info on success, or undefined if creation failed (error already shown to user).
	 */
	private async prepareWorktreeForSession(
		prompt: string,
		existingBranch?: string,
	): Promise<{ branch: string; path: string; parentBranch: string } | undefined> {
		try {
			const manager = this.getWorktreeManager()
			const worktreeInfo = await manager.createWorktree({ prompt, existingBranch })
			this.outputChannel.appendLine(
				`[AgentManager] Created worktree: ${worktreeInfo.path} (branch: ${worktreeInfo.branch})`,
			)
			return worktreeInfo
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[AgentManager] Failed to create worktree: ${errorMsg}`)
			void vscode.window.showErrorMessage(
				error instanceof WorktreeError
					? `Failed to create worktree: ${error.message}`
					: `Failed to start parallel mode: ${errorMsg}`,
			)
			return undefined
		}
	}

	/**
	 * Common helper to spawn an agent process with standard setup.
	 * Handles workspace folder validation, API config, and event callback wiring.
	 * Uses RuntimeProcessHandler which forks agent-runtime processes (no CLI needed).
	 * @returns true if process was spawned, false if setup failed
	 */
	private async spawnAgentWithCommonSetup(
		prompt: string,
		options: {
			parallelMode?: boolean
			label?: string
			gitUrl?: string
			existingBranch?: string
			sessionId?: string
			worktreeInfo?: { branch: string; path: string; parentBranch: string }
			effectiveWorkspace?: string
			model?: string
			mode?: string // Mode slug (e.g., "code", "architect")
			images?: string[] // Image file paths to include with the initial prompt
			apiConfigurationOverride?: ProviderSettings
			teamRunId?: string
			teamMemberId?: string
			waveId?: string
			roleType?: AgentSession["roleType"]
			ownership?: AgentSession["ownership"]
			sessionData?: {
				uiMessages: ClineMessage[]
				apiConversationHistory: unknown[]
				metadata: { sessionId: string; title: string; createdAt: string; mode: string | null }
			} // For resuming with history
		},
		onSetupFailed?: () => void,
	): Promise<boolean> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!workspaceFolder) {
			this.outputChannel.appendLine("ERROR: No workspace folder open")
			onSetupFailed?.()
			return false
		}

		// Use effective workspace (worktree path) if provided, otherwise use workspace folder
		const workspace = options.effectiveWorkspace || workspaceFolder

		const processStartTime = Date.now()
		let apiConfiguration: ProviderSettings | undefined = options.apiConfigurationOverride
		if (!apiConfiguration) {
			try {
				apiConfiguration = await this.getApiConfigurationForCli()
			} catch (error) {
				this.outputChannel.appendLine(
					`[AgentManager] Failed to read provider settings: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}
		}

		// Fetch custom modes (including organization modes) to pass to the agent process
		// This ensures the agent has access to all mode configurations without needing to fetch them
		let customModes: ModeConfig[] | undefined
		try {
			customModes = await this.provider.customModesManager.getCustomModes()
			const modeSlugs = customModes.map((m) => `${m.slug}(${m.source || "local"})`).join(", ")
			this.outputChannel.appendLine(
				`[AgentManager] Fetched ${customModes.length} custom modes for agent process: [${modeSlugs}]`,
			)
			this.outputChannel.appendLine(
				`[AgentManager] Requested mode for session: ${options.mode || "code"} (default)`,
			)
		} catch (error) {
			this.outputChannel.appendLine(
				`[AgentManager] Failed to fetch custom modes: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		// When using OpenAI Codex (ChatGPT Plus/Pro), pass OAuth credentials to the agent process
		// so it can authenticate; the agent process has its own context and no access to main extension secrets
		let secrets: Record<string, string> | undefined
		if (apiConfiguration?.apiProvider === "openai-codex") {
			try {
				const credentialsJson = await this.context.secrets.get(OPENAI_CODEX_CREDENTIALS_KEY)
				if (credentialsJson) {
					secrets = { [OPENAI_CODEX_CREDENTIALS_KEY]: credentialsJson }
					this.outputChannel.appendLine("[AgentManager] Passing OpenAI Codex credentials to agent process")
				} else {
					this.outputChannel.appendLine(
						"[AgentManager] OpenAI Codex selected but no credentials found; sign in using the Nova Code sidebar first.",
					)
				}
			} catch (error) {
				this.outputChannel.appendLine(
					`[AgentManager] Failed to read OpenAI Codex credentials: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}
		}

		// RuntimeProcessHandler uses fork() with agent-runtime, cliPath is ignored
		this.processHandler.spawnProcess(
			"", // cliPath not used - RuntimeProcessHandler forks agent-runtime
			workspace,
			prompt,
			{
				...options,
				apiConfiguration,
				customModes,
				// Pass worktree info for session state tracking
				worktreeInfo: options.worktreeInfo,
				secrets,
			},
			(sid, event) => {
				if (!this.processStartTimes.has(sid)) {
					this.processStartTimes.set(sid, processStartTime)
				}
				this.handleCliEvent(sid, event)
			},
		)

		return true
	}

	/**
	 * Handle a JSON event from the CLI stdout
	 */
	private handleCliEvent(sessionId: string, event: StreamEvent): void {
		switch (event.streamEventType) {
			case "novacode": {
				// Filter out replayed events from history (older than process start time)
				// We allow timestamp <= 1000 because 'welcome' events often have timestamp: 1
				const processStartTime = this.processStartTimes.get(sessionId) ?? 0
				const eventTimestamp = event.payload?.timestamp
				if (eventTimestamp && eventTimestamp > 1000 && eventTimestamp < processStartTime) {
					this.outputChannel.appendLine(
						`[AgentManager] Filtering replayed event: ${
							event.payload?.say || event.payload?.ask || "unknown"
						} (ts=${eventTimestamp} < start=${processStartTime})`,
					)
					return
				}
				this.handleNovacodeEvent(sessionId, event)
				break
			}
			case "status":
				this.parseParallelModeStatus(sessionId, event.message)
				this.log(sessionId, event.message)
				break
			case "output":
				this.parseParallelModeOutput(sessionId, event.content)
				this.log(sessionId, `[${event.source}] ${event.content}`)
				break
			case "error": {
				const session = this.registry.getSession(sessionId)
				this.registry.updateSessionStatus(sessionId, "error", undefined, event.error)
				this.log(sessionId, `Error: ${event.error}`)
				if (event.details) {
					this.log(sessionId, `Details: ${JSON.stringify(event.details)}`)
				}
				void this.routeTeamSessionOutcome({
					sessionId,
					outcome: "failed",
					source: "error",
					message: event.error,
				})
				captureAgentManagerSessionError(sessionId, session?.parallelMode?.enabled ?? false, event.error)
				break
			}
			case "complete": {
				const session = this.registry.getSession(sessionId)
				const wasStopped = session?.status === "stopped"
				const isSuccess = event.exitCode === 0 || event.exitCode === undefined
				this.registry.updateSessionStatus(
					sessionId,
					isSuccess ? "done" : wasStopped ? "stopped" : "error",
					event.exitCode,
				)
				this.log(sessionId, isSuccess ? "Agent completed" : `Agent failed with exit code ${event.exitCode}`)
				void this.fetchAndPostRemoteSessions()
				if (isSuccess) {
					captureAgentManagerSessionCompleted(sessionId, session?.parallelMode?.enabled ?? false)
				} else if (wasStopped) {
					void this.routeTeamSessionOutcome({
						sessionId,
						outcome: "cancelled",
						source: "process_exit",
						message: `Process exited after stop request (${event.exitCode})`,
						exitCode: event.exitCode,
					})
				} else {
					captureAgentManagerSessionError(
						sessionId,
						session?.parallelMode?.enabled ?? false,
						`Exit code ${event.exitCode}`,
					)
					void this.routeTeamSessionOutcome({
						sessionId,
						outcome: "failed",
						source: "complete",
						exitCode: event.exitCode,
						message: `Exit code ${event.exitCode}`,
					})
				}
				break
			}
			case "interrupted": {
				const session = this.registry.getSession(sessionId)
				this.registry.updateSessionStatus(sessionId, "stopped", undefined, event.reason)
				this.log(sessionId, event.reason || "Execution interrupted")
				void this.routeTeamSessionOutcome({
					sessionId,
					outcome: "cancelled",
					source: "interrupted",
					message: event.reason || "Execution interrupted",
				})
				captureAgentManagerSessionStopped(sessionId, session?.parallelMode?.enabled ?? false)
				break
			}
			case "session_created":
				// Handled by CliProcessManager
				break
			case "welcome":
				this.handleWelcomeEvent(sessionId, event as WelcomeStreamEvent)
				break
		}
	}

	private getTeamSessionSettlement(sessionId: string) {
		let settlement = this.teamSessionSettlement.get(sessionId)
		if (!settlement) {
			settlement = { completedSignalReceived: false, finalized: false }
			this.teamSessionSettlement.set(sessionId, settlement)
		}
		return settlement
	}

	private async handleStateEventFromProcessor(
		sessionId: string,
		payload: { eventType: string; partial?: boolean },
	): Promise<void> {
		this.postMessage({ type: "agentManager.stateEvent", sessionId, ...payload })
		if (payload.eventType !== "ask_completion_result") {
			return
		}

		const settlement = this.getTeamSessionSettlement(sessionId)
		settlement.completedSignalReceived = true
		await this.routeTeamSessionOutcome({
			sessionId,
			outcome: "completed",
			source: "ask_completion_result",
		})
	}

	private async handleRuntimeSessionCompleted(sessionId: string, exitCode: number | null): Promise<void> {
		if (exitCode !== null && exitCode !== undefined && exitCode !== 0) {
			return
		}

		const settlement = this.getTeamSessionSettlement(sessionId)
		if (settlement.completedSignalReceived || settlement.finalized) {
			return
		}

		this.postMessage({
			type: "agentManager.stateEvent",
			sessionId,
			eventType: "ask_completion_result",
		})
		await this.routeTeamSessionOutcome({
			sessionId,
			outcome: "completed",
			source: "complete",
			exitCode: exitCode ?? undefined,
		})
	}

	private async routeTeamSessionOutcome(outcome: TeamSessionOutcome): Promise<void> {
		const settlement = this.getTeamSessionSettlement(outcome.sessionId)
		if (settlement.finalized) {
			return
		}
		if (outcome.outcome === "completed" && outcome.source === "complete" && settlement.completedSignalReceived) {
			return
		}

		const handled = await this.teamCoordinator.handleSessionOutcome(outcome)
		if (!handled) {
			if (outcome.outcome !== "completed") {
				settlement.finalized = true
			}
			return
		}

		if (outcome.outcome === "completed") {
			settlement.completedSignalReceived = true
		}
		settlement.finalized = true
	}

	/**
	 * Parse parallel mode info from CLI status messages
	 */
	private parseParallelModeStatus(sessionId: string, message: string): void {
		let updated = false

		const branch = parseParallelModeBranch(message)
		if (branch) {
			if (this.registry.updateParallelModeInfo(sessionId, { branch })) {
				updated = true
			}
		}

		const worktreePath = parseParallelModeWorktreePath(message)
		if (worktreePath) {
			if (this.registry.updateParallelModeInfo(sessionId, { worktreePath })) {
				updated = true
			}
		}

		if (updated) {
			this.postStateToWebview()
		}
	}

	/**
	 * Parse parallel mode completion message from CLI output
	 */
	private parseParallelModeOutput(sessionId: string, content: string): void {
		if (isParallelModeCompletionMessage(content)) {
			let updated = false

			// Extract branch name from completion message
			const branch = parseParallelModeCompletionBranch(content)
			if (branch) {
				if (this.registry.updateParallelModeInfo(sessionId, { branch })) {
					updated = true
				}
			}

			// Store the completion message
			if (this.registry.updateParallelModeInfo(sessionId, { completionMessage: content })) {
				updated = true
			}

			if (updated) {
				this.postStateToWebview()
			}
		}
	}

	/**
	 * Handle welcome event from CLI - extracts worktree branch and path for parallel mode sessions
	 */
	private handleWelcomeEvent(sessionId: string, event: WelcomeStreamEvent): void {
		let updated = false
		const session = this.registry.getSession(sessionId)
		const existingWorktreePath = session?.parallelMode?.worktreePath

		if (event.worktreeBranch) {
			this.outputChannel.appendLine(
				`[AgentManager] Session ${sessionId} worktree branch: ${event.worktreeBranch}`,
			)
			if (this.registry.updateParallelModeInfo(sessionId, { branch: event.worktreeBranch })) {
				updated = true
			}
		}

		if (event.worktreePath) {
			this.outputChannel.appendLine(`[AgentManager] Session ${sessionId} worktree path: ${event.worktreePath}`)
			if (this.registry.updateParallelModeInfo(sessionId, { worktreePath: event.worktreePath })) {
				updated = true
			}
		}

		if (!event.worktreePath && event.worktreeBranch && !existingWorktreePath) {
			const derivedWorktreePath = buildParallelModeWorktreePath(event.worktreeBranch)
			this.outputChannel.appendLine(
				`[AgentManager] Session ${sessionId} derived worktree path: ${derivedWorktreePath}`,
			)
			if (this.registry.updateParallelModeInfo(sessionId, { worktreePath: derivedWorktreePath })) {
				updated = true
			}
		}

		if (updated) {
			this.postStateToWebview()
		}
	}

	private handleNovacodeEvent(sessionId: string, event: NovacodeStreamEvent): void {
		this.eventProcessor.handle(sessionId, event)
	}

	/**
	 * Append a log line to a session
	 */
	private log(sessionId: string, line: string): void {
		this.registry.appendLog(sessionId, line)
	}

	private selectSession(sessionId: string | null): void {
		this.registry.selectedId = sessionId
		this.postStateToWebview()

		if (!sessionId) return

		this.terminalManager.showExistingTerminal(sessionId)

		// Check if we have cached messages to send immediately
		const cachedMessages = this.sessionMessages.get(sessionId)
		if (cachedMessages) {
			// Re-post cached messages to ensure webview has them
			this.postMessage({
				type: "agentManager.chatMessages",
				sessionId,
				messages: cachedMessages,
			})
			return
		}

		// No cached messages - fetch from remote if no active process
		if (!this.processHandler.hasProcess(sessionId)) {
			void this.fetchRemoteSessionMessages(sessionId)
		}
	}

	private async fetchRemoteSessionMessages(sessionId: string): Promise<void> {
		try {
			const messages = await this.remoteSessionService.fetchSessionMessages(sessionId)
			if (!messages) return

			this.storeAndPostMessages(sessionId, messages)
		} catch (error) {
			this.outputChannel.appendLine(`[AgentManager] Failed to fetch remote session messages: ${error}`)
		}
	}

	private storeAndPostMessages(sessionId: string, messages: ClineMessage[]): void {
		this.outputChannel.appendLine(`[AgentManager] Fetched ${messages.length} messages for session: ${sessionId}`)

		this.sessionMessages.set(sessionId, messages)
		this.postMessage({
			type: "agentManager.chatMessages",
			sessionId,
			messages,
		})
	}

	private async refreshSessionMessages(sessionId: string): Promise<void> {
		this.sessionMessages.delete(sessionId)
		await this.fetchRemoteSessionMessages(sessionId)
	}

	/**
	 * Stop a running agent session
	 */
	private stopAgentSession(sessionId: string): void {
		const session = this.registry.getSession(sessionId)

		this.processHandler.stopProcess(sessionId)

		this.registry.updateSessionStatus(sessionId, "stopped", undefined, "Stopped by user")
		this.log(sessionId, "Stopped by user")
		this.postMessage({
			type: "agentManager.stateEvent",
			sessionId,
			eventType: "cancel_session",
		})
		void this.routeTeamSessionOutcome({
			sessionId,
			outcome: "cancelled",
			source: "cancel_session",
			message: "Stopped by user",
		})
		this.postStateToWebview()

		this.firstApiReqStarted.delete(sessionId)
		this.processStartTimes.delete(sessionId)
		this.sendingMessageMap.delete(sessionId)

		captureAgentManagerSessionStopped(sessionId, session?.parallelMode?.enabled ?? false)
	}

	/**
	 * Finish a worktree (parallel mode) session:
	 * 1. Stage all changes
	 * 2. Ask agent to generate commit message and commit
	 * 3. Fallback to programmatic commit if agent times out
	 *
	 * Note: The session remains interactive after finishing. The CLI process
	 * and worktree are kept alive so the user can continue working.
	 */
	private async finishWorktreeSession(sessionId: string): Promise<void> {
		const session = this.registry.getSession(sessionId)
		if (!session?.parallelMode?.enabled) {
			this.outputChannel.appendLine(
				`[AgentManager] Ignoring finishWorktreeSession for non-worktree session: ${sessionId}`,
			)
			return
		}

		if (session.status !== "running") {
			this.outputChannel.appendLine(
				`[AgentManager] Ignoring finishWorktreeSession for non-running session: ${sessionId} (status: ${session.status})`,
			)
			return
		}

		const worktreePath = session.parallelMode.worktreePath
		const branch = session.parallelMode.branch

		if (!worktreePath) {
			this.outputChannel.appendLine(`[AgentManager] No worktree path for session: ${sessionId}`)
			return
		}

		this.log(sessionId, "Finishing worktree session...")

		try {
			const manager = this.getWorktreeManager()

			// Stage all changes
			const hasChanges = await manager.stageAllChanges(worktreePath)

			if (hasChanges) {
				this.log(sessionId, "Asking agent to commit changes...")

				// Create task runner with sendMessage bound to this session
				const taskRunner = new AgentTaskRunner(this.outputChannel, async (sid, message) => {
					await this.sendMessageToStdin(sid, message)
				})

				// Ask agent to commit with a proper message
				const commitTask = AgentTasks.createCommitTask(worktreePath, "chore: parallel mode task completion")
				const result = await taskRunner.executeTask(sessionId, commitTask)

				if (result.completedByAgent) {
					this.log(sessionId, "Agent committed changes successfully")
					// Show completion message only on success
					this.showWorktreeCompletionMessage(branch)
				} else if (result.success) {
					this.log(sessionId, "Used fallback commit message")
					// Show completion message only on success
					this.showWorktreeCompletionMessage(branch)
				} else {
					this.log(sessionId, `Commit failed: ${result.error}`)
					// Don't show completion message on failure - show error instead
					vscode.window.showErrorMessage(`Failed to commit changes: ${result.error}`)
				}
			} else {
				this.log(sessionId, "No changes to commit")
				if (branch) {
					void vscode.window
						.showInformationMessage(
							`Parallel mode complete (no changes). Branch: ${branch}`,
							"Copy Branch Name",
						)
						.then((selection) => {
							if (selection === "Copy Branch Name") {
								void vscode.env.clipboard.writeText(branch)
							}
						})
				}
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[AgentManager] Error finishing worktree session: ${errorMsg}`)
		}

		this.postStateToWebview()
	}

	/**
	 * Send a message to a session's stdin (for agent instructions)
	 */
	private async sendMessageToStdin(sessionId: string, content: string, images?: string[]): Promise<void> {
		// Use buildRuntimeMessage to send base64 images directly (not file paths)
		const message = this.buildRuntimeMessage(content, images)
		await this.processHandler.writeToStdin(sessionId, message)
	}

	/**
	 * Show completion message after finishing worktree session
	 */
	private showWorktreeCompletionMessage(branch?: string): void {
		if (!branch) return

		const message = `Parallel mode complete! Changes committed to: ${branch}`
		void vscode.window.showInformationMessage(message, "Copy Branch Name").then((selection) => {
			if (selection === "Copy Branch Name") {
				void vscode.env.clipboard.writeText(branch)
			}
		})
	}

	/**
	 * Send a follow-up message to a running agent session via stdin.
	 */
	public async sendMessage(
		sessionId: string,
		content: string,
		sessionLabel?: string,
		images?: string[],
	): Promise<void> {
		if (!this.processHandler.hasStdin(sessionId)) {
			// Session is not running - ignore the message
			this.outputChannel.appendLine(`[AgentManager] Session ${sessionId} not running, ignoring follow-up message`)
			return
		}

		// Use buildRuntimeMessage to send base64 images directly (not file paths)
		const message = this.buildRuntimeMessage(content, images)
		await this.safeWriteToStdin(sessionId, message, "message")
	}

	/**
	 * Set the mode for a running agent session via IPC.
	 * This sends a "mode" webview message to the agent process which calls handleModeSwitch().
	 */
	private async setSessionMode(sessionId: string, mode: string): Promise<void> {
		if (!this.processHandler.hasStdin(sessionId)) {
			this.outputChannel.appendLine(`[AgentManager] Session ${sessionId} not running, cannot set mode`)
			return
		}

		// Send as a webview message - the extension expects { type: "mode", text: mode }
		const message = { type: "mode", text: mode }
		try {
			await this.processHandler.writeToStdin(sessionId, message)
			this.outputChannel.appendLine(`[AgentManager] Set mode to ${mode} for session ${sessionId}`)
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : "Unknown error"
			this.outputChannel.appendLine(`[AgentManager] Failed to set mode for session ${sessionId}: ${errorMsg}`)
		}
	}

	/**
	 * Handle a queued message from the webview.
	 * Orchestrates validation, sending, and status notification.
	 */
	private async handleQueuedMessage(
		sessionId: string,
		messageId: string,
		content: string,
		_sessionLabel?: string,
		images?: string[],
	): Promise<void> {
		// Validate the session and message prerequisites
		const validationError = this.validateMessagePrerequisites(sessionId, messageId)
		if (validationError) return

		// Attempt to send the message
		await this.sendQueuedMessage(sessionId, messageId, content, images)
	}

	/**
	 * Validate that a message can be sent (session running, no other message sending).
	 * Returns error message if validation fails, undefined if valid.
	 */
	private validateMessagePrerequisites(sessionId: string, messageId: string): void | undefined {
		// Check if session is running
		if (!this.processHandler.hasStdin(sessionId)) {
			this.outputChannel.appendLine(`[AgentManager] Session ${sessionId} not running, message send failed`)
			this.notifyMessageStatus(sessionId, messageId, "failed", "Session is not running")
			return
		}

		// Check one-at-a-time constraint
		if (this.sendingMessageMap.has(sessionId)) {
			this.outputChannel.appendLine(
				`[AgentManager] Message ${messageId} queued - another message is currently sending`,
			)
			this.notifyMessageStatus(sessionId, messageId, "failed", "Another message is currently being sent")
			return
		}
	}

	/**
	 * Send a validated queued message to the agent.
	 * Handles marking as sending, actual send, and error handling.
	 */
	private async sendQueuedMessage(
		sessionId: string,
		messageId: string,
		content: string,
		images?: string[],
	): Promise<void> {
		// Mark as sending
		this.sendingMessageMap.set(sessionId, messageId)
		this.notifyMessageStatus(sessionId, messageId, "sending")

		try {
			// Use buildRuntimeMessage to send base64 images directly (not file paths)
			const message = this.buildRuntimeMessage(content, images)
			await this.safeWriteToStdin(sessionId, message, "message")
			this.log(sessionId, `Message ${messageId} sent successfully`)
			this.notifyMessageStatus(sessionId, messageId, "sent")
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : "Unknown error"
			this.outputChannel.appendLine(`[AgentManager] Failed to send message ${messageId}: ${errorMsg}`)
			this.notifyMessageStatus(sessionId, messageId, "failed", errorMsg)
		} finally {
			// Clear the sending flag
			this.sendingMessageMap.delete(sessionId)
		}
	}

	/**
	 * Notify the webview of message status changes.
	 */
	private notifyMessageStatus(
		sessionId: string,
		messageId: string,
		status: "sending" | "sent" | "failed",
		error?: string,
	): void {
		this.postMessage({
			type: "agentManager.messageStatus",
			sessionId,
			messageId,
			status,
			error,
		})
	}

	/**
	 * Resume a completed session by spawning a new agent-runtime process.
	 * The agent-runtime will load conversation history from server using sessionId.
	 * Supports both local sessions (in registry) and remote sessions (from server).
	 */
	public async resumeSession(
		sessionId: string,
		content: string,
		sessionLabel?: string,
		images?: string[],
	): Promise<void> {
		const session = this.registry.getSession(sessionId)

		// If session is still running, send as regular message instead
		if (this.processHandler.hasStdin(sessionId)) {
			await this.sendMessage(sessionId, content, undefined, images)
			return
		}

		// If session is already being created (another resume in progress), queue the message
		if (session?.status === "creating") {
			this.outputChannel.appendLine(
				`[AgentManager] Session ${sessionId} is already starting, queueing message for later`,
			)
			// Store the message to send after session is ready
			// The message will be handled when the session becomes active
			return
		}

		// For agent-runtime, pass base64 images directly (not file paths)
		if (images && images.length > 0) {
			this.outputChannel.appendLine(`[AgentManager] Passing ${images.length} images (base64) to resumed session`)
		}

		this.outputChannel.appendLine(`[AgentManager] Resuming session ${sessionId} with new prompt`)

		// Fetch full session data for resume (UI messages + API history + metadata)
		let sessionData:
			| {
					uiMessages: ClineMessage[]
					apiConversationHistory: unknown[]
					metadata: { sessionId: string; title: string; createdAt: string; mode: string | null }
			  }
			| undefined
		try {
			const fetchedData = await this.remoteSessionService.fetchSessionDataForResume(sessionId)
			if (fetchedData) {
				sessionData = fetchedData
				this.outputChannel.appendLine(
					`[AgentManager] Fetched session data: ${fetchedData.uiMessages.length} UI messages, ${fetchedData.apiConversationHistory.length} API history entries`,
				)
			} else {
				this.outputChannel.appendLine(`[AgentManager] No session data available for resume`)
			}
		} catch (error) {
			this.outputChannel.appendLine(
				`[AgentManager] Failed to fetch session data for resume: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}

		// Determine the mode to use for resume: prefer session metadata, fall back to local session mode
		const resumeMode = sessionData?.metadata?.mode || session?.mode
		if (resumeMode) {
			this.outputChannel.appendLine(`[AgentManager] Resuming with mode: ${resumeMode}`)
		}

		// Handle local session with parallel mode
		if (session?.parallelMode?.enabled && session.parallelMode.branch) {
			const worktreeInfo = await this.prepareWorktreeForResume(session)
			if (worktreeInfo) {
				await this.spawnAgentWithCommonSetup(content, {
					sessionId,
					parallelMode: true,
					gitUrl: session.gitUrl,
					worktreeInfo,
					effectiveWorkspace: worktreeInfo.path,
					images,
					sessionData,
					model: session.model,
					mode: resumeMode ?? undefined,
				})
				return
			}
			// If worktree preparation failed, fall through to non-parallel mode
			this.outputChannel.appendLine(`[AgentManager] Failed to prepare worktree, resuming without parallel mode`)
		}

		// Resume session - pass session data for agent-runtime to load
		await this.spawnAgentWithCommonSetup(content, {
			sessionId,
			label: sessionLabel || session?.label,
			parallelMode: session?.parallelMode?.enabled,
			gitUrl: session?.gitUrl,
			images,
			sessionData,
			model: session?.model,
			mode: resumeMode ?? undefined,
		})
	}

	/**
	 * Prepare worktree for resuming a parallel mode session.
	 * Uses existing worktree if available, otherwise recreates it from the session's branch.
	 */
	private async prepareWorktreeForResume(
		session: AgentSession,
	): Promise<{ branch: string; path: string; parentBranch: string } | undefined> {
		if (!session.parallelMode?.branch) {
			return undefined
		}

		const existingPath = session.parallelMode.worktreePath
		const branch = session.parallelMode.branch
		const parentBranch = session.parallelMode.parentBranch || "main"

		// Check if existing worktree is still valid
		if (existingPath && fs.existsSync(existingPath)) {
			const gitFile = path.join(existingPath, ".git")
			if (fs.existsSync(gitFile)) {
				this.outputChannel.appendLine(`[AgentManager] Reusing existing worktree at: ${existingPath}`)
				return { branch, path: existingPath, parentBranch }
			}
		}

		// Worktree doesn't exist - recreate it from the existing branch
		this.outputChannel.appendLine(`[AgentManager] Recreating worktree for branch: ${branch}`)
		try {
			const manager = this.getWorktreeManager()
			const worktreeInfo = await manager.createWorktree({ existingBranch: branch })

			// Update session with new worktree path
			this.registry.updateParallelModeInfo(session.sessionId, { worktreePath: worktreeInfo.path })

			return worktreeInfo
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[AgentManager] Failed to recreate worktree: ${errorMsg}`)
			return undefined
		}
	}

	/**
	 * Cancel/abort a running agent session via stdin.
	 * Falls back to SIGTERM if stdin write fails.
	 * Does nothing if the session is not running.
	 */
	public async cancelSession(sessionId: string): Promise<void> {
		if (!this.processHandler.hasStdin(sessionId)) {
			// Session is not running or stdin unavailable - force stop
			this.outputChannel.appendLine(`[AgentManager] Session ${sessionId} not running, stopping process`)
			this.stopAgentSession(sessionId)
			return
		}

		const message = { type: "cancelTask" }

		try {
			await this.safeWriteToStdin(sessionId, message, "cancel")
			this.log(sessionId, "Cancel request sent via stdin")
			this.stopAgentSession(sessionId)
		} catch (error) {
			// Fallback to SIGTERM if stdin write fails
			this.outputChannel.appendLine(`Failed to send cancel via stdin, falling back to SIGTERM: ${error}`)
			this.stopAgentSession(sessionId)
		}
	}

	/**
	 * Respond to an approval prompt (yes/no button click).
	 * Optionally includes additional text context.
	 */
	public async respondToApproval(sessionId: string, approved: boolean, text?: string): Promise<void> {
		if (!this.processHandler.hasStdin(sessionId)) {
			throw new Error(`Session ${sessionId} not found or not running`)
		}

		const message: { type: string; askResponse: string; text?: string } = {
			type: "askResponse",
			askResponse: approved ? "yesButtonClicked" : "noButtonClicked",
		}

		if (text) {
			message.text = text
		}

		await this.safeWriteToStdin(sessionId, message, approved ? "approval-yes" : "approval-no")
		this.log(sessionId, `Approval response sent: ${approved ? "approved" : "rejected"}`)
	}

	private async respondToTeamApproval(
		runId: string,
		approvalId: string,
		approved: boolean,
		reason?: string,
	): Promise<void> {
		try {
			const approval = await this.teamCoordinator.resolveApproval({ runId, approvalId, approved, reason })
			if (!approval) {
				this.outputChannel.appendLine(
					`[AgentManager] Team approval not found: runId=${runId}, approvalId=${approvalId}`,
				)
				return
			}

			this.outputChannel.appendLine(
				`[AgentManager] Team approval resolved: ${approvalId} -> ${approved ? "approved" : "rejected"}`,
			)
			this.postTeamRunStateToWebview()
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(
				`[AgentManager] Failed to resolve team approval ${approvalId} for run ${runId}: ${errorMessage}`,
			)
		}
	}

	private async safeWriteToStdin(sessionId: string, payload: object, label: string): Promise<void> {
		try {
			await this.processHandler.writeToStdin(sessionId, payload)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[AgentManager] Failed to send ${label} via stdin: ${errorMessage}`)
			void vscode.window.showErrorMessage(`Failed to send ${label} to agent: ${errorMessage}`)
			throw error
		}
	}

	/**
	 * Cancel a pending session that is stuck in "Creating session..." state
	 */
	private cancelPendingSession(): void {
		this.processHandler.cancelPendingSession()
	}

	/**
	 * Remove a session completely
	 */
	private removeSession(sessionId: string): void {
		// Stop process if running
		this.processHandler.stopProcess(sessionId)

		// Clean up messages
		this.sessionMessages.delete(sessionId)

		this.registry.removeSession(sessionId)
		this.postStateToWebview()

		this.firstApiReqStarted.delete(sessionId)
		this.processStartTimes.delete(sessionId)
		this.sendingMessageMap.delete(sessionId)
		this.teamSessionSettlement.delete(sessionId)
	}

	private getFilteredState() {
		return this.registry.getStateForGitUrl(this.currentGitUrl)
	}

	private postStateToWebview(): void {
		this.postMessage({
			type: "agentManager.state",
			state: this.getFilteredState(),
		})
		this.postTeamRunStateToWebview()
	}

	private postTeamRunStateToWebview(): void {
		this.postMessage({
			type: "agentManager.teamRunState",
			state: this.teamCoordinator.getState(),
		})
	}

	private async fetchAndPostRemoteSessions(): Promise<void> {
		try {
			const remoteSessions = await this.remoteSessionService.fetchRemoteSessions()

			// Filter remote sessions by git_url (only if git_url is available from API)
			const filteredSessions = this.filterRemoteSessionsByGitUrl(remoteSessions)

			this.postMessage({
				type: "agentManager.remoteSessions",
				sessions: filteredSessions,
			})
		} catch (error) {
			this.outputChannel.appendLine(`[AgentManager] Failed to fetch remote sessions: ${error}`)
		}
	}

	/**
	 * Get available models from the extension's cache and post to webview.
	 * Models are already fetched by the main extension - we just read from the shared cache.
	 * @param forceRefresh - If true, clears local cache (extension cache is still used)
	 */
	private async fetchAndPostAvailableModels(forceRefresh: boolean = false): Promise<void> {
		// Skip if we already have cached models and not forcing refresh
		if (this.availableModels && !forceRefresh) {
			this.postModelsToWebview(this.availableModels)
			return
		}

		// Skip if already fetching
		if (this.fetchingModels) {
			return
		}

		this.fetchingModels = true

		try {
			// Get API configuration from the extension
			const state = await this.provider.getState()
			const { apiConfiguration } = state

			// Determine the provider - default to "novacode" if not set
			const providerName = apiConfiguration.apiProvider || "novacode"

			// Check if this provider supports model fetching via router
			if (!isRouterName(providerName)) {
				this.outputChannel.appendLine(
					`[AgentManager] Provider "${providerName}" does not support dynamic model fetching`,
				)
				this.postMessage({
					type: "agentManager.modelsLoadFailed",
					error: `Provider "${providerName}" does not support dynamic model fetching`,
				})
				return
			}

			this.outputChannel.appendLine(`[AgentManager] Getting models for provider "${providerName}" from cache...`)

			// Get models from the extension's shared cache (already fetched by main extension)
			const models = getModelsFromCache(providerName)

			if (!models || Object.keys(models).length === 0) {
				this.outputChannel.appendLine(
					`[AgentManager] No models in cache for "${providerName}" - extension may still be loading`,
				)
				this.postMessage({
					type: "agentManager.modelsLoadFailed",
					error: "Models not yet loaded. Please wait for the extension to finish loading.",
				})
				return
			}

			// Get the current model ID from configuration
			const currentModel = getModelId(apiConfiguration) || ""

			// Store the cached result
			this.availableModels = {
				provider: providerName,
				currentModel,
				models,
			}

			const modelCount = Object.keys(models).length
			this.outputChannel.appendLine(`[AgentManager] Got ${modelCount} models for provider "${providerName}"`)

			this.postModelsToWebview(this.availableModels)
		} catch (error) {
			this.outputChannel.appendLine(
				`[AgentManager] Error getting models: ${error instanceof Error ? error.message : String(error)}`,
			)
			this.postMessage({
				type: "agentManager.modelsLoadFailed",
				error: error instanceof Error ? error.message : "Failed to get models",
			})
		} finally {
			this.fetchingModels = false
		}
	}

	/**
	 * Fetch available modes from ClineProvider and post to webview
	 */
	private async fetchAndPostAvailableModes(): Promise<void> {
		try {
			// Get full mode data directly from customModesManager and DEFAULT_MODES
			// This provides description, iconName, and source which getModes() doesn't include
			const customModes = await this.provider.customModesManager.getCustomModes()
			const allModes = [...DEFAULT_MODES, ...customModes]
			const currentMode = await this.provider.getMode()
			this.outputChannel.appendLine(
				`[AgentManager] Fetched ${allModes.length} available modes, current: ${currentMode}`,
			)

			this.postMessage({
				type: "agentManager.availableModes",
				modes: allModes.map((mode) => ({
					slug: mode.slug,
					name: mode.name,
					description: mode.description,
					iconName: mode.iconName,
					source: mode.source as "global" | "project" | "organization" | undefined,
				})),
				currentMode,
			})
		} catch (error) {
			this.outputChannel.appendLine(
				`[AgentManager] Error fetching modes: ${error instanceof Error ? error.message : String(error)}`,
			)
			// Send empty modes array on error
			this.postMessage({
				type: "agentManager.availableModes",
				modes: [],
				currentMode: DEFAULT_MODE_SLUG,
			})
		}
	}

	/**
	 * Post models to the webview in the expected format.
	 */
	private postModelsToWebview(cached: { provider: string; currentModel: string; models: ModelRecord }): void {
		// Transform ModelRecord to array format expected by webview
		const modelsArray = Object.entries(cached.models).map(([id, info]) => ({
			id,
			displayName: info.displayName || null,
			contextWindow: info.contextWindow ?? 0,
			supportsImages: info.supportsImages,
			inputPrice: info.inputPrice,
			outputPrice: info.outputPrice,
		}))

		this.postMessage({
			type: "agentManager.availableModels",
			provider: cached.provider,
			currentModel: cached.currentModel,
			models: modelsArray,
		})
	}

	private async handleListBranches(): Promise<void> {
		try {
			const gitService = new WorkspaceGitService()
			const { branches, currentBranch } = await gitService.getBranchInfo()
			this.postMessage({ type: "agentManager.branches", branches, currentBranch })
		} catch (error) {
			this.outputChannel.appendLine(
				`[AgentManager] Failed to list branches: ${error instanceof Error ? error.message : String(error)}`,
			)
			this.postMessage({ type: "agentManager.branches", branches: [], currentBranch: undefined })
		}
	}

	private filterRemoteSessionsByGitUrl(sessions: RemoteSession[]): RemoteSession[] {
		if (!this.currentGitUrl) {
			return sessions.filter((s) => !s.git_url)
		}
		return sessions.filter((s) => s.git_url === this.currentGitUrl)
	}

	private postMessage(message: unknown): void {
		// Log outgoing message to webview
		const msg = message as { type?: string; sessionId?: string; messages?: ClineMessage[] }
		if (msg.type === "agentManager.chatMessages") {
			const lastMsgs = msg.messages?.slice(-2).map((m) => {
				const msgType = `${m.type}:${m.say || m.ask || "?"}`
				const text = m.text?.slice(0, 30) || "(no text)"
				return `${msgType} "${text}"`
			})
			this.outputChannel.appendLine(
				`[Webview←] ${msg.type} sessionId=${msg.sessionId} (${msg.messages?.length || 0} messages)` +
					(lastMsgs?.length ? `\n  last: ${lastMsgs.join(", ")}` : ""),
			)
		} else if (msg.type === "agentManager.stateEvent") {
			const eventType = (msg as { eventType?: string }).eventType || "?"
			this.outputChannel.appendLine(`[Webview←] ${msg.type} sessionId=${msg.sessionId} eventType=${eventType}`)
		} else {
			this.outputChannel.appendLine(`[Webview←] ${msg.type || "unknown"}`)
		}
		this.panel?.webview.postMessage(message)
	}

	// HMR support for development mode - same approach as ClineProvider (see src/core/webview/ClineProvider.ts)
	private async getHMRHtmlContent(webview: vscode.Webview): Promise<string> {
		const viteConfig = await getViteDevServerConfig(webview)

		if (!viteConfig) {
			vscode.window.showErrorMessage(
				"Vite dev server is not running. Please run 'pnpm dev' in webview-ui directory or use 'pnpm build'.",
			)
			return this.getHtmlContent(webview)
		}

		const { localServerUrl, csp, reactRefreshScript } = viteConfig

		// Include both shared base styles (index.css with codicons) and agent-manager specific styles
		const baseStylesUri = getUri(webview, this.context.extensionUri, ["webview-ui", "build", "assets", "index.css"])
		const stylesUri = getUri(webview, this.context.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"agent-manager.css",
		])

		const scriptUri = `http://${localServerUrl}/src/nova/agent-manager/index.tsx`

		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${baseStylesUri}">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<title>Agent Manager</title>
				</head>
				<body>
					<div id="root"></div>
					${reactRefreshScript}
					<script type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`
	}

	private getHtmlContent(webview: vscode.Webview): string {
		// Get URIs for the React build assets
		const scriptUri = getUri(webview, this.context.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"agent-manager.js",
		])
		// Include both shared base styles (index.css) and agent-manager specific styles
		const baseStylesUri = getUri(webview, this.context.extensionUri, ["webview-ui", "build", "assets", "index.css"])
		const stylesUri = getUri(webview, this.context.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"agent-manager.css",
		])

		const nonce = getNonce()

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}';">
	<title>Agent Manager</title>
	<link rel="stylesheet" type="text/css" href="${baseStylesUri}">
	<link rel="stylesheet" type="text/css" href="${stylesUri}">
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`
	}

	public hasRunningSessions(): boolean {
		return this.registry.hasRunningSessions()
	}

	public getRunningSessionCount(): number {
		return this.registry.getRunningSessionCount()
	}

	private stopAllAgents(): void {
		this.processHandler.stopAllProcesses()

		// Update all running sessions to stopped
		for (const session of this.registry.getSessions()) {
			if (session.status === "running") {
				this.registry.updateSessionStatus(session.sessionId, "stopped", undefined, "Stopped by user")
			}
		}

		this.firstApiReqStarted.clear()
	}

	public dispose(): void {
		this.processHandler.dispose()
		this.terminalManager.dispose()
		this.sessionMessages.clear()
		this.firstApiReqStarted.clear()

		this.panel?.dispose()
		this.disposables.forEach((d) => d.dispose())
	}

	private showPaymentRequiredPrompt(payload?: NovacodePayload | { text?: string; content?: string }): void {
		const { title, message, buyCreditsUrl, rawText } = this.parsePaymentRequiredPayload(payload)

		captureAgentManagerLoginIssue({
			issueType: "payment_required",
		})

		const actionLabel = buyCreditsUrl ? "Open billing" : undefined
		const actions = actionLabel ? [actionLabel] : []

		this.outputChannel.appendLine(`[AgentManager] Payment required: ${message}`)

		void vscode.window.showWarningMessage(`${title}: ${message}`, ...actions).then((selection) => {
			if (selection === actionLabel && buyCreditsUrl) {
				void vscode.env.openExternal(vscode.Uri.parse(buyCreditsUrl))
			}
		})
	}

	private handleStartSessionApiFailure(error: { message?: string; authError?: boolean }): void {
		captureAgentManagerLoginIssue({
			issueType: error.authError ? "auth_error" : "api_error",
			httpStatusCode: error.authError ? 401 : undefined,
		})

		const message = error.message || t("novacode:agentManager.errors.sessionFailed")
		if (error.authError && message && message === this.lastAuthErrorMessage) {
			return
		}

		void vscode.window.showWarningMessage(message)
		if (error.authError) {
			this.lastAuthErrorMessage = message
		}
	}

	private parsePaymentRequiredPayload(payload?: NovacodePayload | { text?: string; content?: string }): {
		title: string
		message: string
		buyCreditsUrl?: string
		rawText?: string
	} {
		const fallbackTitle = t("novacode:lowCreditWarning.title")
		const fallbackMessage = t("novacode:lowCreditWarning.message")

		const rawText = payload ? extractRawText(payload) : undefined
		const parsed = rawText ? tryParsePayloadJson(rawText) : undefined

		const title =
			parsed?.title || (typeof fallbackTitle === "string" ? fallbackTitle : undefined) || "Payment required"
		const message =
			parsed?.message ||
			rawText ||
			(typeof fallbackMessage === "string" ? fallbackMessage : undefined) ||
			"Paid model requires credits or billing setup."

		return { title, message, buyCreditsUrl: parsed?.buyCreditsUrl, rawText }
	}

	private showAgentError(error?: { type: "spawn_error" | "unknown"; message: string }): void {
		const { platform, shell } = getPlatformDiagnostics()

		// Capture telemetry for spawn errors
		if (error?.type === "spawn_error") {
			captureAgentManagerLoginIssue({
				issueType: "cli_spawn_error", // Keep telemetry key for backwards compatibility
				platform,
				shell,
				errorMessage: error.message,
			})
		}

		// Show error message to user
		const errorMessage = error?.message
			? t("novacode:agentManager.errors.sessionFailedWithMessage", { message: error.message })
			: t("novacode:agentManager.errors.sessionFailed")
		const actionLabel = t("novacode:agentManager.actions.getHelp")
		vscode.window.showErrorMessage(errorMessage, actionLabel).then((selection) => {
			if (selection === actionLabel) {
				void vscode.env.openExternal(vscode.Uri.parse("https://nova.ai/docs"))
			}
		})
	}

	/**
	 * Check if the given directory is inside a git worktree (not the main repo).
	 * In a worktree, .git is a file containing "gitdir: /path/to/main/.git/worktrees/..."
	 * In the main repo, .git is a directory.
	 */
	private isInsideWorktree(workspacePath: string): boolean {
		try {
			const gitPath = path.join(workspacePath, ".git")
			const stat = fs.statSync(gitPath)
			// If .git is a file (not a directory), we're in a worktree
			return stat.isFile()
		} catch {
			// .git doesn't exist or can't be accessed
			return false
		}
	}
}
