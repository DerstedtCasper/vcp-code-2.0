// novacode_change - new file
import type { DesktopTheme } from "@opencode-ai/ui/theme/types"
import { DEFAULT_THEMES as UPSTREAM_THEMES } from "@opencode-ai/ui/theme/default-themes"
import novaJson from "./themes/nova.json"
import novaVscodeJson from "./themes/nova-vscode.json"

// Re-export all upstream theme constants
export {
  oc1Theme,
  tokyonightTheme,
  draculaTheme,
  monokaiTheme,
  solarizedTheme,
  nordTheme,
  catppuccinTheme,
  ayuTheme,
  oneDarkProTheme,
  shadesOfPurpleTheme,
  nightowlTheme,
  vesperTheme,
  carbonfoxTheme,
  gruvboxTheme,
  auraTheme,
} from "@opencode-ai/ui/theme/default-themes"

export const novaTheme = novaJson as DesktopTheme
export const novaVscodeTheme = novaVscodeJson as DesktopTheme

// Keep backward-compatible aliases while migrating brand keys.
export const kiloTheme = novaTheme
export const kiloVscodeTheme = novaVscodeTheme

export const NOVA_THEMES: Record<string, DesktopTheme> = {
  kilo: novaTheme,
  nova: novaTheme,
  "nova-vscode": novaVscodeTheme,
}

// Override DEFAULT_THEMES: Kilo themes first, then upstream
export const DEFAULT_THEMES: Record<string, DesktopTheme> = {
  ...NOVA_THEMES,
  ...UPSTREAM_THEMES,
}
