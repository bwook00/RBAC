import { createHash, randomBytes } from "node:crypto"
import type { CallerContext } from "@runbear/rbac-memory"
import { callerFromUser } from "./demo-state.js"
import type { RbacDirectory } from "./rbac-db.js"

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
  readonly #pending = new Map<string, { codeVerifier: string; createdAt: number }>()

  constructor(env: OidcEnv | null) {
    this.#env = env
  }

  get mode(): AuthMode {
    return this.#env === null ? "dev" : "oidc"
  }

  async handleLogin(
    directory: RbacDirectory,
    request: Request,
    now: number,
  ): Promise<Response> {
    if (this.#env === null) {
      return htmlResponse(renderDevLoginPage(directory.users()))
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
    const user = directory.getUserByEmail(email)
    if (user === undefined) {
      return htmlResponse(
        renderMessagePage(
          `No directory user is registered for ${email}. Ask an admin to add you.`,
        ),
        403,
      )
    }
    const session = directory.createSession(user.id, now)
    return redirect("/", sessionCookie(session.id))
  }

  handleDevLogin(
    directory: RbacDirectory,
    userId: string,
    now: number,
  ): Response {
    if (this.#env !== null) {
      return htmlResponse(
        renderMessagePage("Dev login is disabled when OIDC is configured."),
        400,
      )
    }
    const user = directory.getUser(userId)
    if (user === undefined) {
      return htmlResponse(renderMessagePage("Unknown user."), 404)
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

function renderDevLoginPage(
  users: Array<{ id: string; displayName: string; email: string }>,
): string {
  const rows = users
    .map(
      (user) =>
        `<button name="userId" value="${escapeHtml(user.id)}" type="submit">${escapeHtml(user.displayName)} <small>${escapeHtml(user.email)}</small></button>`,
    )
    .join("")
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Dev login</title>
<style>body{font-family:system-ui;max-width:480px;margin:64px auto;padding:0 16px}
form{display:flex;flex-direction:column;gap:8px}
button{padding:12px;border:1px solid #ccc;border-radius:8px;background:#fff;text-align:left;cursor:pointer}
button:hover{background:#f5f5f5}small{color:#777;display:block}</style></head>
<body><h1>Dev login</h1>
<p>OIDC is not configured. Pick a seeded directory user to start a session.</p>
<form method="post" action="/auth/dev-login">${rows}</form></body></html>`
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
