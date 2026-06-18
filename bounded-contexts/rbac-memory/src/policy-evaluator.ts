import { isScopeAllowed, isValidScope } from "./scope.js"
import type {
  Action,
  CallerContext,
  Decision,
  DenyReasonCode,
  Permission,
  Scope,
} from "./types.js"

export type PolicyEvaluatorOptions = {
  permissions: Permission[]
}

export class PolicyEvaluator {
  readonly #permissionsByRole: Map<string, Permission>

  constructor(options: PolicyEvaluatorOptions) {
    this.#permissionsByRole = new Map(
      options.permissions.map((permission) => [permission.roleId, permission]),
    )
  }

  permissions(): Permission[] {
    return Array.from(this.#permissionsByRole.values()).map((permission) => ({
      roleId: permission.roleId,
      readableScopes: [...permission.readableScopes],
      writableScopes: [...permission.writableScopes],
    }))
  }

  evaluateManagement(caller: CallerContext): Decision {
    const baseDecision = validateCaller(caller, "permission:manage")
    if (!baseDecision.allowed) {
      return baseDecision
    }

    if (!caller.capabilities.includes("management")) {
      return deny("missing_capability")
    }

    const permissions = this.#permissionsFor(caller)
    if (permissions.length !== caller.roleIds.length) {
      return deny("unknown_role")
    }

    return { allowed: true }
  }

  evaluateWrite(caller: CallerContext, targetScope: Scope): Decision {
    const baseDecision = validateCaller(caller, "memory:write")
    if (!baseDecision.allowed) {
      return baseDecision
    }

    if (!isValidScope(targetScope)) {
      return deny("malformed_scope")
    }

    const permissions = this.#permissionsFor(caller)
    if (permissions.length !== caller.roleIds.length) {
      return deny("unknown_role")
    }

    const writableScopes = permissions.flatMap(
      (permission) => permission.writableScopes,
    )
    if (!isScopeAllowed(targetScope, writableScopes)) {
      return deny("no_writable_scope")
    }

    return { allowed: true }
  }

  evaluateSearch(
    caller: CallerContext,
    requestedScopes: Scope[],
    options: { requireRuntimeCapability?: boolean } = {},
  ): Decision {
    const baseDecision = validateCaller(caller, "memory:search", {
      requireRuntimeCapability: options.requireRuntimeCapability ?? true,
    })
    if (!baseDecision.allowed) {
      return baseDecision
    }

    if (requestedScopes.some((scope) => !isValidScope(scope))) {
      return deny("malformed_scope")
    }

    const permissions = this.#permissionsFor(caller)
    if (permissions.length !== caller.roleIds.length) {
      return deny("unknown_role")
    }

    if (this.readableScopesFor(caller).length === 0) {
      return deny("no_readable_scope")
    }

    return { allowed: true }
  }

  readableScopesFor(caller: CallerContext): Scope[] {
    return uniqueScopes(
      this.#permissionsFor(caller).flatMap(
        (permission) => permission.readableScopes,
      ),
    )
  }

  writableScopesFor(caller: CallerContext): Scope[] {
    return uniqueScopes(
      this.#permissionsFor(caller).flatMap(
        (permission) => permission.writableScopes,
      ),
    )
  }

  #permissionsFor(caller: CallerContext): Permission[] {
    return caller.roleIds.flatMap((roleId) => {
      const permission = this.#permissionsByRole.get(roleId)
      return permission === undefined ? [] : [permission]
    })
  }
}

function validateCaller(
  caller: CallerContext,
  action: Action,
  options: { requireRuntimeCapability?: boolean } = {},
): Decision {
  if (caller.principalId.length === 0) {
    return deny("missing_principal")
  }

  if (caller.roleIds.length === 0) {
    return deny("unknown_role")
  }

  if (
    action !== "permission:manage" &&
    (options.requireRuntimeCapability ?? true) &&
    !caller.capabilities.includes("runtime")
  ) {
    return deny("missing_capability")
  }

  return { allowed: true }
}

function deny(reason: DenyReasonCode): Decision {
  return { allowed: false, reason }
}

function uniqueScopes(scopes: Scope[]): Scope[] {
  return Array.from(new Set(scopes))
}
