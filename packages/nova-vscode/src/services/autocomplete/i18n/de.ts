// de runtime translations for autocomplete

export const dict = {
  "novacode:autocomplete.statusBar.enabled": "$(nova-logo) Autocomplete",
  "novacode:autocomplete.statusBar.snoozed": "pausiert",
  "novacode:autocomplete.statusBar.warning": "$(warning) Autocomplete",
  "novacode:autocomplete.statusBar.tooltip.basic": "Nova Code Autocomplete",
  "novacode:autocomplete.statusBar.tooltip.disabled": "Nova Code Autocomplete (deaktiviert)",
  "novacode:autocomplete.statusBar.tooltip.noCredits":
    "**Kein Guthaben auf deinem Konto**\n\nDein Nova Code Konto hat kein Guthaben. Um Autocomplete zu nutzen, füge bitte Guthaben zu deinem Konto hinzu.\n\n[Einstellungen öffnen](command:vcp-code.new.settingsButtonClicked)",
  "novacode:autocomplete.statusBar.tooltip.noUsableProvider":
    "**Kein Autocomplete-Modell konfiguriert**\n\nUm Autocomplete zu aktivieren, füge ein Profil mit einem dieser unterstützten Anbieter hinzu: {{providers}}.\n\n[Einstellungen öffnen](command:vcp-code.new.settingsButtonClicked)",
  "novacode:autocomplete.statusBar.tooltip.sessionTotal": "Sitzungsgesamtkosten:",
  "novacode:autocomplete.statusBar.tooltip.provider": "Anbieter:",
  "novacode:autocomplete.statusBar.tooltip.model": "Modell:",
  "novacode:autocomplete.statusBar.tooltip.profile": "Profil: ",
  "novacode:autocomplete.statusBar.tooltip.defaultProfile": "Standard",
  "novacode:autocomplete.statusBar.tooltip.completionSummary":
    "{{count}} Vervollständigungen zwischen {{startTime}} und {{endTime}} durchgeführt, für Gesamtkosten von {{cost}}.",
  "novacode:autocomplete.statusBar.tooltip.providerInfo":
    "Autovervollständigungen bereitgestellt von {{model}} über {{provider}}.",
  "novacode:autocomplete.statusBar.cost.zero": "$0.00",
  "novacode:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "novacode:autocomplete.toggleMessage": "Nova Code Autocomplete {{status}}",
  "novacode:autocomplete.progress.title": "Nova Code",
  "novacode:autocomplete.progress.analyzing": "Analysiere deinen Code...",
  "novacode:autocomplete.progress.generating": "Generiere Bearbeitungsvorschläge...",
  "novacode:autocomplete.progress.processing": "Verarbeite Bearbeitungsvorschläge...",
  "novacode:autocomplete.progress.showing": "Zeige Bearbeitungsvorschläge...",
  "novacode:autocomplete.input.title": "Nova Code: Schnellaufgabe",
  "novacode:autocomplete.input.placeholder": "z.B. 'refaktoriere diese Funktion für mehr Effizienz'",
  "novacode:autocomplete.commands.generateSuggestions": "Nova Code: Bearbeitungsvorschläge generieren",
  "novacode:autocomplete.commands.displaySuggestions": "Bearbeitungsvorschläge anzeigen",
  "novacode:autocomplete.commands.cancelSuggestions": "Bearbeitungsvorschläge abbrechen",
  "novacode:autocomplete.commands.applyCurrentSuggestion": "Aktuellen Bearbeitungsvorschlag anwenden",
  "novacode:autocomplete.commands.applyAllSuggestions": "Alle Bearbeitungsvorschläge anwenden",
  "novacode:autocomplete.commands.category": "Nova Code",
  "novacode:autocomplete.codeAction.title": "Nova Code: Bearbeitungsvorschläge",
  "novacode:autocomplete.chatParticipant.fullName": "Nova Code Agent",
  "novacode:autocomplete.chatParticipant.name": "Agent",
  "novacode:autocomplete.chatParticipant.description":
    "Ich kann dir bei Schnellaufgaben und Bearbeitungsvorschlägen helfen.",
  "novacode:autocomplete.incompatibilityExtensionPopup.message":
    "Das Nova Code Autocomplete wird durch einen Konflikt mit GitHub Copilot blockiert. Um dies zu beheben, musst du Copilots Inline-Vorschläge deaktivieren.",
  "novacode:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Copilot deaktivieren",
  "novacode:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "Autocomplete deaktivieren",
}
