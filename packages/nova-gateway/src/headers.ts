import {
  HEADER_ORGANIZATIONID,
  HEADER_TASKID,
  HEADER_PROJECTID,
  HEADER_TESTER,
  HEADER_EDITORNAME,
  HEADER_MACHINEID,
  HEADER_FEATURE,
  USER_AGENT,
  CONTENT_TYPE,
  DEFAULT_EDITOR_NAME,
  ENV_EDITOR_NAME,
  TESTER_SUPPRESS_VALUE,
  ENV_FEATURE, // novacode_change
} from "./api/constants.js"

/**
 * Header constants for NovaCode API requests
 * @deprecated Use HEADER_* constants from constants.ts instead
 */
export const X_KILOCODE_ORGANIZATIONID = HEADER_ORGANIZATIONID
export const X_KILOCODE_TASKID = HEADER_TASKID
export const X_KILOCODE_PROJECTID = HEADER_PROJECTID
export const X_KILOCODE_TESTER = HEADER_TESTER
export const X_KILOCODE_EDITORNAME = HEADER_EDITORNAME
export const X_KILOCODE_MACHINEID = HEADER_MACHINEID
export const X_KILOCODE_FEATURE = HEADER_FEATURE

/**
 * Get feature header value from KILOCODE_FEATURE env var.
 * Returns undefined when not set — the gateway stores NULL (unattributed).
 * Callers must explicitly set the env var to get attribution.
 */
export function getFeatureHeader(): string | undefined {
  return process.env[ENV_FEATURE] || undefined
}

/**
 * Default headers for NovaCode requests
 */
export const DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Content-Type": CONTENT_TYPE,
}

/**
 * Get editor name header value
 * Defaults to "opencode" but can be customized
 */
export function getEditorNameHeader(): string {
  return process.env[ENV_EDITOR_NAME] ?? DEFAULT_EDITOR_NAME
}

/**
 * Build NovaCode-specific headers from metadata and options
 */
export function buildKiloHeaders(
  metadata?: { taskId?: string; projectId?: string },
  options?: {
    novacodeOrganizationId?: string
    novacodeTesterWarningsDisabledUntil?: number
    machineId?: string
  },
): Record<string, string> {
  // novacode_change start
  const feature = getFeatureHeader()
  const headers: Record<string, string> = {
    [X_KILOCODE_EDITORNAME]: getEditorNameHeader(),
    ...(feature ? { [X_KILOCODE_FEATURE]: feature } : {}),
  }
  // novacode_change end

  if (metadata?.taskId) {
    headers[X_KILOCODE_TASKID] = metadata.taskId
  }

  if (options?.novacodeOrganizationId) {
    headers[X_KILOCODE_ORGANIZATIONID] = options.novacodeOrganizationId

    if (metadata?.projectId) {
      headers[X_KILOCODE_PROJECTID] = metadata.projectId
    }
  }

  // Add X-KILOCODE-TESTER: SUPPRESS header if the setting is enabled
  if (options?.novacodeTesterWarningsDisabledUntil && options.novacodeTesterWarningsDisabledUntil > Date.now()) {
    headers[X_KILOCODE_TESTER] = TESTER_SUPPRESS_VALUE
  }

  if (options?.machineId) {
    headers[X_KILOCODE_MACHINEID] = options.machineId
  }

  return headers
}
