import { createHash, randomBytes, randomUUID } from "node:crypto"
import { Database } from "bun:sqlite"
import type { CallerContext } from "@runbear/rbac-memory"

export type Capability = "runtime" | "management"

export type Organization = {
  id: string
  name: string
  domain: string
}

export type DirectoryUser = {
  id: string
  displayName: string
  email: string
  organizationIds: string[]
  roleIds: string[]
  capabilities: Capability[]
}

export type SessionRecord = {
  id: string
  userId: string
  expiresAt: number
}

export type ApiTokenInfo = {
  tokenHash: string
  label: string
  principalId: string
  createdAt: number
  lastUsedAt: number | null
}

export type IssuedApiToken = ApiTokenInfo & {
  /** Plaintext token, returned only once at creation time. */
  token: string
}

const TOKEN_PREFIX = "rbm_"
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

type OrganizationRow = { id: string; name: string; domain: string }
type UserRow = {
  id: string
  display_name: string
  email: string
  organization_ids: string
  role_ids: string
  capabilities: string
}
type SessionRow = { id: string; user_id: string; expires_at: number }
type TokenRow = {
  token_hash: string
  label: string
  principal_id: string
  role_ids: string
  capabilities: string
  organization_ids: string
  created_at: number
  last_used_at: number | null
}

/**
 * SQLite-backed RBAC directory: organizations, users, login sessions, and MCP
 * API tokens. Shares a single `Database` handle with `SqlitePermissionStore`
 * so the whole RBAC configuration lives in one file (or `:memory:` in tests).
 */
