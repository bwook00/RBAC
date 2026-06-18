import { expect, test } from "bun:test"
import { createDemoState, seedDemo } from "./demo-state.js"
import { createAppContext, handleRequest } from "./http-api.js"
import { callMcpTool, listMcpTools } from "./mcp-server.js"

async function json(response: Response): Promise<unknown> {
  return response.json()
}

test("dashboard HTML exposes required local verification flows", async () => {
  const context = createAppContext()

  const response = await handleRequest(
    new Request("http://local/dashboard"),
    context,
  )
  const body = await response.text()

  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toContain("text/html")
  expect(body).toContain("Organization permissions")
  expect(body).toContain("Impersonation playground")
  expect(body).toContain("Mem0 adapter mode")
  expect(body).toContain("Admin audit explain")
  expect(body).toContain("Adapter status")
  expect(body).toContain("/runtime/memory/search")
  expect(body).toContain("/admin/audit-explain")
})
test("runtime HTTP search returns redacted scoped memory", async () => {
  const context = createAppContext()
  await handleRequest(
    new Request("http://local/admin/seed", { method: "POST" }),
    context,
  )

  const response = await handleRequest(
    new Request("http://local/runtime/memory/search", {
      method: "POST",
      body: JSON.stringify({ roleId: "role-a", query: "shared" }),
    }),
    context,
  )
  const body = await json(response)

  expect(response.status).toBe(200)
  expect(JSON.stringify(body)).toContain("a-only")
  expect(JSON.stringify(body)).not.toContain("b-only")
  expect(JSON.stringify(body)).not.toContain("beta renewal")
})

test("runtime HTTP search enforces symmetric role-b isolation", async () => {
  const context = createAppContext()
  await handleRequest(
    new Request("http://local/admin/seed", { method: "POST" }),
    context,
  )

  const response = await handleRequest(
    new Request("http://local/runtime/memory/search", {
      method: "POST",
      body: JSON.stringify({ roleId: "role-b", query: "shared" }),
    }),
    context,
  )
  const body = await json(response)

  expect(response.status).toBe(200)
  expect(JSON.stringify(body)).toContain("b-only")
  expect(JSON.stringify(body)).not.toContain("a-only")
  expect(JSON.stringify(body)).not.toContain("alpha launch")
})

test("runtime HTTP write denies unauthorized scope before persistence", async () => {
  const context = createAppContext()

  const denied = await handleRequest(
    new Request("http://local/runtime/memory/write", {
      method: "POST",
      body: JSON.stringify({
        roleId: "role-a",
        record: {
          id: "bad-b",
          scope: "customer/acme/team/b",
          content: "forbidden beta write",
        },
      }),
    }),
    context,
  )
  const search = await handleRequest(
    new Request("http://local/runtime/memory/search", {
      method: "POST",
      body: JSON.stringify({ roleId: "role-b", query: "forbidden" }),
    }),
    context,
  )

  expect(denied.status).toBe(403)
  expect(await json(denied)).toEqual({
    allowed: false,
    reason: "no_writable_scope",
  })
  expect(JSON.stringify(await json(search))).not.toContain("forbidden beta")
})

test("admin API can seed fs backend and request audit explain", async () => {
  const context = createAppContext()
  await handleRequest(
    new Request("http://local/admin/backend", {
      method: "POST",
      body: JSON.stringify({ backendId: "fs" }),
    }),
    context,
  )
  await handleRequest(
    new Request("http://local/admin/seed", { method: "POST" }),
    context,
  )

  const explain = await handleRequest(
    new Request("http://local/admin/audit-explain", {
      method: "POST",
      body: JSON.stringify({ query: "shared" }),
    }),
    context,
  )
  const body = await json(explain)

  expect(explain.status).toBe(200)
  expect(JSON.stringify(body)).toContain("admin")
  expect(JSON.stringify(body)).toContain("b-only")
})

test("admin API exposes fs and mem0 adapter contract status", async () => {
  const context = createAppContext()

  const response = await handleRequest(
    new Request("http://local/admin/adapter-contract-status"),
    context,
  )
  const body = await json(response)

  expect(response.status).toBe(200)
  expect(JSON.stringify(body)).toContain('"activeBackend":"fs"')
  expect(JSON.stringify(body)).toContain('"backendId":"fs"')
  expect(JSON.stringify(body)).toContain('"backendId":"mem0"')
  expect(JSON.stringify(body)).toContain("Local FS store")
  expect(JSON.stringify(body)).toContain("Mem0 hosted memory")
})

test("admin API can delete a role permission", async () => {
  const context = createAppContext()
  await handleRequest(
    new Request("http://local/admin/seed", { method: "POST" }),
    context,
  )

  const deleted = await handleRequest(
    new Request("http://local/admin/permissions?roleId=role-a", {
      method: "DELETE",
    }),
    context,
  )
  const search = await handleRequest(
    new Request("http://local/runtime/memory/search", {
      method: "POST",
      body: JSON.stringify({ roleId: "role-a", query: "shared" }),
    }),
    context,
  )

  expect(deleted.status).toBe(200)
  expect(await json(deleted)).toEqual({ deleted: true })
  expect(search.status).toBe(403)
  expect(await json(search)).toEqual({ allowed: false, reason: "unknown_role" })
})

