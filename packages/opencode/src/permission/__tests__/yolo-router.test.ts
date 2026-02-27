import { describe, expect, test } from "bun:test"
import { YoloRouter } from "../yolo-router"

describe("permission.yolo-router", () => {
  test("escalates when yolo is disabled", () => {
    const decision = YoloRouter.decide(
      {
        permission: "read",
        pattern: ["src/**/*.ts"],
      },
      { enabled: false },
    )
    expect(decision.route).toBe("escalate_to_human")
  })

  test("denies dangerous command patterns", () => {
    const decision = YoloRouter.decide(
      {
        permission: "bash",
        message: "run rm -rf /tmp/build-cache",
      },
      { enabled: true },
    )
    expect(decision.route).toBe("deny")
  })

  test("escalates when force_human matches", () => {
    const decision = YoloRouter.decide(
      {
        permission: "read",
        pattern: ["secrets/.env"],
      },
      { enabled: true, force_human: ["secrets/**"] },
    )
    expect(decision.route).toBe("escalate_to_human")
  })

  test("approves read-only permissions when auto approve is enabled", () => {
    const decision = YoloRouter.decide(
      {
        permission: "read",
        pattern: ["src/index.ts"],
      },
      { enabled: true, auto_approve_readonly: true },
    )
    expect(decision.route).toBe("approve")
  })

  test("escalates high-risk permissions", () => {
    const decision = YoloRouter.decide(
      {
        permission: "edit",
        pattern: ["src/index.ts"],
      },
      { enabled: true },
    )
    expect(decision.route).toBe("escalate_to_human")
  })

  test("deny rule cannot be bypassed even when small model is enabled", async () => {
    const decision = await YoloRouter.route(
      {
        permission: "bash",
        message: "please run DROP TABLE users",
      },
      { enabled: true, use_small_model: true },
    )
    expect(decision.route).toBe("deny")
  })
})
