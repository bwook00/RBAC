import type {
  CallerContext,
  MemoryRecord,
  Permission,
  SearchMode,
} from "@runbear/rbac-memory"
import {
  AuthService,
  clearSessionCookie,
  loadOidcEnv,
  resolveSessionCaller,
  type SignupInput,
  sessionFromRequest,
} from "./auth.js"
import { renderDashboard } from "./dashboard.js"
import {
  type BackendId,
  type CreateDemoStateOptions,
  callerFromPrincipal,
  callerFromRole,
  callerFromUser,
  createDemoState,
  type DemoState,
  type DirectoryUser,
  hasManagement,
  type Organization,
  resetBackend,
  seedDemo,
  switchBackend,
} from "./demo-state.js"
import { handleMcpRequest } from "./mcp-server.js"

export type AppContext = {
  state: DemoState
  auth: AuthService
}

type RouteHandler = (request: Request, context: AppContext) => Promise<Response>

const ROUTES: Record<string, RouteHandler> = {
  "GET /": handleDashboard,
  "GET /dashboard": handleDashboard,
  "GET /auth/login": handleAuthLogin,
  "GET /auth/callback": handleAuthCallback,
  "POST /auth/dev-login": handleDevLogin,
  "POST /auth/signup": handleSignup,
  "POST /auth/logout": handleLogout,
  "GET /auth/me": handleAuthMe,
  "GET /mcp": handleMcpStream,
  "POST /mcp": handleMcp,
  "GET /tokens": handleListMyTokens,
  "POST /tokens": handleIssueMyToken,
  "DELETE /tokens": handleDeleteMyToken,
  "POST /runtime/memory/write": handleRuntimeWrite,
  "POST /runtime/memory/search": handleRuntimeSearch,
  "GET /admin/organizations": handleListOrganizations,
  "PUT /admin/organizations": handleUpsertOrganization,
  "DELETE /admin/organizations": handleDeleteOrganization,
  "GET /admin/users": handleListUsers,
  "PUT /admin/users": handleUpsertUser,
  "DELETE /admin/users": handleDeleteUser,
  "GET /admin/permissions": handleListPermissions,
  "PUT /admin/permissions": handleUpsertPermission,
  "DELETE /admin/permissions": handleDeletePermission,
  "GET /admin/tokens": handleListTokens,
  "POST /admin/tokens": handleIssueToken,
  "DELETE /admin/tokens": handleDeleteToken,
  "POST /admin/backend": handleSwitchBackend,
  "POST /admin/seed": handleSeed,
  "GET /admin/adapter-contract-status": handleAdapterContractStatus,
  "POST /admin/audit-explain": handleAuditExplain,
}

export function createAppContext(
  options: CreateDemoStateOptions = {},
): AppContext {
  return {
    state: createDemoState(options),
    auth: new AuthService(loadOidcEnv()),
  }
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

async function handleAuthLogin(
  _request: Request,
  context: AppContext,
): Promise<Response> {
  return context.auth.handleLogin(context.state.directory, Date.now())
}

async function handleAuthCallback(
  request: Request,
  context: AppContext,
): Promise<Response> {
  return context.auth.handleCallback(
    context.state.directory,
    request,
    Date.now(),
  )
}

async function handleDevLogin(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const userId = await readUserId(request)
  if (userId === undefined) {
    return json({ error: "missing_user_id" }, 400)
  }
  return context.auth.handleDevLogin(
    context.state.directory,
    userId,
    Date.now(),
  )
}

async function handleSignup(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const input = await readSignup(request)
  if (input === undefined) {
    return json({ error: "missing_email" }, 400)
  }
  return context.auth.handleSignup(context.state.directory, input, Date.now())
}

async function handleLogout(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const sessionId = sessionFromRequest(request)
  if (sessionId !== undefined) {
    context.state.directory.deleteSession(sessionId)
  }
  return new Response(null, {
    status: 302,
    headers: { location: "/", "set-cookie": clearSessionCookie() },
  })
}

async function handleAuthMe(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const caller = resolveSessionCaller(
    context.state.directory,
    request,
    Date.now(),
  )
  if (caller === undefined) {
    return json({ authenticated: false, mode: context.auth.mode }, 401)
  }
  return json({
    authenticated: true,
    mode: context.auth.mode,
    principalId: caller.principalId,
    roleIds: caller.roleIds,
    organizationIds: caller.organizationIds ?? [],
    capabilities: caller.capabilities,
    canImpersonate: hasManagement(caller),
  })
}

async function handleMcpStream(
  _request: Request,
  _context: AppContext,
): Promise<Response> {
  // The optional Streamable-HTTP server→client GET stream is not supported;
  // 405 tells MCP clients to fall back to POST-only request/response.
  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: { "content-type": "application/json", allow: "POST" },
  })
}

