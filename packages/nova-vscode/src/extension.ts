import * as vscode from "vscode"
import { NovaProvider } from "./NovaProvider"
import { AgentManagerProvider } from "./agent-manager/AgentManagerProvider"
import { EXTENSION_DISPLAY_NAME } from "./constants"
import { NovaConnectionService } from "./services/cli-backend"
import { registerAutocompleteProvider } from "./services/autocomplete"
import { BrowserAutomationService } from "./services/browser-automation"
import { TelemetryProxy } from "./services/telemetry"
import { registerCommitMessageService } from "./services/commit-message"
import { registerCodeActions, registerTerminalActions, NovaCodeActionProvider } from "./services/code-actions"

export function activate(context: vscode.ExtensionContext) {
  console.log("VCP Code 2.0 extension is now active")

  const telemetry = TelemetryProxy.getInstance()

  // Create shared connection service (one server for all webviews)
  const connectionService = new NovaConnectionService(context)

  // Create browser automation service (manages Playwright MCP registration)
  const browserAutomationService = new BrowserAutomationService(connectionService)
  browserAutomationService.syncWithSettings()

  // Re-register browser automation MCP server on CLI backend reconnect and configure telemetry
  const unsubscribeStateChange = connectionService.onStateChange((state) => {
    if (state === "connected") {
      browserAutomationService.reregisterIfEnabled()
      const config = connectionService.getServerConfig()
      if (config) {
        telemetry.configure(config.baseUrl, config.password)
      }
    }
  })

  // Create the provider with shared service
  const provider = new NovaProvider(context.extensionUri, connectionService, context)

  // Register the webview view provider for the sidebar.
  // retainContextWhenHidden keeps the webview alive when switching to other sidebar panels.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(NovaProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  // Create Agent Manager provider for editor panel
  const agentManagerProvider = new AgentManagerProvider(context.extensionUri, connectionService)
  context.subscriptions.push(agentManagerProvider)

  // Register toolbar button command handlers
  context.subscriptions.push(
    vscode.commands.registerCommand("vcp-code.new.plusButtonClicked", () => {
      provider.postMessage({ type: "action", action: "plusButtonClicked" })
    }),
    vscode.commands.registerCommand("vcp-code.new.agentManagerOpen", () => {
      agentManagerProvider.openPanel()
    }),
    vscode.commands.registerCommand("vcp-code.new.marketplaceButtonClicked", () => {
      provider.postMessage({ type: "action", action: "marketplaceButtonClicked" })
    }),
    vscode.commands.registerCommand("vcp-code.new.historyButtonClicked", () => {
      provider.postMessage({ type: "action", action: "historyButtonClicked" })
    }),
    vscode.commands.registerCommand("vcp-code.new.profileButtonClicked", () => {
      provider.postMessage({ type: "action", action: "profileButtonClicked" })
    }),
    vscode.commands.registerCommand("vcp-code.new.vcpButtonClicked", () => {
      provider.postMessage({ type: "action", action: "vcpButtonClicked" })
    }),
    vscode.commands.registerCommand("vcp-code.new.settingsButtonClicked", () => {
      provider.postMessage({ type: "action", action: "settingsButtonClicked" })
    }),
    vscode.commands.registerCommand("vcp-code.new.promptsButtonClicked", () => {
      provider.postMessage({ type: "action", action: "promptsButtonClicked" })
    }),
    vscode.commands.registerCommand("vcp-code.new.helpButtonClicked", () => {
      void vscode.env.openExternal(vscode.Uri.parse("https://opencode.ai/docs"))
    }),
    vscode.commands.registerCommand("vcp-code.new.popoutButtonClicked", () => {
      return openNovaInNewTab(context, connectionService)
    }),
    vscode.commands.registerCommand("vcp-code.new.openInNewTab", () => {
      return openNovaInNewTab(context, connectionService)
    }),
    vscode.commands.registerCommand("vcp-code.new.exportConfig", async () => {
      await provider.exportGlobalConfig()
    }),
    vscode.commands.registerCommand("vcp-code.new.importConfig", async () => {
      await provider.importGlobalConfig()
    }),
    vscode.commands.registerCommand("vcp-code.new.openInTab", () => {
      return openNovaInNewTab(context, connectionService)
    }),
    vscode.commands.registerCommand("vcp-code.new.agentManager.previousSession", () => {
      agentManagerProvider.postMessage({ type: "action", action: "sessionPrevious" })
    }),
    vscode.commands.registerCommand("vcp-code.new.agentManager.nextSession", () => {
      agentManagerProvider.postMessage({ type: "action", action: "sessionNext" })
    }),
    vscode.commands.registerCommand("vcp-code.new.agentManager.previousTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "tabPrevious" })
    }),
    vscode.commands.registerCommand("vcp-code.new.agentManager.nextTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "tabNext" })
    }),
    vscode.commands.registerCommand("vcp-code.new.agentManager.showTerminal", () => {
      agentManagerProvider.showTerminalForCurrentSession()
    }),
    vscode.commands.registerCommand("vcp-code.new.agentManager.focusPanel", () => {
      agentManagerProvider.focusPanel()
    }),
    vscode.commands.registerCommand("vcp-code.new.agentManager.newTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newTab" })
    }),
    vscode.commands.registerCommand("vcp-code.new.agentManager.closeTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "closeTab" })
    }),
    vscode.commands.registerCommand("vcp-code.new.agentManager.newWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newWorktree" })
    }),
    vscode.commands.registerCommand("vcp-code.new.agentManager.closeWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "closeWorktree" })
    }),
  )

  // Register autocomplete provider
  registerAutocompleteProvider(context, connectionService)

  // Register commit message generation
  registerCommitMessageService(context, connectionService)

  // Register code actions (editor context menus, terminal context menus, keyboard shortcuts)
  registerCodeActions(context, provider, agentManagerProvider)
  registerTerminalActions(context, provider)

  // Register CodeActionProvider (lightbulb quick fixes)
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      new NovaCodeActionProvider(),
      NovaCodeActionProvider.metadata,
    ),
  )

  // Dispose services when extension deactivates (kills the server)
  context.subscriptions.push({
    dispose: () => {
      unsubscribeStateChange()
      browserAutomationService.dispose()
      provider.dispose()
      connectionService.dispose()
    },
  })
}

