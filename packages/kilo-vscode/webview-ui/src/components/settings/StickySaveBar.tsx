/**
 * StickySaveBar — 页面底部固定保存栏
 * 当设置有未保存更改时显示，提供保存/撤销操作。
 *
 * Usage:
 *   <StickySaveBar
 *     isDirty={hasChanges()}
 *     onSave={handleSave}
 *     onDiscard={handleDiscard}
 *   />
 */

import { Component, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"

export interface StickySaveBarProps {
  /** 是否有未保存的修改 */
  isDirty: boolean
  /** 保存回调 */
  onSave: () => void
  /** 丢弃更改回调 */
  onDiscard: () => void
  /** 保存按钮文字，默认 "Save Changes" */
  saveLabel?: string
  /** 丢弃按钮文字，默认 "Discard" */
  discardLabel?: string
  /** 是否正在保存（loading 状态） */
  isSaving?: boolean
}

export const StickySaveBar: Component<StickySaveBarProps> = (props) => {
  return (
    <Show when={props.isDirty}>
      <div class="sticky-save-bar" role="region" aria-label="Unsaved changes">
        <span class="sticky-save-bar-hint">You have unsaved changes</span>
        <div class="sticky-save-bar-actions">
          <Button
            variant="ghost"
            size="small"
            onClick={props.onDiscard}
            disabled={props.isSaving}
          >
            {props.discardLabel ?? "Discard"}
          </Button>
          <Button
            variant="primary"
            size="small"
            onClick={props.onSave}
            disabled={props.isSaving}
          >
            {props.isSaving ? "Saving…" : (props.saveLabel ?? "Save Changes")}
          </Button>
        </div>
      </div>
    </Show>
  )
}
