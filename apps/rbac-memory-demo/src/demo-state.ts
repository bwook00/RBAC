import type {
  CallerContext,
  MemoryRecord,
  MemoryStore,
  Permission,
  PermissionStore,
} from "@runbear/rbac-memory"
import {
  ExternalMemoryStore,
  FsMemoryStore,
  Mem0MemoryClient,
  RbacMemory,
  SqlitePermissionStore,
} from "@runbear/rbac-memory"
import {
  type DirectoryUser,
  type Organization,
  RbacDirectory,
} from "./rbac-db.js"

export type { Capability, DirectoryUser, Organization } from "./rbac-db.js"

export type BackendId = "fs" | "mem0"

type DemoStores = {
  fs: MemoryStore
  mem0?: MemoryStore
}

export type BackendStatus = {
  backendId: BackendId
  contract: "rbac-memory-store"
  deterministic: boolean
  status: "available" | "unconfigured"
  label: string
  description: string
  reason?: string
}

export type DemoState = {
  backendId: BackendId
  memory: RbacMemory
  stores: DemoStores
  statuses: Record<BackendId, BackendStatus>
  fsRootDir: string
  directory: RbacDirectory
  permissionStore: PermissionStore
}

export type CreateDemoStateOptions = {
  backendId?: BackendId
  dbPath?: string
  fsRootDir?: string
}

export const DEMO_ORGANIZATIONS: Organization[] = [
  { id: "customer/acme", name: "Acme Corp", domain: "acme.example" },
  { id: "customer/globex", name: "Globex", domain: "globex.example" },
]

export const DEMO_PERMISSIONS: Permission[] = [
  {
    roleId: "admin",
    readableScopes: ["customer"],
    writableScopes: ["customer"],
  },
  {
    roleId: "acme-eng",
    readableScopes: ["customer/acme/common", "customer/acme/team/eng"],
    writableScopes: ["customer/acme/team/eng"],
  },
  {
    roleId: "role-a",
    readableScopes: ["customer/acme/common", "customer/acme/team/a"],
    writableScopes: ["customer/acme/team/a"],
  },
  {
    roleId: "role-b",
    readableScopes: ["customer/acme/common", "customer/acme/team/b"],
    writableScopes: ["customer/acme/team/b"],
  },
  {
    roleId: "acme-sales",
    readableScopes: ["customer/acme/common", "customer/acme/team/sales"],
    writableScopes: ["customer/acme/team/sales"],
  },
  {
    roleId: "globex-ops",
    readableScopes: ["customer/globex/common", "customer/globex/team/ops"],
    writableScopes: ["customer/globex/team/ops"],
  },
]

export const DEMO_USERS: DirectoryUser[] = [
  {
    id: "admin",
    displayName: "Platform Admin",
    email: "admin@rbac-memory.dev",
    organizationIds: ["customer/acme", "customer/globex"],
    roleIds: ["admin"],
    capabilities: ["runtime", "management"],
  },
  {
    id: "agent-acme-eng",
    displayName: "Acme Engineering Agent",
    email: "eng-agent@acme.example",
    organizationIds: ["customer/acme"],
    roleIds: ["acme-eng"],
    capabilities: ["runtime"],
  },
  {
    id: "agent-acme-sales",
    displayName: "Acme Sales Agent",
    email: "sales-agent@acme.example",
    organizationIds: ["customer/acme"],
    roleIds: ["acme-sales"],
    capabilities: ["runtime"],
  },
  {
    id: "agent-globex-ops",
    displayName: "Globex Ops Agent",
    email: "ops-agent@globex.example",
    organizationIds: ["customer/globex"],
    roleIds: ["globex-ops"],
    capabilities: ["runtime"],
  },
]

export const ADMIN_CALLER: CallerContext = callerFromUser({
  id: "admin",
  displayName: "Platform Admin",
  email: "admin@rbac-memory.dev",
  organizationIds: ["customer/acme", "customer/globex"],
  roleIds: ["admin"],
  capabilities: ["runtime", "management"],
})

