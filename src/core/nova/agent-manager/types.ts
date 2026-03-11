/**
 * Agent Manager Types
 *
 * Re-exports types from @novacode/core-schemas for consistency
 * and backward compatibility.
 */

import type { Session as RemoteSession } from "../../../shared/nova/cli-sessions/core/SessionClient"

// Re-export all agent manager types from core-schemas
export {
	// Schemas
	agentStatusSchema,
	sessionSourceSchema,
	parallelModeInfoSchema,
	agentTeamOwnershipSchema,
	teamRunStatusSchema,
	teamWaveStatusSchema,
	teamHandoffStatusSchema,
	teamApprovalStatusSchema,
	teamBlackboardCategorySchema,
	teamApprovalAskTypeSchema,
	teamRunEventTypeSchema,
	teamRunMemberSchema,
	teamWaveSchema,
	teamHandoffSchema,
	teamBlackboardEntrySchema,
	teamApprovalRequestSchema,
	teamRunSchema,
	teamRunStateSchema,
	teamRunEventSchema,
	agentSessionSchema,
	pendingSessionSchema,
	agentManagerStateSchema,
	agentManagerMessageSchema,
	agentManagerExtensionMessageSchema,
	availableModelSchema,
	availableModeSchema,
	startSessionMessageSchema,
	respondToTeamApprovalMessageSchema,
	cancelTeamMemberMessageSchema,
	cancelTeamRunMessageSchema,
	// Types
	type AgentTeamRoleType,
	type AgentTeamOwnership,
	type TeamRunStatus,
	type TeamWaveStatus,
	type TeamHandoffStatus,
	type TeamApprovalStatus,
	type TeamBlackboardCategory,
	type TeamApprovalAskType,
	type TeamRunEventType,
	type TeamRunMember,
	type TeamWave,
	type TeamHandoff,
	type TeamBlackboardEntry,
	type TeamApprovalRequest,
	type TeamRun,
	type TeamRunState,
	type TeamRunEvent,
	type AgentStatus,
	type SessionSource,
	type ParallelModeInfo,
	type AgentSession,
	type PendingSession,
	type AgentManagerState,
	type AgentManagerMessage,
	type AgentManagerExtensionMessage,
	type AvailableModel,
	type AvailableMode,
	type StartSessionMessage,
	type RespondToTeamApprovalMessage,
	type CancelTeamMemberMessage,
	type CancelTeamRunMessage,
} from "@novacode/core-schemas"

// Re-export remote session shape from shared session client for consistency
export type { RemoteSession }
