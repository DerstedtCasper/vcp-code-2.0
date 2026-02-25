import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Button } from "@kilocode/kilo-ui/button"
import { Select } from "@kilocode/kilo-ui/select"
import { Switch } from "@kilocode/kilo-ui/switch"
import { IconButton } from "@kilocode/kilo-ui/icon-button"

import { useConfig } from "../../context/config"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import type { CommandConfig } from "../../types/messages"
import SettingsRow from "./SettingsRow"

interface SelectOption {
  value: string
  label: string
}

const WorkflowsEditor: Component = () => {
  const { config, updateConfig } = useConfig()
  const session = useSession()
  const language = useLanguage()

  const [newName, setNewName] = createSignal("")
  const [newTemplate, setNewTemplate] = createSignal("")
  const [newDescription, setNewDescription] = createSignal("")
  const [newAgent, setNewAgent] = createSignal("")
  const [newModel, setNewModel] = createSignal("")
  const [newSubtask, setNewSubtask] = createSignal(false)

  const workflows = createMemo(() =>
    Object.entries(config().command ?? {}).sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" })),
  )

  const agentOptions = createMemo<SelectOption[]>(() => [
    { value: "", label: language.t("common.default") },
    ...session
      .agents()
      .map((agent) => agent.name)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name })),
  ])

  const normalizeInput = (value: string): string | undefined => {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  const normalizeWorkflowName = (value: string): string =>
    value
      .trim()
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")

  const updateWorkflow = (name: string, partial: Partial<CommandConfig>) => {
    const existing = config().command ?? {}
    const current = existing[name] ?? { template: "" }
    updateConfig({
      command: {
        ...existing,
        [name]: {
          ...current,
          ...partial,
        },
      },
    })
  }

  const removeWorkflow = (name: string) => {
    const existing = config().command ?? {}
    const next = { ...existing }
    delete next[name]
    updateConfig({ command: next })
  }

  const createWorkflow = () => {
    const name = normalizeWorkflowName(newName())
    const template = normalizeInput(newTemplate())
    if (!name || !template) return

    const existing = config().command ?? {}
    updateConfig({
      command: {
        ...existing,
        [name]: {
          template,
          description: normalizeInput(newDescription()),
          agent: normalizeInput(newAgent()),
          model: normalizeInput(newModel()),
          subtask: newSubtask() ? true : undefined,
        },
      },
    })

    setNewName("")
    setNewTemplate("")
    setNewDescription("")
    setNewAgent("")
    setNewModel("")
    setNewSubtask(false)
  }

  return (
    <div>
      <Card style={{ "margin-bottom": "12px" }}>
        <SettingsRow
          title={language.t("settings.workflows.name.title")}
          description={language.t("settings.workflows.name.description")}
        >
          <TextField
            value={newName()}
            placeholder={language.t("settings.workflows.name.placeholder")}
            onChange={(value) => setNewName(value)}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.workflows.template.title")}
          description={language.t("settings.workflows.template.description")}
          last
        >
          <TextField
            value={newTemplate()}
            placeholder={language.t("settings.workflows.template.placeholder")}
            multiline
            onChange={(value) => setNewTemplate(value)}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.workflows.description.title")}
          description={language.t("settings.workflows.description.description")}
          last
        >
          <TextField
            value={newDescription()}
            placeholder={language.t("settings.workflows.description.placeholder")}
            onChange={(value) => setNewDescription(value)}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.workflows.agent.title")}
          description={language.t("settings.workflows.agent.description")}
          last
        >
          <Select
            options={agentOptions()}
            current={agentOptions().find((option) => option.value === newAgent())}
            value={(option) => option.value}
            label={(option) => option.label}
            onSelect={(option) => setNewAgent(option?.value ?? "")}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.workflows.model.title")}
          description={language.t("settings.workflows.model.description")}
          last
        >
          <TextField
            value={newModel()}
            placeholder={language.t("settings.workflows.model.placeholder")}
            onChange={(value) => setNewModel(value)}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.workflows.subtask.title")}
          description={language.t("settings.workflows.subtask.description")}
          last
        >
          <Switch checked={newSubtask()} onChange={(checked) => setNewSubtask(checked)} hideLabel>
            {language.t("settings.workflows.subtask.label")}
          </Switch>
        </SettingsRow>

        <div style={{ display: "flex", "justify-content": "flex-end", padding: "8px 0 0" }}>
          <Button size="small" onClick={createWorkflow}>
            {language.t("common.add")}
          </Button>
        </div>
      </Card>

      <Show
        when={workflows().length > 0}
        fallback={
          <Card>
            <div
              style={{
                "font-size": "12px",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              }}
            >
              {language.t("settings.workflows.empty")}
            </div>
          </Card>
        }
      >
        <For each={workflows()}>
          {([name, workflow], index) => {
            const cardStyle = () => ({ "margin-bottom": index() < workflows().length - 1 ? "12px" : "0" })
            const current = workflow ?? {}
            return (
              <Card style={cardStyle()}>
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "space-between",
                    "padding-bottom": "8px",
                    "border-bottom": "1px solid var(--border-weak-base)",
                  }}
                >
                  <div style={{ "font-family": "var(--vscode-editor-font-family, monospace)", "font-size": "12px" }}>
                    /{name}
                  </div>
                  <IconButton size="small" variant="ghost" icon="close" onClick={() => removeWorkflow(name)} />
                </div>

                <SettingsRow
                  title={language.t("settings.workflows.template.title")}
                  description={language.t("settings.workflows.template.description")}
                >
                  <TextField
                    value={current.template ?? ""}
                    multiline
                    onChange={(value) => updateWorkflow(name, { template: value })}
                  />
                </SettingsRow>

                <SettingsRow
                  title={language.t("settings.workflows.description.title")}
                  description={language.t("settings.workflows.description.description")}
                >
                  <TextField
                    value={current.description ?? ""}
                    onChange={(value) => updateWorkflow(name, { description: normalizeInput(value) })}
                  />
                </SettingsRow>

                <SettingsRow
                  title={language.t("settings.workflows.agent.title")}
                  description={language.t("settings.workflows.agent.description")}
                >
                  <Select
                    options={agentOptions()}
                    current={agentOptions().find((option) => option.value === (current.agent ?? ""))}
                    value={(option) => option.value}
                    label={(option) => option.label}
                    onSelect={(option) => updateWorkflow(name, { agent: normalizeInput(option?.value ?? "") })}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                  />
                </SettingsRow>

                <SettingsRow
                  title={language.t("settings.workflows.model.title")}
                  description={language.t("settings.workflows.model.description")}
                >
                  <TextField
                    value={current.model ?? ""}
                    onChange={(value) => updateWorkflow(name, { model: normalizeInput(value) })}
                  />
                </SettingsRow>

                <SettingsRow
                  title={language.t("settings.workflows.subtask.title")}
                  description={language.t("settings.workflows.subtask.description")}
                  last
                >
                  <Switch
                    checked={current.subtask ?? false}
                    onChange={(checked) => updateWorkflow(name, { subtask: checked })}
                    hideLabel
                  >
                    {language.t("settings.workflows.subtask.label")}
                  </Switch>
                </SettingsRow>
              </Card>
            )
          }}
        </For>
      </Show>
    </div>
  )
}

export default WorkflowsEditor

