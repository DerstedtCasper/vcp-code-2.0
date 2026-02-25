import { Instance } from "@/project/instance"
import z from "zod"

export namespace VcpPromptQueue {
  export const Item = z.object({
    id: z.string(),
    text: z.string(),
    files: z
      .array(
        z.object({
          mime: z.string(),
          url: z.string(),
        }),
      )
      .optional(),
    policy: z.enum(["guide", "queue", "interrupt"]),
    priority: z.number().int(),
    createdAt: z.string(),
    providerID: z.string().optional(),
    modelID: z.string().optional(),
    agent: z.string().optional(),
    variant: z.string().optional(),
  })
  export type Item = z.infer<typeof Item>

  const state = Instance.state(() => {
    const data = new Map<string, Item[]>()
    return data
  })

  export function list(sessionID: string) {
    return state().get(sessionID) ?? []
  }

  export function set(sessionID: string, items: Item[]) {
    state().set(sessionID, items)
    return list(sessionID)
  }

  export function enqueue(sessionID: string, input: Omit<Item, "id" | "createdAt">) {
    const current = list(sessionID)
    const next: Item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      ...input,
    }
    return set(sessionID, [...current, next])
  }

  export function dequeue(sessionID: string, itemID?: string) {
    const current = list(sessionID)
    if (current.length === 0) return current
    const next = itemID ? current.filter((item) => item.id !== itemID) : current.slice(1)
    return set(sessionID, next)
  }

  export function reorder(sessionID: string, itemIDs: string[]) {
    const current = list(sessionID)
    const byId = new Map(current.map((item) => [item.id, item]))
    const ordered = itemIDs.map((id) => byId.get(id)).filter((item) => !!item)
    const missing = current.filter((item) => !itemIDs.includes(item.id))
    return set(sessionID, [...ordered, ...missing])
  }
}
