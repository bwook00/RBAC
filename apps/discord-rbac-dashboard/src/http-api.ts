import { type DiscordConfig, isConfigured, loadConfig } from "./config.js"
import { renderDashboard } from "./dashboard.js"
import { fetchGuildMembers, type GuildMembersResult } from "./discord-client.js"
import {
  addMember,
  addTeam,
  deleteTeam,
  removeMember,
  renameTeam,
} from "./teams-operations.js"
import { loadTeams, saveTeams } from "./teams-store.js"
import type { TeamsState } from "./types.js"

const MEMBERS_CACHE_TTL_MS = 30_000

export type AppContext = {
  config: DiscordConfig
  teams: TeamsState
  membersCache: { at: number; result: GuildMembersResult } | null
}

type RouteHandler = (request: Request, context: AppContext) => Promise<Response>

const ROUTES: Record<string, RouteHandler> = {
  "GET /": handleDashboard,
  "GET /dashboard": handleDashboard,
  "GET /api/config": handleConfig,
  "GET /api/members": handleMembers,
  "GET /api/teams": handleListTeams,
  "POST /api/teams": handleCreateTeam,
  "PUT /api/teams": handleRenameTeam,
  "DELETE /api/teams": handleDeleteTeam,
  "POST /api/teams/members": handleAddMember,
  "DELETE /api/teams/members": handleRemoveMember,
}

export async function createAppContext(): Promise<AppContext> {
  const config = loadConfig()
  const teams = await loadTeams(config.teamsPath)
  return { config, teams, membersCache: null }
}

export async function handleRequest(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const url = new URL(request.url)
  const handler = ROUTES[`${request.method} ${url.pathname}`]
  if (handler === undefined) return json({ error: "not_found" }, 404)
  return handler(request, context)
}

async function handleDashboard(
  _request: Request,
  context: AppContext,
): Promise<Response> {
  return new Response(renderDashboard(context.config), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

async function handleConfig(
  _request: Request,
  context: AppContext,
): Promise<Response> {
  return json({
    configured: isConfigured(context.config),
    guildId: context.config.guildId,
    channelId: context.config.channelId,
  })
}

async function handleMembers(
  _request: Request,
  context: AppContext,
): Promise<Response> {
  const { config } = context
  if (config.botToken === null || config.guildId === null) {
    return json(
      {
        error: "not_configured",
        detail: "Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.",
      },
      409,
    )
  }

  const now = Date.now()
  const cached = context.membersCache
  if (cached !== null && now - cached.at < MEMBERS_CACHE_TTL_MS) {
    return membersResponse(cached.result)
  }

  const result = await fetchGuildMembers(config.botToken, config.guildId)
  context.membersCache = { at: now, result }
  return membersResponse(result)
}

function membersResponse(result: GuildMembersResult): Response {
  if (!result.ok) {
    return json({ error: result.error, detail: result.detail }, 502)
  }
  return json({ members: result.members })
}

async function handleListTeams(
  _request: Request,
  context: AppContext,
): Promise<Response> {
  return json({ teams: context.teams.teams })
}

async function handleCreateTeam(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const body = (await request.json()) as { name?: string }
  const name = body.name ?? ""
  if (name.trim() === "") return json({ error: "missing_name" }, 400)
  await commit(context, addTeam(context.teams, name))
  return json({ teams: context.teams.teams })
}

async function handleRenameTeam(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const body = (await request.json()) as { id?: string; name?: string }
  if (body.id === undefined || body.name === undefined) {
    return json({ error: "missing_id_or_name" }, 400)
  }
  await commit(context, renameTeam(context.teams, body.id, body.name))
  return json({ teams: context.teams.teams })
}

async function handleDeleteTeam(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id")
  if (id === null || id.length === 0) return json({ error: "missing_id" }, 400)
  await commit(context, deleteTeam(context.teams, id))
  return json({ teams: context.teams.teams })
}

async function handleAddMember(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const body = (await request.json()) as { teamId?: string; memberId?: string }
  if (body.teamId === undefined || body.memberId === undefined) {
    return json({ error: "missing_team_or_member" }, 400)
  }
  await commit(context, addMember(context.teams, body.teamId, body.memberId))
  return json({ teams: context.teams.teams })
}

async function handleRemoveMember(
  request: Request,
  context: AppContext,
): Promise<Response> {
  const params = new URL(request.url).searchParams
  const teamId = params.get("teamId")
  const memberId = params.get("memberId")
  if (teamId === null || memberId === null) {
    return json({ error: "missing_team_or_member" }, 400)
  }
  await commit(context, removeMember(context.teams, teamId, memberId))
  return json({ teams: context.teams.teams })
}

async function commit(context: AppContext, next: TeamsState): Promise<void> {
  context.teams = next
  await saveTeams(context.config.teamsPath, next)
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  })
}
