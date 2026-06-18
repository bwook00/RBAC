export function renderDashboard(): string {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <!-- Compatibility labels: Organization permissions, Impersonation playground, Mem0 adapter mode, Admin audit explain, Adapter status -->
    <title>RBAC Memory 관리 콘솔</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f4f7fb;
        color: #172033;
      }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: linear-gradient(135deg, #eef4ff 0%, #f8fafc 52%, #edf7f4 100%); }
      .app { display: grid; grid-template-columns: 280px 1fr; min-height: 100vh; }
      aside { padding: 28px 22px; background: rgba(15, 23, 42, 0.96); color: white; position: sticky; top: 0; height: 100vh; }
      .brand { display: grid; gap: 10px; margin-bottom: 28px; }
      .brand-mark { width: 46px; height: 46px; border-radius: 16px; display: grid; place-items: center; background: linear-gradient(135deg, #8b5cf6, #06b6d4); font-weight: 900; }
      .brand h1 { margin: 0; font-size: 21px; letter-spacing: -0.03em; }
      .brand p { margin: 0; color: #aab6cc; line-height: 1.5; font-size: 13px; }
      nav { display: grid; gap: 8px; }
      .nav-item { border: 0; width: 100%; text-align: left; padding: 12px 14px; border-radius: 14px; color: #dbeafe; background: transparent; cursor: pointer; font: inherit; font-weight: 800; }
      .nav-item.active { background: #ffffff; color: #172033; box-shadow: 0 12px 28px rgba(0,0,0,.2); }
      main { padding: 32px; display: grid; gap: 22px; }
      .topbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
      .eyebrow { margin: 0 0 6px; color: #64748b; font-weight: 900; text-transform: uppercase; letter-spacing: .12em; font-size: 12px; }
      h2 { margin: 0; font-size: clamp(28px, 4vw, 42px); letter-spacing: -0.04em; }
      h3 { margin: 0 0 10px; font-size: 18px; letter-spacing: -0.02em; }
      p { margin: 0; }
      .muted { color: #64748b; line-height: 1.6; }
      .hero { padding: 28px; border-radius: 28px; background: linear-gradient(135deg, #ffffff, #edf4ff); border: 1px solid rgba(148, 163, 184, .28); box-shadow: 0 24px 70px rgba(37, 51, 78, .11); }
      .grid { display: grid; gap: 18px; }
      .cols { grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); }
      .card { padding: 22px; border-radius: 24px; background: rgba(255,255,255,.88); border: 1px solid rgba(148, 163, 184, .28); box-shadow: 0 16px 50px rgba(30, 41, 59, .08); backdrop-filter: blur(12px); }
      .metric { display: grid; gap: 8px; }
      .metric strong { font-size: 32px; letter-spacing: -0.05em; }
      .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; margin-top: 14px; }
      label { display: grid; gap: 7px; color: #475569; font-size: 13px; font-weight: 900; }
      input, select, textarea { width: 100%; border: 1px solid #ccd6e5; border-radius: 14px; padding: 12px 13px; background: #fff; color: #172033; font: inherit; outline-color: #6366f1; }
      textarea { min-height: 110px; resize: vertical; }
      button { border: 0; border-radius: 14px; padding: 12px 15px; background: #172033; color: white; font: inherit; font-weight: 900; cursor: pointer; transition: transform .12s ease, box-shadow .12s ease; }
      button:hover { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(23,32,51,.16); }
      button.secondary { background: #eef2ff; color: #3730a3; }
      button.success { background: #dcfce7; color: #166534; }
      button.danger { background: #fee2e2; color: #991b1b; }
      .section { display: none; }
      .section.active { display: grid; gap: 18px; }
      .pill-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
      .pill { border-radius: 999px; padding: 7px 11px; background: #eff6ff; color: #1d4ed8; font-size: 12px; font-weight: 900; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 13px; border-bottom: 1px solid #edf2f7; text-align: left; vertical-align: top; }
      th { color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: .09em; }
      code, pre { font-family: "SFMono-Regular", Consolas, monospace; }
      pre { overflow: auto; padding: 18px; border-radius: 18px; background: #0f172a; color: #dbeafe; min-height: 180px; }
      .inline-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-top: 16px; }
      @media (max-width: 860px) { .app { grid-template-columns: 1fr; } aside { position: relative; height: auto; } }
    </style>
  </head>
  <body>
    <div class="app">
      <aside>
        <div class="brand">
          <div class="brand-mark">RB</div>
          <div>
            <h1>RBAC Memory</h1>
            <p>조직 범위 에이전트 메모리 거버넌스를 위한 오픈소스 관리 콘솔입니다.</p>
          </div>
        </div>
        <nav aria-label="관리 섹션">
          <button class="nav-item active" data-tab="overview" type="button">개요</button>
          <button class="nav-item" data-tab="organizations" type="button">조직</button>
          <button class="nav-item" data-tab="users" type="button">사용자</button>
          <button class="nav-item" data-tab="permissions" type="button">역할 및 권한</button>
          <button class="nav-item" data-tab="memory" type="button">메모리</button>
          <button class="nav-item" data-tab="playground" type="button">접근 테스트</button>
          <button class="nav-item" data-tab="audit" type="button">감사</button>
        </nav>
      </aside>
      <main>
        <section class="hero">
          <p class="eyebrow">관리 대시보드</p>
          <h2>에이전트 컨텍스트에 들어갈 수 있는 메모리를 통제합니다.</h2>
          <p class="muted">조직과 사용자를 등록하고, 계층형 스코프에 역할을 연결하며, 메모리 레코드를 관리하고, 사용자 관점에서 접근 결과를 검증합니다. 대시보드, HTTP, MCP 호출은 모두 동일한 RBAC enforcement 경로를 사용합니다.</p>
          <div class="pill-row">
            <span class="pill">다중 조직 테넌트</span>
            <span class="pill">고급 필터 검색</span>
            <span class="pill">FS + Mem0 백엔드</span>
          </div>
        </section>

        <section id="section-overview" class="section active">
          <div class="grid cols">
            <article class="card metric"><span class="muted">조직</span><strong id="metric-orgs">—</strong><span class="muted">독립 스코프를 가진 테넌트 루트입니다.</span></article>
            <article class="card metric"><span class="muted">사용자</span><strong id="metric-users">—</strong><span class="muted">역할과 조직에 매핑된 사용자/서비스 주체입니다.</span></article>
            <article class="card metric"><span class="muted">활성 백엔드</span><strong id="metric-backend">—</strong><span class="muted">기본은 로컬 FS, 설정 시 Mem0를 사용합니다.</span></article>
          </div>
          <article class="card">
            <h3>백엔드 제어</h3>
            <p class="muted">로컬 FS는 설정된 데이터 루트 아래 JSON을 저장합니다. Mem0 모드는 호스팅 Mem0 REST API를 사용하고 각 메모리에 RBAC 메타데이터를 유지합니다.</p>
            <div class="toolbar">
              <label>백엔드<select id="backend-select"><option value="fs">로컬 FS 저장소</option><option value="mem0">Mem0 호스팅 메모리</option></select></label>
              <button data-action="switch-backend" type="button">백엔드 전환</button>
              <button class="secondary" data-action="seed-reset" type="button">데모 데이터 초기화</button>
              <button class="secondary" data-action="adapter-status" type="button">상태 새로고침</button>
            </div>
          </article>
        </section>

        <section id="section-organizations" class="section">
          <article class="card">
            <h3>조직</h3>
            <p class="muted">테넌트 루트를 생성합니다. 메모리 레코드가 조직 ID를 보유하므로 하나의 저장소로 여러 회사를 안전하게 지원할 수 있습니다.</p>
            <div class="inline-form">
              <label>조직 ID<input id="org-id" value="customer/initech" /></label>
              <label>이름<input id="org-name" value="Initech" /></label>
              <label>도메인<input id="org-domain" value="initech.example" /></label>
            </div>
            <div class="toolbar"><button data-action="save-organization" type="button">조직 저장</button><button class="secondary" data-action="list-organizations" type="button">새로고침</button></div>
            <div id="organizations-table" style="margin-top:16px"></div>
          </article>
        </section>

        <section id="section-users" class="section">
          <article class="card">
            <h3>사용자</h3>
            <p class="muted">사용자와 서비스 주체를 등록한 뒤 조직, 역할, capability를 할당합니다.</p>
            <div class="inline-form">
              <label>사용자 ID<input id="user-id" value="agent-initech-support" /></label>
              <label>표시 이름<input id="user-name" value="Initech Support Agent" /></label>
              <label>이메일<input id="user-email" value="support-agent@initech.example" /></label>
              <label>조직<input id="user-orgs" value="customer/initech" /></label>
              <label>역할<input id="user-roles" value="initech-support" /></label>
              <label>Capability<input id="user-capabilities" value="runtime" /></label>
            </div>
            <div class="toolbar"><button data-action="save-user" type="button">사용자 저장</button><button class="danger" data-action="delete-user" type="button">사용자 삭제</button><button class="secondary" data-action="list-users" type="button">새로고침</button></div>
            <div id="users-table" style="margin-top:16px"></div>
          </article>
        </section>

        <section id="section-permissions" class="section">
          <article class="card">
            <h3>역할 및 권한</h3>
            <p class="muted">읽기/쓰기 가능 스코프를 부여합니다. Prefix 스코프는 형제 테넌트를 노출하지 않으면서 하위 팀을 포함할 수 있습니다.</p>
            <div class="inline-form">
              <label>역할 ID<input id="permission-role" value="initech-support" /></label>
              <label>읽기 가능 스코프<input id="permission-readable" value="customer/initech/common" /></label>
              <label>쓰기 가능 스코프<input id="permission-writable" value="customer/initech/common" /></label>
            </div>
            <div class="toolbar"><button data-action="save-permission" type="button">역할 저장</button><button class="danger" data-action="delete-permission" type="button">역할 삭제</button><button class="secondary" data-action="list-permissions" type="button">새로고침</button></div>
            <div id="permissions-table" style="margin-top:16px"></div>
          </article>
        </section>

        <section id="section-memory" class="section">
          <div class="grid cols">
            <article class="card">
              <h3>메모리 쓰기</h3>
              <label>실행 주체<select id="write-principal"></select></label>
              <label>메모리 ID<input id="write-id" value="initech-note" /></label>
              <label>스코프<input id="write-scope" value="customer/initech/common" /></label>
              <label>조직<input id="write-orgs" value="customer/initech" /></label>
              <label>태그<input id="write-tags" value="support,shared" /></label>
              <label>메타데이터 key=value<input id="write-metadata" value="department=support,sensitivity=internal" /></label>
              <label>내용<textarea id="write-content">Initech 공용 문제 해결 정책 메모리입니다.</textarea></label>
              <div class="toolbar"><button data-action="write-memory" type="button">메모리 저장</button></div>
            </article>
            <article class="card">
              <h3>고급 검색</h3>
              <label>실행 주체<select id="search-principal"></select></label>
              <label>검색어<input id="search-query" value="memory policy" /></label>
              <label>검색 모드<select id="search-mode"><option value="semantic">벡터/시맨틱</option><option value="contains">구문 포함</option><option value="all">모든 단어</option><option value="any">일부 단어</option><option value="exact">정확히 일치</option></select></label>
              <label>조직<input id="search-orgs" value="customer/acme" /></label>
              <label>태그<input id="search-tags" value="" /></label>
              <label>메타데이터 key=value<input id="search-metadata" value="" /></label>
              <label>제한 개수<input id="search-limit" value="10" /></label>
              <div class="toolbar"><button data-action="runtime-search" type="button">메모리 검색</button></div>
            </article>
          </div>
        </section>

        <section id="section-playground" class="section">
          <article class="card">
            <h3>접근 테스트</h3>
            <p class="muted">에이전트를 연결하기 전에 등록된 사용자로 전환하여 어떤 테넌트 메모리가 포함되는지 정확히 확인합니다.</p>
            <div class="inline-form">
              <label>실행 주체<select id="playground-principal"></select></label>
              <label>검색어<input id="playground-query" value="runbook handbook launch renewal" /></label>
              <label>조직 필터<input id="playground-orgs" value="customer/acme" /></label>
            </div>
            <div class="toolbar"><button data-action="playground-search" type="button">가시성 검사 실행</button><button class="danger" data-action="denied-write" type="button">쓰기 거부 재현</button></div>
          </article>
        </section>

        <section id="section-audit" class="section">
          <article class="card">
            <h3>감사 설명</h3>
            <p class="muted">관리자는 포함/제외된 레코드를 확인할 수 있습니다. 런타임 응답에는 마스킹된 설명만 전달됩니다.</p>
            <div class="inline-form">
              <label>검색어<input id="audit-query" value="memory" /></label>
              <label>조직 필터<input id="audit-orgs" value="customer/acme,customer/globex" /></label>
              <label>태그<input id="audit-tags" value="" /></label>
            </div>
            <div class="toolbar"><button data-action="admin-audit-explain" type="button">감사 설명 실행</button></div>
          </article>
        </section>

        <section class="card" aria-labelledby="output-heading">
          <h3 id="output-heading">작업 결과</h3>
          <pre id="output" aria-live="polite">관리 콘솔을 불러오는 중…</pre>
        </section>
      </main>
    </div>

    <script type="module">
      const output = document.querySelector("#output")
      const backendSelect = document.querySelector("#backend-select")

      function value(id) { return document.querySelector(id).value }
      function csv(value) { return value.split(",").map((item) => item.trim()).filter(Boolean) }
      function metadata(value) {
        const entries = csv(value).map((item) => item.split("="))
        return Object.fromEntries(entries.filter(([key, val]) => key && val).map(([key, val]) => [key.trim(), val.trim()]))
      }
      function numberValue(id) {
        const parsed = Number(value(id))
        return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
      }
      async function postJson(path, body) {
        const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        return response.json()
      }
      async function putJson(path, body) {
        const response = await fetch(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        return response.json()
      }
      async function getJson(path) { return (await fetch(path)).json() }
      async function deleteJson(path) { return (await fetch(path, { method: "DELETE" })).json() }
      function show(label, response) { output.textContent = label + "\\n" + JSON.stringify(response, null, 2) }
      function table(rows, columns) {
        return '<table><thead><tr>' + columns.map((column) => '<th>' + column.label + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map((row) => '<tr>' + columns.map((column) => '<td>' + column.render(row) + '</td>').join('') + '</tr>').join('') + '</tbody></table>'
      }
      function options(users) {
        return users.map((user) => '<option value="' + user.id + '">' + user.displayName + ' · ' + user.id + '</option>').join('')
      }
      async function refreshOrganizations() {
        const organizations = await getJson("/admin/organizations")
        document.querySelector("#metric-orgs").textContent = String(organizations.length)
        document.querySelector("#organizations-table").innerHTML = table(organizations, [
          { label: "조직", render: (row) => '<strong>' + row.name + '</strong><br><span class="muted">' + row.id + '</span>' },
          { label: "도메인", render: (row) => row.domain },
        ])
        return organizations
      }
      async function refreshUsers() {
        const users = await getJson("/admin/users")
        document.querySelector("#metric-users").textContent = String(users.length)
        document.querySelector("#users-table").innerHTML = table(users, [
          { label: "사용자", render: (row) => '<strong>' + row.displayName + '</strong><br><span class="muted">' + row.id + '</span>' },
          { label: "조직", render: (row) => row.organizationIds.join('<br>') },
          { label: "역할", render: (row) => row.roleIds.join('<br>') },
          { label: "Capability", render: (row) => row.capabilities.join(', ') },
        ])
        document.querySelector("#write-principal").innerHTML = options(users)
        document.querySelector("#search-principal").innerHTML = options(users)
        document.querySelector("#playground-principal").innerHTML = options(users)
        return users
      }
      async function refreshPermissions() {
        const permissions = await getJson("/admin/permissions")
        document.querySelector("#permissions-table").innerHTML = table(permissions, [
          { label: "역할", render: (row) => '<strong>' + row.roleId + '</strong>' },
          { label: "읽기", render: (row) => row.readableScopes.join('<br>') },
          { label: "쓰기", render: (row) => row.writableScopes.join('<br>') },
        ])
        return permissions
      }
      async function refreshBackend() {
        const status = await getJson("/admin/adapter-contract-status")
        document.querySelector("#metric-backend").textContent = status.activeBackend
        backendSelect.value = status.activeBackend
        return status
      }
      async function refreshAll() {
        const [organizations, users, permissions, backend] = await Promise.all([refreshOrganizations(), refreshUsers(), refreshPermissions(), refreshBackend()])
        show("콘솔 로드 완료", { organizations, users, permissions, backend })
      }
      const actions = {
        "switch-backend": async () => show("백엔드", await postJson("/admin/backend", { backendId: backendSelect.value })),
        "seed-reset": async () => { show("데모 데이터", await postJson("/admin/seed", {})); await refreshAll() },
        "adapter-status": async () => show("어댑터 상태", await refreshBackend()),
        "list-organizations": async () => show("조직", await refreshOrganizations()),
        "save-organization": async () => { show("조직 저장됨", await putJson("/admin/organizations", { id: value("#org-id"), name: value("#org-name"), domain: value("#org-domain") })); await refreshOrganizations() },
        "list-users": async () => show("사용자", await refreshUsers()),
        "save-user": async () => { show("사용자 저장됨", await putJson("/admin/users", { id: value("#user-id"), displayName: value("#user-name"), email: value("#user-email"), organizationIds: csv(value("#user-orgs")), roleIds: csv(value("#user-roles")), capabilities: csv(value("#user-capabilities")) })); await refreshUsers() },
        "delete-user": async () => { show("사용자 삭제됨", await deleteJson("/admin/users?userId=" + encodeURIComponent(value("#user-id")))); await refreshUsers() },
        "list-permissions": async () => show("권한", await refreshPermissions()),
        "save-permission": async () => { show("역할 저장됨", await putJson("/admin/permissions", { roleId: value("#permission-role"), readableScopes: csv(value("#permission-readable")), writableScopes: csv(value("#permission-writable")) })); await refreshPermissions() },
        "delete-permission": async () => { show("역할 삭제됨", await deleteJson("/admin/permissions?roleId=" + encodeURIComponent(value("#permission-role")))); await refreshPermissions() },
        "write-memory": async () => show("메모리 쓰기", await postJson("/runtime/memory/write", { principalId: value("#write-principal"), record: { id: value("#write-id"), scope: value("#write-scope"), organizationIds: csv(value("#write-orgs")), tags: csv(value("#write-tags")), metadata: metadata(value("#write-metadata")), content: value("#write-content") } })),
        "runtime-search": async () => show("런타임 검색", await postJson("/runtime/memory/search", { principalId: value("#search-principal"), query: value("#search-query"), mode: value("#search-mode"), organizationIds: csv(value("#search-orgs")), tags: csv(value("#search-tags")), metadata: metadata(value("#search-metadata")), limit: numberValue("#search-limit") })),
        "playground-search": async () => show("가시성 검사", await postJson("/runtime/memory/search", { principalId: value("#playground-principal"), query: value("#playground-query"), mode: "any", organizationIds: csv(value("#playground-orgs")) })),
        "denied-write": async () => show("쓰기 거부", await postJson("/runtime/memory/write", { principalId: value("#playground-principal"), record: { id: "denied-cross-tenant", scope: "customer/globex/team/ops", organizationIds: ["customer/globex"], content: "cross tenant protected memory" } })),
        "admin-audit-explain": async () => show("관리자 감사 설명", await postJson("/admin/audit-explain", { query: value("#audit-query"), organizationIds: csv(value("#audit-orgs")), tags: csv(value("#audit-tags")), mode: "any" })),
      }
      document.addEventListener("click", (event) => {
        if (!(event.target instanceof HTMLElement)) return
        const tab = event.target.dataset.tab
        if (tab !== undefined) {
          document.querySelectorAll(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.tab === tab))
          document.querySelectorAll(".section").forEach((node) => node.classList.toggle("active", node.id === "section-" + tab))
          return
        }
        const action = event.target.dataset.action
        if (action === undefined || actions[action] === undefined) return
        void actions[action]().catch((error) => show("오류", { message: String(error) }))
      })
      void refreshAll()
    </script>
  </body>
</html>`
}
