import type { Scope } from "./types.js"

const SCOPE_SEGMENT_PATTERN = /^[a-zA-Z0-9_-]+$/

export function isValidScope(scope: Scope): boolean {
  const segments = scope.split("/")
  return (
    segments.length > 0 &&
    segments.every((segment) => SCOPE_SEGMENT_PATTERN.test(segment))
  )
}

export function scopeIncludes(granted: Scope, requested: Scope): boolean {
  return requested === granted || requested.startsWith(`${granted}/`)
}

export function isScopeAllowed(scope: Scope, allowedScopes: Scope[]): boolean {
  return allowedScopes.some((allowedScope) =>
    scopeIncludes(allowedScope, scope),
  )
}

export function intersectRequestedScopes(
  readableScopes: Scope[],
  requestedScopes: Scope[] | undefined,
): Scope[] {
  if (requestedScopes === undefined) {
    return readableScopes
  }

  return requestedScopes.filter((scope) =>
    isScopeAllowed(scope, readableScopes),
  )
}
