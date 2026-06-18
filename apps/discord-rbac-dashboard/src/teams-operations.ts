/**
 * Pure, immutable state transitions for Discord teams. Every function returns a
 * new {@link TeamsState}; inputs are never mutated. No React/IO here so the
 * rules are trivial to unit test.
 */
import type { Team, TeamsState } from "./types.js"

export const EMPTY_STATE: TeamsState = { teams: [] }

export function addTeam(state: TeamsState, name: string): TeamsState {
  const trimmed = name.trim()
  if (trimmed === "") return state
  const team: Team = {
    id: crypto.randomUUID(),
    name: trimmed,
    memberDiscordIds: [],
  }
  return { teams: [...state.teams, team] }
}

export function renameTeam(
  state: TeamsState,
  teamId: string,
  name: string,
): TeamsState {
  const trimmed = name.trim()
  if (trimmed === "") return state
  return {
    teams: state.teams.map((team) =>
      team.id === teamId ? { ...team, name: trimmed } : team,
    ),
  }
}

export function deleteTeam(state: TeamsState, teamId: string): TeamsState {
  return { teams: state.teams.filter((team) => team.id !== teamId) }
}

/** Add a Discord member to a team. Duplicate ids within a team are ignored. */
export function addMember(
  state: TeamsState,
  teamId: string,
  discordId: string,
): TeamsState {
  return {
    teams: state.teams.map((team) => {
      if (team.id !== teamId) return team
      if (team.memberDiscordIds.includes(discordId)) return team
      return {
        ...team,
        memberDiscordIds: [...team.memberDiscordIds, discordId],
      }
    }),
  }
}

export function removeMember(
  state: TeamsState,
  teamId: string,
  discordId: string,
): TeamsState {
  return {
    teams: state.teams.map((team) =>
      team.id === teamId
        ? {
            ...team,
            memberDiscordIds: team.memberDiscordIds.filter(
              (id) => id !== discordId,
            ),
          }
        : team,
    ),
  }
}

/** Toggle a member in a team (add if absent, remove if present). */
export function toggleMember(
  state: TeamsState,
  teamId: string,
  discordId: string,
): TeamsState {
  const team = state.teams.find((t) => t.id === teamId)
  if (team === undefined) return state
  return team.memberDiscordIds.includes(discordId)
    ? removeMember(state, teamId, discordId)
    : addMember(state, teamId, discordId)
}
