import { fetchDefaultModel } from "@novacode/nova-gateway"
import { mapValues } from "remeda"
import { Auth } from "../auth"
import { Config } from "../config/config"
import { Provider } from "../provider/provider"

export class ConfigRuntimeService {
  static async get() {
    return Config.get()
  }

  static async update(config: object) {
    await Config.update(config)
    return config
  }

  static async listProviders() {
    const providers = await Provider.list()
    const kiloAuth = await Auth.get("kilo")
    const token = kiloAuth?.type === "oauth" ? kiloAuth.access : kiloAuth?.key
    const organizationId = kiloAuth?.type === "oauth" ? kiloAuth.accountId : undefined
    const kiloApiDefault = await fetchDefaultModel(token, organizationId)

    const defaults = mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id)
    if (kiloApiDefault && providers["kilo"]?.models[kiloApiDefault]) {
      defaults["kilo"] = kiloApiDefault
    }

    return {
      providers: Object.values(providers),
      default: defaults,
    }
  }
}