export const DEMO_RECORDS: MemoryRecord[] = [
  {
    id: "acme-handbook",
    scope: "customer/acme/common",
    organizationIds: ["customer/acme"],
    content: "Acme shared company handbook for onboarding and policy search",
    tags: ["handbook", "shared", "policy"],
    metadata: { department: "company", sensitivity: "internal" },
  },
  {
    id: "a-only",
    scope: "customer/acme/team/a",
    organizationIds: ["customer/acme"],
    content: "shared alpha launch plan",
    tags: ["launch", "alpha", "memory"],
    metadata: { department: "engineering", sensitivity: "team" },
  },
  {
    id: "b-only",
    scope: "customer/acme/team/b",
    organizationIds: ["customer/acme"],
    content: "shared beta renewal plan",
    tags: ["renewal", "beta", "memory"],
    metadata: { department: "sales", sensitivity: "team" },
  },
  {
    id: "acme-eng-launch",
    scope: "customer/acme/team/eng",
    organizationIds: ["customer/acme"],
    content: "Acme engineering launch checklist for vector memory rollout",
    tags: ["launch", "engineering", "memory"],
    metadata: { department: "engineering", sensitivity: "team" },
  },
  {
    id: "acme-sales-renewal",
    scope: "customer/acme/team/sales",
    organizationIds: ["customer/acme"],
    content: "Acme sales renewal playbook with enterprise pricing notes",
    tags: ["sales", "renewal", "pricing"],
    metadata: { department: "sales", sensitivity: "team" },
  },
  {
    id: "globex-runbook",
    scope: "customer/globex/common",
    organizationIds: ["customer/globex"],
    content: "Globex operations runbook for incident response memory retrieval",
    tags: ["runbook", "operations", "incident"],
    metadata: { department: "operations", sensitivity: "internal" },
  },
]

export function createDemoState(
  options: CreateDemoStateOptions = {},
): DemoState {
  const backendId = options.backendId ?? "fs"
  const fsRootDir =
    options.fsRootDir ?? Bun.env.RBAC_MEMORY_FS_ROOT ?? ".data/rbac-memory-demo"
  // The SQLite file MUST live outside `fsRootDir`: `resetBackend` clears the FS
  // memory store by deleting that directory, which would invalidate an open
  // database handle inside it (SQLITE_IOERR_VNODE on the next query).
  const dbPath = options.dbPath ?? Bun.env.RBAC_DB_PATH ?? `${fsRootDir}.sqlite`

  const directory = new RbacDirectory(dbPath)
  const permissionStore = new SqlitePermissionStore(directory.db)
  directory.seedIfEmpty(DEMO_ORGANIZATIONS, DEMO_USERS)
  seedPermissionsIfEmpty(permissionStore, DEMO_PERMISSIONS)

  const stores = createStores(fsRootDir)
  const statuses = createBackendStatuses(stores)
  const activeStore = stores[backendId]
  const activeBackend = activeStore === undefined ? "fs" : backendId
  return {
    backendId: activeBackend,
    fsRootDir,
    stores,
    statuses,
    directory,
    permissionStore,
    memory: createMemory(activeStore ?? stores.fs, permissionStore),
  }
}

export function switchBackend(
  state: DemoState,
  backendId: BackendId,
): DemoState | { error: "backend_unconfigured" } {
  const store = state.stores[backendId]
  if (store === undefined) {
    return { error: "backend_unconfigured" }
  }
  return {
    ...state,
    backendId,
    memory: createMemory(store, state.permissionStore),
  }
}

