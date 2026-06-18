import { createHash, randomBytes } from "node:crypto"
import type { CallerContext } from "@runbear/rbac-memory"
import { callerFromUser } from "./demo-state.js"
import type { DirectoryUser, Organization, RbacDirectory } from "./rbac-db.js"

export type SignupInput = {
  email: string
  displayName?: string
  organizationIds?: string[]
}

export const SESSION_COOKIE = "rbm_session"
const BEARER_PREFIX = "Bearer "
const PENDING_STATE_TTL_MS = 10 * 60 * 1000
const DEFAULT_SCOPE = "openid email profile"
const COOKIE_SPLIT_PATTERN = /;\s*/
const TRAILING_EQUALS_PATTERN = /=+$/

export type AuthMode = "oidc" | "dev"

type OidcEnv = {
  issuer?: string
  authorizationEndpoint?: string
  tokenEndpoint?: string
  clientId: string
  clientSecret: string
  redirectUri: string
  scope: string
}

type ResolvedEndpoints = {
  authorizationEndpoint: string
  tokenEndpoint: string
}

/**
 * Generic OIDC authorization-code flow with a built-in dev-login fallback.
 *
 * When the OIDC_* env vars are present the service drives a real provider
 * (authorize redirect → callback → token exchange → id_token email → user
 * mapping). When they are absent it falls back to a local dev-login page so
 * the demo runs with zero external setup.
 */
export class AuthService {
  readonly #env: OidcEnv | null
  #endpoints: ResolvedEndpoints | null = null
  readonly #pending = new Map<
    string,
    { codeVerifier: string; createdAt: number }
  >()

  constructor(env: OidcEnv | null) {
    this.#env = env
  }

  get mode(): AuthMode {
    return this.#env === null ? "dev" : "oidc"
  }

