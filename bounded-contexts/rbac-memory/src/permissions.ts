import type { Permission, RoleId } from "./types.js"

export interface PermissionStore {
  list(): Permission[]
  upsert(permission: Permission): Permission
  delete(roleId: RoleId): boolean
  get(roleId: RoleId): Permission | undefined
}

export class InMemoryPermissionStore implements PermissionStore {
  readonly #permissions = new Map<RoleId, Permission>()

  list(): Permission[] {
    return Array.from(this.#permissions.values()).map(copyPermission)
  }

  upsert(permission: Permission): Permission {
    const stored = copyPermission(permission)
    this.#permissions.set(stored.roleId, stored)
    return copyPermission(stored)
  }

  delete(roleId: RoleId): boolean {
    return this.#permissions.delete(roleId)
  }

  get(roleId: RoleId): Permission | undefined {
    const permission = this.#permissions.get(roleId)
    return permission === undefined ? undefined : copyPermission(permission)
  }
}

export function copyPermission(permission: Permission): Permission {
  return {
    roleId: permission.roleId,
    readableScopes: [...permission.readableScopes],
    writableScopes: [...permission.writableScopes],
  }
}
