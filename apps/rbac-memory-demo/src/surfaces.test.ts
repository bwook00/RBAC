import { expect, test } from "bun:test"
import { callerFromRole, createDemoState, seedDemo } from "./demo-state.js"
import { type AppContext, createAppContext, handleRequest } from "./http-api.js"
import { callMcpTool, listMcpTools } from "./mcp-server.js"

function newContext(): AppContext {
  return createAppContext({ dbPath: ":memory:" })
}

async function json(response: Response): Promise<unknown> {
  return response.json()
}

async function loginAs(context: AppContext, userId: string): Promise<string> {
  const response = await handleRequest(
    new Request("http://local/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    }),
    context,
  )
  const setCookie = response.headers.get("set-cookie") ?? ""
  return setCookie.split(";")[0] ?? ""
}

async function loginAsAdmin(context: AppContext): Promise<string> {
  return loginAs(context, "admin")
}

async function seed(context: AppContext, cookie: string): Promise<void> {
  await handleRequest(
    new Request("http://local/admin/seed", {
      method: "POST",
      headers: { cookie },
    }),
    context,
  )
}

async function issueRoleToken(
  context: AppContext,
  cookie: string,
  roleId: string,
): Promise<string> {
  const response = await handleRequest(
    new Request("http://local/admin/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ roleId, label: roleId }),
    }),
    context,
  )
  const body = (await response.json()) as { token: string }
  return body.token
}

function runtimeSearch(cookie: string, body: Record<string, unknown>): Request {
  return new Request("http://local/runtime/memory/search", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  })
}

test("dashboard HTML exposes required local verification flows", async () => {
  const context = newContext()

  const response = await handleRequest(
    new Request("http://local/dashboard"),
    context,
  )
  const body = await response.text()

  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toContain("text/html")
  expect(body).toContain("Organizations")
  expect(body).toContain("Members")
  expect(body).toContain("MCP Tokens")
  expect(body).toContain("/admin/organizations")
  expect(body).toContain("/tokens")
})

test("runtime search requires an authenticated session", async () => {
  const context = newContext()

  const response = await handleRequest(
    runtimeSearch("", { roleId: "role-a", query: "shared" }),
    context,
  )

  expect(response.status).toBe(401)
  expect(await json(response)).toEqual({ error: "unauthorized" })
})

test("admin impersonation returns redacted scoped memory for role-a", async () => {
  const context = newContext()
  const cookie = await loginAsAdmin(context)
  await seed(context, cookie)

  const response = await handleRequest(
    runtimeSearch(cookie, { roleId: "role-a", query: "shared" }),
    context,
  )
  const body = await json(response)

  expect(response.status).toBe(200)
  expect(JSON.stringify(body)).toContain("a-only")
  expect(JSON.stringify(body)).not.toContain("b-only")
  expect(JSON.stringify(body)).not.toContain("beta renewal")
})

test("admin impersonation enforces symmetric role-b isolation", async () => {
  const context = newContext()
  const cookie = await loginAsAdmin(context)
  await seed(context, cookie)

  const response = await handleRequest(
    runtimeSearch(cookie, { roleId: "role-b", query: "shared" }),
    context,
  )
  const body = await json(response)

  expect(response.status).toBe(200)
  expect(JSON.stringify(body)).toContain("b-only")
  expect(JSON.stringify(body)).not.toContain("a-only")
  expect(JSON.stringify(body)).not.toContain("alpha launch")
})

test("a non-admin session is pinned to its own identity and cannot impersonate", async () => {
  const context = newContext()
  const adminCookie = await loginAsAdmin(context)
  await seed(context, adminCookie)
  const engCookie = await loginAs(context, "agent-acme-eng")

  // Even though the body asks to impersonate globex-ops, a non-admin session
  // is pinned to its own identity (acme-eng), which cannot see globex memory.
  const response = await handleRequest(
    runtimeSearch(engCookie, { roleId: "globex-ops", query: "runbook" }),
    context,
  )
  const body = await json(response)

  expect(response.status).toBe(200)
  expect(JSON.stringify(body)).not.toContain("globex-runbook")
})

