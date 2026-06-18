/**
 * Thin Discord REST client. Lists the real members of a guild (server) so the
 * dashboard can assign them to teams. Requires a bot token with the privileged
 * "Server Members Intent" enabled in the Discord developer portal.
 */
import type { DiscordMember } from "./types.js"

const DISCORD_API = "https://discord.com/api/v10"
const MEMBER_PAGE_LIMIT = 1000

type RawGuildMember = {
  nick?: string | null
  user?: {
    id: string
    username: string
    global_name?: string | null
    avatar?: string | null
    bot?: boolean
  }
}

export type GuildMembersResult =
  | { ok: true; members: DiscordMember[] }
  | { ok: false; error: string; detail: string }

export async function fetchGuildMembers(
  botToken: string,
  guildId: string,
): Promise<GuildMembersResult> {
  let response: Response
  try {
    response = await fetch(
      `${DISCORD_API}/guilds/${guildId}/members?limit=${MEMBER_PAGE_LIMIT}`,
      { headers: { Authorization: `Bot ${botToken}` } },
    )
  } catch (error) {
    return { ok: false, error: "network_error", detail: String(error) }
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    return { ok: false, error: mapStatus(response.status), detail }
  }

  const raw = (await response.json()) as RawGuildMember[]
  const members = raw
    .map(toDiscordMember)
    .filter((member): member is DiscordMember => member !== null && !member.bot)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
  return { ok: true, members }
}

function mapStatus(status: number): string {
  if (status === 401) return "invalid_token"
  if (status === 403) return "missing_members_intent_or_access"
  if (status === 404) return "guild_not_found"
  if (status === 429) return "rate_limited"
  return `discord_error_${status}`
}

function toDiscordMember(raw: RawGuildMember): DiscordMember | null {
  const user = raw.user
  if (user === undefined) return null
  const displayName = raw.nick ?? user.global_name ?? user.username
  const avatarUrl =
    user.avatar != null
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
      : null
  return {
    id: user.id,
    username: user.username,
    displayName,
    avatarUrl,
    bot: user.bot ?? false,
  }
}
