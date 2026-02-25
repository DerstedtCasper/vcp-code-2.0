// it runtime translations for autocomplete

export const dict = {
  "novacode:autocomplete.statusBar.enabled": "$(nova-logo) Autocomplete",
  "novacode:autocomplete.statusBar.snoozed": "in pausa",
  "novacode:autocomplete.statusBar.warning": "$(warning) Autocomplete",
  "novacode:autocomplete.statusBar.tooltip.basic": "Nova Code Autocomplete",
  "novacode:autocomplete.statusBar.tooltip.disabled": "Nova Code Autocomplete (disabilitato)",
  "novacode:autocomplete.statusBar.tooltip.noCredits":
    "**Nessun credito nel tuo account**\n\nIl tuo account Nova Code non ha crediti. Per usare l'autocompletamento, aggiungi crediti al tuo account.\n\n[Apri Impostazioni](command:vcp-code.new.settingsButtonClicked)",
  "novacode:autocomplete.statusBar.tooltip.noUsableProvider":
    "**Nessun modello di autocompletamento configurato**\n\nPer abilitare l'autocompletamento, aggiungi un profilo con uno di questi provider supportati: {{providers}}.\n\n[Apri Impostazioni](command:vcp-code.new.settingsButtonClicked)",
  "novacode:autocomplete.statusBar.tooltip.sessionTotal": "Costo totale della sessione:",
  "novacode:autocomplete.statusBar.tooltip.provider": "Provider:",
  "novacode:autocomplete.statusBar.tooltip.model": "Modello:",
  "novacode:autocomplete.statusBar.tooltip.profile": "Profilo: ",
  "novacode:autocomplete.statusBar.tooltip.defaultProfile": "Predefinito",
  "novacode:autocomplete.statusBar.tooltip.completionSummary":
    "Eseguiti {{count}} completamenti tra {{startTime}} e {{endTime}}, per un costo totale di {{cost}}.",
  "novacode:autocomplete.statusBar.tooltip.providerInfo":
    "Autocompletamenti forniti da {{model}} tramite {{provider}}.",
  "novacode:autocomplete.statusBar.cost.zero": "$0.00",
  "novacode:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "novacode:autocomplete.toggleMessage": "Nova Code Autocomplete {{status}}",
  "novacode:autocomplete.progress.title": "Nova Code",
  "novacode:autocomplete.progress.analyzing": "Analizzando il tuo codice...",
  "novacode:autocomplete.progress.generating": "Generando modifiche suggerite...",
  "novacode:autocomplete.progress.processing": "Elaborando modifiche suggerite...",
  "novacode:autocomplete.progress.showing": "Mostrando modifiche suggerite...",
  "novacode:autocomplete.input.title": "Nova Code: Attività Rapida",
  "novacode:autocomplete.input.placeholder": "es., 'refactorizza questa funzione per renderla più efficiente'",
  "novacode:autocomplete.commands.generateSuggestions": "Nova Code: Genera Modifiche Suggerite",
  "novacode:autocomplete.commands.displaySuggestions": "Mostra Modifiche Suggerite",
  "novacode:autocomplete.commands.cancelSuggestions": "Annulla Modifiche Suggerite",
  "novacode:autocomplete.commands.applyCurrentSuggestion": "Applica Modifica Suggerita Corrente",
  "novacode:autocomplete.commands.applyAllSuggestions": "Applica Tutte le Modifiche Suggerite",
  "novacode:autocomplete.commands.category": "Nova Code",
  "novacode:autocomplete.codeAction.title": "Nova Code: Modifiche Suggerite",
  "novacode:autocomplete.chatParticipant.fullName": "Nova Code Agent",
  "novacode:autocomplete.chatParticipant.name": "Agent",
  "novacode:autocomplete.chatParticipant.description": "Posso aiutarti con attività rapide e modifiche suggerite.",
  "novacode:autocomplete.incompatibilityExtensionPopup.message":
    "Il Nova Code Autocomplete è bloccato da un conflitto con GitHub Copilot. Per risolvere questo problema, devi disabilitare i suggerimenti in linea di Copilot.",
  "novacode:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Disabilita Copilot",
  "novacode:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "Disabilita Autocomplete",
}
