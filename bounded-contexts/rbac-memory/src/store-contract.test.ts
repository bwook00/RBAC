import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CallerContext, MemoryStore, Permission } from "./index.js"
import {
  DeterministicExternalMemoryClient,
  ExternalMemoryStore,
  FsMemoryStore,
  fromExternalEntry,
  InMemoryStore,
  Mem0MemoryClient,
  RbacMemory,
} from "./index.js"

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

const storeFactories: Array<{
  name: string
  createStore: () => MemoryStore | Promise<MemoryStore>
}> = [
  { name: "built-in store", createStore: () => new InMemoryStore("built-in") },
  {
    name: "fs store",
    createStore: async () =>
      new FsMemoryStore({
        rootDir: await mkdtemp(join(tmpdir(), "rbac-memory-fs-store-")),
      }),
  },
  {
    name: "external adapter implementation with deterministic client",
    createStore: () =>
      new ExternalMemoryStore({
        id: "external-deterministic",
        client: new DeterministicExternalMemoryClient(),
      }),
  },
]

test.each(
  storeFactories,
)("$name passes the shared A/B isolation contract", async ({ createStore }) => {
  const store = await createStore()
  const memory = new RbacMemory({
    permissions: PERMISSIONS,
    store,
  })
  await memory.memoryWrite({
    caller: ADMIN,
    record: {
      id: "common",
      scope: "customer/acme/common",
      content: "shared roadmap",
    },
  })
  await memory.memoryWrite({
    caller: ADMIN,
    record: {
      id: "a-only",
      scope: "customer/acme/team/a",
      content: "shared alpha secret",
    },
  })
  await memory.memoryWrite({
    caller: ADMIN,
    record: {
      id: "b-only",
      scope: "customer/acme/team/b",
      content: "shared beta secret",
    },
  })

  const resultA = await memory.memorySearch({
    caller: AGENT_A,
    query: "shared",
  })
  const resultB = await memory.memorySearch({
    caller: AGENT_B,
    query: "shared",
  })

  if ("allowed" in resultA || "allowed" in resultB) {
    throw new Error("search should be allowed")
  }
  expect(resultA.records.map((record) => record.id).sort()).toEqual([
    "a-only",
    "common",
  ])
  expect(resultB.records.map((record) => record.id).sort()).toEqual([
    "b-only",
    "common",
  ])
  expect(resultA.explain.audience).toBe("runtime")
  expect(JSON.stringify(resultA.explain)).not.toContain("shared beta secret")

  const adminExplain = await memory.memorySearch({
    caller: ADMIN,
    query: "shared",
    explain: "admin",
  })
  if ("allowed" in adminExplain) {
    throw new Error("admin explain should be allowed")
  }
  expect(adminExplain.explain.audience).toBe("admin")
  if (adminExplain.explain.audience !== "admin") {
    throw new Error("expected admin explain")
  }
  expect(
    adminExplain.explain.included.map((record) => record.id).sort(),
  ).toEqual(["a-only", "b-only", "common"])
})

test.each(
  storeFactories,
)("$name denies unauthorized writes before persistence", async ({
  createStore,
}) => {
  const store = await createStore()
  const memory = new RbacMemory({
    permissions: PERMISSIONS,
    store,
  })

  const denied = await memory.memoryWrite({
    caller: AGENT_A,
    record: {
      id: "b-denied",
      scope: "customer/acme/team/b",
      content: "forbidden beta write",
    },
  })
  const search = await memory.memorySearch({
    caller: AGENT_B,
    query: "forbidden",
  })

  expect(denied).toEqual({ allowed: false, reason: "no_writable_scope" })
  if ("allowed" in search) {
    throw new Error("search should be allowed")
  }
  expect(search.records).toEqual([])
})