export async function resetBackend(state: DemoState): Promise<DemoState> {
  state.directory.replaceDirectory(DEMO_ORGANIZATIONS, DEMO_USERS)
  replacePermissions(state.permissionStore, DEMO_PERMISSIONS)

  if (state.backendId === "fs") {
    const store = new FsMemoryStore({ id: "fs", rootDir: state.fsRootDir })
    await store.clear()
    const stores = { ...state.stores, fs: store }
    return {
      ...state,
      stores,
      statuses: createBackendStatuses(stores),
      memory: createMemory(store, state.permissionStore),
    }
  }

  const stores = createStores(state.fsRootDir)
  const activeStore = stores[state.backendId]
  if (activeStore === undefined) {
    return {
      ...state,
      backendId: "fs",
      stores,
      statuses: createBackendStatuses(stores),
      memory: createMemory(stores.fs, state.permissionStore),
    }
  }
  return {
    ...state,
    stores,
    statuses: createBackendStatuses(stores),
    memory: createMemory(activeStore, state.permissionStore),
  }
}

export async function seedDemo(state: DemoState): Promise<void> {
  await Promise.all(
    DEMO_RECORDS.map((record) =>
      state.memory.memoryWrite({ caller: ADMIN_CALLER, record }),
    ),
  )
}

export function callerFromPrincipal(
  state: DemoState,
  principalId: string,
): CallerContext {
  const user = state.directory.getUser(principalId)
  if (user === undefined) {
    return {
      principalId,
      roleIds: [principalId],
      capabilities: ["runtime"],
    }
  }
  return callerFromUser(user)
}

export function callerFromRole(roleId: string): CallerContext {
  return {
    principalId: `agent-${roleId}`,
    roleIds: [roleId],
    capabilities: ["runtime"],
  }
}

export function callerFromUser(user: DirectoryUser): CallerContext {
  return {
    principalId: user.id,
    roleIds: [...user.roleIds],
    organizationIds: [...user.organizationIds],
    capabilities: [...user.capabilities],
  }
}

export function hasManagement(caller: CallerContext): boolean {
  return caller.capabilities.includes("management")
}

function seedPermissionsIfEmpty(
  store: PermissionStore,
  permissions: Permission[],
): void {
  if (store.list().length > 0) {
    return
  }
  for (const permission of permissions) {
    store.upsert(permission)
  }
}

function replacePermissions(
  store: PermissionStore,
  permissions: Permission[],
): void {
  for (const existing of store.list()) {
    store.delete(existing.roleId)
  }
  for (const permission of permissions) {
    store.upsert(permission)
  }
}

function createStores(fsRootDir: string): DemoStores {
  const stores: DemoStores = {
    fs: new FsMemoryStore({ id: "fs", rootDir: fsRootDir }),
  }
  const mem0Store = createMem0Store()
  if (mem0Store !== null) {
    stores.mem0 = mem0Store
  }
  return stores
}

function createMem0Store(): MemoryStore | null {
  const apiKey = Bun.env.MEM0_API_KEY
  if (apiKey === undefined || apiKey.length === 0) {
    return null
  }
  return new ExternalMemoryStore({
    id: "mem0",
    client: new Mem0MemoryClient({
      apiKey,
      userId: Bun.env.MEM0_USER_ID ?? "rbac-memory-demo",
      baseUrl: Bun.env.MEM0_BASE_URL,
    }),
  })
}

function createBackendStatuses(
  stores: DemoStores,
): Record<BackendId, BackendStatus> {
  return {
    fs: {
      backendId: "fs",
      contract: "rbac-memory-store",
      deterministic: true,
      status: "available",
      label: "Local FS store",
      description: "Persistent local JSON files with full-text search.",
    },
    mem0: {
      backendId: "mem0",
      contract: "rbac-memory-store",
      deterministic: false,
      status: stores.mem0 === undefined ? "unconfigured" : "available",
      label: "Mem0 hosted memory",
      description:
        "Real Mem0 REST API adapter using metadata.scope enforcement.",
      reason:
        stores.mem0 === undefined ? "Set MEM0_API_KEY to enable." : undefined,
    },
  }
}

function createMemory(
  store: MemoryStore,
  permissionStore: PermissionStore,
): RbacMemory {
  return new RbacMemory({ permissionStore, store })
}