export function deactivate() {
  TelemetryProxy.getInstance().shutdown()
}

async function openNovaInNewTab(context: vscode.ExtensionContext, connectionService: NovaConnectionService) {
  const lastCol = Math.max(...vscode.window.visibleTextEditors.map((e) => e.viewColumn || 0), 0)
  const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0

  if (!hasVisibleEditors) {
    await vscode.commands.executeCommand("workbench.action.newGroupRight")
  }

  const targetCol = hasVisibleEditors ? Math.max(lastCol + 1, 1) : vscode.ViewColumn.Two

  const panel = vscode.window.createWebviewPanel("vcp-code.new.TabPanel", EXTENSION_DISPLAY_NAME, targetCol, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [context.extensionUri],
  })

  panel.iconPath = {
    light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "nova-light.svg"),
    dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "nova-dark.svg"),
  }

  const tabProvider = new NovaProvider(context.extensionUri, connectionService, context)
  tabProvider.resolveWebviewPanel(panel)

  // Wait for the new panel to become active before locking the editor group.
  // This avoids the race where VS Code hasn't switched focus yet.
  await waitForWebviewPanelToBeActive(panel)
  await vscode.commands.executeCommand("workbench.action.lockEditorGroup")

  panel.onDidDispose(
    () => {
      console.log("[VCP Code 2.0] Tab panel disposed")
      tabProvider.dispose()
    },
    null,
    context.subscriptions,
  )
}

function waitForWebviewPanelToBeActive(panel: vscode.WebviewPanel): Promise<void> {
  if (panel.active) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const disposable = panel.onDidChangeViewState((event) => {
      if (!event.webviewPanel.active) {
        return
      }
      disposable.dispose()
      resolve()
    })
  })
}