  async handleLogin(directory: RbacDirectory, now: number): Promise<Response> {
    if (this.#env === null) {
      return htmlResponse(
        renderLoginPage(directory.users(), directory.organizations()),
      )
    }
    const endpoints = await this.#resolveEndpoints(this.#env)
    const codeVerifier = base64url(randomBytes(32))
    const state = base64url(randomBytes(16))
    this.#prunePending(now)
    this.#pending.set(state, { codeVerifier, createdAt: now })

    const url = new URL(endpoints.authorizationEndpoint)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("client_id", this.#env.clientId)
    url.searchParams.set("redirect_uri", this.#env.redirectUri)
    url.searchParams.set("scope", this.#env.scope)
    url.searchParams.set("state", state)
    url.searchParams.set("code_challenge", base64url(sha256(codeVerifier)))
    url.searchParams.set("code_challenge_method", "S256")
    return redirect(url.toString())
  }

  async handleCallback(
    directory: RbacDirectory,
    request: Request,
    now: number,
  ): Promise<Response> {
    if (this.#env === null) {
      return htmlResponse(renderMessagePage("OIDC is not configured."), 400)
    }
    const params = new URL(request.url).searchParams
    const code = params.get("code")
    const state = params.get("state")
    if (code === null || state === null) {
      return htmlResponse(renderMessagePage("Missing code or state."), 400)
    }
    const pending = this.#pending.get(state)
    this.#pending.delete(state)
    if (pending === undefined) {
      return htmlResponse(renderMessagePage("Unknown or expired state."), 400)
    }

    const endpoints = await this.#resolveEndpoints(this.#env)
    const email = await this.#exchangeCodeForEmail(
      endpoints.tokenEndpoint,
      code,
      pending.codeVerifier,
      this.#env,
    )
    if (email === null) {
      return htmlResponse(
        renderMessagePage("Could not read email from the identity provider."),
        400,
      )
    }
    // Auto-provision first-time SSO users so OAuth onboarding works without a
    // pre-registered directory entry. New users start with runtime capability
    // and no roles/orgs until an admin maps them.
    const user =
      directory.getUserByEmail(email) ?? provisionUser(directory, email)
    const session = directory.createSession(user.id, now)
    return redirect("/", sessionCookie(session.id))
  }

  handleSignup(
    directory: RbacDirectory,
    input: SignupInput,
    now: number,
  ): Response {
    if (this.#env !== null) {
      return htmlResponse(
        renderMessagePage("Sign-up happens through your SSO provider."),
        400,
      )
    }
    const email = input.email.trim()
    if (email.length === 0) {
      return htmlResponse(renderMessagePage("Email is required."), 400)
    }
    if (directory.getUserByEmail(email) !== undefined) {
      return htmlResponse(
        renderMessagePage(`${email} is already registered. Please sign in.`),
        409,
      )
    }
    const user = provisionUser(directory, email, {
      displayName: input.displayName,
      organizationIds: input.organizationIds,
    })
    const session = directory.createSession(user.id, now)
    return redirect("/", sessionCookie(session.id))
  }

  handleDevLogin(
    directory: RbacDirectory,
    identifier: string,
    now: number,
  ): Response {
    if (this.#env !== null) {
      return htmlResponse(
        renderMessagePage("Dev login is disabled when OIDC is configured."),
        400,
      )
    }
    // Accept either the user id or the email so the login form can be a single
    // email field instead of a button per directory user.
    const user =
      directory.getUser(identifier) ?? directory.getUserByEmail(identifier)
    if (user === undefined) {
      return htmlResponse(
        renderMessagePage(
          `No account found for "${identifier}". Sign up first.`,
        ),
        404,
      )
    }
    const session = directory.createSession(user.id, now)
    return redirect("/", sessionCookie(session.id))
  }

  async #resolveEndpoints(env: OidcEnv): Promise<ResolvedEndpoints> {
    if (this.#endpoints !== null) {
      return this.#endpoints
    }
    if (
      env.authorizationEndpoint !== undefined &&
      env.tokenEndpoint !== undefined
    ) {
      this.#endpoints = {
        authorizationEndpoint: env.authorizationEndpoint,
        tokenEndpoint: env.tokenEndpoint,
      }
      return this.#endpoints
    }
    if (env.issuer === undefined) {
      throw new Error(
        "OIDC requires OIDC_ISSUER or explicit authorization/token endpoints",
      )
    }
    const discoveryUrl = new URL(
      ".well-known/openid-configuration",
      env.issuer.endsWith("/") ? env.issuer : `${env.issuer}/`,
    )
    const response = await fetch(discoveryUrl)
    const document = (await response.json()) as {
      authorization_endpoint?: string
      token_endpoint?: string
    }
    if (
      document.authorization_endpoint === undefined ||
      document.token_endpoint === undefined
    ) {
      throw new Error("OIDC discovery document is missing endpoints")
    }
    this.#endpoints = {
      authorizationEndpoint: document.authorization_endpoint,
      tokenEndpoint: document.token_endpoint,
    }
    return this.#endpoints
  }

  async #exchangeCodeForEmail(
    tokenEndpoint: string,
    code: string,
    codeVerifier: string,
    env: OidcEnv,
  ): Promise<string | null> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: env.redirectUri,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      code_verifier: codeVerifier,
    })
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })
    if (!response.ok) {
      return null
    }
    const payload = (await response.json()) as { id_token?: string }
    if (payload.id_token === undefined) {
      return null
    }
    const claims = decodeJwtPayload(payload.id_token)
    const email = claims?.email
    return typeof email === "string" ? email : null
  }

  #prunePending(now: number): void {
    for (const [state, entry] of this.#pending) {
      if (now - entry.createdAt > PENDING_STATE_TTL_MS) {
        this.#pending.delete(state)
      }
    }
  }
}

export function loadOidcEnv(): OidcEnv | null {
  const clientId = Bun.env.OIDC_CLIENT_ID
  const clientSecret = Bun.env.OIDC_CLIENT_SECRET
  const redirectUri = Bun.env.OIDC_REDIRECT_URI
  if (
    clientId === undefined ||
    clientSecret === undefined ||
    redirectUri === undefined
  ) {
    return null
  }
  return {
    issuer: Bun.env.OIDC_ISSUER,
    authorizationEndpoint: Bun.env.OIDC_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: Bun.env.OIDC_TOKEN_ENDPOINT,
    clientId,
    clientSecret,
    redirectUri,
    scope: Bun.env.OIDC_SCOPE ?? DEFAULT_SCOPE,
  }
}

export function resolveSessionCaller(
  directory: RbacDirectory,
  request: Request,
  now: number,
): CallerContext | undefined {
  const sessionId = parseCookies(request)[SESSION_COOKIE]
  if (sessionId === undefined) {
    return undefined
  }
  const session = directory.getSession(sessionId, now)
  if (session === undefined) {
    return undefined
  }
  const user = directory.getUser(session.userId)
  return user === undefined ? undefined : callerFromUser(user)
}

export function resolveBearerCaller(
  directory: RbacDirectory,
  request: Request,
  now: number,
): CallerContext | undefined {
  const header = request.headers.get("authorization")
  if (header === null || !header.startsWith(BEARER_PREFIX)) {
    return undefined
  }
  const token = header.slice(BEARER_PREFIX.length).trim()
  if (token.length === 0) {
    return undefined
  }
  return directory.resolveToken(token, now)
}

