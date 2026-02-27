export type RuntimeState = "initializing" | "ready" | "error"
export type RuntimeMode = "embedded" | "legacy"

export interface RuntimeStateChangedEvent {
  type: "runtimeStateChanged"
  mode: RuntimeMode
  state: RuntimeState
  reason?: string
  error?: string
}

export type YoloRoute = "approve" | "escalate_to_human"
export type YoloSource = "small_model" | "heuristic"

export interface YoloDecisionMadeEvent {
  type: "yoloDecisionMade"
  requestID: string
  sessionID: string
  permission: string
  route: YoloRoute
  confidence: number
  reason: string
  source: YoloSource
}
