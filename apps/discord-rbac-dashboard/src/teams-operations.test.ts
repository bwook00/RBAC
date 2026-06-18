import { describe, expect, it } from "bun:test"
import {
  addMember,
  addTeam,
  deleteTeam,
  EMPTY_STATE,
  removeMember,
  renameTeam,
  toggleMember,
} from "./teams-operations.js"
import type { TeamsState } from "./types.js"

describe("teams-operations", () => {
  it("starts empty", () => {
    expect(EMPTY_STATE.teams).toEqual([])
  })

  it("adds a trimmed team with no members", () => {
    const next = addTeam(EMPTY_STATE, "  dev  ")
    expect(next.teams.length).toBe(1)
    expect(next.teams.at(0)?.name).toBe("dev")
    expect(next.teams.at(0)?.memberDiscordIds).toEqual([])
  })

  it("ignores blank team names", () => {
    expect(addTeam(EMPTY_STATE, "   ").teams.length).toBe(0)
  })

  it("does not mutate the previous state", () => {
    const next = addTeam(EMPTY_STATE, "hr")
    expect(EMPTY_STATE.teams.length).toBe(0)
    expect(next).not.toBe(EMPTY_STATE)
  })

  it("renames a team", () => {
    const s1 = addTeam(EMPTY_STATE, "dev")
    const id = s1.teams.at(0)?.id ?? ""
    expect(renameTeam(s1, id, "engineering").teams.at(0)?.name).toBe(
      "engineering",
    )
  })

  it("deletes a team", () => {
    const s1 = addTeam(addTeam(EMPTY_STATE, "dev"), "hr")
    const id = s1.teams.at(0)?.id ?? ""
    const s2 = deleteTeam(s1, id)
    expect(s2.teams.length).toBe(1)
    expect(s2.teams.at(0)?.name).toBe("hr")
  })

  it("adds members and dedupes within a team", () => {
    const s1 = addTeam(EMPTY_STATE, "dev")
    const id = s1.teams.at(0)?.id ?? ""
    const s2 = addMember(addMember(s1, id, "100"), id, "100")
    expect(s2.teams.at(0)?.memberDiscordIds).toEqual(["100"])
  })

  it("lets one user belong to multiple teams", () => {
    let s: TeamsState = addTeam(addTeam(EMPTY_STATE, "dev"), "hr")
    const dev = s.teams.at(0)?.id ?? ""
    const hr = s.teams.at(1)?.id ?? ""
    s = addMember(s, dev, "100")
    s = addMember(s, hr, "100")
    expect(s.teams.at(0)?.memberDiscordIds).toContain("100")
    expect(s.teams.at(1)?.memberDiscordIds).toContain("100")
  })

  it("removes a member", () => {
    const s1 = addTeam(EMPTY_STATE, "dev")
    const id = s1.teams.at(0)?.id ?? ""
    const s2 = removeMember(addMember(s1, id, "100"), id, "100")
    expect(s2.teams.at(0)?.memberDiscordIds).toEqual([])
  })

  it("toggles a member on then off", () => {
    const s1 = addTeam(EMPTY_STATE, "dev")
    const id = s1.teams.at(0)?.id ?? ""
    const on = toggleMember(s1, id, "100")
    expect(on.teams.at(0)?.memberDiscordIds).toEqual(["100"])
    expect(toggleMember(on, id, "100").teams.at(0)?.memberDiscordIds).toEqual(
      [],
    )
  })
})
