import type { MemoryRecord, Permission, SearchMode } from "@runbear/rbac-memory"
import { renderDashboard } from "./dashboard.js"
import {
  ADMIN_CALLER,
  type BackendId,
  callerFromPrincipal,
  callerFromRole,
  createDemoState,
  type DemoState,
  type DirectoryUser,
  deleteUser,
  type Organization,
  resetBackend,
  seedDemo,
  switchBackend,
  upsertOrganization,
  upsertUser,
} from "./demo-state.js"
import { handleMcpRequest } from "./mcp-server.js"

export type AppContext = {
  state: DemoState
}

type RouteHandler = (request: Request, context: AppContext) => Promise<Response>

const ROUTES: Record<string, RouteHandler> = {
  "GET /": handleDashboard,
  "GET /dashboard": handleDashboard,
  "POST /mcp": handleMcp,
  "POST /runtime/memory/write": handleRuntimeWrite,
  "POST /runtime/memory/search": handleRuntimeSearch,
  "GET /admin/organizations": handleListOrganizations,
  "PUT /admin/organizations": handleUpsertOrganization,
  "GET /admin/users": handleListUsers,
  "PUT /admin/users": handleUpsertUser,
  "DELETE /admin/users": handleDeleteUser,
  "GET /admin/permissions": handleListPermissions,
  "PUT /admin/permissions": handleUpsertPermission,
  "DELETE /admin/permissions": handleDeletePermission,
  "POST /admin/backend": handleSwitchBackend,
  "POST /admin/seed": handleSeed,
  "GET /admin/adapter-contract-status": handleAdapterContractStatus,
  "POST /admin/audit-explain": handleAuditExplain,
}

export function createAppContext(): AppContext {
  return { state: createDemoState() }
}

export async function handleRequest(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const url = new URL(request.url)
  const handler = ROUTES[`${request.method} ${url.pathname}`]
  if (handler === undefined) {
    return json({ error: "not_found" }, 404)
  }

  return handler(request, context)
}

async function handleDashboard(
  _request: Request,
  _context: AppContext,
): Promise<Response> {
  return new Response(renderDashboard(), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}
async function handleMcp(
  request: Request,
  context: AppContext,
): Promise<Response> {
  return handleMcpRequest(context.state, request)
}

async function handleRuntimeWrite(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const body = (await request.json()) as {
    principalId?: string
    roleId?: string
    record: MemoryRecord
  }
  const result = await context.state.memory.memoryWrite({
    caller: callerFromRequest(context.state, body),
    record: body.record,
  })
  return json(result, result.allowed ? 200 : 403)
}

async function handleRuntimeSearch(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const body = (await request.json()) as {
    principalId?: string
    roleId?: string
    query: string
    requestedScopes?: string[]
    organizationIds?: string[]
    tags?: string[]
    metadata?: Record<string, string>
    mode?: SearchMode
    limit?: number
  }
  const result = await context.state.memory.memorySearch({
    caller: callerFromRequest(context.state, body),
    query: body.query,
    requestedScopes: body.requestedScopes,
    organizationIds: body.organizationIds,
    tags: body.tags,
    metadata: body.metadata,
    mode: body.mode,
    limit: body.limit,
    explain: "runtime",
  })
  return json(result, "allowed" in result ? 403 : 200)
}

async function handleListOrganizations(
  _request: Request,
  context: AppContext,
): Promise<Response> {
  return json(context.state.organizations)
}

async function handleUpsertOrganization(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const organization = (await request.json()) as Organization
  return json(upsertOrganization(context.state, organization))
}

async function handleListUsers(
  _request: Request,
  context: AppContext,
): Promise<Response> {
  return json(context.state.users)
}

async function handleUpsertUser(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const user = (await request.json()) as DirectoryUser
  return json(upsertUser(context.state, user))
}

async function handleDeleteUser(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const userId = new URL(request.url).searchParams.get("userId")
  if (userId === null || userId.length === 0) {
    return json({ error: "missing_user_id" }, 400)
  }
  return json({ deleted: deleteUser(context.state, userId) })
}

async function handleListPermissions(
  _request: Request,
  context: AppContext,
): Promise<Response> {
  return json(context.state.memory.listPermissions(ADMIN_CALLER))
}

async function handleUpsertPermission(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const permission = (await request.json()) as Permission
  return json(context.state.memory.upsertPermission(ADMIN_CALLER, permission))
}

async function handleDeletePermission(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const roleId = new URL(request.url).searchParams.get("roleId")
  if (roleId === null || roleId.length === 0) {
    return json({ error: "missing_role_id" }, 400)
  }

  return json({
    deleted: context.state.memory.deletePermission(ADMIN_CALLER, roleId),
  })
}

async function handleSwitchBackend(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const body = (await request.json()) as { backendId: string }
  if (!isBackendId(body.backendId)) {
    return json({ error: "unsupported_backend" }, 400)
  }

  const nextState = switchBackend(context.state, body.backendId)
  if ("error" in nextState) {
    return json(nextState, 409)
  }
  context.state = nextState
  return json({ backendId: context.state.backendId })
}

async function handleSeed(
  _request: Request,
  context: AppContext,
): Promise<Response> {
  context.state = await resetBackend(context.state)
  await seedDemo(context.state)
  return json({ seeded: true, backendId: context.state.backendId })
}

async function handleAuditExplain(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const body = (await request.json()) as {
    query: string
    organizationIds?: string[]
    tags?: string[]
    metadata?: Record<string, string>
    mode?: SearchMode
    limit?: number
  }
  const result = await context.state.memory.memorySearch({
    caller: ADMIN_CALLER,
    query: body.query,
    organizationIds: body.organizationIds,
    tags: body.tags,
    metadata: body.metadata,
    mode: body.mode,
    limit: body.limit,
    explain: "admin",
  })
  return json(result, "allowed" in result ? 403 : 200)
}

async function handleAdapterContractStatus(
  _request: Request,
  context: AppContext,
): Promise<Response> {
  return json({
    activeBackend: context.state.backendId,
    backends: Object.values(context.state.statuses),
  })
}

function callerFromRequest(
  state: DemoState,
  body: { principalId?: string; roleId?: string },
) {
  if (body.principalId !== undefined && body.principalId.length > 0) {
    return callerFromPrincipal(state, body.principalId)
  }
  return callerFromRole(body.roleId ?? "")
}

function isBackendId(value: string): value is BackendId {
  return value === "fs" || value === "mem0"
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  })
}
