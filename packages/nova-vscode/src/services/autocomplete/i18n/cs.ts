// cs runtime translations for autocomplete

export const dict = {
  "novacode:autocomplete.statusBar.enabled": "$(nova-logo) Autocomplete",
  "novacode:autocomplete.statusBar.snoozed": "pozastaveno",
  "novacode:autocomplete.statusBar.warning": "$(warning) Autocomplete",
  "novacode:autocomplete.statusBar.tooltip.basic": "Nova Code Autocomplete",
  "novacode:autocomplete.statusBar.tooltip.disabled": "Nova Code Autocomplete (zakázáno)",
  "novacode:autocomplete.statusBar.tooltip.noCredits":
    "**Na tvém účtu nejsou žádné kredity**\n\nTvůj účet Nova Code nemá žádné kredity. Pro použití automatického doplňování prosím přidej kredity na svůj účet.\n\n[Otevřít Nastavení](command:vcp-code.new.settingsButtonClicked)",
  "novacode:autocomplete.statusBar.tooltip.noUsableProvider":
    "**Není nakonfigurován žádný model automatického doplňování**\n\nPro povolení automatického doplňování přidej profil s jedním z těchto podporovaných poskytovatelů: {{providers}}.\n\n[Otevřít Nastavení](command:vcp-code.new.settingsButtonClicked)",
  "novacode:autocomplete.statusBar.tooltip.sessionTotal": "Celkové náklady relace:",
  "novacode:autocomplete.statusBar.tooltip.provider": "Poskytovatel:",
  "novacode:autocomplete.statusBar.tooltip.model": "Model:",
  "novacode:autocomplete.statusBar.tooltip.profile": "Profil: ",
  "novacode:autocomplete.statusBar.tooltip.defaultProfile": "Výchozí",
  "novacode:autocomplete.statusBar.tooltip.completionSummary":
    "Provedeno {{count}} dokončení mezi {{startTime}} a {{endTime}}, s celkovými náklady {{cost}}.",
  "novacode:autocomplete.statusBar.tooltip.providerInfo":
    "Automatické dokončování poskytuje {{model}} přes {{provider}}.",
  "novacode:autocomplete.statusBar.cost.zero": "$0.00",
  "novacode:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "novacode:autocomplete.toggleMessage": "Nova Code Autocomplete {{status}}",
  "novacode:autocomplete.progress.title": "Nova Code",
  "novacode:autocomplete.progress.analyzing": "Analyzuji tvůj kód...",
  "novacode:autocomplete.progress.generating": "Generuji navrhované úpravy...",
  "novacode:autocomplete.progress.processing": "Zpracovávám navrhované úpravy...",
  "novacode:autocomplete.progress.showing": "Zobrazuji navrhované úpravy...",
  "novacode:autocomplete.input.title": "Nova Code: Rychlý úkol",
  "novacode:autocomplete.input.placeholder": "např. 'refaktoruj tuto funkci, aby byla efektivnější'",
  "novacode:autocomplete.commands.generateSuggestions": "Nova Code: Generovat navrhované úpravy",
  "novacode:autocomplete.commands.displaySuggestions": "Zobrazit navrhované úpravy",
  "novacode:autocomplete.commands.cancelSuggestions": "Zrušit navrhované úpravy",
  "novacode:autocomplete.commands.applyCurrentSuggestion": "Použít aktuální navrhovanou úpravu",
  "novacode:autocomplete.commands.applyAllSuggestions": "Použít všechny navrhované úpravy",
  "novacode:autocomplete.commands.category": "Nova Code",
  "novacode:autocomplete.codeAction.title": "Nova Code: Navrhované úpravy",
  "novacode:autocomplete.chatParticipant.fullName": "Nova Code Agent",
  "novacode:autocomplete.chatParticipant.name": "Agent",
  "novacode:autocomplete.chatParticipant.description": "Mohu ti pomoci s rychlými úkoly a navrženými úpravami.",
  "novacode:autocomplete.incompatibilityExtensionPopup.message":
    "Nova Code Autocomplete je blokováno konfliktem s GitHub Copilot. Pro vyřešení tohoto problému musíš zakázat inline návrhy Copilot.",
  "novacode:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Zakázat Copilot",
  "novacode:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "Zakázat Autocomplete",
}
