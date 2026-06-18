/**
 * Domain types for the standalone Discord team-management dashboard.
 *
 * A team is a named group of Discord users (e.g. dev, hr, cs). Membership is
 * many-to-many: one Discord user can belong to multiple teams. This dashboard
 * manages teams + membership only; mapping memory access scopes onto teams is a
 * later step.
 */

/** A team groups Discord users. `memberDiscordIds` holds Discord user snowflakes. */
export type Team = {
  readonly id: string
  readonly name: string
  readonly memberDiscordIds: readonly string[]
}

export type TeamsState = {
  readonly teams: readonly Team[]
}

/** A Discord guild member, normalized from the Discord REST API. */
export type DiscordMember = {
  readonly id: string
  readonly username: string
  readonly displayName: string
  readonly avatarUrl: string | null
  readonly bot: boolean
}
