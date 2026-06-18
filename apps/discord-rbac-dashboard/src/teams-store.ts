/**
 * JSON-file persistence for teams. Survives restarts (this is a personal tool,
 * not a throwaway demo) while staying schema-free and dependency-light.
 */
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { Team, TeamsState } from "./types.js"

export async function loadTeams(path: string): Promise<TeamsState> {
  const file = Bun.file(path)
  if (!(await file.exists())) return { teams: [] }
  try {
    const data = (await file.json()) as { teams?: unknown }
    if (!Array.isArray(data.teams)) return { teams: [] }
    return { teams: data.teams.filter(isTeam) }
  } catch {
    return { teams: [] }
  }
}

export async function saveTeams(
  path: string,
  state: TeamsState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, JSON.stringify(state, null, 2))
}

function isTeam(value: unknown): value is Team {
  if (typeof value !== "object" || value === null) return false
  const team = value as Record<string, unknown>
  return (
    typeof team.id === "string" &&
    typeof team.name === "string" &&
    Array.isArray(team.memberDiscordIds) &&
    team.memberDiscordIds.every((id) => typeof id === "string")
  )
}
