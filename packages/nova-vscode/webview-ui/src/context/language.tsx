/**
 * Language context
 * Provides i18n translations for nova-ui components.
 * Merges app translations, ui translations and nova overrides.
 */

import { createContext, useContext, createSignal, createMemo, createEffect } from "solid-js"
import type { ParentComponent, Accessor } from "solid-js"
import { I18nProvider } from "@novacode/nova-ui/context"
import type { UiI18nKey, UiI18nParams } from "@novacode/nova-ui/context"
import { dict as uiEn } from "@novacode/nova-ui/i18n/en"
import { dict as uiZh } from "@novacode/nova-ui/i18n/zh"
import { dict as uiZht } from "@novacode/nova-ui/i18n/zht"
import { dict as uiKo } from "@novacode/nova-ui/i18n/ko"
import { dict as uiDe } from "@novacode/nova-ui/i18n/de"
import { dict as uiEs } from "@novacode/nova-ui/i18n/es"
import { dict as uiFr } from "@novacode/nova-ui/i18n/fr"
import { dict as uiDa } from "@novacode/nova-ui/i18n/da"
import { dict as uiJa } from "@novacode/nova-ui/i18n/ja"
import { dict as uiPl } from "@novacode/nova-ui/i18n/pl"
import { dict as uiRu } from "@novacode/nova-ui/i18n/ru"
import { dict as uiAr } from "@novacode/nova-ui/i18n/ar"
import { dict as uiNo } from "@novacode/nova-ui/i18n/no"
import { dict as uiBr } from "@novacode/nova-ui/i18n/br"
import { dict as uiTh } from "@novacode/nova-ui/i18n/th"
import { dict as uiBs } from "@novacode/nova-ui/i18n/bs"
import { dict as appEn } from "../i18n/en"
import { dict as appZh } from "../i18n/zh"
import { dict as appZht } from "../i18n/zht"
import { dict as appKo } from "../i18n/ko"
import { dict as appDe } from "../i18n/de"
import { dict as appEs } from "../i18n/es"
import { dict as appFr } from "../i18n/fr"
import { dict as appDa } from "../i18n/da"
import { dict as appJa } from "../i18n/ja"
import { dict as appPl } from "../i18n/pl"
import { dict as appRu } from "../i18n/ru"
import { dict as appAr } from "../i18n/ar"
import { dict as appNo } from "../i18n/no"
import { dict as appBr } from "../i18n/br"
import { dict as appTh } from "../i18n/th"
import { dict as appBs } from "../i18n/bs"
import { dict as novaEn } from "@novacode/nova-i18n/en"
import { dict as novaZh } from "@novacode/nova-i18n/zh"
import { dict as novaZht } from "@novacode/nova-i18n/zht"
import { dict as novaKo } from "@novacode/nova-i18n/ko"
import { dict as novaDe } from "@novacode/nova-i18n/de"
import { dict as novaEs } from "@novacode/nova-i18n/es"
import { dict as novaFr } from "@novacode/nova-i18n/fr"
import { dict as novaDa } from "@novacode/nova-i18n/da"
import { dict as novaJa } from "@novacode/nova-i18n/ja"
import { dict as novaPl } from "@novacode/nova-i18n/pl"
import { dict as novaRu } from "@novacode/nova-i18n/ru"
import { dict as novaAr } from "@novacode/nova-i18n/ar"
import { dict as novaNo } from "@novacode/nova-i18n/no"
import { dict as novaBr } from "@novacode/nova-i18n/br"
import { dict as novaTh } from "@novacode/nova-i18n/th"
import { dict as novaBs } from "@novacode/nova-i18n/bs"
import { useVSCode } from "./vscode"
import { normalizeLocale as _normalizeLocale, resolveTemplate as _resolveTemplate } from "./language-utils"
import type { Locale } from "./language-utils"
import { LOCALES } from "./language-utils"

export type { Locale } from "./language-utils"
export { LOCALES }

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  zh: "简体中文",
  zht: "繁体中文",
  ko: "한국어",
  de: "Deutsch",
  es: "Espanol",
  fr: "Francais",
  da: "Dansk",
  ja: "日本語",
  pl: "Polski",
  ru: "Русский",
  ar: "العربية",
  no: "Norsk",
  br: "Portugues (Brasil)",
  th: "ภาษาไทย",
  bs: "Bosanski",
}

const base = { ...appEn, ...uiEn, ...novaEn }
const dicts: Record<Locale, Record<string, string>> = {
  en: base,
  zh: { ...base, ...appZh, ...uiZh, ...novaZh },
  zht: { ...base, ...appZht, ...uiZht, ...novaZht },
  ko: { ...base, ...appKo, ...uiKo, ...novaKo },
  de: { ...base, ...appDe, ...uiDe, ...novaDe },
  es: { ...base, ...appEs, ...uiEs, ...novaEs },
  fr: { ...base, ...appFr, ...uiFr, ...novaFr },
  da: { ...base, ...appDa, ...uiDa, ...novaDa },
  ja: { ...base, ...appJa, ...uiJa, ...novaJa },
  pl: { ...base, ...appPl, ...uiPl, ...novaPl },
  ru: { ...base, ...appRu, ...uiRu, ...novaRu },
  ar: { ...base, ...appAr, ...uiAr, ...novaAr },
  no: { ...base, ...appNo, ...uiNo, ...novaNo },
  br: { ...base, ...appBr, ...uiBr, ...novaBr },
  th: { ...base, ...appTh, ...uiTh, ...novaTh },
  bs: { ...base, ...appBs, ...uiBs, ...novaBs },
}

function normalizeLocale(lang: string): Locale {
  return _normalizeLocale(lang)
}

function resolveTemplate(text: string, params?: UiI18nParams): string {
  return _resolveTemplate(text, params as Record<string, string | number | boolean | undefined>)
}

interface LanguageContextValue {
  locale: Accessor<Locale>
  setLocale: (locale: Locale | "") => void
  userOverride: Accessor<Locale | "">
  t: (key: string, params?: UiI18nParams) => string
}

const LanguageContext = createContext<LanguageContextValue>()

interface LanguageProviderProps {
  vscodeLanguage?: Accessor<string | undefined>
  languageOverride?: Accessor<string | undefined>
}

export const LanguageProvider: ParentComponent<LanguageProviderProps> = (props) => {
  const vscode = useVSCode()
  const [userOverride, setUserOverride] = createSignal<Locale | "">("")

  createEffect(() => {
    const override = props.languageOverride?.()
    if (override) setUserOverride(normalizeLocale(override))
  })

  const locale = createMemo<Locale>(() => {
    const override = userOverride()
    if (override) return override
    const vscodeLang = props.vscodeLanguage?.()
    if (vscodeLang) return normalizeLocale(vscodeLang)
    if (typeof navigator !== "undefined" && navigator.language) return normalizeLocale(navigator.language)
    return "en"
  })

  const dict = createMemo(() => dicts[locale()] ?? dicts.en)

  const t = (key: UiI18nKey, params?: UiI18nParams) => {
    const text = (dict() as Record<string, string>)[key] ?? String(key)
    return resolveTemplate(text, params)
  }

  const setLocale = (next: Locale | "") => {
    setUserOverride(next)
    vscode.postMessage({ type: "setLanguage", locale: next })
  }

  return (
    <LanguageContext.Provider
      value={{ locale, setLocale, userOverride, t: t as (key: string, params?: UiI18nParams) => string }}
    >
      <I18nProvider value={{ locale: () => locale(), t }}>{props.children}</I18nProvider>
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider")
  }
  return ctx
}
