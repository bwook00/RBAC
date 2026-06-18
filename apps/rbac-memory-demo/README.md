# RBAC Memory Admin Console

Local product/admin surface for the `@runbear/rbac-memory` bounded context.

## Run

```sh
bun install
bun run --cwd apps/rbac-memory-demo start
```

The server listens on `http://localhost:4321`. Open `/dashboard` — you will be
redirected to sign in first (see **Authentication** below).

## Authentication

Every runtime, admin, and MCP surface is authenticated. Identity is no longer a
free-form request parameter.

- **Dashboard / HTTP**: a login establishes a session cookie (`rbm_session`).
  The session's directory user drives the query scope. A user with the
  `management` capability (e.g. `admin`) may additionally impersonate any role
  or principal via the `roleId` / `principalId` body fields (the
  "Impersonation playground"); non-admin sessions are pinned to their own
  identity.
- **MCP**: clients authenticate with `Authorization: Bearer <token>`. Tokens
  are issued per user/role from the dashboard's **MCP tokens** tab (or
  `POST /admin/tokens`). The token resolves to the caller identity server-side,
  so MCP tool arguments no longer carry a `roleId`.

### OIDC vs. dev-login

The login flow is a generic OIDC authorization-code flow (PKCE) with a built-in
dev-login fallback:

- **OIDC mode** — enabled when `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and
  `OIDC_REDIRECT_URI` are set. Provide either `OIDC_ISSUER` (endpoints are
  discovered from `/.well-known/openid-configuration`) or explicit
  `OIDC_AUTHORIZATION_ENDPOINT` / `OIDC_TOKEN_ENDPOINT`. Optional `OIDC_SCOPE`
  defaults to `openid email profile`. After consent, the provider's
  `id_token` email is mapped to a directory user by email.
- **dev-login mode** — the default when no `OIDC_*` vars are set. `/auth/login`
  renders a local page to pick a seeded directory user, so the demo runs with
  zero external setup.

```sh
# OIDC example
OIDC_ISSUER=https://accounts.google.com \
OIDC_CLIENT_ID=... \
OIDC_CLIENT_SECRET=... \
OIDC_REDIRECT_URI=http://localhost:4321/auth/callback \
bun run --cwd apps/rbac-memory-demo start
```

## Storage modes

RBAC configuration (organizations, users, role permissions, login sessions, and
MCP tokens) is persisted in **SQLite**. Memory records use a pluggable store.

- **RBAC config (SQLite)**: a single SQLite file. Set `RBAC_DB_PATH` to change
  its location. The default is `<RBAC_MEMORY_FS_ROOT>/rbac.sqlite`
  (i.e. `.data/rbac-memory-demo/rbac.sqlite`). Role permissions and directory
  edits survive restarts.
- **Memory records — Local FS store**: default persistent JSON-file backend.
  Set `RBAC_MEMORY_FS_ROOT` to change the storage directory (default
  `.data/rbac-memory-demo`).
- **Memory records — Mem0 hosted memory**: real Mem0 REST API adapter. Set
  `MEM0_API_KEY` to enable it. Optional: `MEM0_USER_ID`, `MEM0_BASE_URL`.

```sh
MEM0_API_KEY=mem0_... \
MEM0_USER_ID=rbac-memory-demo \
bun run --cwd apps/rbac-memory-demo start
```

## Dashboard quickstart

Open `http://localhost:4321/dashboard`, sign in, then run these flows:

1. **Overview**: inspect the active backend, switch between Local FS and Mem0, seed fixture memories, and check adapter status.
2. **Organizations**: create and update tenant roots such as `customer/acme` and `customer/globex`.
3. **Users**: register users or service principals, assign them to organizations, and attach runtime/management capabilities.
4. **Roles & permissions**: list, create, update, or delete role-to-scope mappings (persisted in SQLite).
5. **Memory**: write and search scoped memories with advanced filters for organization, tags, metadata, search mode, and result limit.
6. **Access playground**: impersonate a registered user (admin only) with the same query to verify cross-organization isolation and denied writes.
7. **MCP tokens**: issue/revoke per-user bearer tokens for MCP clients.
8. **Audit explain**: run management-only explain to see included and excluded records for policy audits.

## HTTP API examples

