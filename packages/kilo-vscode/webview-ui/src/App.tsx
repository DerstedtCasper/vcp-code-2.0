import { Component, createSignal, createMemo, Switch, Match, Show, onMount, onCleanup } from "solid-js"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { DataProvider } from "@kilocode/kilo-ui/context/data"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Toast, showToast } from "@kilocode/kilo-ui/toast"
import Settings from "./components/Settings"
import ProfileView from "./components/ProfileView"
import { VSCodeProvider, useVSCode } from "./context/vscode"
import { ServerProvider, useServer } from "./context/server"
import { ProviderProvider } from "./context/provider"
import { ConfigProvider, useConfig } from "./context/config"
import { SessionProvider, useSession } from "./context/session"
import { LanguageProvider, useLanguage } from "./context/language"
import { ChatView } from "./components/chat"
import { KiloNotifications } from "./components/chat/KiloNotifications"
import SessionList from "./components/history/SessionList"
import { NotificationsProvider } from "./context/notifications"
import type { Message as SDKMessage, Part as SDKPart } from "@kilocode/sdk/v2"
import "./styles/chat.css"

type ViewType = "newTask" | "marketplace" | "history" | "profile" | "settings" | "vcp"
const VALID_VIEWS = new Set<string>(["newTask", "marketplace", "history", "profile", "settings", "vcp"])

const DummyView: Component<{ title: string }> = (props) => {
  return (
    <div
      style={{
        display: "flex",
        "justify-content": "center",
        "align-items": "center",
        height: "100%",
        "min-height": "200px",
        "font-size": "24px",
        color: "var(--vscode-foreground)",
      }}
    >
      <h1>{props.title}</h1>
    </div>
  )
}

