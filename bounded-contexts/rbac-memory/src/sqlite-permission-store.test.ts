import { Database } from "bun:sqlite"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqlitePermissionStore } from "./sqlite-permission-store.js"

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "rbac-perms-"))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

test("upsert, get, list and delete round-trip through SQLite", () => {
  const db = new Database(":memory:")
  const store = new SqlitePermissionStore(db)

  store.upsert({
    roleId: "role-a",
    readableScopes: ["customer/acme/common", "customer/acme/team/a"],
    writableScopes: ["customer/acme/team/a"],
  })
  store.upsert({
    roleId: "role-b",
    readableScopes: ["customer/acme/common"],
    writableScopes: [],
  })

  expect(store.get("role-a")?.readableScopes).toEqual([
    "customer/acme/common",
    "customer/acme/team/a",
  ])
  expect(store.list().map((permission) => permission.roleId)).toEqual([
    "role-a",
    "role-b",
  ])
  expect(store.delete("role-a")).toBe(true)
  expect(store.get("role-a")).toBeUndefined()
  expect(store.delete("role-a")).toBe(false)
})

test("upsert overwrites an existing role's scopes", () => {
  const db = new Database(":memory:")
  const store = new SqlitePermissionStore(db)

  store.upsert({
    roleId: "role-a",
    readableScopes: ["customer/acme/common"],
    writableScopes: ["customer/acme/team/a"],
  })
  store.upsert({
    roleId: "role-a",
    readableScopes: ["customer/acme/team/a"],
    writableScopes: [],
  })

  expect(store.list()).toHaveLength(1)
  expect(store.get("role-a")?.readableScopes).toEqual(["customer/acme/team/a"])
  expect(store.get("role-a")?.writableScopes).toEqual([])
})

test("permissions persist after the database handle is reopened", () => {
  const dbPath = join(tempDir, "perms.sqlite")

  const first = new Database(dbPath)
  new SqlitePermissionStore(first).upsert({
    roleId: "role-a",
    readableScopes: ["customer/acme/team/a"],
    writableScopes: ["customer/acme/team/a"],
  })
  first.close()

  const second = new Database(dbPath)
  const reopened = new SqlitePermissionStore(second)
  expect(reopened.get("role-a")?.writableScopes).toEqual([
    "customer/acme/team/a",
  ])
  second.close()
})
