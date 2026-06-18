/** Runtime configuration read from environment variables. */
export type DiscordConfig = {
  readonly botToken: string | null
  readonly guildId: string | null
  readonly channelId: string | null
  readonly port: number
  readonly teamsPath: string
}

const DEFAULT_PORT = 4322
const DEFAULT_TEAMS_PATH = ".data/discord-rbac/teams.json"

export function loadConfig(): DiscordConfig {
  const rawPort = Number(Bun.env.PORT ?? DEFAULT_PORT)
  return {
    botToken: nonEmpty(Bun.env.DISCORD_BOT_TOKEN),
    guildId: nonEmpty(Bun.env.DISCORD_GUILD_ID),
    channelId: nonEmpty(Bun.env.DISCORD_CHANNEL_ID),
    port: Number.isFinite(rawPort) ? rawPort : DEFAULT_PORT,
    teamsPath: Bun.env.DISCORD_TEAMS_PATH ?? DEFAULT_TEAMS_PATH,
  }
}

/** True once a bot token and guild id are present (required to fetch members). */
export function isConfigured(config: DiscordConfig): boolean {
  return config.botToken !== null && config.guildId !== null
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