async function handleMcp(
  request: Request,
  context: AppContext,
): Promise<Response> {
  return handleMcpRequest(context.state, request, Date.now())
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
  const caller = resolveRuntimeCaller(context, request, body)
  if (caller === undefined) {
    return json({ error: "unauthorized" }, 401)
  }
  const result = await context.state.memory.memoryWrite({
    caller,
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
  const caller = resolveRuntimeCaller(context, request, body)
  if (caller === undefined) {
    return json({ error: "unauthorized" }, 401)
  }
  const result = await context.state.memory.memorySearch({
    caller,
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
  request: Request,
  context: AppContext,
): Promise<Response> {
  const denied = requireManagement(context, request)
  if (denied !== undefined) {
    return denied
  }
  return json(context.state.directory.organizations())
}

async function handleUpsertOrganization(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const denied = requireManagement(context, request)
  if (denied !== undefined) {
    return denied
  }
  const organization = (await request.json()) as Organization
  return json(context.state.directory.upsertOrganization(organization))
}

async function handleDeleteOrganization(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const denied = requireManagement(context, request)
  if (denied !== undefined) {
    return denied
  }
  const id = new URL(request.url).searchParams.get("id")
  if (id === null || id.length === 0) {
    return json({ error: "missing_organization_id" }, 400)
  }
  return json({ deleted: context.state.directory.deleteOrganization(id) })
}

async function handleListUsers(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const denied = requireManagement(context, request)
  if (denied !== undefined) {
    return denied
  }
  return json(context.state.directory.users())
}

async function handleUpsertUser(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const denied = requireManagement(context, request)
  if (denied !== undefined) {
    return denied
  }
  const user = (await request.json()) as DirectoryUser
  return json(context.state.directory.upsertUser(user))
}

async function handleDeleteUser(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const denied = requireManagement(context, request)
  if (denied !== undefined) {
    return denied
  }
  const userId = new URL(request.url).searchParams.get("userId")
  if (userId === null || userId.length === 0) {
    return json({ error: "missing_user_id" }, 400)
  }
  return json({ deleted: context.state.directory.deleteUser(userId) })
}

async function handleListPermissions(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const caller = requireManagementCaller(context, request)
  if ("response" in caller) {
    return caller.response
  }
  return json(context.state.memory.listPermissions(caller.caller))
}

async function handleUpsertPermission(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const caller = requireManagementCaller(context, request)
  if ("response" in caller) {
    return caller.response
  }
  const permission = (await request.json()) as Permission
  return json(context.state.memory.upsertPermission(caller.caller, permission))
}

async function handleDeletePermission(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const caller = requireManagementCaller(context, request)
  if ("response" in caller) {
    return caller.response
  }
  const roleId = new URL(request.url).searchParams.get("roleId")
  if (roleId === null || roleId.length === 0) {
    return json({ error: "missing_role_id" }, 400)
  }
  return json({
    deleted: context.state.memory.deletePermission(caller.caller, roleId),
  })
}

async function handleListTokens(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const denied = requireManagement(context, request)
  if (denied !== undefined) {
    return denied
  }
  return json(context.state.directory.listTokens())
}

async function handleIssueToken(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const denied = requireManagement(context, request)
  if (denied !== undefined) {
    return denied
  }
  const body = (await request.json()) as {
    label?: string
    userId?: string
    roleId?: string
  }
  const tokenCaller = resolveTokenCaller(context.state, body)
  if (tokenCaller === undefined) {
    return json({ error: "missing_token_subject" }, 400)
  }
  const label = body.label ?? tokenCaller.principalId
  const issued = context.state.directory.issueToken(
    label,
    tokenCaller,
    Date.now(),
  )
  return json(issued)
}

async function handleDeleteToken(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const denied = requireManagement(context, request)
  if (denied !== undefined) {
    return denied
  }
  const tokenHash = new URL(request.url).searchParams.get("tokenHash")
  if (tokenHash === null || tokenHash.length === 0) {
    return json({ error: "missing_token_hash" }, 400)
  }
  return json({ deleted: context.state.directory.deleteToken(tokenHash) })
}

async function handleListMyTokens(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const caller = resolveSessionCaller(
    context.state.directory,
    request,
    Date.now(),
  )
  if (caller === undefined) {
    return json({ error: "unauthorized" }, 401)
  }
  return json(
    context.state.directory.listTokensForPrincipal(caller.principalId),
  )
}

async function handleIssueMyToken(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const caller = resolveSessionCaller(
    context.state.directory,
    request,
    Date.now(),
  )
  if (caller === undefined) {
    return json({ error: "unauthorized" }, 401)
  }
  const body = (await request.json()) as { label?: string }
  const label =
    body.label !== undefined && body.label.length > 0
      ? body.label
      : caller.principalId
  return json(context.state.directory.issueToken(label, caller, Date.now()))
}

async function handleDeleteMyToken(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const caller = resolveSessionCaller(
    context.state.directory,
    request,
    Date.now(),
  )
  if (caller === undefined) {
    return json({ error: "unauthorized" }, 401)
  }
  const tokenHash = new URL(request.url).searchParams.get("tokenHash")
  if (tokenHash === null || tokenHash.length === 0) {
    return json({ error: "missing_token_hash" }, 400)
  }
  return json({
    deleted: context.state.directory.deleteTokenForPrincipal(
      tokenHash,
      caller.principalId,
    ),
  })
}

async function handleSwitchBackend(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const denied = requireManagement(context, request)
  if (denied !== undefined) {
    return denied
  }
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
  request: Request,
  context: AppContext,
): Promise<Response> {
  const denied = requireManagement(context, request)
  if (denied !== undefined) {
    return denied
  }
  context.state = await resetBackend(context.state)
  await seedDemo(context.state)
  return json({ seeded: true, backendId: context.state.backendId })
}

async function handleAuditExplain(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const caller = requireManagementCaller(context, request)
  if ("response" in caller) {
    return caller.response
  }
  const body = (await request.json()) as {
    query: string
    organizationIds?: string[]
    tags?: string[]
    metadata?: Record<string, string>
    mode?: SearchMode
    limit?: number
  }
  const result = await context.state.memory.memorySearch({
    caller: caller.caller,
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
  request: Request,
  context: AppContext,
): Promise<Response> {
  const denied = requireManagement(context, request)
  if (denied !== undefined) {
    return denied
  }
  return json({
    activeBackend: context.state.backendId,
    backends: Object.values(context.state.statuses),
  })
}

function resolveRuntimeCaller(
  context: AppContext,
  request: Request,
  body: { principalId?: string; roleId?: string },
): CallerContext | undefined {
  const session = resolveSessionCaller(
    context.state.directory,
    request,
    Date.now(),
  )
  if (session === undefined) {
    return undefined
  }
  if (!hasManagement(session)) {
    return session
  }
  if (body.principalId !== undefined && body.principalId.length > 0) {
    return callerFromPrincipal(context.state, body.principalId)
  }
  if (body.roleId !== undefined && body.roleId.length > 0) {
    return callerFromRole(body.roleId)
  }
  return session
}

function resolveTokenCaller(
  state: DemoState,
  body: { userId?: string; roleId?: string },
): CallerContext | undefined {
  if (body.userId !== undefined && body.userId.length > 0) {
    const user = state.directory.getUser(body.userId)
    return user === undefined ? undefined : callerFromUser(user)
  }
  if (body.roleId !== undefined && body.roleId.length > 0) {
    return callerFromRole(body.roleId)
  }
  return undefined
}

function requireManagement(
  context: AppContext,
  request: Request,
): Response | undefined {
  const result = requireManagementCaller(context, request)
  return "response" in result ? result.response : undefined
}

function requireManagementCaller(
  context: AppContext,
  request: Request,
): { caller: CallerContext } | { response: Response } {
  const caller = resolveSessionCaller(
    context.state.directory,
    request,
    Date.now(),
  )
  if (caller === undefined) {
    return { response: json({ error: "unauthorized" }, 401) }
  }
  if (!hasManagement(caller)) {
    return { response: json({ error: "forbidden" }, 403) }
  }
  return { caller }
}

async function readSignup(request: Request): Promise<SignupInput | undefined> {
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      email?: string
      displayName?: string
      organizationIds?: string[]
    }
    if (body.email === undefined || body.email.length === 0) {
      return undefined
    }
    return {
      email: body.email,
      displayName: body.displayName,
      organizationIds: body.organizationIds,
    }
  }
  const form = await request.formData()
  const email = form.get("email")
  if (typeof email !== "string" || email.length === 0) {
    return undefined
  }
  const displayName = form.get("displayName")
  const organizationId = form.get("organizationIds")
  return {
    email,
    displayName: typeof displayName === "string" ? displayName : undefined,
    organizationIds:
      typeof organizationId === "string" && organizationId.length > 0
        ? [organizationId]
        : [],
  }
}

async function readUserId(request: Request): Promise<string | undefined> {
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { userId?: string }
    return body.userId !== undefined && body.userId.length > 0
      ? body.userId
      : undefined
  }
  const form = await request.formData()
  const userId = form.get("userId")
  return typeof userId === "string" && userId.length > 0 ? userId : undefined
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
