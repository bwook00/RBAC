export function renderDashboard(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RBAC Memory Console</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #172033; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: linear-gradient(135deg, #eef4ff 0%, #f8fafc 52%, #edf7f4 100%); }
      .app { display: grid; grid-template-columns: 260px 1fr; min-height: 100vh; }
      aside { padding: 26px 20px; background: rgba(15, 23, 42, 0.96); color: #fff; position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; }
      .brand { display: flex; gap: 12px; align-items: center; margin-bottom: 26px; }
      .brand-mark { width: 42px; height: 42px; border-radius: 14px; display: grid; place-items: center; background: linear-gradient(135deg, #8b5cf6, #06b6d4); font-weight: 900; }
      .brand h1 { margin: 0; font-size: 18px; letter-spacing: -0.02em; }
      nav { display: grid; gap: 6px; }
      .nav-item { border: 0; width: 100%; text-align: left; padding: 11px 13px; border-radius: 12px; color: #dbeafe; background: transparent; cursor: pointer; font: inherit; font-weight: 700; }
      .nav-item.active { background: #fff; color: #172033; }
      .nav-item.hidden { display: none; }
      .me { margin-top: auto; padding-top: 18px; border-top: 1px solid rgba(255,255,255,.12); font-size: 13px; color: #aab6cc; line-height: 1.5; }
      .me strong { color: #fff; display: block; }
      .me button { margin-top: 10px; width: 100%; border: 0; border-radius: 10px; padding: 9px; background: rgba(255,255,255,.12); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
      main { padding: 32px; display: grid; gap: 20px; align-content: start; }
      h2 { margin: 0; font-size: 26px; letter-spacing: -0.03em; }
      h3 { margin: 0 0 8px; font-size: 17px; }
      p.muted { margin: 0; color: #64748b; line-height: 1.6; font-size: 14px; }
      .card { padding: 22px; border-radius: 20px; background: rgba(255,255,255,.92); border: 1px solid rgba(148,163,184,.28); box-shadow: 0 14px 44px rgba(30,41,59,.07); }
      .section { display: none; gap: 18px; }
      .section.active { display: grid; }
      label { display: grid; gap: 6px; color: #475569; font-size: 13px; font-weight: 700; }
      input, select { width: 100%; border: 1px solid #ccd6e5; border-radius: 11px; padding: 10px 12px; background: #fff; font: inherit; }
      select[multiple] { min-height: 92px; }
      .inline-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top: 14px; }
      .toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
      button.act { border: 0; border-radius: 11px; padding: 10px 14px; background: #172033; color: #fff; font: inherit; font-weight: 800; cursor: pointer; }
      button.secondary { background: #eef2ff; color: #3730a3; }
      button.danger { background: #fee2e2; color: #991b1b; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { padding: 12px; border-bottom: 1px solid #edf2f7; text-align: left; vertical-align: top; font-size: 14px; }
      th { color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
      .pill { display: inline-block; border-radius: 999px; padding: 3px 9px; background: #eff6ff; color: #1d4ed8; font-size: 12px; font-weight: 700; margin: 2px 2px 0 0; }
      .token-reveal { margin-top: 14px; padding: 14px; border-radius: 12px; background: #0f172a; color: #dbeafe; word-break: break-all; display: none; }
      .token-reveal.show { display: block; }
      .token-reveal code { font-family: "SFMono-Regular", Consolas, monospace; }
      .banner { display: none; padding: 12px 14px; border-radius: 12px; font-size: 14px; }
      .banner.show { display: block; }
      .banner.error { background: #fee2e2; color: #991b1b; }
      .banner.ok { background: #dcfce7; color: #166534; }
      @media (max-width: 820px) { .app { grid-template-columns: 1fr; } aside { position: relative; height: auto; } }
    </style>
  </head>
  <body>
    <div class="app">
      <aside>
        <div class="brand">
          <div class="brand-mark">RB</div>
          <h1>RBAC Memory</h1>
        </div>
        <nav>
          <button class="nav-item active" data-tab="organizations" type="button">Organizations</button>
          <button class="nav-item" data-tab="members" type="button">Members</button>
          <button class="nav-item" data-tab="tokens" type="button">MCP Tokens</button>
        </nav>
        <div class="me" id="me">Loading…</div>
      </aside>
      <main>
        <div class="banner" id="banner"></div>

        <section id="section-organizations" class="section active">
          <div class="card">
            <h2>Organizations</h2>
            <p class="muted">Tenant roots that scope memory access. Create, update, or remove organizations.</p>
            <div class="inline-form">
              <label>Organization ID<input id="org-id" placeholder="customer/acme" /></label>
              <label>Name<input id="org-name" placeholder="Acme Corp" /></label>
              <label>Domain<input id="org-domain" placeholder="acme.example" /></label>
            </div>
            <div class="toolbar">
              <button class="act" data-action="save-organization" type="button">Save organization</button>
              <button class="act secondary" data-action="refresh-organizations" type="button">Refresh</button>
            </div>
            <div id="organizations-table"></div>
          </div>
        </section>

        <section id="section-members" class="section">
          <div class="card">
            <h2>Members</h2>
            <p class="muted">Manage users and map them to organizations, roles, and capabilities.</p>
            <div class="inline-form">
              <label>User ID<input id="user-id" placeholder="user@acme.example" /></label>
              <label>Display name<input id="user-name" placeholder="Jane Doe" /></label>
              <label>Email<input id="user-email" placeholder="user@acme.example" /></label>
              <label>Organizations<select id="user-orgs" multiple></select></label>
              <label>Roles (comma-separated)<input id="user-roles" placeholder="acme-eng" /></label>
              <label>Capabilities<select id="user-capabilities" multiple><option value="runtime" selected>runtime</option><option value="management">management</option></select></label>
            </div>
            <div class="toolbar">
              <button class="act" data-action="save-user" type="button">Save member</button>
              <button class="act danger" data-action="delete-user" type="button">Delete member</button>
              <button class="act secondary" data-action="refresh-users" type="button">Refresh</button>
            </div>
            <div id="users-table"></div>
          </div>
        </section>

        <section id="section-tokens" class="section">
          <div class="card">
            <h2>MCP Tokens</h2>
            <p class="muted">Issue bearer tokens for MCP clients. Each token carries your identity and scope. The plaintext token is shown only once.</p>
            <div class="inline-form">
              <label>Label<input id="token-label" placeholder="my-laptop" /></label>
            </div>
            <div class="toolbar">
              <button class="act" data-action="issue-token" type="button">Issue token</button>
              <button class="act secondary" data-action="refresh-tokens" type="button">Refresh</button>
            </div>
            <div class="token-reveal" id="token-reveal"></div>
            <div id="tokens-table"></div>
          </div>
        </section>
      </main>
    </div>

    <script type="module">
      let me = null
      const banner = document.querySelector("#banner")
      function notify(message, kind) {
        banner.textContent = message
        banner.className = "banner show " + (kind || "ok")
        setTimeout(() => { banner.className = "banner" }, 4000)
      }
      function val(id) { return document.querySelector(id).value.trim() }
      function csv(value) { return value.split(",").map((item) => item.trim()).filter(Boolean) }
      function multiVal(id) { return Array.from(document.querySelector(id).selectedOptions).map((option) => option.value).filter(Boolean) }
      function asArray(value) { return Array.isArray(value) ? value : [] }
      async function getJson(path) { return (await fetch(path)).json() }
      async function send(method, path, body) {
        const init = { method }
        if (body !== undefined) { init.headers = { "content-type": "application/json" }; init.body = JSON.stringify(body) }
        const response = await fetch(path, init)
        const data = await response.json().catch(() => ({}))
        if (!response.ok) { throw new Error(data.error || ("HTTP " + response.status)) }
        return data
      }
      function esc(value) { return String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])) }
      function table(rows, columns) {
        if (rows.length === 0) { return '<p class="muted" style="margin-top:16px">No records yet.</p>' }
        return '<table><thead><tr>' + columns.map((c) => '<th>' + c.label + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map((row) => '<tr>' + columns.map((c) => '<td>' + c.render(row) + '</td>').join('') + '</tr>').join('') + '</tbody></table>'
      }
      function pills(items) { return asArray(items).map((item) => '<span class="pill">' + esc(item) + '</span>').join('') || '<span class="muted">—</span>' }

      async function refreshAuth() {
        const response = await fetch("/auth/me")
        if (response.status === 401) { window.location.href = "/auth/login"; return false }
        me = await response.json()
        const admin = me.capabilities.includes("management")
        document.querySelector("#me").innerHTML =
          '<strong>' + esc(me.principalId) + '</strong>' +
          'roles: ' + (me.roleIds.join(', ') || '—') + '<br>' +
          (admin ? 'admin' : 'member') +
          '<button id="logout" type="button">Sign out</button>'
        document.querySelector("#logout").addEventListener("click", async () => {
          await fetch("/auth/logout", { method: "POST" }); window.location.href = "/auth/login"
        })
        // Members + Organizations are admin-only; hide for regular members.
        for (const tab of ["organizations", "members"]) {
          document.querySelector('[data-tab="' + tab + '"]').classList.toggle("hidden", !admin)
        }
        if (!admin) { activate("tokens") }
        return true
      }

      async function refreshOrganizations() {
        const orgs = asArray(await getJson("/admin/organizations"))
        document.querySelector("#organizations-table").innerHTML = table(orgs, [
          { label: "Name", render: (r) => '<strong>' + esc(r.name) + '</strong><br><span class="muted">' + esc(r.id) + '</span>' },
          { label: "Domain", render: (r) => esc(r.domain) },
          { label: "", render: (r) => '<button class="act danger" data-del-org="' + esc(r.id) + '" type="button">Delete</button>' },
        ])
        const select = document.querySelector("#user-orgs")
        select.innerHTML = orgs.map((o) => '<option value="' + esc(o.id) + '">' + esc(o.name) + ' (' + esc(o.id) + ')</option>').join('')
        return orgs
      }
      async function refreshUsers() {
        const users = asArray(await getJson("/admin/users"))
        document.querySelector("#users-table").innerHTML = table(users, [
          { label: "Member", render: (r) => '<strong>' + esc(r.displayName) + '</strong><br><span class="muted">' + esc(r.email) + '</span>' },
          { label: "Organizations", render: (r) => pills(r.organizationIds) },
          { label: "Roles", render: (r) => pills(r.roleIds) },
          { label: "Capabilities", render: (r) => pills(r.capabilities) },
          { label: "", render: (r) => '<button class="act danger" data-del-user="' + esc(r.id) + '" type="button">Delete</button>' },
        ])
        return users
      }
      async function refreshTokens() {
        const tokens = asArray(await getJson("/tokens"))
        document.querySelector("#tokens-table").innerHTML = table(tokens, [
          { label: "Label", render: (r) => '<strong>' + esc(r.label) + '</strong>' },
          { label: "Owner", render: (r) => esc(r.principalId) },
          { label: "Last used", render: (r) => r.lastUsedAt ? new Date(r.lastUsedAt).toLocaleString() : 'never' },
          { label: "", render: (r) => '<button class="act danger" data-del-token="' + esc(r.tokenHash) + '" type="button">Revoke</button>' },
        ])
        return tokens
      }

      const actions = {
        "save-organization": async () => {
          if (!val("#org-id")) { return notify("Organization ID is required", "error") }
          await send("PUT", "/admin/organizations", { id: val("#org-id"), name: val("#org-name"), domain: val("#org-domain") })
          notify("Organization saved"); await refreshOrganizations()
        },
        "refresh-organizations": refreshOrganizations,
        "save-user": async () => {
          if (!val("#user-id")) { return notify("User ID is required", "error") }
          await send("PUT", "/admin/users", {
            id: val("#user-id"), displayName: val("#user-name"), email: val("#user-email"),
            organizationIds: multiVal("#user-orgs"), roleIds: csv(val("#user-roles")), capabilities: multiVal("#user-capabilities"),
          })
          notify("Member saved"); await refreshUsers()
        },
        "delete-user": async () => {
          if (!val("#user-id")) { return notify("User ID is required", "error") }
          await send("DELETE", "/admin/users?userId=" + encodeURIComponent(val("#user-id")))
          notify("Member deleted"); await refreshUsers()
        },
        "refresh-users": refreshUsers,
        "issue-token": async () => {
          const issued = await send("POST", "/tokens", { label: val("#token-label") })
          const reveal = document.querySelector("#token-reveal")
          reveal.innerHTML = 'Copy this token now — it will not be shown again:<br><code>' + esc(issued.token) + '</code>'
          reveal.className = "token-reveal show"
          notify("Token issued"); await refreshTokens()
        },
        "refresh-tokens": refreshTokens,
      }

      function activate(tab) {
        document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.tab === tab))
        document.querySelectorAll(".section").forEach((s) => s.classList.toggle("active", s.id === "section-" + tab))
      }

      document.addEventListener("click", (event) => {
        const el = event.target
        if (!(el instanceof HTMLElement)) return
        if (el.dataset.tab) { activate(el.dataset.tab); return }
        const run = (fn) => fn().catch((error) => notify(String(error.message || error), "error"))
        if (el.dataset.delOrg) { run(async () => { await send("DELETE", "/admin/organizations?id=" + encodeURIComponent(el.dataset.delOrg)); notify("Organization deleted"); await refreshOrganizations() }); return }
        if (el.dataset.delUser) { run(async () => { await send("DELETE", "/admin/users?userId=" + encodeURIComponent(el.dataset.delUser)); notify("Member deleted"); await refreshUsers() }); return }
        if (el.dataset.delToken) { run(async () => { await send("DELETE", "/tokens?tokenHash=" + encodeURIComponent(el.dataset.delToken)); notify("Token revoked"); await refreshTokens() }); return }
        const action = el.dataset.action
        if (action && actions[action]) { run(actions[action]) }
      })

      async function boot() {
        if (!(await refreshAuth())) return
        await refreshTokens()
        if (me.capabilities.includes("management")) {
          await refreshOrganizations()
          await refreshUsers()
        }
      }
      void boot()
    </script>
  </body>
</html>`
}
