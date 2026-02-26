import { Component, For, Show, createMemo } from "solid-js"
import { Select } from "@novacode/nova-ui/select"
import { Card } from "@novacode/nova-ui/card"
import { Switch } from "@novacode/nova-ui/switch"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import type { PermissionLevel } from "../../types/messages"

const TOOLS = [
  "read",
  "edit",
  "glob",
  "grep",
  "list",
  "bash",
  "task",
  "skill",
  "lsp",
  "todoread",
  "todowrite",
  "webfetch",
  "websearch",
  "codesearch",
  "external_directory",
  "doom_loop",
] as const

interface LevelOption {
  value: PermissionLevel
  labelKey: string
}

const LEVEL_OPTIONS: LevelOption[] = [
  { value: "allow", labelKey: "settings.autoApprove.level.allow" },
  { value: "ask", labelKey: "settings.autoApprove.level.ask" },
  { value: "deny", labelKey: "settings.autoApprove.level.deny" },
]

const AutoApproveTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const language = useLanguage()

  const yoloMode = createMemo(() => !!config().yolo_mode)
  const permissions = createMemo(() => config().permission ?? {})

  const getLevel = (tool: string): PermissionLevel => {
    if (yoloMode()) return "allow"
    return permissions()[tool] ?? permissions()["*"] ?? "ask"
  }

  const setPermission = (tool: string, level: PermissionLevel) => {
    updateConfig({
      permission: { ...permissions(), [tool]: level },
    })
  }

  const setAll = (level: PermissionLevel) => {
    const updated: Record<string, PermissionLevel> = {}
    for (const tool of TOOLS) {
      updated[tool] = level
    }
    updateConfig({ permission: updated })
  }

  const toggleYoloMode = (checked: boolean) => {
    updateConfig({ yolo_mode: checked })
  }

  return (
    <div data-component="auto-approve-settings">
      {/* ── YOLO Mode ────────────────────────────────────────── */}
      <Card>
        <div
          style={{
            border: "2px solid var(--vscode-charts-yellow, #e5a500)",
            "border-radius": "6px",
            padding: "14px",
            background: "color-mix(in srgb, var(--vscode-charts-yellow, #e5a500) 8%, transparent)",
          }}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "10px", "margin-bottom": "8px" }}>
            <span style={{ "font-size": "20px" }}>⚠️</span>
            <span style={{ "font-size": "14px", "font-weight": "700", color: "var(--vscode-charts-yellow, #e5a500)" }}>
              {language.t("settings.autoApprove.yoloMode")}
            </span>
          </div>
          <Switch checked={yoloMode()} onChange={toggleYoloMode}>
            {language.t("settings.autoApprove.yoloMode.label")}
          </Switch>
          <div
            style={{
              "font-size": "12px",
              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              "margin-top": "6px",
              "padding-left": "2px",
            }}
          >
            {language.t("settings.autoApprove.yoloMode.description")}
          </div>
          <div
            style={{
              "font-size": "12px",
              color: "var(--vscode-charts-yellow, #e5a500)",
              "font-weight": "500",
              "margin-top": "4px",
              "padding-left": "2px",
            }}
          >
            {language.t("settings.autoApprove.yoloMode.caution")}
          </div>
        </div>
      </Card>

      {/* ── YOLO active banner ───────────────────────────────── */}
      <Show when={yoloMode()}>
        <div
          style={{
            "margin-top": "12px",
            background: "color-mix(in srgb, var(--vscode-charts-yellow, #e5a500) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--vscode-charts-yellow, #e5a500) 30%, transparent)",
            "border-radius": "6px",
            padding: "10px 14px",
            display: "flex",
            "align-items": "center",
            gap: "8px",
          }}
        >
          <span style={{ "font-size": "16px" }}>⚡</span>
          <span style={{ "font-size": "13px", "font-weight": "500", color: "var(--vscode-charts-yellow, #e5a500)" }}>
            {language.t("settings.autoApprove.yoloMode.warning")}
          </span>
        </div>
      </Show>

      <div style={{ "margin-top": "12px" }} />

      {/* ── Set All control ──────────────────────────────────── */}
      <Card>
        <div
          data-slot="settings-row"
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "8px 0",
            opacity: yoloMode() ? "0.45" : "1",
            "pointer-events": yoloMode() ? "none" : "auto",
          }}
        >
          <span style={{ "font-weight": "600" }}>{language.t("settings.autoApprove.setAll")}</span>
          <Select
            options={LEVEL_OPTIONS}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(option) => option && setAll(option.value)}
            variant="secondary"
            size="small"
            triggerVariant="settings"
            placeholder={language.t("common.choose")}
          />
        </div>
      </Card>

      <div style={{ "margin-top": "12px" }} />

      {/* ── Tool permission list ─────────────────────────────── */}
      <Card>
        <For each={[...TOOLS]}>
          {(tool, index) => (
            <div
              data-slot="settings-row"
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "8px 0",
                "border-bottom": index() < TOOLS.length - 1 ? "1px solid var(--border-weak-base)" : "none",
                opacity: yoloMode() ? "0.45" : "1",
                "pointer-events": yoloMode() ? "none" : "auto",
              }}
            >
              <div style={{ flex: 1, "min-width": 0 }}>
                <div
                  style={{
                    "font-family": "var(--vscode-editor-font-family, monospace)",
                    "font-size": "12px",
                  }}
                >
                  {tool}
                </div>
                <div
                  style={{
                    "font-size": "11px",
                    color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                    "margin-top": "2px",
                  }}
                >
                  {language.t(`settings.autoApprove.tool.${tool}`)}
                </div>
              </div>
              <Select
                options={LEVEL_OPTIONS}
                current={LEVEL_OPTIONS.find((o) => o.value === getLevel(tool))}
                value={(o) => o.value}
                label={(o) => language.t(o.labelKey)}
                onSelect={(option) => option && setPermission(tool, option.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </div>
          )}
        </For>
      </Card>
    </div>
  )
}

export default AutoApproveTab
