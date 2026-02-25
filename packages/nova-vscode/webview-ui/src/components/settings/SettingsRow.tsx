import { Component, JSX, Show } from "solid-js"

export interface SettingsRowProps {
  title: string
  description: string
  last?: boolean
  /** 帮助提示（悬停图标） */
  helpHint?: string
  /** 示例值文本 */
  example?: string
  /** 是否有未保存的修改（高亮标题） */
  isDirty?: boolean
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => (
  <div
    data-slot="settings-row"
    class={`settings-row${props.isDirty ? " settings-row--dirty" : ""}${props.last ? " settings-row--last" : ""}`}
  >
    <div class="settings-row-label">
      <div class="settings-row-title">
        {props.title}
        <Show when={props.isDirty}>
          <span class="settings-row-dirty-dot" aria-label="unsaved changes" />
        </Show>
        <Show when={props.helpHint}>
          <span class="settings-row-help-icon" title={props.helpHint} aria-label={props.helpHint}>?</span>
        </Show>
      </div>
      <div class="settings-row-description">
        {props.description}
        <Show when={props.example}>
          <span class="settings-row-example">e.g. {props.example}</span>
        </Show>
      </div>
    </div>
    {props.children}
  </div>
)

export default SettingsRow