test("runtime write denies unauthorized scope before persistence", async () => {
  const context = newContext()
  const cookie = await loginAsAdmin(context)

  const denied = await handleRequest(
    new Request("http://local/runtime/memory/write", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
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
    runtimeSearch(cookie, { roleId: "role-b", query: "forbidden" }),
    context,
  )

  expect(denied.status).toBe(403)
  expect(await json(denied)).toEqual({
    allowed: false,
    reason: "no_writable_scope",
  })
  expect(JSON.stringify(await json(search))).not.toContain("forbidden beta")
})

test("admin endpoints reject sessions without the management capability", async () => {
  const context = newContext()
  const engCookie = await loginAs(context, "agent-acme-eng")

  const response = await handleRequest(
    new Request("http://local/admin/permissions", {
      headers: { cookie: engCookie },
    }),
    context,
  )

  expect(response.status).toBe(403)
  expect(await json(response)).toEqual({ error: "forbidden" })
})

test("admin API can seed fs backend and request audit explain", async () => {
  const context = newContext()
  const cookie = await loginAsAdmin(context)
  await handleRequest(
    new Request("http://local/admin/backend", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ backendId: "fs" }),
    }),
    context,
  )
  await seed(context, cookie)

  const explain = await handleRequest(
    new Request("http://local/admin/audit-explain", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
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
  const context = newContext()
  const cookie = await loginAsAdmin(context)

  const response = await handleRequest(
    new Request("http://local/admin/adapter-contract-status", {
      headers: { cookie },
    }),
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
  const context = newContext()
  const cookie = await loginAsAdmin(context)
  await seed(context, cookie)

  const deleted = await handleRequest(
    new Request("http://local/admin/permissions?roleId=role-a", {
      method: "DELETE",
      headers: { cookie },
    }),
    context,
  )
  const search = await handleRequest(
    runtimeSearch(cookie, { roleId: "role-a", query: "shared" }),
    context,
  )

  expect(deleted.status).toBe(200)
  expect(await json(deleted)).toEqual({ deleted: true })
  expect(search.status).toBe(403)
  expect(await json(search)).toEqual({ allowed: false, reason: "unknown_role" })
})

test("role permission edits persist across a backend switch", async () => {
  const context = newContext()
  const cookie = await loginAsAdmin(context)

  await handleRequest(
    new Request("http://local/admin/permissions", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        roleId: "role-c",
        readableScopes: ["customer/acme/team/c"],
        writableScopes: ["customer/acme/team/c"],
      }),
    }),
    context,
  )
  await handleRequest(
    new Request("http://local/admin/backend", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ backendId: "fs" }),
    }),
    context,
  )
  const listed = await handleRequest(
    new Request("http://local/admin/permissions", { headers: { cookie } }),
    context,
  )

  expect(JSON.stringify(await json(listed))).toContain("role-c")
})

test("admin API rejects unsupported backends without changing active backend", async () => {
  const context = newContext()
  const cookie = await loginAsAdmin(context)

  const rejected = await handleRequest(
    new Request("http://local/admin/backend", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ backendId: "missing" }),
    }),
    context,
  )
  const status = await handleRequest(
    new Request("http://local/admin/adapter-contract-status", {
      headers: { cookie },
    }),
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
  const context = newContext()
  const cookie = await loginAsAdmin(context)
  await handleRequest(
    new Request("http://local/runtime/memory/write", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
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

  await seed(context, cookie)
  const search = await handleRequest(
    runtimeSearch(cookie, { roleId: "role-a", query: "dynamic reset" }),
    context,
  )

  expect(search.status).toBe(200)
  expect(JSON.stringify(await json(search))).not.toContain("a-dynamic-reset")
})

test("admin seed resets permission mutations as well as memory records", async () => {
  const context = newContext()
  const cookie = await loginAsAdmin(context)
  await handleRequest(
    new Request("http://local/admin/permissions?roleId=role-a", {
      method: "DELETE",
      headers: { cookie },
    }),
    context,
  )

  await seed(context, cookie)
  const search = await handleRequest(
    runtimeSearch(cookie, { roleId: "role-a", query: "shared" }),
    context,
  )

  expect(search.status).toBe(200)
  expect(JSON.stringify(await json(search))).toContain("a-only")
})

test("MCP surface exposes only runtime write and search tools", () => {
  const tools = listMcpTools().map((tool) => tool.name)

  expect(tools).toEqual(["memory_write", "memory_search"])
  expect(tools).not.toContain("admin_grant_role")
  expect(tools).not.toContain("backend_switch")
})

test("HTTP MCP endpoint lists only runtime tool schemas", async () => {
  const context = newContext()

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

test("HTTP MCP tools/call requires a bearer token", async () => {
  const context = newContext()
  const cookie = await loginAsAdmin(context)
  await seed(context, cookie)

  const response = await handleRequest(
    new Request("http://local/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "no-auth",
        method: "tools/call",
        params: { name: "memory_search", arguments: { query: "shared" } },
      }),
    }),
    context,
  )
  const body = (await json(response)) as {
    error?: { code: number; message: string }
  }

  expect(response.status).toBe(200)
  expect(body.error?.message).toBe("unauthorized")
})

test("HTTP MCP endpoint executes runtime tools with a bearer token", async () => {
  const context = newContext()
  const cookie = await loginAsAdmin(context)
  await seed(context, cookie)
  const token = await issueRoleToken(context, cookie, "role-a")

  const response = await handleRequest(
    new Request("http://local/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "search-1",
        method: "tools/call",
        params: { name: "memory_search", arguments: { query: "shared" } },
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
  const state = createDemoState({ dbPath: ":memory:" })
  await seedDemo(state)
  const caller = callerFromRole("role-a")

  const write = await callMcpTool(state, caller, {
    name: "memory_write",
    arguments: {
      record: {
        id: "a-dynamic",
        scope: "customer/acme/team/a",
        content: "dynamic alpha memory",
      },
    },
  })
  const search = await callMcpTool(state, caller, {
    name: "memory_search",
    arguments: { query: "dynamic" },
  })

  expect(write).toEqual({ allowed: true })
  expect(JSON.stringify(search)).toContain("a-dynamic")
})

test("MCP write denies unauthorized scope with a redacted reason", async () => {
  const state = createDemoState({ dbPath: ":memory:" })

  const denied = await callMcpTool(state, callerFromRole("role-a"), {
    name: "memory_write",
    arguments: {
      record: {
        id: "mcp-bad",
        scope: "customer/acme/team/b",
        content: "mcp forbidden beta memory",
      },
    },
  })

  expect(denied).toEqual({ allowed: false, reason: "no_writable_scope" })
})
