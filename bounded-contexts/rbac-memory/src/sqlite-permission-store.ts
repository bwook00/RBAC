import type { Database } from "bun:sqlite"
import { copyPermission, type PermissionStore } from "./permissions.js"
import type { Permission, RoleId, Scope } from "./types.js"

type PermissionRow = {
  role_id: string
  readable_scopes: string
  writable_scopes: string
}

/**
 * Persists role → scope permissions in a SQLite `permissions` table.
 *
 * The caller owns the `Database` handle (so the same connection can back the
 * demo directory tables too) and is responsible for its lifecycle. The table
 * is created on construction if it does not already exist.
 */
export class SqlitePermissionStore implements PermissionStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
    this.#db.run(
      `CREATE TABLE IF NOT EXISTS permissions (
        role_id TEXT PRIMARY KEY,
        readable_scopes TEXT NOT NULL,
        writable_scopes TEXT NOT NULL
      )`,
    )
  }

  list(): Permission[] {
    const rows = this.#db
      .query<PermissionRow, []>(
        "SELECT role_id, readable_scopes, writable_scopes FROM permissions ORDER BY role_id",
      )
      .all()
    return rows.map(rowToPermission)
  }

  upsert(permission: Permission): Permission {
    const stored = copyPermission(permission)
    this.#db.run(
      `INSERT INTO permissions (role_id, readable_scopes, writable_scopes)
       VALUES (?, ?, ?)
       ON CONFLICT(role_id) DO UPDATE SET
         readable_scopes = excluded.readable_scopes,
         writable_scopes = excluded.writable_scopes`,
      [
        stored.roleId,
        JSON.stringify(stored.readableScopes),
        JSON.stringify(stored.writableScopes),
      ],
    )
    return copyPermission(stored)
  }

  delete(roleId: RoleId): boolean {
    const result = this.#db.run("DELETE FROM permissions WHERE role_id = ?", [
      roleId,
    ])
    return result.changes > 0
  }

  get(roleId: RoleId): Permission | undefined {
    const row = this.#db
      .query<PermissionRow, [string]>(
        "SELECT role_id, readable_scopes, writable_scopes FROM permissions WHERE role_id = ?",
      )
      .get(roleId)
    return row === null ? undefined : rowToPermission(row)
  }
}

function rowToPermission(row: PermissionRow): Permission {
  return {
    roleId: row.role_id,
    readableScopes: parseScopes(row.readable_scopes),
    writableScopes: parseScopes(row.writable_scopes),
  }
}

function parseScopes(value: string): Scope[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) {
    return []
  }
  return parsed.filter((item): item is Scope => typeof item === "string")
}
