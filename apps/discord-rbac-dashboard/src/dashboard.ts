import type { DiscordConfig } from "./config.js"

/** Renders the single-page Discord-themed team management console. */
export function renderDashboard(config: DiscordConfig): string {
  const guildLabel = config.guildId ?? "not set"
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Discord Access Control</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "gg sans", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        --bg: #313338;
        --bg-2: #2b2d31;
        --bg-3: #1e1f22;
        --card: #383a40;
        --card-2: #404249;
        --blurple: #5865f2;
        --blurple-hover: #4752c4;
        --text: #f2f3f5;
        --muted: #b5bac1;
        --faint: #949ba4;
        --green: #23a55a;
        --danger: #da373c;
        --line: rgba(255,255,255,.07);
      }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); }
      a { color: var(--blurple); }
      .topbar { display: flex; align-items: center; gap: 14px; padding: 18px 26px; background: var(--bg-2); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 5; }
      .mark { width: 42px; height: 42px; border-radius: 14px; background: var(--blurple); display: grid; place-items: center; box-shadow: 0 8px 22px rgba(88,101,242,.4); }
      .mark svg { width: 24px; height: 24px; fill: #fff; }
      .titles h1 { margin: 0; font-size: 18px; letter-spacing: -0.01em; }
      .titles p { margin: 2px 0 0; font-size: 13px; color: var(--faint); }
      .chip { margin-left: auto; font-size: 12px; font-weight: 700; color: var(--muted); background: var(--bg-3); border: 1px solid var(--line); padding: 7px 12px; border-radius: 999px; }
      .chip b { color: var(--text); font-family: "SFMono-Regular", Consolas, monospace; }
      .banner { margin: 16px 26px 0; padding: 14px 16px; border-radius: 12px; background: rgba(218,55,60,.12); border: 1px solid rgba(218,55,60,.4); color: #f5b5b7; font-size: 13.5px; line-height: 1.55; display: none; }
      .banner.show { display: block; }
      .banner code { background: rgba(0,0,0,.35); padding: 2px 6px; border-radius: 6px; color: #fff; }
      .wrap { display: grid; grid-template-columns: 300px 1fr; gap: 18px; padding: 18px 26px 40px; align-items: start; }
      .panel { background: var(--card); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
      .panel-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--line); }
      .panel-head h2 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--faint); }
      .panel-body { padding: 10px; }
      button { border: 0; border-radius: 10px; padding: 9px 13px; background: var(--blurple); color: #fff; font: inherit; font-weight: 700; cursor: pointer; transition: background .12s ease, transform .12s ease; }
      button:hover { background: var(--blurple-hover); }
      button.ghost { background: transparent; color: var(--muted); padding: 6px; }
      button.ghost:hover { background: var(--card-2); color: var(--text); }
      button.icon { width: 30px; height: 30px; display: grid; place-items: center; padding: 0; }
      button.danger { background: transparent; color: var(--faint); }
      button.danger:hover { background: rgba(218,55,60,.16); color: #f5b5b7; }
      input { width: 100%; background: var(--bg-3); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; color: var(--text); font: inherit; outline: none; }
      input:focus { border-color: var(--blurple); }
      .team-row { display: flex; align-items: center; gap: 6px; padding: 4px 6px 4px 10px; border-radius: 10px; cursor: pointer; }
      .team-row:hover { background: var(--card-2); }
      .team-row.active { background: var(--blurple); }
      .team-row.active .count, .team-row.active .name { color: #fff; }
      .team-row .name { flex: 1; font-weight: 600; font-size: 14px; }
      .team-row .count { font-size: 12px; color: var(--faint); }
      .team-actions { display: none; gap: 2px; }
      .team-row:hover .team-actions { display: flex; }
      .empty { color: var(--faint); font-size: 13px; text-align: center; padding: 26px 12px; }
      .member-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .member-head h3 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
      .member-head .sub { color: var(--faint); font-size: 13px; margin-top: 2px; }
      .member-list { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
      .member { display: flex; align-items: center; gap: 12px; padding: 9px 12px; background: var(--bg-3); border: 1px solid var(--line); border-radius: 12px; }
      .avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--blurple); display: grid; place-items: center; font-weight: 800; font-size: 14px; color: #fff; overflow: hidden; flex: 0 0 auto; }
      .avatar img { width: 100%; height: 100%; object-fit: cover; }
      .member .who { min-width: 0; flex: 1; }
      .member .dn { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .member .id { font-size: 12px; color: var(--faint); font-family: "SFMono-Regular", Consolas, monospace; }
      .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: none; align-items: center; justify-content: center; z-index: 20; }
      .modal-bg.show { display: flex; }
      .modal { width: min(460px, 92vw); max-height: 78vh; display: flex; flex-direction: column; background: var(--bg-2); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
      .modal header { padding: 16px 18px; border-bottom: 1px solid var(--line); }
      .modal header h3 { margin: 0 0 10px; font-size: 16px; }
      .modal .scroll { overflow-y: auto; padding: 8px; }
      .pick { display: flex; align-items: center; gap: 11px; padding: 8px 10px; border-radius: 10px; cursor: pointer; }
      .pick:hover { background: var(--card-2); }
      .pick .check { width: 18px; height: 18px; border-radius: 5px; border: 2px solid var(--faint); display: grid; place-items: center; flex: 0 0 auto; }
      .pick.on .check { background: var(--green); border-color: var(--green); }
      .pick .check svg { width: 12px; height: 12px; fill: #fff; opacity: 0; }
      .pick.on .check svg { opacity: 1; }
      .modal footer { padding: 12px 18px; border-top: 1px solid var(--line); display: flex; justify-content: flex-end; }
      .row-gap { display: flex; gap: 8px; }
      @media (max-width: 820px) { .wrap { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <div class="topbar">
      <div class="mark" aria-hidden="true">
        <svg viewBox="0 0 24 18"><path d="M20.3 1.6A19.8 19.8 0 0 0 15.4.1l-.3.5c2.1.5 3.1 1.3 4.1 2.1A13.6 13.6 0 0 0 12 1.5c-2.6 0-5 .6-7.2 1.2C5.8 1.9 6.9 1.1 9 .6L8.7.1A19.8 19.8 0 0 0 3.7 1.6C.8 5.9 0 10.1.4 14.3A19.9 19.9 0 0 0 6.4 17l.5-.7c-1-.3-2-.8-2.9-1.4l.6-.4a14.2 14.2 0 0 0 14.8 0l.6.4c-.9.6-1.9 1-2.9 1.4l.5.7a19.9 19.9 0 0 0 6-2.7c.5-4.9-.8-9-3.9-12.7ZM8.3 11.9c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7.4 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/></svg>
      </div>
      <div class="titles">
        <h1>Discord Access Control</h1>
        <p>디스코드 서버 멤버를 팀으로 묶어 관리합니다 (hermes bot)</p>
      </div>
      <span class="chip">guild&nbsp;<b>${guildLabel}</b></span>
    </div>

    <div class="banner" id="banner"></div>

    <div class="wrap">
      <section class="panel">
        <div class="panel-head">
          <h2>Teams</h2>
          <button class="icon" id="add-team-btn" title="New team" aria-label="New team">+</button>
        </div>
        <div class="panel-body" id="team-list"></div>
      </section>

      <section class="panel">
        <div class="panel-body" id="member-pane" style="padding:20px;"></div>
      </section>
    </div>

    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <header>
          <h3>Add members from Discord</h3>
          <input id="member-search" placeholder="Search members..." autocomplete="off" />
        </header>
        <div class="scroll" id="member-picker"></div>
        <footer><button id="modal-done">Done</button></footer>
      </div>
    </div>

    <script>
      (function () {
        var teams = [];
        var members = [];
        var membersById = {};
        var membersLoaded = false;
        var selectedTeamId = null;

        var bannerEl = document.getElementById("banner");
        var teamListEl = document.getElementById("team-list");
        var memberPaneEl = document.getElementById("member-pane");
        var modalBg = document.getElementById("modal-bg");
        var pickerEl = document.getElementById("member-picker");
        var searchEl = document.getElementById("member-search");

        function showBanner(html) { bannerEl.innerHTML = html; bannerEl.classList.add("show"); }
        function hideBanner() { bannerEl.classList.remove("show"); }

        function api(method, path, body) {
          var opts = { method: method, headers: {} };
          if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
          return fetch(path, opts).then(function (r) {
            return r.json().then(function (data) { return { status: r.status, data: data }; });
          });
        }

        function initial(name) { return (name || "?").trim().charAt(0).toUpperCase() || "?"; }

        function avatarNode(member) {
          var a = document.createElement("div");
          a.className = "avatar";
          if (member && member.avatarUrl) {
            var img = document.createElement("img");
            img.src = member.avatarUrl; img.alt = "";
            img.onerror = function () { a.textContent = initial(member.displayName); };
            a.appendChild(img);
          } else {
            a.textContent = initial(member ? member.displayName : "?");
          }
          return a;
        }

        function selectedTeam() {
          for (var i = 0; i < teams.length; i++) { if (teams[i].id === selectedTeamId) return teams[i]; }
          return null;
        }

        function renderTeams() {
          teamListEl.innerHTML = "";
          if (teams.length === 0) {
            var e = document.createElement("div");
            e.className = "empty";
            e.textContent = "No teams yet. Click + to create one.";
            teamListEl.appendChild(e);
            return;
          }
          teams.forEach(function (team) {
            var row = document.createElement("div");
            row.className = "team-row" + (team.id === selectedTeamId ? " active" : "");
            row.onclick = function () { selectedTeamId = team.id; renderTeams(); renderMembers(); };

            var name = document.createElement("span");
            name.className = "name"; name.textContent = team.name;
            var count = document.createElement("span");
            count.className = "count"; count.textContent = String(team.memberDiscordIds.length);

            var actions = document.createElement("div");
            actions.className = "team-actions";
            var renameBtn = document.createElement("button");
            renameBtn.className = "ghost icon"; renameBtn.title = "Rename"; renameBtn.textContent = "✎";
            renameBtn.onclick = function (ev) { ev.stopPropagation(); doRename(team); };
            var delBtn = document.createElement("button");
            delBtn.className = "danger icon"; delBtn.title = "Delete"; delBtn.textContent = "🗑";
            delBtn.onclick = function (ev) { ev.stopPropagation(); doDelete(team); };
            actions.appendChild(renameBtn); actions.appendChild(delBtn);

            row.appendChild(name); row.appendChild(actions); row.appendChild(count);
            teamListEl.appendChild(row);
          });
        }

        function renderMembers() {
          var team = selectedTeam();
          memberPaneEl.innerHTML = "";
          if (!team) {
            var e = document.createElement("div");
            e.className = "empty"; e.style.padding = "60px 12px";
            e.textContent = "Select a team to manage its members.";
            memberPaneEl.appendChild(e);
            return;
          }

          var head = document.createElement("div");
          head.className = "member-head";
          var left = document.createElement("div");
          var h = document.createElement("h3"); h.textContent = team.name;
          var sub = document.createElement("div"); sub.className = "sub";
          sub.textContent = team.memberDiscordIds.length + (team.memberDiscordIds.length === 1 ? " member" : " members");
          left.appendChild(h); left.appendChild(sub);
          var addBtn = document.createElement("button");
          addBtn.textContent = "+ Add members";
          addBtn.onclick = openPicker;
          head.appendChild(left); head.appendChild(addBtn);
          memberPaneEl.appendChild(head);

          var list = document.createElement("div");
          list.className = "member-list";
          if (team.memberDiscordIds.length === 0) {
            var empty = document.createElement("div");
            empty.className = "empty";
            empty.textContent = "No members yet. Use \\"Add members\\" to assign Discord users.";
            list.appendChild(empty);
          } else {
            team.memberDiscordIds.forEach(function (id) {
              var m = membersById[id] || { id: id, displayName: id, avatarUrl: null };
              var row = document.createElement("div"); row.className = "member";
              var who = document.createElement("div"); who.className = "who";
              var dn = document.createElement("div"); dn.className = "dn"; dn.textContent = m.displayName;
              var idEl = document.createElement("div"); idEl.className = "id"; idEl.textContent = id;
              who.appendChild(dn); who.appendChild(idEl);
              var rm = document.createElement("button"); rm.className = "danger icon"; rm.textContent = "✕"; rm.title = "Remove";
              rm.onclick = function () { removeMember(team.id, id); };
              row.appendChild(avatarNode(m)); row.appendChild(who); row.appendChild(rm);
              list.appendChild(row);
            });
          }
          memberPaneEl.appendChild(list);
        }

        function loadTeams() {
          return api("GET", "/api/teams").then(function (res) {
            teams = (res.data && res.data.teams) || [];
            if (selectedTeamId === null && teams.length > 0) selectedTeamId = teams[0].id;
            renderTeams(); renderMembers();
          });
        }

        function ensureMembers() {
          if (membersLoaded) return Promise.resolve();
          return api("GET", "/api/members").then(function (res) {
            if (res.status === 200) {
              members = res.data.members || [];
              membersById = {};
              members.forEach(function (m) { membersById[m.id] = m; });
              membersLoaded = true;
              hideBanner();
              renderMembers();
            } else {
              showMemberError(res.data);
            }
          });
        }

        function showMemberError(data) {
          var reason = data && data.error ? data.error : "unknown";
          var msg = "Discord 멤버를 불러오지 못했습니다 (" + reason + "). ";
          if (reason === "not_configured") {
            msg += "<code>.env</code>에 <code>DISCORD_BOT_TOKEN</code>과 <code>DISCORD_GUILD_ID</code>를 설정한 뒤 서버를 재시작하세요.";
          } else if (reason === "missing_members_intent_or_access") {
            msg += "Discord 개발자 포털에서 봇의 <code>Server Members Intent</code>를 켜고, 봇이 서버에 초대됐는지 확인하세요.";
          } else if (reason === "invalid_token") {
            msg += "봇 토큰이 올바른지 확인하세요.";
          } else if (reason === "guild_not_found") {
            msg += "<code>DISCORD_GUILD_ID</code>가 올바른지, 봇이 그 서버에 있는지 확인하세요.";
          }
          showBanner(msg);
        }

        function renderPicker() {
          var team = selectedTeam();
          var q = searchEl.value.trim().toLowerCase();
          pickerEl.innerHTML = "";
          var filtered = members.filter(function (m) {
            if (q === "") return true;
            return m.displayName.toLowerCase().indexOf(q) >= 0 ||
              m.username.toLowerCase().indexOf(q) >= 0 ||
              m.id.indexOf(q) >= 0;
          });
          if (filtered.length === 0) {
            var e = document.createElement("div"); e.className = "empty";
            e.textContent = members.length === 0 ? "No members available." : "No member matches.";
            pickerEl.appendChild(e);
            return;
          }
          filtered.forEach(function (m) {
            var on = team ? team.memberDiscordIds.indexOf(m.id) >= 0 : false;
            var row = document.createElement("div"); row.className = "pick" + (on ? " on" : "");
            var check = document.createElement("div"); check.className = "check";
            check.innerHTML = '<svg viewBox="0 0 16 16"><path d="M6.2 11.3 3 8.1l1.1-1.1 2.1 2 5-5L12.3 5z"/></svg>';
            var who = document.createElement("div"); who.className = "who";
            var dn = document.createElement("div"); dn.className = "dn"; dn.textContent = m.displayName;
            var idEl = document.createElement("div"); idEl.className = "id"; idEl.textContent = "@" + m.username;
            who.appendChild(dn); who.appendChild(idEl);
            row.appendChild(check); row.appendChild(avatarNode(m)); row.appendChild(who);
            row.onclick = function () { toggleMember(m.id); };
            pickerEl.appendChild(row);
          });
        }

        function openPicker() {
          if (!selectedTeam()) return;
          modalBg.classList.add("show");
          searchEl.value = "";
          ensureMembers().then(renderPicker);
          searchEl.focus();
        }
        function closePicker() { modalBg.classList.remove("show"); }

        function toggleMember(memberId) {
          var team = selectedTeam();
          if (!team) return;
          var on = team.memberDiscordIds.indexOf(memberId) >= 0;
          if (on) {
            api("DELETE", "/api/teams/members?teamId=" + encodeURIComponent(team.id) + "&memberId=" + encodeURIComponent(memberId))
              .then(afterTeamsChange);
          } else {
            api("POST", "/api/teams/members", { teamId: team.id, memberId: memberId }).then(afterTeamsChange);
          }
        }

        function removeMember(teamId, memberId) {
          api("DELETE", "/api/teams/members?teamId=" + encodeURIComponent(teamId) + "&memberId=" + encodeURIComponent(memberId))
            .then(afterTeamsChange);
        }

        function afterTeamsChange(res) {
          teams = (res.data && res.data.teams) || teams;
          renderTeams(); renderMembers();
          if (modalBg.classList.contains("show")) renderPicker();
        }

        function addTeam() {
          var name = window.prompt("New team name (e.g. dev, hr, cs)");
          if (name === null || name.trim() === "") return;
          api("POST", "/api/teams", { name: name }).then(function (res) {
            teams = (res.data && res.data.teams) || teams;
            var created = teams[teams.length - 1];
            if (created) selectedTeamId = created.id;
            renderTeams(); renderMembers();
          });
        }

        function doRename(team) {
          var name = window.prompt("Rename team", team.name);
          if (name === null || name.trim() === "") return;
          api("PUT", "/api/teams", { id: team.id, name: name }).then(afterTeamsChange);
        }

        function doDelete(team) {
          if (!window.confirm("Delete team \\"" + team.name + "\\"? This cannot be undone.")) return;
          api("DELETE", "/api/teams?id=" + encodeURIComponent(team.id)).then(function (res) {
            teams = (res.data && res.data.teams) || teams;
            if (selectedTeamId === team.id) selectedTeamId = teams.length > 0 ? teams[0].id : null;
            renderTeams(); renderMembers();
          });
        }

        document.getElementById("add-team-btn").onclick = addTeam;
        document.getElementById("modal-done").onclick = closePicker;
        modalBg.onclick = function (ev) { if (ev.target === modalBg) closePicker(); };
        searchEl.oninput = renderPicker;

        api("GET", "/api/config").then(function (res) {
          if (res.data && res.data.configured === false) {
            showBanner("디스코드가 아직 연결되지 않았습니다. <code>.env</code>에 <code>DISCORD_BOT_TOKEN</code>과 <code>DISCORD_GUILD_ID</code>를 채우고 서버를 재시작하세요. 팀 생성은 지금도 가능합니다.");
          }
        });
        loadTeams();
      })();
    </script>
  </body>
</html>`
}