export function sessionFromRequest(request: Request): string | undefined {
  return parseCookies(request)[SESSION_COOKIE]
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("cookie")
  if (header === null) {
    return {}
  }
  const cookies: Record<string, string> = {}
  for (const part of header.split(COOKIE_SPLIT_PATTERN)) {
    const eq = part.indexOf("=")
    if (eq > 0) {
      cookies[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1))
    }
  }
  return cookies
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const segments = jwt.split(".")
  if (segments.length < 2) {
    return null
  }
  try {
    const json = Buffer.from(segments[1] ?? "", "base64url").toString("utf8")
    const parsed: unknown = JSON.parse(json)
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest()
}

function base64url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(TRAILING_EQUALS_PATTERN, "")
}

function redirect(location: string, setCookie?: string): Response {
  const headers = new Headers({ location })
  if (setCookie !== undefined) {
    headers.set("set-cookie", setCookie)
  }
  return new Response(null, { status: 302, headers })
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

function provisionUser(
  directory: RbacDirectory,
  email: string,
  overrides: { displayName?: string; organizationIds?: string[] } = {},
): DirectoryUser {
  const normalizedEmail = email.trim().toLowerCase()
  const localPart = normalizedEmail.split("@")[0]
  return directory.upsertUser({
    id: normalizedEmail,
    email: normalizedEmail,
    displayName:
      overrides.displayName !== undefined && overrides.displayName.length > 0
        ? overrides.displayName
        : (localPart ?? normalizedEmail),
    organizationIds: overrides.organizationIds ?? [],
    roleIds: [],
    capabilities: ["runtime"],
  })
}

function renderLoginPage(
  users: DirectoryUser[],
  organizations: Organization[],
): string {
  const adminHint = users.find((user) =>
    user.capabilities.includes("management"),
  )
  const hint =
    adminHint === undefined
      ? ""
      : `<p class="muted" style="margin-top:8px;font-size:12px">Demo admin: ${escapeHtml(adminHint.email)}</p>`
  const orgOptions = organizations
    .map(
      (organization) =>
        `<option value="${escapeHtml(organization.id)}">${escapeHtml(organization.name)} (${escapeHtml(organization.id)})</option>`,
    )
    .join("")
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RBAC Memory — Sign in</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,sans-serif;color:#172033}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#eef4ff,#f8fafc 52%,#edf7f4)}
.wrap{width:100%;max-width:420px;padding:24px}
.card{background:#fff;border:1px solid rgba(148,163,184,.28);border-radius:24px;padding:28px;box-shadow:0 24px 70px rgba(37,51,78,.12);margin-bottom:18px}
h1{margin:0 0 6px;font-size:24px;letter-spacing:-.02em}
h2{margin:0 0 14px;font-size:16px}
p.muted{margin:0 0 18px;color:#64748b;font-size:14px}
form{display:grid;gap:10px}
label{display:grid;gap:6px;font-size:13px;font-weight:700;color:#475569}
input,select{width:100%;padding:11px 12px;border:1px solid #ccd6e5;border-radius:12px;font:inherit}
button{padding:12px;border:0;border-radius:12px;background:#172033;color:#fff;font:inherit;font-weight:800;cursor:pointer;text-align:left}
button:hover{opacity:.92}
.signin button{background:#eef2ff;color:#3730a3;display:flex;justify-content:space-between;align-items:center}
.signin small{color:#64748b;font-weight:600}
.brand-mark{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,#8b5cf6,#06b6d4);color:#fff;font-weight:900;margin-bottom:14px}
</style></head>
<body><div class="wrap">
  <div class="card">
    <div class="brand-mark">RB</div>
    <h1>RBAC Memory</h1>
    <p class="muted">Sign in to manage organizations, members, and MCP access tokens.</p>
    <h2>Sign in</h2>
    <form method="post" action="/auth/dev-login">
      <label>Email<input name="userId" type="email" placeholder="you@company.com" required /></label>
      <button type="submit">Sign in</button>
    </form>
    ${hint}
  </div>
  <div class="card">
    <h2>Create an account</h2>
    <p class="muted">New here? Sign up and (optionally) join an organization.</p>
    <form method="post" action="/auth/signup">
      <label>Email<input name="email" type="email" placeholder="you@company.com" required /></label>
      <label>Display name<input name="displayName" placeholder="Your name" /></label>
      <label>Organization<select name="organizationIds"><option value="">— none —</option>${orgOptions}</select></label>
      <button type="submit">Sign up</button>
    </form>
  </div>
</div></body></html>`
}

function renderMessagePage(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Sign-in</title>
<style>body{font-family:system-ui;max-width:480px;margin:64px auto;padding:0 16px}</style></head>
<body><h1>Sign-in</h1><p>${escapeHtml(message)}</p><p><a href="/auth/login">Try again</a></p></body></html>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
