import { PermissionNext } from "@/permission/next"

export class PermissionRuntimeService {
  static async list() {
    return PermissionNext.list()
  }

  static async reply(input: { requestID: string; reply: "once" | "always" | "reject"; message?: string }) {
    await PermissionNext.reply(input)
    return true
  }
}
