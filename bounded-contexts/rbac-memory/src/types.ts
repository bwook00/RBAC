export type Scope = string
export type RoleId = string
export type PrincipalId = string
export type MemoryId = string
export type OrganizationId = string
export type UserId = string

export type Capability = "runtime" | "management"
export type Action = "permission:manage" | "memory:write" | "memory:search"
export type SearchMode = "contains" | "all" | "any" | "exact" | "semantic"

export type CallerContext = {
  principalId: PrincipalId
  roleIds: RoleId[]
  capabilities: Capability[]
  organizationIds?: OrganizationId[]
}

export type Permission = {
  roleId: RoleId
  readableScopes: Scope[]
  writableScopes: Scope[]
}

export type MemoryRecord = {
  id: MemoryId
  scope: Scope
  organizationIds?: OrganizationId[]
  content: string
  tags?: string[]
  metadata?: Record<string, string>
}

export type MemoryWriteInput = {
  caller: CallerContext
  record: MemoryRecord
}

export type MemorySearchInput = {
  caller: CallerContext
  query: string
  requestedScopes?: Scope[]
  organizationIds?: OrganizationId[]
  tags?: string[]
  metadata?: Record<string, string>
  mode?: SearchMode
  limit?: number
  explain?: ExplainAudience
}

export type ExplainAudience = "runtime" | "admin"

export type DenyReasonCode =
  | "missing_principal"
  | "missing_capability"
  | "unknown_role"
  | "malformed_scope"
  | "no_readable_scope"
  | "no_writable_scope"
  | "unsupported_explain_audience"
  | "store_unavailable"

export type Decision =
  | { allowed: true }
  | { allowed: false; reason: DenyReasonCode }

export type RuntimeRedactedExplain = {
  audience: "runtime"
  includedIds: MemoryId[]
  excludedCount: number
  reasonCodes: DenyReasonCode[]
  requestedScopeDenials: Scope[]
}

export type AdminAuditExplain = {
  audience: "admin"
  included: MemoryRecord[]
  excluded: Array<{ record: MemoryRecord; reason: DenyReasonCode }>
}

export type MemorySearchResult = {
  records: MemoryRecord[]
  explain: RuntimeRedactedExplain | AdminAuditExplain
}

export type PolicyDecisionEvent = {
  type: "policy_decision" | "memory_write_denied" | "memory_search_explained"
  principalId: PrincipalId
  roleIds: RoleId[]
  action: Action
  requestedScopes: Scope[]
  decision: "allow" | "deny"
  reasonCode?: DenyReasonCode
  backendId?: string
}