test("external adapter preserves scope metadata through the production adapter path", async () => {
  const client = new DeterministicExternalMemoryClient()
  const store = new ExternalMemoryStore({ client })
  const memory = new RbacMemory({ permissions: PERMISSIONS, store })

  await memory.memoryWrite({
    caller: ADMIN,
    record: {
      id: "a-meta",
      scope: "customer/acme/team/a",
      content: "alpha adapter mapping",
      metadata: { source: "fixture" },
    },
  })

  const entries = await client.list()

  expect(entries).toEqual([
    {
      id: "a-meta",
      text: "alpha adapter mapping",
      metadata: { source: "fixture", scope: "customer/acme/team/a" },
    },
  ])
})

test("external adapter rejects malformed scope metadata before it becomes a memory record", () => {
  expect(() =>
    fromExternalEntry({
      id: "bad-scope",
      text: "bad scope",
      metadata: { scope: "customer/acme/team a" },
    }),
  ).toThrow("invalid scope")
})

test("fs store persists records across store instances", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "rbac-memory-persist-"))
  try {
    const writer = new FsMemoryStore({ rootDir })
    await writer.write({
      record: {
        id: "persisted",
        scope: "customer/acme/team/a",
        content: "persistent alpha memory",
      },
    })

    const reader = new FsMemoryStore({ rootDir })
    const records = await reader.search({
      query: "persistent",
      readableScopes: ["customer/acme/team/a"],
    })

    expect(records).toEqual([
      {
        id: "persisted",
        scope: "customer/acme/team/a",
        content: "persistent alpha memory",
      },
    ])
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test("fs store uses a persisted vector index for semantic search", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "rbac-memory-vector-"))
  try {
    const store = new FsMemoryStore({ rootDir })
    await store.write({
      record: {
        id: "incident-playbook",
        scope: "customer/acme/team/a",
        organizationIds: ["customer/acme"],
        tags: ["runbook"],
        metadata: { category: "incident" },
        content: "Service outage troubleshooting guide for on-call responders",
      },
    })
    await store.write({
      record: {
        id: "sales-note",
        scope: "customer/acme/team/a",
        organizationIds: ["customer/acme"],
        content: "Quarterly renewal account planning notes",
      },
    })

    const results = await store.search({
      query: "troubleshoot outage",
      readableScopes: ["customer/acme/team/a"],
      mode: "semantic",
      limit: 1,
    })
    const index = JSON.parse(
      await readFile(join(rootDir, ".index", "search.json"), "utf8"),
    )

    expect(results.map((record) => record.id)).toEqual(["incident-playbook"])
    expect(index.records[0].vector.length).toBeGreaterThan(0)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test("mem0 client maps real REST payloads through external memory entries", async () => {
  const requests: Array<{ path: string; body: string }> = []
  const client = new Mem0MemoryClient({
    apiKey: "test-key",
    userId: "acme",
    baseUrl: "https://mem0.test",
    fetchFn: async (input, init) => {
      requests.push({
        path: String(input),
        body: typeof init?.body === "string" ? init.body : "",
      })
      if (String(input).endsWith("/v3/memories/add/")) {
        return Response.json({ status: "PENDING", event_id: "evt-1" })
      }
      return Response.json({
        results: [
          {
            id: "mem0-generated",
            memory: "shared alpha result",
            metadata: {
              rbac_memory_id: "alpha",
              scope: "customer/acme/team/a",
              source: "mem0",
            },
          },
          {
            id: "beta",
            memory: "shared beta result",
            metadata: { scope: "customer/acme/team/b" },
          },
        ],
      })
    },
  })

  await client.add({
    id: "alpha",
    text: "shared alpha result",
    metadata: { scope: "customer/acme/team/a" },
  })
  const results = await client.search({
    query: "shared",
    scopes: ["customer/acme/team/a"],
  })

  expect(results).toEqual([
    {
      id: "alpha",
      text: "shared alpha result",
      metadata: { scope: "customer/acme/team/a", source: "mem0" },
    },
  ])
  expect(requests.map((request) => request.path)).toEqual([
    "https://mem0.test/v3/memories/add/",
    "https://mem0.test/v3/memories/search/",
  ])
  expect(requests[0]?.body).toContain('"rbac_memory_id":"alpha"')
})
