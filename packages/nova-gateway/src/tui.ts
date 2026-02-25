/**
 * Nova Gateway TUI Integration
 *
 * This module provides TUI-specific functionality for nova-gateway.
 * It requires OpenCode TUI dependencies to be injected at runtime.
 *
 * Import from "@novacode/nova-gateway/tui" for TUI features.
 */

// ============================================================================
// TUI Dependency Injection
// ============================================================================
export { initializeTUIDependencies, getTUIDependencies, areTUIDependenciesInitialized } from "./tui/context.js"
export type { TUIDependencies } from "./tui/types.js"

// ============================================================================
// TUI Helpers
// ============================================================================
export { formatProfileInfo, getOrganizationOptions, getDefaultOrganizationSelection } from "./tui/helpers.js"

// ============================================================================
// NOTE: TUI Components Moved to OpenCode
// ============================================================================
// All TUI components with JSX have been moved to packages/opencode/src/novacode/
// to ensure correct JSX transpilation with @opentui/solid.
//
// Components moved:
// - registerKiloCommands -> @/novacode/kilo-commands
// - DialogKiloTeamSelect -> @/novacode/components/dialog-kilo-team-select
// - DialogKiloOrganization -> @/novacode/components/dialog-kilo-organization
// - DialogKiloProfile -> @/novacode/components/dialog-kilo-profile
// - KiloAutoMethod -> @/novacode/components/dialog-kilo-auto-method
// - KiloNews -> @/novacode/components/kilo-news
// - NotificationBanner -> @/novacode/components/notification-banner
// - DialogNovaNotifications -> @/novacode/components/dialog-nova-notifications
