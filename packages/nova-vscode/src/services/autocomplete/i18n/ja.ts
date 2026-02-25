// ja runtime translations for autocomplete

export const dict = {
  "novacode:autocomplete.statusBar.enabled": "$(nova-logo) Autocomplete",
  "novacode:autocomplete.statusBar.snoozed": "一時停止中",
  "novacode:autocomplete.statusBar.warning": "$(warning) Autocomplete",
  "novacode:autocomplete.statusBar.tooltip.basic": "Nova Code Autocomplete",
  "novacode:autocomplete.statusBar.tooltip.disabled": "Nova Code Autocomplete（無効）",
  "novacode:autocomplete.statusBar.tooltip.noCredits":
    "**アカウントにクレジットがありません**\n\nNova Code アカウントにクレジットがありません。オートコンプリートを使用するには、アカウントにクレジットを追加してください。\n\n[設定を開く](command:vcp-code.new.settingsButtonClicked)",
  "novacode:autocomplete.statusBar.tooltip.noUsableProvider":
    "**オートコンプリートモデルが設定されていません**\n\nオートコンプリートを有効にするには、これらのサポートされているプロバイダーのいずれかでプロファイルを追加してください: {{providers}}。\n\n[設定を開く](command:vcp-code.new.settingsButtonClicked)",
  "novacode:autocomplete.statusBar.tooltip.sessionTotal": "セッション合計コスト:",
  "novacode:autocomplete.statusBar.tooltip.provider": "プロバイダー:",
  "novacode:autocomplete.statusBar.tooltip.model": "モデル:",
  "novacode:autocomplete.statusBar.tooltip.profile": "プロファイル: ",
  "novacode:autocomplete.statusBar.tooltip.defaultProfile": "デフォルト",
  "novacode:autocomplete.statusBar.tooltip.completionSummary":
    "{{startTime}}から{{endTime}}の間に{{count}}回の補完を実行し、合計コストは{{cost}}です。",
  "novacode:autocomplete.statusBar.tooltip.providerInfo":
    "オートコンプリートは{{provider}}経由で{{model}}によって提供されています。",
  "novacode:autocomplete.statusBar.cost.zero": "$0.00",
  "novacode:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "novacode:autocomplete.toggleMessage": "Nova Code Autocomplete {{status}}",
  "novacode:autocomplete.progress.title": "Nova Code",
  "novacode:autocomplete.progress.analyzing": "コードを分析中...",
  "novacode:autocomplete.progress.generating": "編集提案を生成中...",
  "novacode:autocomplete.progress.processing": "編集提案を処理中...",
  "novacode:autocomplete.progress.showing": "編集提案を表示中...",
  "novacode:autocomplete.input.title": "Nova Code: クイックタスク",
  "novacode:autocomplete.input.placeholder": "例：「この関数をより効率的にリファクタリングして」",
  "novacode:autocomplete.commands.generateSuggestions": "Nova Code: 編集提案を生成",
  "novacode:autocomplete.commands.displaySuggestions": "編集提案を表示",
  "novacode:autocomplete.commands.cancelSuggestions": "編集提案をキャンセル",
  "novacode:autocomplete.commands.applyCurrentSuggestion": "現在の編集提案を適用",
  "novacode:autocomplete.commands.applyAllSuggestions": "すべての編集提案を適用",
  "novacode:autocomplete.commands.category": "Nova Code",
  "novacode:autocomplete.codeAction.title": "Nova Code: 編集提案",
  "novacode:autocomplete.chatParticipant.fullName": "Nova Code Agent",
  "novacode:autocomplete.chatParticipant.name": "Agent",
  "novacode:autocomplete.chatParticipant.description": "クイックタスクと編集提案でお手伝いできます。",
  "novacode:autocomplete.incompatibilityExtensionPopup.message":
    "Nova Code AutocompleteがGitHub Copilotとの競合によってブロックされています。これを修正するには、Copilotのインライン提案を無効にする必要があります。",
  "novacode:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Copilotを無効にする",
  "novacode:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "Autocompleteを無効にする",
}
