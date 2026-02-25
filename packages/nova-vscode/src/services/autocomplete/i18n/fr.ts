// fr runtime translations for autocomplete

export const dict = {
  "novacode:autocomplete.statusBar.enabled": "$(nova-logo) Autocomplete",
  "novacode:autocomplete.statusBar.snoozed": "en pause",
  "novacode:autocomplete.statusBar.warning": "$(warning) Autocomplete",
  "novacode:autocomplete.statusBar.tooltip.basic": "Nova Code Autocomplete",
  "novacode:autocomplete.statusBar.tooltip.disabled": "Nova Code Autocomplete (désactivé)",
  "novacode:autocomplete.statusBar.tooltip.noCredits":
    "**Pas de crédits sur ton compte**\n\nTon compte Nova Code n'a pas de crédits. Pour utiliser l'autocomplétion, ajoute des crédits à ton compte.\n\n[Ouvrir les Paramètres](command:vcp-code.new.settingsButtonClicked)",
  "novacode:autocomplete.statusBar.tooltip.noUsableProvider":
    "**Aucun modèle d'autocomplétion configuré**\n\nPour activer l'autocomplétion, ajoute un profil avec l'un de ces fournisseurs pris en charge : {{providers}}.\n\n[Ouvrir les Paramètres](command:vcp-code.new.settingsButtonClicked)",
  "novacode:autocomplete.statusBar.tooltip.sessionTotal": "Coût total de la session :",
  "novacode:autocomplete.statusBar.tooltip.provider": "Fournisseur:",
  "novacode:autocomplete.statusBar.tooltip.model": "Modèle :",
  "novacode:autocomplete.statusBar.tooltip.profile": "Profil : ",
  "novacode:autocomplete.statusBar.tooltip.defaultProfile": "Par défaut",
  "novacode:autocomplete.statusBar.tooltip.completionSummary":
    "{{count}} complétions effectuées entre {{startTime}} et {{endTime}}, pour un coût total de {{cost}}.",
  "novacode:autocomplete.statusBar.tooltip.providerInfo": "Auto-complétions fournies par {{model}} via {{provider}}.",
  "novacode:autocomplete.statusBar.cost.zero": "$0.00",
  "novacode:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "novacode:autocomplete.toggleMessage": "Nova Code Autocomplete {{status}}",
  "novacode:autocomplete.progress.title": "Nova Code",
  "novacode:autocomplete.progress.analyzing": "Analyse de ton code...",
  "novacode:autocomplete.progress.generating": "Génération des modifications suggérées...",
  "novacode:autocomplete.progress.processing": "Traitement des modifications suggérées...",
  "novacode:autocomplete.progress.showing": "Affichage des modifications suggérées...",
  "novacode:autocomplete.input.title": "Nova Code : Tâche Rapide",
  "novacode:autocomplete.input.placeholder": "ex., 'refactorise cette fonction pour plus d'efficacité'",
  "novacode:autocomplete.commands.generateSuggestions": "Nova Code : Générer des Modifications Suggérées",
  "novacode:autocomplete.commands.displaySuggestions": "Afficher les Modifications Suggérées",
  "novacode:autocomplete.commands.cancelSuggestions": "Annuler les Modifications Suggérées",
  "novacode:autocomplete.commands.applyCurrentSuggestion": "Appliquer la Modification Suggérée Actuelle",
  "novacode:autocomplete.commands.applyAllSuggestions": "Appliquer Toutes les Modifications Suggérées",
  "novacode:autocomplete.commands.category": "Nova Code",
  "novacode:autocomplete.codeAction.title": "Nova Code : Modifications Suggérées",
  "novacode:autocomplete.chatParticipant.fullName": "Nova Code Agent",
  "novacode:autocomplete.chatParticipant.name": "Agent",
  "novacode:autocomplete.chatParticipant.description":
    "Je peux t'aider avec des tâches rapides et des modifications suggérées.",
  "novacode:autocomplete.incompatibilityExtensionPopup.message":
    "Le Nova Code Autocomplete est bloqué par un conflit avec GitHub Copilot. Pour résoudre cela, tu dois désactiver les suggestions en ligne de Copilot.",
  "novacode:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Désactiver Copilot",
  "novacode:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "Désactiver Autocomplete",
}
