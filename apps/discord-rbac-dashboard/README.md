# Discord Access Control Dashboard

A standalone (no Runbear required) admin console for grouping **Discord server
members** into **teams** — for external agents / Discord bots like `hermes`.
This first version manages teams + membership only; mapping memory access scopes
onto teams comes later.

## Setup (fill token + server ID → run)

1. Create/booted bot at https://discord.com/developers/applications
   - **Bot → Privileged Gateway Intents → Server Members Intent: ON**
   - Invite the bot to your server.
2. Copy env and fill it in:
   ```sh
   cp apps/discord-rbac-dashboard/.env.example .env   # at repo root
   # DISCORD_BOT_TOKEN=...   DISCORD_GUILD_ID=...
   ```
   Get the server ID: Discord → Settings → Advanced → Developer Mode ON, then
   right-click the server icon → **Copy Server ID**.
3. Run:
   ```sh
   bun install
   bun run --cwd apps/discord-rbac-dashboard start
   ```
   Open http://localhost:4322/dashboard

Without the token/server ID the dashboard still loads and you can create teams;
the member picker shows a setup banner until Discord is connected.

## What you can do

- Create / rename / delete teams (e.g. `dev`, `hr`, `cs`)
- Search your real Discord server members and assign them to teams
- One member can belong to multiple teams
- Remove members from a team

## Storage

Teams persist to `.data/discord-rbac/teams.json` (override with
`DISCORD_TEAMS_PATH`). Discord members are fetched live (cached 30s) and never
stored.

## Verify

```sh
bun run --cwd apps/discord-rbac-dashboard type-check
bun run --cwd apps/discord-rbac-dashboard test
```
