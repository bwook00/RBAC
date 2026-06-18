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
      : `<p class="hint">Demo account: <button type="button" class="hint-link" data-fill="${escapeHtml(adminHint.email)}">${escapeHtml(adminHint.email)}</button></p>`
  const orgOptions = organizations
    .map(
      (organization) =>
        `<option value="${escapeHtml(organization.id)}">${escapeHtml(organization.name)}</option>`,
    )
    .join("")
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RBAC Memory</title>
<style>
:root{--ink:#0b1220;--muted:#64748b;--line:#e2e8f0;--brand:#4f46e5;--brand-press:#4338ca;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink)}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0}
.auth{display:flex;min-height:100vh}
.brand{position:relative;flex:1.05;overflow:hidden;color:#fff;padding:48px;display:flex;flex-direction:column;justify-content:space-between;background:radial-gradient(120% 120% at 15% 0%,#6366f1 0%,#4338ca 42%,#0ea5e9 100%)}
.brand::after{content:"";position:absolute;inset:0;background:radial-gradient(60% 60% at 85% 90%,rgba(255,255,255,.14),transparent 70%);pointer-events:none}
.brand-top{display:flex;align-items:center;gap:12px;position:relative;z-index:1}
.brand-mark{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:rgba(255,255,255,.16);backdrop-filter:blur(6px);font-weight:900;letter-spacing:.02em}
.brand-name{font-weight:800;font-size:16px}
.brand-copy{position:relative;z-index:1;max-width:440px}
.brand-copy h1{font-size:38px;line-height:1.1;letter-spacing:-.03em;margin:0 0 16px;font-weight:800}
.brand-copy p{margin:0 0 28px;color:rgba(255,255,255,.82);font-size:16px;line-height:1.6}
.feat{display:grid;gap:14px;list-style:none;padding:0;margin:0}
.feat li{display:flex;gap:12px;align-items:flex-start;font-size:14px;color:rgba(255,255,255,.92)}
.feat .ico{flex:0 0 22px;height:22px;border-radius:7px;display:grid;place-items:center;background:rgba(255,255,255,.18);font-size:13px;font-weight:900}
.brand-foot{position:relative;z-index:1;color:rgba(255,255,255,.6);font-size:13px}
.panel{flex:1;display:grid;place-items:center;padding:32px;background:#fff}
.card{width:100%;max-width:380px}
.card>.logo{display:none}
.seg{display:flex;background:#f1f5f9;border-radius:12px;padding:4px;margin:0 0 24px}
.seg button{flex:1;border:0;background:transparent;padding:9px 10px;border-radius:9px;font:inherit;font-weight:700;font-size:14px;color:var(--muted);cursor:pointer;transition:all .15s ease}
.seg button.active{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(15,23,42,.12)}
.head{margin:0 0 20px}
.head h2{margin:0 0 6px;font-size:22px;letter-spacing:-.02em}
.head p{margin:0;color:var(--muted);font-size:14px}
form{display:grid;gap:16px}
.field{display:grid;gap:7px}
.field label{font-size:13px;font-weight:600;color:#334155}
.field input,.field select{width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:10px;font:inherit;color:var(--ink);background:#fff;transition:border-color .15s,box-shadow .15s}
.field input::placeholder{color:#94a3b8}
.field input:focus,.field select:focus{outline:0;border-color:var(--brand);box-shadow:0 0 0 3px rgba(79,70,229,.15)}
.submit{margin-top:4px;width:100%;padding:12px;border:0;border-radius:10px;background:var(--brand);color:#fff;font:inherit;font-weight:700;font-size:15px;cursor:pointer;transition:background .15s,transform .05s}
.submit:hover{background:var(--brand-press)}
.submit:active{transform:translateY(1px)}
.hint{margin:18px 0 0;font-size:13px;color:var(--muted);text-align:center}
.hint-link{border:0;background:none;color:var(--brand);font:inherit;font-weight:600;cursor:pointer;padding:0}
.hint-link:hover{text-decoration:underline}
.hidden{display:none}
@media (max-width:880px){.brand{display:none}.card>.logo{display:flex;align-items:center;gap:10px;margin:0 0 24px;color:var(--ink)}.card>.logo .brand-mark{background:linear-gradient(135deg,#6366f1,#0ea5e9)}}
</style></head>
<body>
<div class="auth">
  <aside class="brand">
    <div class="brand-top"><div class="brand-mark">RB</div><span class="brand-name">RBAC Memory</span></div>
    <div class="brand-copy">
      <h1>Scoped memory for every AI agent.</h1>
      <p>Govern exactly which memories each agent, role, and tenant can read and write — across your dashboard, HTTP API, and MCP clients.</p>
      <ul class="feat">
        <li><span class="ico">✓</span><span>Hierarchical scopes with per-role read/write policies</span></li>
        <li><span class="ico">✓</span><span>Per-user MCP bearer tokens — identity, not guesswork</span></li>
        <li><span class="ico">✓</span><span>SSO sign-in with automatic member provisioning</span></li>
      </ul>
    </div>
    <div class="brand-foot">RBAC Memory · local console</div>
  </aside>
  <main class="panel">
    <div class="card">
      <div class="logo"><div class="brand-mark">RB</div><span class="brand-name">RBAC Memory</span></div>
      <div class="seg" role="tablist">
        <button type="button" class="active" data-mode="signin">Sign in</button>
        <button type="button" data-mode="signup">Create account</button>
      </div>

      <section id="pane-signin">
        <div class="head"><h2>Welcome back</h2><p>Sign in to manage organizations, members, and MCP tokens.</p></div>
        <form method="post" action="/auth/dev-login">
          <div class="field"><label for="si-email">Email</label><input id="si-email" name="userId" type="email" placeholder="you@company.com" autocomplete="email" required /></div>
          <button class="submit" type="submit">Sign in</button>
        </form>
        ${hint}
      </section>

      <section id="pane-signup" class="hidden">
        <div class="head"><h2>Create your account</h2><p>Sign up and optionally join an organization to get started.</p></div>
        <form method="post" action="/auth/signup">
          <div class="field"><label for="su-email">Email</label><input id="su-email" name="email" type="email" placeholder="you@company.com" autocomplete="email" required /></div>
          <div class="field"><label for="su-name">Display name</label><input id="su-name" name="displayName" placeholder="Your name" autocomplete="name" /></div>
          <div class="field"><label for="su-org">Organization <span style="color:#94a3b8;font-weight:400">(optional)</span></label><select id="su-org" name="organizationIds"><option value="">No organization</option>${orgOptions}</select></div>
          <button class="submit" type="submit">Create account</button>
        </form>
      </section>
    </div>
  </main>
</div>
<script>
  const seg = document.querySelector(".seg")
  const panes = { signin: document.querySelector("#pane-signin"), signup: document.querySelector("#pane-signup") }
  seg.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mode]")
    if (!btn) return
    seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn))
    panes.signin.classList.toggle("hidden", btn.dataset.mode !== "signin")
    panes.signup.classList.toggle("hidden", btn.dataset.mode !== "signup")
  })
  document.addEventListener("click", (e) => {
    const fill = e.target.closest(".hint-link")
    if (fill) { document.querySelector("#si-email").value = fill.dataset.fill }
  })
</script>
</body></html>`
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
