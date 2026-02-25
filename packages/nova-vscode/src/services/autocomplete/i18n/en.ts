// English runtime translations for autocomplete (novacode:autocomplete.* namespace)
// Source: src/i18n/locales/en/novacode.json → "autocomplete" section

export const dict = {
  "novacode:autocomplete.statusBar.enabled": "$(nova-logo) Autocomplete",
  "novacode:autocomplete.statusBar.snoozed": "snoozed",
  "novacode:autocomplete.statusBar.warning": "$(warning) Autocomplete",
  "novacode:autocomplete.statusBar.tooltip.basic": "Nova Code Autocomplete",
  "novacode:autocomplete.statusBar.tooltip.disabled": "Nova Code Autocomplete (disabled)",
  "novacode:autocomplete.statusBar.tooltip.noCredits":
    "**No credits in your account**\n\nYour Nova Code account has no credits. To use autocomplete, please add credits to your account.\n\n[Open Settings](command:vcp-code.new.settingsButtonClicked)",
  "novacode:autocomplete.statusBar.tooltip.noUsableProvider":
    "**No autocomplete model configured**\n\nTo enable autocomplete, add a profile with one of these supported providers: {{providers}}.\n\n[Open Settings](command:vcp-code.new.settingsButtonClicked)",
  "novacode:autocomplete.statusBar.tooltip.sessionTotal": "Session total cost:",
  "novacode:autocomplete.statusBar.tooltip.provider": "Provider:",
  "novacode:autocomplete.statusBar.tooltip.model": "Model:",
  "novacode:autocomplete.statusBar.tooltip.profile": "Profile: ",
  "novacode:autocomplete.statusBar.tooltip.defaultProfile": "Default",
  "novacode:autocomplete.statusBar.tooltip.completionSummary":
    "Performed {{count}} completions between {{startTime}} and {{endTime}}, for a total cost of {{cost}}.",
  "novacode:autocomplete.statusBar.tooltip.providerInfo": "Autocompletions provided by {{model}} via {{provider}}.",
  "novacode:autocomplete.statusBar.cost.zero": "$0.00",
  "novacode:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "novacode:autocomplete.toggleMessage": "Nova Code Autocomplete {{status}}",
  "novacode:autocomplete.progress.title": "Nova Code",
  "novacode:autocomplete.progress.analyzing": "Analyzing your code...",
  "novacode:autocomplete.progress.generating": "Generating suggested edits...",
  "novacode:autocomplete.progress.processing": "Processing suggested edits...",
  "novacode:autocomplete.progress.showing": "Displaying suggested edits...",
  "novacode:autocomplete.input.title": "Nova Code: Quick Task",
  "novacode:autocomplete.input.placeholder": "e.g., 'refactor this function to be more efficient'",
  "novacode:autocomplete.commands.generateSuggestions": "Nova Code: Generate Suggested Edits",
  "novacode:autocomplete.commands.displaySuggestions": "Display Suggested Edits",
  "novacode:autocomplete.commands.cancelSuggestions": "Cancel Suggested Edits",
  "novacode:autocomplete.commands.applyCurrentSuggestion": "Apply Current Suggested Edit",
  "novacode:autocomplete.commands.applyAllSuggestions": "Apply All Suggested Edits",
  "novacode:autocomplete.commands.category": "Nova Code",
  "novacode:autocomplete.codeAction.title": "Nova Code: Suggested Edits",
  "novacode:autocomplete.chatParticipant.fullName": "Nova Code Agent",
  "novacode:autocomplete.chatParticipant.name": "Agent",
  "novacode:autocomplete.chatParticipant.description": "I can help you with quick tasks and suggested edits.",
  "novacode:autocomplete.incompatibilityExtensionPopup.message":
    "The Nova Code Autocomplete is being blocked by a conflict with GitHub Copilot. To fix this, you must disable Copilot's inline suggestions.",
  "novacode:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Disable Copilot",
  "novacode:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "Disable Autocomplete",
}