const VCPView: Component<{ onOpenSettingsTab: (tab: string) => void; onOpenQueue: () => void }> = (props) => {
  const { config } = useConfig()
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()
  const vcpParts = createMemo(() => {
    const texts: string[] = []
    for (const message of session.messages()) {
      const parts = session.getParts(message.id)
      for (const part of parts) {
        if (part.type === "text") texts.push(part.text ?? "")
      }
    }
    return texts
  })
  const toolParts = createMemo(() => {
    const tools: string[] = []
    for (const message of session.messages()) {
      const parts = session.getParts(message.id)
      for (const part of parts) {
        if (part.type === "tool") tools.push((part.tool ?? "").toLowerCase())
      }
    }
    return tools
  })
  const foldCount = createMemo(() => vcpParts().filter((part) => part.includes("data-vcp-fold=\"true\"")).length)
  const infoCount = createMemo(() => vcpParts().filter((part) => part.includes("data-vcp-info=\"true\"")).length)
  const toolRequestCount = createMemo(() => vcpParts().filter((part) => part.includes("data-vcp-tool-request=\"true\"")).length)
  const windowSensorCount = createMemo(() => toolParts().filter((name) => name.includes("windowsensor")).length)
  const screenPilotCount = createMemo(() => toolParts().filter((name) => name.includes("screenpilot")).length)

  const status = (enabled: boolean | undefined) =>
    enabled === false ? language.t("vcp.view.status.disabled") : language.t("vcp.view.status.enabled")

  const connectionStateClass = createMemo(() => {
    const state = server.connectionState()
    if (state === "connected") return "status-dot status-dot--ok"
    if (state === "connecting") return "status-dot status-dot--warn"
    return "status-dot status-dot--error"
  })

  const protocolRows = createMemo(() => [
    { label: language.t("vcp.view.protocol.contextFold"), enabled: config().vcp?.contextFold?.enabled },
    { label: language.t("vcp.view.protocol.vcpInfo"), enabled: config().vcp?.vcpInfo?.enabled },
    { label: language.t("vcp.view.protocol.toolRequest"), enabled: config().vcp?.toolRequest?.enabled },
    { label: language.t("vcp.view.protocol.htmlRender"), enabled: config().vcp?.html?.enabled },
    { label: language.t("vcp.view.protocol.agentTeam"), enabled: config().vcp?.agentTeam?.enabled },
    { label: language.t("vcp.view.protocol.memoryRuntime"), enabled: config().vcp?.memory?.enabled },
  ])

  const refreshDiagnostics = () => {
    const id = session.currentSessionID()
    if (id) {
      session.syncSession(id)
    }
    session.requestPromptQueue()
    vscode.postMessage({ type: "requestProviders" })
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("vcp.view.diagnostics.actions.refreshed.title"),
      description: language.t("vcp.view.diagnostics.actions.refreshed.description"),
    })
  }

  const exportDiagnostics = async () => {
    const snapshot = {
      timestamp: new Date().toISOString(),
      connection: server.connectionState(),
      port: server.serverInfo()?.port ?? null,
      extensionVersion: server.extensionVersion() ?? null,
      error: server.error() ?? null,
      session: {
        id: session.currentSessionID() ?? null,
        status: session.status(),
        queuedPrompts: session.promptQueue().length,
        pendingPermissions: session.permissions().length,
        pendingQuestions: session.questions().length,
      },
      protocol: {
        contextFold: config().vcp?.contextFold?.enabled ?? true,
        vcpInfo: config().vcp?.vcpInfo?.enabled ?? true,
        toolRequest: config().vcp?.toolRequest?.enabled ?? true,
        htmlRender: config().vcp?.html?.enabled ?? true,
        agentTeam: config().vcp?.agentTeam?.enabled ?? false,
        memoryRuntime: config().vcp?.memory?.enabled ?? true,
      },
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2))
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("vcp.view.diagnostics.actions.export.success.title"),
        description: language.t("vcp.view.diagnostics.actions.export.success.description"),
      })
    } catch {
      showToast({
        title: language.t("vcp.view.diagnostics.actions.export.failed.title"),
        description: language.t("vcp.view.diagnostics.actions.export.failed.description"),
      })
    }
  }

  return (
    <div class="vcp-control-center">
      <Card>
        <h3 style={{ margin: "0 0 8px 0" }}>{language.t("vcp.view.title")}</h3>
        <p style={{ margin: 0, "font-size": "12px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
          {language.t("vcp.view.description")}
        </p>
      </Card>

      <Card>
        <h4 style={{ margin: "0 0 10px 0" }}>{language.t("vcp.view.protocol.title")}</h4>
        <div class="vcp-control-center__rows">
          {protocolRows().map((item) => (
            <div class="vcp-control-center__row">
              <div style={{ display: "flex", "align-items": "center", gap: "8px", "min-width": 0 }}>
                <span>{item.label}</span>
                <span class={`vcp-status-tag${item.enabled === false ? " vcp-status-tag--disabled" : ""}`}>
                  {status(item.enabled)}
                </span>
              </div>
              <Button size="small" variant="ghost" onClick={() => props.onOpenSettingsTab("agentBehaviour")}>
                {language.t("vcp.view.action.configure")}
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h4 style={{ margin: "0 0 10px 0" }}>{language.t("vcp.view.runtime.title")}</h4>
        <div class="vcp-control-center__metrics">
          <div>{language.t("vcp.view.runtime.activeSession")}: {session.currentSessionID() ?? "-"}</div>
          <div>{language.t("vcp.view.runtime.sessionStatus")}: {session.status()}</div>
          <div>{language.t("vcp.view.runtime.queuedPrompts")}: {session.promptQueue().length}</div>
          <div>{language.t("vcp.view.runtime.pendingPermissions")}: {session.permissions().length}</div>
          <div>{language.t("vcp.view.runtime.pendingQuestions")}: {session.questions().length}</div>
        </div>
        <div class="vcp-control-center__actions">
          <Button size="small" variant="secondary" onClick={props.onOpenQueue}>
            {language.t("vcp.view.runtime.actions.viewQueue")}
          </Button>
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              session.dequeuePrompt()
              showToast({
                variant: "success",
                icon: "circle-check",
                title: language.t("vcp.view.runtime.actions.queueCleared.title"),
                description: language.t("vcp.view.runtime.actions.queueCleared.description"),
              })
            }}
          >
            {language.t("vcp.view.runtime.actions.clearQueue")}
          </Button>
        </div>
      </Card>

      <Card>
        <h4 style={{ margin: "0 0 10px 0" }}>{language.t("vcp.view.diagnostics.title")}</h4>
        <div class="vcp-control-center__metrics">
          <div>
            {language.t("vcp.view.diagnostics.connection")}:{" "}
            <span style={{ display: "inline-flex", "align-items": "center", gap: "6px" }}>
              <span class={connectionStateClass()} />
              {server.connectionState()}
            </span>
          </div>
          <div>{language.t("vcp.view.diagnostics.serverPort")}: {server.serverInfo()?.port ?? "-"}</div>
          <div>{language.t("vcp.view.diagnostics.extensionVersion")}: {server.extensionVersion() ?? "-"}</div>
          <div>{language.t("vcp.view.diagnostics.error")}: {server.error() ?? "-"}</div>
        </div>
        <div class="vcp-control-center__actions">
          <Button size="small" variant="secondary" onClick={refreshDiagnostics}>
            {language.t("vcp.view.diagnostics.actions.refresh")}
          </Button>
          <Button size="small" variant="ghost" onClick={() => void exportDiagnostics()}>
            {language.t("vcp.view.diagnostics.actions.export")}
          </Button>
        </div>
      </Card>

      <Card>
        <h4 style={{ margin: "0 0 10px 0" }}>{language.t("vcp.view.visualization.title")}</h4>
        <div class="vcp-control-center__metrics">
          <div>{language.t("vcp.view.visualization.foldBlocks")}: {foldCount()}</div>
          <div>{language.t("vcp.view.visualization.vcpInfoBlocks")}: {infoCount()}</div>
          <div>{language.t("vcp.view.visualization.toolRequestBlocks")}: {toolRequestCount()}</div>
          <div>{language.t("vcp.view.observability.windowSensorCalls")}: {windowSensorCount()}</div>
          <div>{language.t("vcp.view.observability.screenPilotCalls")}: {screenPilotCount()}</div>
          <div>{language.t("vcp.view.observability.browserAutomation")}: {status(config().browserAutomation?.enabled)}</div>
        </div>
      </Card>
    </div>
  )
}

/**
 * Bridge our session store to the DataProvider's expected Data shape.
 */
export const DataBridge: Component<{ children: any }> = (props) => {
  const session = useSession()
  const vscode = useVSCode()

  const data = createMemo(() => {
    const id = session.currentSessionID()
    const perms = id ? session.permissions().filter((p) => p.sessionID === id) : []
    return {
      session: session.sessions().map((s) => ({ ...s, id: s.id, role: "user" as const })) as unknown as any[],
      session_status: {} as Record<string, any>,
      session_diff: {} as Record<string, any[]>,
      message: id ? { [id]: session.messages() as unknown as SDKMessage[] } : {},
      part: id
        ? Object.fromEntries(
            session
              .messages()
              .map((msg) => [msg.id, session.getParts(msg.id) as unknown as SDKPart[]])
              .filter(([, parts]) => (parts as SDKPart[]).length > 0),
          )
        : {},
      permission: id ? { [id]: perms as unknown as any[] } : {},
    }
  })

  const respond = (input: { sessionID: string; permissionID: string; response: "once" | "always" | "reject" }) => {
    session.respondToPermission(input.permissionID, input.response)
  }

  const sync = (sessionID: string) => {
    session.syncSession(sessionID)
  }

  const open = (filePath: string, line?: number, column?: number) => {
    vscode.postMessage({ type: "openFile", filePath, line, column })
  }

  return (
    <DataProvider data={data()} directory="" onPermissionRespond={respond} onSyncSession={sync} onOpenFile={open}>
      {props.children}
    </DataProvider>
  )
}

/**
 * Wraps children in LanguageProvider, passing server-side language info.
 * Must be below ServerProvider in the hierarchy.
 */
export const LanguageBridge: Component<{ children: any }> = (props) => {
  const server = useServer()
  return (
    <LanguageProvider vscodeLanguage={server.vscodeLanguage} languageOverride={server.languageOverride}>
      {props.children}
    </LanguageProvider>
  )
}

// Inner app component that uses the contexts
const AppContent: Component = () => {
  const [currentView, setCurrentView] = createSignal<ViewType>("newTask")
  const [settingsTab, setSettingsTab] = createSignal("providers")
  const session = useSession()
  const server = useServer()
  const language = useLanguage()

  const handleViewAction = (action: string) => {
    switch (action) {
      case "plusButtonClicked":
        session.clearCurrentSession()
        setCurrentView("newTask")
        break
      case "marketplaceButtonClicked":
        setCurrentView("marketplace")
        break
      case "historyButtonClicked":
        setCurrentView("history")
        break
      case "profileButtonClicked":
        setCurrentView("profile")
        break
      case "vcpButtonClicked":
        setSettingsTab("agentBehaviour")
        setCurrentView("settings")
        break
      case "providersButtonClicked":
      case "settingsButtonClicked":
        setSettingsTab("providers")
        setCurrentView("settings")
        break
      case "terminalButtonClicked":
        setSettingsTab("terminal")
        setCurrentView("settings")
        break
      case "promptsButtonClicked":
        setSettingsTab("prompts")
        setCurrentView("settings")
        break
    }
  }

  onMount(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data
      if (message?.type === "action" && message.action) {
        console.log("[VCP] App: 馃幀 action:", message.action)
        handleViewAction(message.action)
      }
      if (message?.type === "navigate" && message.view && VALID_VIEWS.has(message.view)) {
        console.log("[VCP] App: 馃Л navigate:", message.view)
        setCurrentView(message.view as ViewType)
      }
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  const handleSelectSession = (id: string) => {
    session.selectSession(id)
    setCurrentView("newTask")
  }

  return (
    <div class="container">
      <Switch fallback={<ChatView />}>
        <Match when={currentView() === "newTask"}>
          <Show when={!session.currentSessionID()}>
            <KiloNotifications />
          </Show>
          <ChatView onSelectSession={handleSelectSession} />
        </Match>
        <Match when={currentView() === "marketplace"}>
          <DummyView title={language.t("view.marketplace.title")} />
        </Match>
        <Match when={currentView() === "history"}>
          <SessionList onSelectSession={handleSelectSession} />
        </Match>
        <Match when={currentView() === "profile"}>
          <ProfileView
            profileData={server.profileData()}
            deviceAuth={server.deviceAuth()}
            onLogin={server.startLogin}
          />
        </Match>
        <Match when={currentView() === "settings"}>
          <Settings initialTab={settingsTab()} onBack={() => setCurrentView("newTask")} />
        </Match>
        <Match when={currentView() === "vcp"}>
          <VCPView
            onOpenSettingsTab={(tab) => {
              setSettingsTab(tab)
              setCurrentView("settings")
            }}
            onOpenQueue={() => setCurrentView("newTask")}
          />
        </Match>
      </Switch>
    </div>
  )
}

// Main App component with context providers
const App: Component = () => {
  return (
    <ThemeProvider defaultTheme="VCP-vscode">
      <DialogProvider>
        <VSCodeProvider>
          <ServerProvider>
            <LanguageBridge>
              <MarkedProvider>
                <DiffComponentProvider component={Diff}>
                  <CodeComponentProvider component={Code}>
                    <ProviderProvider>
                      <ConfigProvider>
                        <NotificationsProvider>
                          <SessionProvider>
                            <DataBridge>
                              <AppContent />
                            </DataBridge>
                          </SessionProvider>
                        </NotificationsProvider>
                      </ConfigProvider>
                    </ProviderProvider>
                  </CodeComponentProvider>
                </DiffComponentProvider>
              </MarkedProvider>
            </LanguageBridge>
          </ServerProvider>
        </VSCodeProvider>
        <Toast.Region />
      </DialogProvider>
    </ThemeProvider>
  )
}

export default App



