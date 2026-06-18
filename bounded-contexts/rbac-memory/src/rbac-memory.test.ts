import { expect, test } from "bun:test"
import type {
  CallerContext,
  DenyReasonCode,
  MemoryRecord,
  MemoryStore,
  Permission,
} from "./index.js"
import { InMemoryStore, RbacMemory, RbacMemoryError } from "./index.js"

const ADMIN: CallerContext = {
  principalId: "admin",
  roleIds: ["admin"],
  capabilities: ["runtime", "management"],
}
const AGENT_A: CallerContext = {
  principalId: "agent-a",
  roleIds: ["role-a"],
  capabilities: ["runtime"],
}
const AGENT_B: CallerContext = {
  principalId: "agent-b",
  roleIds: ["role-b"],
  capabilities: ["runtime"],
}
const RUNTIME_ONLY: CallerContext = {
  principalId: "runtime-only",
  roleIds: ["role-a"],
  capabilities: ["runtime"],
}

const PERMISSIONS: Permission[] = [
  {
    roleId: "admin",
    readableScopes: ["customer/acme"],
    writableScopes: ["customer/acme"],
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
]

const COMMON: MemoryRecord = {
  id: "common-1",
  scope: "customer/acme/common",
  content: "shared launch plan",
}
const A_ONLY: MemoryRecord = {
  id: "a-1",
  scope: "customer/acme/team/a",
  content: "shared alpha quota",
  metadata: { sensitivity: "team-a" },
  tags: ["finance", "alpha"],
}
const B_ONLY: MemoryRecord = {
  id: "b-1",
  scope: "customer/acme/team/b",
  content: "shared beta quota",
  metadata: { sensitivity: "team-b" },
}
class BroadCandidateStore implements MemoryStore {
  readonly id = "broad-store"
  readonly #records: MemoryRecord[]

  constructor(records: MemoryRecord[]) {
    this.#records = records
  }

  async write(): Promise<void> {}

  async search(): Promise<MemoryRecord[]> {
    return this.#records
  }

  async list(): Promise<MemoryRecord[]> {
    return this.#records
  }
}

class ThrowingStore implements MemoryStore {
  readonly id = "throwing-store"

  async write(): Promise<void> {
    throw new Error("store unavailable")
  }

  async search(): Promise<MemoryRecord[]> {
    throw new Error("store unavailable")
  }

  async list(): Promise<MemoryRecord[]> {
    throw new Error("store unavailable")
  }
}

function createMemory(): RbacMemory {
  return new RbacMemory({ permissions: PERMISSIONS })
}

async function seed(memory: RbacMemory): Promise<void> {
  await memory.memoryWrite({ caller: ADMIN, record: COMMON })
  await memory.memoryWrite({ caller: ADMIN, record: A_ONLY })
  await memory.memoryWrite({ caller: ADMIN, record: B_ONLY })
}

test("returns common plus role-specific memory for the same query", async () => {
  const memory = createMemory()
  await seed(memory)

  const resultA = await memory.memorySearch({
    caller: AGENT_A,
    query: "shared",
  })
  const resultB = await memory.memorySearch({
    caller: AGENT_B,
    query: "shared",
  })

  expect("allowed" in resultA).toBe(false)
  expect("allowed" in resultB).toBe(false)
  if ("allowed" in resultA || "allowed" in resultB) {
    throw new Error("search should be allowed")
  }

  expect(resultA.records.map((record) => record.id).sort()).toEqual([
    "a-1",
    "common-1",
  ])
  expect(resultB.records.map((record) => record.id).sort()).toEqual([
    "b-1",
    "common-1",
  ])
})

test("filters search by organization tags metadata and term mode", async () => {
  const memory = createMemory()
  await seed(memory)

  const result = await memory.memorySearch({
    caller: ADMIN,
    query: "alpha quota",
    organizationIds: ["customer/acme"],
    tags: ["finance"],
    metadata: { sensitivity: "team-a" },
    mode: "all",
  })

  expect("allowed" in result).toBe(false)
  if ("allowed" in result) {
    throw new Error("search should be allowed")
  }
  expect(result.records.map((record) => record.id)).toEqual(["a-1"])
})
test("denies unauthorized writes before persistence", async () => {
  const store = new InMemoryStore()
  const memory = new RbacMemory({ permissions: PERMISSIONS, store })

  const denied = await memory.memoryWrite({ caller: AGENT_A, record: B_ONLY })
  const records = await store.list()

  expect(denied).toEqual({ allowed: false, reason: "no_writable_scope" })
  expect(records).toEqual([])
})

test("denies cross-scope id overwrite without existing scope write access", async () => {
  const store = new InMemoryStore()
  const memory = new RbacMemory({ permissions: PERMISSIONS, store })
  await memory.memoryWrite({ caller: ADMIN, record: B_ONLY })

  const denied = await memory.memoryWrite({
    caller: AGENT_A,
    record: { ...A_ONLY, id: B_ONLY.id },
  })
  const records = await store.list()

  expect(denied).toEqual({ allowed: false, reason: "no_writable_scope" })
  expect(records).toEqual([B_ONLY])
})

test("runtime explain redacts unauthorized records", async () => {
  const memory = new RbacMemory({
    permissions: PERMISSIONS,
    store: new BroadCandidateStore([COMMON, A_ONLY, B_ONLY]),
  })

  const result = await memory.memorySearch({
    caller: AGENT_A,
    query: "shared",
    explain: "runtime",
  })

  expect("allowed" in result).toBe(false)
  if ("allowed" in result) {
    throw new Error("search should be allowed")
  }

  expect(result.explain).toEqual({
    audience: "runtime",
    includedIds: ["common-1", "a-1"],
    excludedCount: 1,
    reasonCodes: ["no_readable_scope"],
    requestedScopeDenials: [],
  })
  expect(JSON.stringify(result.explain)).not.toContain("b-1")
  expect(JSON.stringify(result.explain)).not.toContain("team-b")
  expect(JSON.stringify(result.explain)).not.toContain("beta quota")
})

test("admin audit explain requires management capability", async () => {
  const memory = createMemory()
  await seed(memory)

  const denied = await memory.memorySearch({
    caller: RUNTIME_ONLY,
    query: "shared",
    explain: "admin",
  })
  const allowed = await memory.memorySearch({
    caller: ADMIN,
    query: "shared",
    explain: "admin",
  })

  expect(denied).toEqual({ allowed: false, reason: "missing_capability" })
  expect("allowed" in allowed).toBe(false)
  if ("allowed" in allowed) {
    throw new Error("admin search should be allowed")
  }
  expect(allowed.explain.audience).toBe("admin")
  if (allowed.explain.audience !== "admin") {
    throw new Error("expected admin explain")
  }
  expect(allowed.explain.excluded).toEqual([])
})

test("permission CRUD rejects runtime callers", () => {
  const memory = createMemory()

  expect(() =>
    memory.upsertPermission(RUNTIME_ONLY, {
      roleId: "role-c",
      readableScopes: ["customer/acme/team/c"],
      writableScopes: ["customer/acme/team/c"],
    }),
  ).toThrow(RbacMemoryError)
})

test("permission CRUD rejects malformed permissions", () => {
  const memory = createMemory()

  expect(() =>
    memory.upsertPermission(ADMIN, {
      roleId: "role-c",
      readableScopes: ["customer/acme/team c"],
      writableScopes: ["customer/acme/team/c"],
    }),
  ).toThrow(RbacMemoryError)
})

test("permission CRUD rejects management callers with unknown roles", () => {
  const memory = createMemory()
  const unknownManagementCaller: CallerContext = {
    principalId: "admin-x",
    roleIds: ["missing"],
    capabilities: ["management"],
  }

  expect(() =>
    memory.upsertPermission(unknownManagementCaller, {
      roleId: "role-c",
      readableScopes: ["customer/acme/team/c"],
      writableScopes: ["customer/acme/team/c"],
    }),
  ).toThrow(RbacMemoryError)
})

const failClosedCases: Array<{
  name: string
  caller: CallerContext
  expected: DenyReasonCode
}> = [
  {
    name: "missing principal",
    caller: { principalId: "", roleIds: ["role-a"], capabilities: ["runtime"] },
    expected: "missing_principal",
  },
  {
    name: "unknown role",
    caller: {
      principalId: "agent-x",
      roleIds: ["missing"],
      capabilities: ["runtime"],
    },
    expected: "unknown_role",
  },
  {
    name: "missing runtime capability",
    caller: { principalId: "agent-a", roleIds: ["role-a"], capabilities: [] },
    expected: "missing_capability",
  },
]

test.each(failClosedCases)("fails closed for $name", async ({
  caller,
  expected,
}) => {
  const memory = createMemory()

  const result = await memory.memoryWrite({ caller, record: A_ONLY })

  expect(result).toEqual({ allowed: false, reason: expected })
})

test("post-filters broad store candidates before constructing runtime response", async () => {
  const memory = new RbacMemory({
    permissions: PERMISSIONS,
    store: new BroadCandidateStore([COMMON, A_ONLY, B_ONLY]),
  })

  const result = await memory.memorySearch({ caller: AGENT_A, query: "shared" })

  expect("allowed" in result).toBe(false)
  if ("allowed" in result) {
    throw new Error("search should be allowed")
  }
  expect(result.records.map((record) => record.id).sort()).toEqual([
    "a-1",
    "common-1",
  ])
  expect(JSON.stringify(result)).not.toContain("beta quota")
})

test("explicit empty requested scopes fail closed instead of broadening", async () => {
  const memory = createMemory()
  await seed(memory)

  const result = await memory.memorySearch({
    caller: AGENT_A,
    query: "shared",
    requestedScopes: [],
  })

  expect(result).toEqual({ allowed: false, reason: "no_readable_scope" })
})

test.each([
  { name: "write list failure", operation: "write" },
  { name: "search failure", operation: "search" },
] as const)("maps store unavailable during $name to a stable denial", async ({
  operation,
}) => {
  const memory = new RbacMemory({
    permissions: PERMISSIONS,
    store: new ThrowingStore(),
  })

  const result =
    operation === "write"
      ? await memory.memoryWrite({ caller: AGENT_A, record: A_ONLY })
      : await memory.memorySearch({ caller: AGENT_A, query: "shared" })

  expect(result).toEqual({ allowed: false, reason: "store_unavailable" })
})

test("emits non-sensitive audit events", async () => {
  const events: unknown[] = []
  const memory = new RbacMemory({
    permissions: PERMISSIONS,
    auditSink: {
      append: (event) => {
        events.push(event)
      },
    },
  })

  await memory.memoryWrite({ caller: AGENT_A, record: B_ONLY })

  expect(events).toEqual([
    {
      type: "memory_write_denied",
      principalId: "agent-a",
      roleIds: ["role-a"],
      action: "memory:write",
      requestedScopes: ["customer/acme/team/b"],
      decision: "deny",
      reasonCode: "no_writable_scope",
      backendId: "built-in",
    },
  ])
  expect(JSON.stringify(events)).not.toContain("beta quota")
})
