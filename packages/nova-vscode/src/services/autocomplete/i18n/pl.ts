// pl runtime translations for autocomplete

export const dict = {
  "novacode:autocomplete.statusBar.enabled": "$(nova-logo) Autocomplete",
  "novacode:autocomplete.statusBar.snoozed": "wstrzymane",
  "novacode:autocomplete.statusBar.warning": "$(warning) Autocomplete",
  "novacode:autocomplete.statusBar.tooltip.basic": "Nova Code Autocomplete",
  "novacode:autocomplete.statusBar.tooltip.disabled": "Nova Code Autocomplete (wyłączone)",
  "novacode:autocomplete.statusBar.tooltip.noCredits":
    "**Brak środków na koncie**\n\nTwoje konto Nova Code nie ma środków. Aby korzystać z autouzupełniania, dodaj środki do swojego konta.\n\n[Otwórz Ustawienia](command:vcp-code.new.settingsButtonClicked)",
  "novacode:autocomplete.statusBar.tooltip.noUsableProvider":
    "**Nie skonfigurowano modelu autouzupełniania**\n\nAby włączyć autouzupełnianie, dodaj profil z jednym z tych obsługiwanych dostawców: {{providers}}.\n\n[Otwórz Ustawienia](command:vcp-code.new.settingsButtonClicked)",
  "novacode:autocomplete.statusBar.tooltip.sessionTotal": "Całkowity koszt sesji:",
  "novacode:autocomplete.statusBar.tooltip.provider": "Dostawca:",
  "novacode:autocomplete.statusBar.tooltip.model": "Model:",
  "novacode:autocomplete.statusBar.tooltip.profile": "Profil: ",
  "novacode:autocomplete.statusBar.tooltip.defaultProfile": "Domyślny",
  "novacode:autocomplete.statusBar.tooltip.completionSummary":
    "Wykonano {{count}} uzupełnień między {{startTime}} a {{endTime}}, za łączny koszt {{cost}}.",
  "novacode:autocomplete.statusBar.tooltip.providerInfo":
    "Autouzupełnianie zapewniane przez {{model}} za pośrednictwem {{provider}}.",
  "novacode:autocomplete.statusBar.cost.zero": "$0.00",
  "novacode:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "novacode:autocomplete.toggleMessage": "Nova Code Autocomplete {{status}}",
  "novacode:autocomplete.progress.title": "Nova Code",
  "novacode:autocomplete.progress.analyzing": "Analizuję twój kod...",
  "novacode:autocomplete.progress.generating": "Generuję sugerowane edycje...",
  "novacode:autocomplete.progress.processing": "Przetwarzam sugerowane edycje...",
  "novacode:autocomplete.progress.showing": "Wyświetlam sugerowane edycje...",
  "novacode:autocomplete.input.title": "Nova Code: Szybkie Zadanie",
  "novacode:autocomplete.input.placeholder": "np. 'zrefaktoruj tę funkcję, aby była bardziej wydajna'",
  "novacode:autocomplete.commands.generateSuggestions": "Nova Code: Generuj Sugerowane Edycje",
  "novacode:autocomplete.commands.displaySuggestions": "Wyświetl Sugerowane Edycje",
  "novacode:autocomplete.commands.cancelSuggestions": "Anuluj Sugerowane Edycje",
  "novacode:autocomplete.commands.applyCurrentSuggestion": "Zastosuj Bieżącą Sugerowaną Edycję",
  "novacode:autocomplete.commands.applyAllSuggestions": "Zastosuj Wszystkie Sugerowane Edycje",
  "novacode:autocomplete.commands.category": "Nova Code",
  "novacode:autocomplete.codeAction.title": "Nova Code: Sugerowane Edycje",
  "novacode:autocomplete.chatParticipant.fullName": "Nova Code Agent",
  "novacode:autocomplete.chatParticipant.name": "Agent",
  "novacode:autocomplete.chatParticipant.description": "Mogę pomóc ci w szybkich zadaniach i sugerowanych edycjach.",
  "novacode:autocomplete.incompatibilityExtensionPopup.message":
    "Nova Code Autocomplete jest blokowane przez konflikt z GitHub Copilot. Aby to naprawić, musisz wyłączyć sugestie inline Copilot.",
  "novacode:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Wyłącz Copilot",
  "novacode:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "Wyłącz Autocomplete",
}
