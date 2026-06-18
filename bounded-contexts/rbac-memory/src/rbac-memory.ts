import { copyRecord, InMemoryStore, type MemoryStore } from "./memory-store.js"
import { InMemoryPermissionStore, type PermissionStore } from "./permissions.js"
import { PolicyEvaluator } from "./policy-evaluator.js"
import {
  intersectRequestedScopes,
  isScopeAllowed,
  isValidScope,
} from "./scope.js"
import type {
  AdminAuditExplain,
  CallerContext,
  DenyReasonCode,
  ExplainAudience,
  MemoryRecord,
  MemorySearchInput,
  MemorySearchResult,
  MemoryWriteInput,
  Permission,
  PolicyDecisionEvent,
  RuntimeRedactedExplain,
  Scope,
} from "./types.js"

export type AuditSink = {
  append(event: PolicyDecisionEvent): void | Promise<void>
}

export type RbacMemoryOptions = {
  permissions?: Permission[]
  permissionStore?: PermissionStore
  store?: MemoryStore
  auditSink?: AuditSink
}

export class RbacMemory {
  readonly #permissions: PermissionStore
  readonly #store: MemoryStore
  readonly #auditSink: AuditSink | undefined

  constructor(options: RbacMemoryOptions = {}) {
    // When a persistent permission store is injected the caller owns seeding
    // (so stored edits survive restarts); otherwise default to an in-memory
    // store seeded from `options.permissions`.
    if (options.permissionStore === undefined) {
      const store = new InMemoryPermissionStore()
      for (const permission of options.permissions ?? []) {
        validatePermission(permission)
        store.upsert(permission)
      }
      this.#permissions = store
    } else {
      this.#permissions = options.permissionStore
    }
    this.#store = options.store ?? new InMemoryStore()
    this.#auditSink = options.auditSink
  }

  listPermissions(caller: CallerContext): Permission[] {
    this.#assertManagement(caller)
    return this.#permissions.list()
  }

  upsertPermission(caller: CallerContext, permission: Permission): Permission {
    this.#assertManagement(caller)
    validatePermission(permission)
    return this.#permissions.upsert(permission)
  }

  deletePermission(caller: CallerContext, roleId: string): boolean {
    this.#assertManagement(caller)
    return this.#permissions.delete(roleId)
  }

  async memoryWrite(
    input: MemoryWriteInput,
  ): Promise<{ allowed: true } | { allowed: false; reason: DenyReasonCode }> {
    const evaluator = this.#evaluator()
    const decision = evaluator.evaluateWrite(input.caller, input.record.scope)
    if (!decision.allowed) {
      await this.#appendEvent({
        type: "memory_write_denied",
        principalId: input.caller.principalId,
        roleIds: input.caller.roleIds,
        action: "memory:write",
        requestedScopes: [input.record.scope],
        decision: "deny",
        reasonCode: decision.reason,
        backendId: this.#store.id,
      })
      return decision
    }
    let existingRecord: MemoryRecord | undefined
    try {
      existingRecord = await this.#findRecord(input.record.id)
    } catch {
      await this.#appendEvent({
        type: "memory_write_denied",
        principalId: input.caller.principalId,
        roleIds: input.caller.roleIds,
        action: "memory:write",
        requestedScopes: [input.record.scope],
        decision: "deny",
        reasonCode: "store_unavailable",
        backendId: this.#store.id,
      })
      return { allowed: false, reason: "store_unavailable" }
    }
    if (
      existingRecord !== undefined &&
      existingRecord.scope !== input.record.scope
    ) {
      const existingScopeDecision = evaluator.evaluateWrite(
        input.caller,
        existingRecord.scope,
      )
      if (!existingScopeDecision.allowed) {
        await this.#appendEvent({
          type: "memory_write_denied",
          principalId: input.caller.principalId,
          roleIds: input.caller.roleIds,
          action: "memory:write",
          requestedScopes: [existingRecord.scope, input.record.scope],
          decision: "deny",
          reasonCode: existingScopeDecision.reason,
          backendId: this.#store.id,
        })
        return existingScopeDecision
      }
    }

    try {
      await this.#store.write({ record: copyRecord(input.record) })
    } catch {
      await this.#appendEvent({
        type: "memory_write_denied",
        principalId: input.caller.principalId,
        roleIds: input.caller.roleIds,
        action: "memory:write",
        requestedScopes: [input.record.scope],
        decision: "deny",
        reasonCode: "store_unavailable",
        backendId: this.#store.id,
      })
      return { allowed: false, reason: "store_unavailable" }
    }
    await this.#appendEvent({
      type: "policy_decision",
      principalId: input.caller.principalId,
      roleIds: input.caller.roleIds,
      action: "memory:write",
      requestedScopes: [input.record.scope],
      decision: "allow",
      backendId: this.#store.id,
    })
    return { allowed: true }
  }

  async memorySearch(
    input: MemorySearchInput,
  ): Promise<MemorySearchResult | { allowed: false; reason: DenyReasonCode }> {
    const audience = input.explain ?? "runtime"
    if (audience !== "runtime" && audience !== "admin") {
      return { allowed: false, reason: "unsupported_explain_audience" }
    }

    if (audience === "admin") {
      const managementDecision = this.#evaluator().evaluateManagement(
        input.caller,
      )
      if (!managementDecision.allowed) {
        return managementDecision
      }
    }

    const evaluator = this.#evaluator()
    const requestedScopes =
      input.requestedScopes ?? evaluator.readableScopesFor(input.caller)
    const decision = evaluator.evaluateSearch(input.caller, requestedScopes, {
      requireRuntimeCapability: audience !== "admin",
    })
    if (!decision.allowed) {
      await this.#appendEvent({
        type: "policy_decision",
        principalId: input.caller.principalId,
        roleIds: input.caller.roleIds,
        action: "memory:search",
        requestedScopes,
        decision: "deny",
        reasonCode: decision.reason,
        backendId: this.#store.id,
      })
      return decision
    }

    const readableScopes = evaluator.readableScopesFor(input.caller)
    const allowedRequestedScopes = intersectRequestedScopes(
      readableScopes,
      input.requestedScopes,
    )
    if (allowedRequestedScopes.length === 0) {
      await this.#appendEvent({
        type: "policy_decision",
        principalId: input.caller.principalId,
        roleIds: input.caller.roleIds,
        action: "memory:search",
        requestedScopes,
        decision: "deny",
        reasonCode: "no_readable_scope",
        backendId: this.#store.id,
      })
      return { allowed: false, reason: "no_readable_scope" }
    }

    let candidates: MemoryRecord[]
    try {
      candidates = await this.#store.search({
        query: input.query,
        readableScopes: allowedRequestedScopes,
        organizationIds: input.organizationIds,
        tags: input.tags,
        metadata: input.metadata,
        mode: input.mode,
        limit: input.limit,
      })
    } catch {
      await this.#appendEvent({
        type: "policy_decision",
        principalId: input.caller.principalId,
        roleIds: input.caller.roleIds,
        action: "memory:search",
        requestedScopes,
        decision: "deny",
        reasonCode: "store_unavailable",
        backendId: this.#store.id,
      })
      return { allowed: false, reason: "store_unavailable" }
    }
    const records = candidates
      .filter((record) => isScopeAllowed(record.scope, allowedRequestedScopes))
      .filter((record) => organizationMatches(record, input.organizationIds))
    const explain = buildExplain({
      audience,
      candidates,
      records,
      readableScopes: allowedRequestedScopes,
      requestedScopes,
    })

    await this.#appendEvent({
      type: "memory_search_explained",
      principalId: input.caller.principalId,
      roleIds: input.caller.roleIds,
      action: "memory:search",
      requestedScopes,
      decision: "allow",
      backendId: this.#store.id,
    })

    return { records, explain }
  }

  #assertManagement(caller: CallerContext): void {
    const decision = this.#evaluator().evaluateManagement(caller)
    if (!decision.allowed) {
      throw new RbacMemoryError(decision.reason)
    }
  }

  #evaluator(): PolicyEvaluator {
    return new PolicyEvaluator({ permissions: this.#permissions.list() })
  }

  async #appendEvent(event: PolicyDecisionEvent): Promise<void> {
    await this.#auditSink?.append(event)
  }

  async #findRecord(id: string): Promise<MemoryRecord | undefined> {
    const records = await this.#store.list()
    return records.find((record) => record.id === id)
  }
}

