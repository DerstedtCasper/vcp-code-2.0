import { Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { ConnectionState } from "../../types/messages"

export interface AboutVCPCodeTabProps {
  port: number | null
  connectionState: ConnectionState
  extensionVersion?: string
}

const AboutVCPCodeTab: Component<AboutVCPCodeTabProps> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const repoBaseUrl = "https://github.com/DerstedtCasper/vcp-code-2.0"
  const repoIssuesUrl = `${repoBaseUrl}/issues`
  const repoDiscussionsUrl = `${repoBaseUrl}/discussions`

  const open = (url: string) => {
    vscode.postMessage({ type: "openExternal", url })
  }

  const getStatusColor = () => {
    switch (props.connectionState) {
      case "connected":
        return "var(--vscode-testing-iconPassed, #89d185)"
      case "connecting":
        return "var(--vscode-testing-iconQueued, #cca700)"
      case "disconnected":
        return "var(--vscode-testing-iconFailed, #f14c4c)"
      case "error":
        return "var(--vscode-testing-iconFailed, #f14c4c)"
    }
  }

  const getStatusText = () => {
    switch (props.connectionState) {
      case "connected":
        return language.t("settings.aboutVCPCode.status.connected")
      case "connecting":
        return language.t("settings.aboutVCPCode.status.connecting")
      case "disconnected":
        return language.t("settings.aboutVCPCode.status.disconnected")
      case "error":
        return language.t("settings.aboutVCPCode.status.error")
    }
  }

  const linkStyle = {
    color: "var(--vscode-textLink-foreground)",
    "text-decoration": "none",
    cursor: "pointer",
  } as const

  const sectionStyle = {
    background: "var(--vscode-editor-background)",
    border: "1px solid var(--vscode-panel-border)",
    "border-radius": "4px",
    padding: "16px",
    "margin-bottom": "16px",
  } as const

  const headingStyle = {
    "font-size": "13px",
    "font-weight": "600",
    "margin-bottom": "12px",
    "margin-top": "0",
    color: "var(--vscode-foreground)",
  } as const

  const labelStyle = {
    "font-size": "12px",
    color: "var(--vscode-descriptionForeground)",
    width: "100px",
  } as const

  const valueStyle = {
    "font-size": "12px",
    color: "var(--vscode-foreground)",
    "font-family": "var(--vscode-editor-font-family, monospace)",
  } as const

  return (
    <div>
      {/* Version Information */}
      <div style={sectionStyle}>
        <h4 style={headingStyle}>{language.t("settings.aboutVCPCode.versionInfo")}</h4>
        <div style={{ display: "flex", "align-items": "center" }}>
          <span style={labelStyle}>{language.t("settings.aboutVCPCode.version.label")}</span>
          <span style={valueStyle}>{props.extensionVersion ?? "—"}</span>
        </div>
      </div>

      {/* Community & Support */}
      <div style={sectionStyle}>
        <h4 style={headingStyle}>{language.t("settings.aboutVCPCode.community")}</h4>
        <p
          style={{
            "font-size": "12px",
            color: "var(--vscode-descriptionForeground)",
            margin: "0 0 12px 0",
            "line-height": "1.5",
          }}
        >
          {language.t("settings.aboutVCPCode.feedback.prefix")}{" "}
          <span style={linkStyle} onClick={() => open(repoBaseUrl)}>
            GitHub
          </span>
          ,{" "}
          <span style={linkStyle} onClick={() => open(repoIssuesUrl)}>
            Issues
          </span>
          , {language.t("settings.aboutVCPCode.feedback.or")}{" "}
          <span style={linkStyle} onClick={() => open(repoDiscussionsUrl)}>
            Discussions
          </span>
          .
        </p>
        <p
          style={{
            "font-size": "12px",
            color: "var(--vscode-descriptionForeground)",
            margin: 0,
            "line-height": "1.5",
          }}
        >
          {language.t("settings.aboutVCPCode.support.prefix")}{" "}
          <span style={linkStyle} onClick={() => open(repoIssuesUrl)}>
            github.com/DerstedtCasper/vcp-code-2.0/issues
          </span>
          .
        </p>
      </div>

      {/* CLI Server */}
      <div style={sectionStyle}>
        <h4 style={headingStyle}>{language.t("settings.aboutVCPCode.cliServer")}</h4>

        {/* Connection Status */}
        <div style={{ display: "flex", "align-items": "center", "margin-bottom": "12px" }}>
          <span style={labelStyle}>{language.t("settings.aboutVCPCode.status.label")}</span>
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                "border-radius": "50%",
                background: getStatusColor(),
                display: "inline-block",
              }}
            />
            <span style={{ "font-size": "12px", color: "var(--vscode-foreground)" }}>{getStatusText()}</span>
          </div>
        </div>

        {/* Port Number */}
        <div style={{ display: "flex", "align-items": "center" }}>
          <span style={labelStyle}>{language.t("settings.aboutVCPCode.port.label")}</span>
          <span style={valueStyle}>{props.port !== null ? props.port : "—"}</span>
        </div>
      </div>

      {/* Reset Settings */}
      <div style={{ ...sectionStyle, "margin-bottom": "0" }}>
        <h4 style={headingStyle}>{language.t("settings.aboutVCPCode.resetSettings.title")}</h4>
        <p
          style={{
            "font-size": "12px",
            color: "var(--vscode-descriptionForeground)",
            margin: "0 0 12px 0",
            "line-height": "1.5",
          }}
        >
          {language.t("settings.aboutVCPCode.resetSettings.description")}
        </p>
        <Button
          size="small"
          onClick={() => vscode.postMessage({ type: "resetAllSettings" })}
        >
          {language.t("settings.aboutVCPCode.resetSettings.button")}
        </Button>
      </div>
    </div>
  )
}

export default AboutVCPCodeTab
