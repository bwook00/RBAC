# RBAC Memory Admin Console

Local product/admin surface for the `@runbear/rbac-memory` bounded context.

## Run

```sh
bun install
bun run --cwd bun-apps/apps/rbac-memory-demo start
```

The server listens on `http://localhost:4321`.

## Storage modes

- **Local FS store**: default persistent JSON-file backend. Set `RBAC_MEMORY_FS_ROOT` to change the storage directory. The default is `.data/rbac-memory-demo` under the app working directory.
- **Mem0 hosted memory**: real Mem0 REST API adapter. Set `MEM0_API_KEY` to enable it. Optional variables: `MEM0_USER_ID` and `MEM0_BASE_URL`.

```sh
MEM0_API_KEY=mem0_... \
MEM0_USER_ID=rbac-memory-demo \
bun run --cwd bun-apps/apps/rbac-memory-demo start
```

## Dashboard quickstart

Open `http://localhost:4321/dashboard`, then run these flows:

1. **Overview**: inspect the active backend, switch between Local FS and Mem0, seed fixture memories, and check adapter status.
2. **Organizations**: create and update tenant roots such as `customer/acme` and `customer/globex`.
3. **Users**: register users or service principals, assign them to organizations, and attach runtime/management capabilities.
4. **Roles & permissions**: list, create, update, or delete role-to-scope mappings for organization memory access.
5. **Memory**: write and search scoped memories with advanced filters for organization, tags, metadata, search mode, and result limit.
6. **Access playground**: impersonate a registered user with the same query to verify cross-organization isolation and denied writes.
7. **Audit explain**: run management-only explain to see included and excluded records for policy audits.

## HTTP API examples

Seed demo records:

```sh
curl -X POST http://localhost:4321/admin/seed
```

Search with runtime RBAC enforcement and advanced filters:

```sh
curl -X POST http://localhost:4321/runtime/memory/search \
  -H 'content-type: application/json' \
  -d '{"principalId":"agent-acme-eng","query":"handbook launch","mode":"any","organizationIds":["customer/acme"],"tags":["memory"],"limit":10}'
```

Write scoped memory:

```sh
curl -X POST http://localhost:4321/runtime/memory/write \
  -H 'content-type: application/json' \
  -d '{"roleId":"role-a","record":{"id":"a-note","scope":"customer/acme/team/a","content":"shared alpha note"}}'
```

Attempt a denied write:

```sh
curl -X POST http://localhost:4321/runtime/memory/write \
  -H 'content-type: application/json' \
  -d '{"roleId":"role-a","record":{"id":"bad-b","scope":"customer/acme/team/b","content":"forbidden beta write"}}'
```

Switch backend and inspect contract status:

```sh
curl -X POST http://localhost:4321/admin/backend \
  -H 'content-type: application/json' \
  -d '{"backendId":"fs"}'

curl http://localhost:4321/admin/adapter-contract-status
```

Switch to Mem0 when configured:

```sh
curl -X POST http://localhost:4321/admin/backend \
  -H 'content-type: application/json' \
  -d '{"backendId":"mem0"}'
```

Manage organizations and users:

```sh
curl http://localhost:4321/admin/organizations

curl -X PUT http://localhost:4321/admin/organizations \
  -H 'content-type: application/json' \
  -d '{"id":"customer/initech","name":"Initech","domain":"initech.example"}'

curl http://localhost:4321/admin/users

curl -X PUT http://localhost:4321/admin/users \
  -H 'content-type: application/json' \
  -d '{"id":"agent-initech-support","displayName":"Initech Support Agent","email":"support-agent@initech.example","organizationIds":["customer/initech"],"roleIds":["initech-support"],"capabilities":["runtime"]}'
```

Manage permissions:

```sh
curl http://localhost:4321/admin/permissions

curl -X PUT http://localhost:4321/admin/permissions \
  -H 'content-type: application/json' \
  -d '{"roleId":"role-c","readableScopes":["customer/acme/team/c"],"writableScopes":["customer/acme/team/c"]}'

curl -X DELETE 'http://localhost:4321/admin/permissions?roleId=role-c'
```

## MCP JSON-RPC examples

List exposed tools. The MCP surface intentionally exposes only runtime `memory_write` and `memory_search`.

```sh
curl -X POST http://localhost:4321/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Call runtime search through MCP:

```sh
curl -X POST http://localhost:4321/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":"search-1","method":"tools/call","params":{"name":"memory_search","arguments":{"roleId":"role-a","query":"shared"}}}'
```

## Library usage

```ts
import { FsMemoryStore, RbacMemory } from "@runbear/rbac-memory"

const memory = new RbacMemory({
  store: new FsMemoryStore({ rootDir: ".data/my-rbac-memory" }),
  permissions: [
    {
      roleId: "role-a",
      readableScopes: ["customer/acme/common", "customer/acme/team/a"],
      writableScopes: ["customer/acme/team/a"],
    },
  ],
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

Mem0 adapter usage:

```ts
import {
  ExternalMemoryStore,
  Mem0MemoryClient,
  RbacMemory,
} from "@runbear/rbac-memory"

const memory = new RbacMemory({
  store: new ExternalMemoryStore({
    id: "mem0",
    client: new Mem0MemoryClient({
      apiKey: "<mem0-api-key>",
      userId: "acme",
    }),
  }),
})
```

## Verification

```sh
bun run --cwd bun-apps/bounded-contexts/rbac-memory type-check
bun run --cwd bun-apps/bounded-contexts/rbac-memory test
bun run --cwd bun-apps/apps/rbac-memory-demo type-check
bun run --cwd bun-apps/apps/rbac-memory-demo test
bun run --cwd bun-apps lint apps/rbac-memory-demo bounded-contexts/rbac-memory
```