export class RbacMemoryError extends Error {
  readonly reason: DenyReasonCode

  constructor(reason: DenyReasonCode) {
    super(reason)
    this.name = "RbacMemoryError"
    this.reason = reason
  }
}

type ExplainInput = {
  audience: ExplainAudience
  candidates: MemoryRecord[]
  records: MemoryRecord[]
  readableScopes: Scope[]
  requestedScopes: Scope[]
}

function buildExplain(
  input: ExplainInput,
): RuntimeRedactedExplain | AdminAuditExplain {
  const includedIds = new Set(input.records.map((record) => record.id))
  const excluded = input.candidates
    .filter((record) => !includedIds.has(record.id))
    .map((record) => ({
      record,
      reason: reasonForRecord(),
    }))

  if (input.audience === "admin") {
    return {
      audience: "admin",
      included: input.records.map(copyRecord),
      excluded: excluded.map(({ record, reason }) => ({
        record: copyRecord(record),
        reason,
      })),
    }
  }

  return {
    audience: "runtime",
    includedIds: input.records.map((record) => record.id),
    excludedCount: excluded.length,
    reasonCodes: uniqueReasons(excluded.map(({ reason }) => reason)),
    requestedScopeDenials: input.requestedScopes.filter(
      (scope) => !isScopeAllowed(scope, input.readableScopes),
    ),
  }
}

function reasonForRecord(): DenyReasonCode {
  return "no_readable_scope"
}

function uniqueReasons(reasons: DenyReasonCode[]): DenyReasonCode[] {
  return Array.from(new Set(reasons))
}

function organizationMatches(
  record: MemoryRecord,
  organizationIds: string[] | undefined,
): boolean {
  if (organizationIds === undefined || organizationIds.length === 0) {
    return true
  }
  const recordOrganizations = record.organizationIds ?? [
    record.scope.split("/").slice(0, 2).join("/"),
  ]
  return recordOrganizations.some((organizationId) =>
    organizationIds.includes(organizationId),
  )
}
function validatePermission(permission: Permission): void {
  if (permission.roleId.length === 0) {
    throw new RbacMemoryError("unknown_role")
  }

  for (const scope of [
    ...permission.readableScopes,
    ...permission.writableScopes,
  ]) {
    if (!isValidScope(scope)) {
      throw new RbacMemoryError("malformed_scope")
    }
  }
}
