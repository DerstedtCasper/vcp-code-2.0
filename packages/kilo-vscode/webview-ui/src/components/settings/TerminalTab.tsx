import { Component, createMemo } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"

import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import type { PermissionLevel } from "../../types/messages"
import SettingsRow from "./SettingsRow"

interface SelectOption {
  value: string
  label: string
}

const TerminalTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const language = useLanguage()
  const permissionOptions = createMemo<SelectOption[]>(() => [
    { value: "ask", label: language.t("settings.autoApprove.level.ask") },
    { value: "allow", label: language.t("settings.autoApprove.level.allow") },
    { value: "deny", label: language.t("settings.autoApprove.level.deny") },
  ])
  const diffStyleOptions = createMemo<SelectOption[]>(() => [
    { value: "auto", label: language.t("settings.terminal.diffStyle.auto") },
    { value: "stacked", label: language.t("settings.terminal.diffStyle.stacked") },
  ])

  const bashPermission = createMemo(() => {
    const value = config().permission?.bash
    return typeof value === "string" ? value : "ask"
  })

  const updateBashPermission = (value: PermissionLevel) => {
    updateConfig({
      permission: {
        ...(config().permission ?? {}),
        bash: value,
      },
    })
  }

  const updateTerminalSuspend = (value: string) => {
    const next = value.trim()
    updateConfig({
      keybinds: {
        ...(config().keybinds ?? {}),
        terminal_suspend: next || undefined,
      },
    })
  }

  const updateTerminalTitleToggle = (value: string) => {
    const next = value.trim()
    updateConfig({
      keybinds: {
        ...(config().keybinds ?? {}),
        terminal_title_toggle: next || undefined,
      },
    })
  }

  const updateDiffStyle = (value: "auto" | "stacked") => {
    updateConfig({
      tui: {
        ...(config().tui ?? {}),
        diff_style: value,
      },
    })
  }

  const updateScrollSpeed = (value: string) => {
    const parsed = Number.parseFloat(value.trim())
    updateConfig({
      tui: {
        ...(config().tui ?? {}),
        scroll_speed: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
      },
    })
  }

  return (
    <div>
      <Card>
        <SettingsRow
          title={language.t("settings.terminal.bashPermission.title")}
          description={language.t("settings.terminal.bashPermission.description")}
        >
          <Select
            options={permissionOptions()}
            current={permissionOptions().find((option) => option.value === bashPermission())}
            value={(option) => option.value}
            label={(option) => option.label}
            onSelect={(option) => option && updateBashPermission(option.value as PermissionLevel)}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.terminal.keybindSuspend.title")}
          description={language.t("settings.terminal.keybindSuspend.description")}
        >
          <TextField
            value={config().keybinds?.terminal_suspend ?? ""}
            placeholder={language.t("settings.terminal.keybindSuspend.placeholder")}
            onChange={(value) => updateTerminalSuspend(value)}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.terminal.keybindTitleToggle.title")}
          description={language.t("settings.terminal.keybindTitleToggle.description")}
        >
          <TextField
            value={config().keybinds?.terminal_title_toggle ?? ""}
            placeholder={language.t("settings.terminal.keybindTitleToggle.placeholder")}
            onChange={(value) => updateTerminalTitleToggle(value)}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.terminal.diffStyle.title")}
          description={language.t("settings.terminal.diffStyle.description")}
        >
          <Select
            options={diffStyleOptions()}
            current={diffStyleOptions().find((option) => option.value === (config().tui?.diff_style ?? "auto"))}
            value={(option) => option.value}
            label={(option) => option.label}
            onSelect={(option) => option && updateDiffStyle(option.value as "auto" | "stacked")}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.terminal.scrollSpeed.title")}
          description={language.t("settings.terminal.scrollSpeed.description")}
          last
        >
          <TextField
            value={config().tui?.scroll_speed?.toString() ?? ""}
            placeholder="0.2"
            onChange={(value) => updateScrollSpeed(value)}
          />
        </SettingsRow>
      </Card>
    </div>
  )
}

export default TerminalTab
