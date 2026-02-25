/**
 * ModelInfoCard — 模型信息悬浮卡片
 * 在 ModelSelector 列表项悬停时展示价格、上下文窗口、能力标签等信息。
 */

import { Component, Show } from "solid-js"
import type { EnrichedModel } from "../../context/provider"

export interface ModelInfoCardProps {
  model: EnrichedModel
  /** 卡片相对于触发元素的定位类名，如 "model-info-card--left" */
  side?: "left" | "right"
}

/** 格式化价格：每百万 token 的美元数 */
function formatPrice(price: number | undefined): string {
  if (price === undefined || price === 0) return "Free"
  if (price < 1) return `$${(price * 1000).toFixed(2)}/MT` // milli-token 级别
  return `$${price.toFixed(2)}/MT`
}

/** 格式化上下文长度 */
function formatContext(len: number | undefined): string {
  if (!len) return "—"
  if (len >= 1_000_000) return `${(len / 1_000_000).toFixed(0)}M`
  if (len >= 1_000) return `${(len / 1_000).toFixed(0)}K`
  return String(len)
}

/** 模型能力标签列表 */
function getCapabilityTags(model: EnrichedModel): string[] {
  const tags: string[] = []
  if (model.capabilities?.reasoning) tags.push("reasoning")
  if (model.variants && Object.keys(model.variants).length > 0) tags.push("variants")
  if (model.contextLength && model.contextLength >= 100_000) tags.push("long-ctx")
  if (model.latest) tags.push("latest")
  return tags
}

export const ModelInfoCard: Component<ModelInfoCardProps> = (props) => {
  const tags = () => getCapabilityTags(props.model)
  const contextLen = () =>
    props.model.contextLength ?? props.model.limit?.context

  return (
    <div class={`model-info-card${props.side === "left" ? " model-info-card--left" : " model-info-card--right"}`}>
      <div class="model-info-card-name">{props.model.name}</div>
      <div class="model-info-card-id">{props.model.id}</div>

      <div class="model-info-card-row">
        <span class="model-info-card-label">Input</span>
        <span class="model-info-card-value">{formatPrice(props.model.inputPrice)}</span>
      </div>
      <div class="model-info-card-row">
        <span class="model-info-card-label">Output</span>
        <span class="model-info-card-value">{formatPrice(props.model.outputPrice)}</span>
      </div>
      <div class="model-info-card-row">
        <span class="model-info-card-label">Context</span>
        <span class="model-info-card-value">{formatContext(contextLen())}</span>
      </div>

      <Show when={tags().length > 0}>
        <div class="model-info-card-tags">
          {tags().map((tag) => (
            <span class={`model-info-card-tag model-info-card-tag--${tag}`}>{tag}</span>
          ))}
        </div>
      </Show>
    </div>
  )
}
