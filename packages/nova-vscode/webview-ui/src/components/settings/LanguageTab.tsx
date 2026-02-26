import { Component, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Select } from "@novacode/nova-ui/select"
import { Button } from "@novacode/nova-ui/button"
import { showToast } from "@novacode/nova-ui/toast"
import { useLanguage, LOCALES, LOCALE_LABELS, type Locale } from "../../context/language"

const options = ["", ...LOCALES] as const
type Option = "" | Locale

const LanguageTab: Component = () => {
  const language = useLanguage()
  const [draftLocale, setDraftLocale] = createSignal<Option>(language.userOverride())

  const isDirty = createMemo(() => draftLocale() !== language.userOverride())

  const save = () => {
    if (!isDirty()) return
    language.setLocale(draftLocale() as Locale | "")
    showToast({ variant: "success", title: language.t("settings.save.toast.title") })
  }

  const discard = () => setDraftLocale(language.userOverride())

  onMount(() => {
    const onSave = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab
      if (tab !== "language") return
      save()
    }
    window.addEventListener("vcp-settings-save", onSave as EventListener)
    onCleanup(() => window.removeEventListener("vcp-settings-save", onSave as EventListener))
  })

  return (
    <div style={{ padding: "16px" }}>
      <p style={{ "font-size": "13px", "margin-bottom": "12px" }}>{language.t("settings.language.description")}</p>
      <Select
        options={[...options]}
        current={draftLocale()}
        label={(opt: Option) => (opt === "" ? language.t("settings.language.auto") : LOCALE_LABELS[opt])}
        value={(opt: Option) => opt}
        onSelect={(opt) => {
          if (opt !== undefined) {
            setDraftLocale(opt as Option)
          }
        }}
        variant="secondary"
        size="large"
      />
      <p style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", "margin-top": "8px" }}>
        {language.t("settings.language.current")} {LOCALE_LABELS[language.locale()]}
      </p>
      <Show when={isDirty()}>
        <div class="sticky-save-bar" style={{ "margin-top": "12px" }}>
          <div class="sticky-save-bar-hint">{language.t("settings.providers.unsaved")}</div>
          <div class="sticky-save-bar-actions">
            <Button size="small" variant="ghost" onClick={discard}>
              {language.t("settings.providers.revert")}
            </Button>
            <Button size="small" onClick={save}>
              {language.t("common.save")}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}

export default LanguageTab