test("admin API can list and upsert role permissions", async () => {
  const context = createAppContext()

  const upserted = await handleRequest(
    new Request("http://local/admin/permissions", {
      method: "PUT",
      body: JSON.stringify({
        roleId: "role-c",
        readableScopes: ["customer/acme/team/c"],
        writableScopes: ["customer/acme/team/c"],
      }),
    }),
    context,
  )
  const listed = await handleRequest(
    new Request("http://local/admin/permissions"),
    context,
  )

  expect(upserted.status).toBe(200)
  expect(await json(upserted)).toEqual({
    roleId: "role-c",
    readableScopes: ["customer/acme/team/c"],
    writableScopes: ["customer/acme/team/c"],
  })
  expect(JSON.stringify(await json(listed))).toContain("role-c")
})

test("admin API rejects unsupported backends without changing active backend", async () => {
  const context = createAppContext()

  const rejected = await handleRequest(
    new Request("http://local/admin/backend", {
      method: "POST",
      body: JSON.stringify({ backendId: "missing" }),
    }),
    context,
  )
  const status = await handleRequest(
    new Request("http://local/admin/adapter-contract-status"),
    context,
  )

  expect(rejected.status).toBe(400)
  expect(await json(rejected)).toEqual({ error: "unsupported_backend" })
  expect(await json(status)).toEqual({
    activeBackend: "fs",
    backends: [
      {
        backendId: "fs",
        contract: "rbac-memory-store",
        deterministic: true,
        status: "available",
        label: "Local FS store",
        description: "Persistent local JSON files with full-text search.",
      },
      {
        backendId: "mem0",
        contract: "rbac-memory-store",
        deterministic: false,
        status: "unconfigured",
        label: "Mem0 hosted memory",
        description:
          "Real Mem0 REST API adapter using metadata.scope enforcement.",
        reason: "Set MEM0_API_KEY to enable.",
      },
    ],
  })
})

test("admin seed resets active backend before loading fixture records", async () => {
  const context = createAppContext()
  await handleRequest(
    new Request("http://local/runtime/memory/write", {
      method: "POST",
      body: JSON.stringify({
        roleId: "role-a",
        record: {
          id: "a-dynamic-reset",
          scope: "customer/acme/team/a",
          content: "dynamic reset memory",
        },
      }),
    }),
    context,
  )

  await handleRequest(
    new Request("http://local/admin/seed", { method: "POST" }),
    context,
  )
  const search = await handleRequest(
    new Request("http://local/runtime/memory/search", {
      method: "POST",
      body: JSON.stringify({ roleId: "role-a", query: "dynamic reset" }),
    }),
    context,
  )

  expect(search.status).toBe(200)
  expect(JSON.stringify(await json(search))).not.toContain("a-dynamic-reset")
})

test("admin seed resets permission mutations as well as memory records", async () => {
  const context = createAppContext()
  await handleRequest(
    new Request("http://local/admin/permissions?roleId=role-a", {
      method: "DELETE",
    }),
    context,
  )

  await handleRequest(
    new Request("http://local/admin/seed", { method: "POST" }),
    context,
  )
  const search = await handleRequest(
    new Request("http://local/runtime/memory/search", {
      method: "POST",
      body: JSON.stringify({ roleId: "role-a", query: "shared" }),
    }),
    context,
  )

  expect(search.status).toBe(200)
  expect(JSON.stringify(await json(search))).toContain("a-only")
})

test("MCP surface exposes only runtime write and search tools", async () => {
  const tools = listMcpTools().map((tool) => tool.name)

  expect(tools).toEqual(["memory_write", "memory_search"])
  expect(tools).not.toContain("admin_grant_role")
  expect(tools).not.toContain("backend_switch")
})

test("HTTP MCP endpoint lists only runtime tool schemas", async () => {
  const context = createAppContext()

  const response = await handleRequest(
    new Request("http://local/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    }),
    context,
  )
  const body = await json(response)

  expect(response.status).toBe(200)
  expect(JSON.stringify(body)).toContain("memory_write")
  expect(JSON.stringify(body)).toContain("inputSchema")
  expect(JSON.stringify(body)).not.toContain("admin_grant_role")
  expect(JSON.stringify(body)).not.toContain("backend_switch")
})

test("HTTP MCP endpoint executes runtime tools through JSON-RPC", async () => {
  const context = createAppContext()
  await handleRequest(
    new Request("http://local/admin/seed", { method: "POST" }),
    context,
  )

  const response = await handleRequest(
    new Request("http://local/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "search-1",
        method: "tools/call",
        params: {
          name: "memory_search",
          arguments: { roleId: "role-a", query: "shared" },
        },
      }),
    }),
    context,
  )
  const body = await json(response)

  expect(response.status).toBe(200)
  expect(JSON.stringify(body)).toContain("a-only")
  expect(JSON.stringify(body)).not.toContain("b-only")
})

test("MCP tools allow dynamic scoped memory write and search", async () => {
  const state = createDemoState()
  await seedDemo(state)

  const write = await callMcpTool(state, {
    name: "memory_write",
    arguments: {
      roleId: "role-a",
      record: {
        id: "a-dynamic",
        scope: "customer/acme/team/a",
        content: "dynamic alpha memory",
      },
    },
  })
  const search = await callMcpTool(state, {
    name: "memory_search",
    arguments: { roleId: "role-a", query: "dynamic" },
  })

  expect(write).toEqual({ allowed: true })
  expect(JSON.stringify(search)).toContain("a-dynamic")
})

test("MCP write denies unauthorized scope with a redacted reason", async () => {
  const state = createDemoState()

  const denied = await callMcpTool(state, {
    name: "memory_write",
    arguments: {
      roleId: "role-a",
      record: {
        id: "mcp-bad",
        scope: "customer/acme/team/b",
        content: "mcp forbidden beta memory",
      },
    },
  })

  expect(denied).toEqual({ allowed: false, reason: "no_writable_scope" })
})