export class RbacDirectory {
  readonly db: Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.run("PRAGMA journal_mode = WAL")
    this.#migrate()
  }

  organizations(): Organization[] {
    return this.db
      .query<OrganizationRow, []>(
        "SELECT id, name, domain FROM organizations ORDER BY id",
      )
      .all()
      .map(rowToOrganization)
  }

  upsertOrganization(organization: Organization): Organization {
    this.db.run(
      `INSERT INTO organizations (id, name, domain) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, domain = excluded.domain`,
      [organization.id, organization.name, organization.domain],
    )
    return { ...organization }
  }

  users(): DirectoryUser[] {
    return this.db
      .query<UserRow, []>(
        "SELECT id, display_name, email, organization_ids, role_ids, capabilities FROM users ORDER BY id",
      )
      .all()
      .map(rowToUser)
  }

  getUser(userId: string): DirectoryUser | undefined {
    const row = this.db
      .query<UserRow, [string]>(
        "SELECT id, display_name, email, organization_ids, role_ids, capabilities FROM users WHERE id = ?",
      )
      .get(userId)
    return row === null ? undefined : rowToUser(row)
  }

  getUserByEmail(email: string): DirectoryUser | undefined {
    const row = this.db
      .query<UserRow, [string]>(
        "SELECT id, display_name, email, organization_ids, role_ids, capabilities FROM users WHERE lower(email) = lower(?)",
      )
      .get(email)
    return row === null ? undefined : rowToUser(row)
  }

  upsertUser(user: DirectoryUser): DirectoryUser {
    this.db.run(
      `INSERT INTO users (id, display_name, email, organization_ids, role_ids, capabilities)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         email = excluded.email,
         organization_ids = excluded.organization_ids,
         role_ids = excluded.role_ids,
         capabilities = excluded.capabilities`,
      [
        user.id,
        user.displayName,
        user.email,
        JSON.stringify(user.organizationIds),
        JSON.stringify(user.roleIds),
        JSON.stringify(user.capabilities),
      ],
    )
    return copyUser(user)
  }

  deleteUser(userId: string): boolean {
    const result = this.db.run("DELETE FROM users WHERE id = ?", [userId])
    return result.changes > 0
  }

  createSession(userId: string, now: number): SessionRecord {
    const session: SessionRecord = {
      id: randomUUID(),
      userId,
      expiresAt: now + SESSION_TTL_MS,
    }
    this.db.run(
      "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
      [session.id, session.userId, session.expiresAt],
    )
    return session
  }

  getSession(sessionId: string, now: number): SessionRecord | undefined {
    const row = this.db
      .query<SessionRow, [string]>(
        "SELECT id, user_id, expires_at FROM sessions WHERE id = ?",
      )
      .get(sessionId)
    if (row === null) {
      return undefined
    }
    if (row.expires_at <= now) {
      this.deleteSession(sessionId)
      return undefined
    }
    return { id: row.id, userId: row.user_id, expiresAt: row.expires_at }
  }

  deleteSession(sessionId: string): boolean {
    const result = this.db.run("DELETE FROM sessions WHERE id = ?", [sessionId])
    return result.changes > 0
  }

  issueToken(label: string, caller: CallerContext, now: number): IssuedApiToken {
    const token = `${TOKEN_PREFIX}${randomBytes(24).toString("hex")}`
    const tokenHash = hashToken(token)
    this.db.run(
      `INSERT INTO api_tokens
        (token_hash, label, principal_id, role_ids, capabilities, organization_ids, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        tokenHash,
        label,
        caller.principalId,
        JSON.stringify(caller.roleIds),
        JSON.stringify(caller.capabilities),
        JSON.stringify(caller.organizationIds ?? []),
        now,
      ],
    )
    return {
      token,
      tokenHash,
      label,
      principalId: caller.principalId,
      createdAt: now,
      lastUsedAt: null,
    }
  }

  listTokens(): ApiTokenInfo[] {
    return this.db
      .query<TokenRow, []>(
        "SELECT token_hash, label, principal_id, role_ids, capabilities, organization_ids, created_at, last_used_at FROM api_tokens ORDER BY created_at DESC",
      )
      .all()
      .map(rowToTokenInfo)
  }

  resolveToken(token: string, now: number): CallerContext | undefined {
    const row = this.db
      .query<TokenRow, [string]>(
        "SELECT token_hash, label, principal_id, role_ids, capabilities, organization_ids, created_at, last_used_at FROM api_tokens WHERE token_hash = ?",
      )
      .get(hashToken(token))
    if (row === null) {
      return undefined
    }
    this.db.run("UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?", [
      now,
      row.token_hash,
    ])
    return {
      principalId: row.principal_id,
      roleIds: parseStringArray(row.role_ids),
      capabilities: parseCapabilities(row.capabilities),
      organizationIds: parseStringArray(row.organization_ids),
    }
  }

  deleteToken(tokenHash: string): boolean {
    const result = this.db.run(
      "DELETE FROM api_tokens WHERE token_hash = ?",
      [tokenHash],
    )
    return result.changes > 0
  }

  isEmpty(): boolean {
    const row = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM users")
      .get()
    return (row?.count ?? 0) === 0
  }

  seedIfEmpty(organizations: Organization[], users: DirectoryUser[]): void {
    if (!this.isEmpty()) {
      return
    }
    this.replaceDirectory(organizations, users)
  }

  /** Wipe organizations/users and reload the provided fixtures. */
  replaceDirectory(
    organizations: Organization[],
    users: DirectoryUser[],
  ): void {
    this.db.run("DELETE FROM organizations")
    this.db.run("DELETE FROM users")
    for (const organization of organizations) {
      this.upsertOrganization(organization)
    }
    for (const user of users) {
      this.upsertUser(user)
    }
  }

  #migrate(): void {
    this.db.run(
      `CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        domain TEXT NOT NULL
      )`,
    )
    this.db.run(
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        email TEXT NOT NULL,
        organization_ids TEXT NOT NULL,
        role_ids TEXT NOT NULL,
        capabilities TEXT NOT NULL
      )`,
    )
    this.db.run(
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
    )
    this.db.run(
      `CREATE TABLE IF NOT EXISTS api_tokens (
        token_hash TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        role_ids TEXT NOT NULL,
        capabilities TEXT NOT NULL,
        organization_ids TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      )`,
    )
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

function rowToOrganization(row: OrganizationRow): Organization {
  return { id: row.id, name: row.name, domain: row.domain }
}

function rowToUser(row: UserRow): DirectoryUser {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    organizationIds: parseStringArray(row.organization_ids),
    roleIds: parseStringArray(row.role_ids),
    capabilities: parseCapabilities(row.capabilities),
  }
}

function rowToTokenInfo(row: TokenRow): ApiTokenInfo {
  return {
    tokenHash: row.token_hash,
    label: row.label,
    principalId: row.principal_id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }
}

function copyUser(user: DirectoryUser): DirectoryUser {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    organizationIds: [...user.organizationIds],
    roleIds: [...user.roleIds],
    capabilities: [...user.capabilities],
  }
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) {
    return []
  }
  return parsed.filter((item): item is string => typeof item === "string")
}

function parseCapabilities(value: string): Capability[] {
  return parseStringArray(value).filter(isCapability)
}

function isCapability(value: string): value is Capability {
  return value === "runtime" || value === "management"
}