Authenticated routes need a session cookie. In dev-login mode, mint one:

```sh
COOKIE=$(curl -s -i -X POST http://localhost:4321/auth/dev-login \
  -H 'content-type: application/json' -d '{"userId":"admin"}' \
  | grep -i '^set-cookie:' | sed 's/.*: //' | cut -d';' -f1)
```

Seed demo records (management capability required):

```sh
curl -X POST http://localhost:4321/admin/seed -H "cookie: $COOKIE"
```

Search with runtime RBAC enforcement. The caller is the session user; an admin
may impersonate a role/principal via `roleId` / `principalId`:

```sh
curl -X POST http://localhost:4321/runtime/memory/search \
  -H 'content-type: application/json' -H "cookie: $COOKIE" \
  -d '{"roleId":"role-a","query":"handbook launch","mode":"any","organizationIds":["customer/acme"],"tags":["memory"],"limit":10}'
```

Attempt a denied write:

```sh
curl -X POST http://localhost:4321/runtime/memory/write \
  -H 'content-type: application/json' -H "cookie: $COOKIE" \
  -d '{"roleId":"role-a","record":{"id":"bad-b","scope":"customer/acme/team/b","content":"forbidden beta write"}}'
```

Switch backend and inspect contract status:

```sh
curl -X POST http://localhost:4321/admin/backend \
  -H 'content-type: application/json' -H "cookie: $COOKIE" \
  -d '{"backendId":"fs"}'

curl http://localhost:4321/admin/adapter-contract-status -H "cookie: $COOKIE"
```

Manage organizations, users, and permissions (all management-only):

```sh
curl http://localhost:4321/admin/organizations -H "cookie: $COOKIE"

curl -X PUT http://localhost:4321/admin/permissions \
  -H 'content-type: application/json' -H "cookie: $COOKIE" \
  -d '{"roleId":"role-c","readableScopes":["customer/acme/team/c"],"writableScopes":["customer/acme/team/c"]}'

curl -X DELETE 'http://localhost:4321/admin/permissions?roleId=role-c' -H "cookie: $COOKIE"
```

## MCP JSON-RPC examples

`tools/list` is open; `tools/call` requires a bearer token. Issue one first:

```sh
TOKEN=$(curl -s -X POST http://localhost:4321/admin/tokens \
  -H 'content-type: application/json' -H "cookie: $COOKIE" \
  -d '{"roleId":"role-a","label":"cli"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
```

List exposed tools (runtime `memory_write` / `memory_search` only):

```sh
curl -X POST http://localhost:4321/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Call runtime search through MCP — identity comes from the token, not the args:

```sh
curl -X POST http://localhost:4321/mcp \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":"search-1","method":"tools/call","params":{"name":"memory_search","arguments":{"query":"shared"}}}'
```

## Library usage

`RbacMemory` accepts an injectable `PermissionStore`. Use `SqlitePermissionStore`
for persistence, or omit it (and pass `permissions`) for an in-memory store.

```ts
import { Database } from "bun:sqlite"
import {
  FsMemoryStore,
  RbacMemory,
  SqlitePermissionStore,
} from "@runbear/rbac-memory"

const db = new Database(".data/my-rbac-memory/rbac.sqlite")
const permissionStore = new SqlitePermissionStore(db)
permissionStore.upsert({
  roleId: "role-a",
  readableScopes: ["customer/acme/common", "customer/acme/team/a"],
  writableScopes: ["customer/acme/team/a"],
})

const memory = new RbacMemory({
  store: new FsMemoryStore({ rootDir: ".data/my-rbac-memory" }),
  permissionStore,
})

await memory.memoryWrite({
  caller: {
    principalId: "agent-role-a",
    roleIds: ["role-a"],
    capabilities: ["runtime"],
  },
  record: {
    id: "a-note",
    scope: "customer/acme/team/a",
    content: "alpha launch note",
    organizationIds: ["customer/acme"],
    tags: ["launch", "alpha"],
    metadata: { department: "engineering" },
  },
})
```

## Verification

```sh
bun run --cwd bounded-contexts/rbac-memory type-check
bun run --cwd bounded-contexts/rbac-memory test
bun run --cwd apps/rbac-memory-demo type-check
bun run --cwd apps/rbac-memory-demo test
bun run lint
```
