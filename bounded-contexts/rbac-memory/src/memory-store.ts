import { isScopeAllowed } from "./scope.js"
import type { MemoryRecord, Scope, SearchMode } from "./types.js"
import { cosineSimilarity, embedSearchText } from "./vector-search.js"

const SEARCH_TERMS_PATTERN = /\s+/

export type StoreWriteInput = {
  record: MemoryRecord
}

export type StoreSearchInput = {
  query: string
  readableScopes: Scope[]
  mode?: SearchMode
  tags?: string[]
  metadata?: Record<string, string>
  organizationIds?: string[]
  limit?: number
}

export interface MemoryStore {
  readonly id: string
  write(input: StoreWriteInput): Promise<void>
  search(input: StoreSearchInput): Promise<MemoryRecord[]>
  list(): Promise<MemoryRecord[]>
}

export class InMemoryStore implements MemoryStore {
  readonly id: string
  readonly #records = new Map<string, MemoryRecord>()

  constructor(id = "built-in") {
    this.id = id
  }

  async write(input: StoreWriteInput): Promise<void> {
    this.#records.set(input.record.id, copyRecord(input.record))
  }

  async search(input: StoreSearchInput): Promise<MemoryRecord[]> {
    return applySearchFilters(Array.from(this.#records.values()), input)
  }

  async list(): Promise<MemoryRecord[]> {
    return Array.from(this.#records.values()).map(copyRecord)
  }
}

export function applySearchFilters(
  records: MemoryRecord[],
  input: StoreSearchInput,
): MemoryRecord[] {
  const normalizedQuery = input.query.trim().toLowerCase()
  const normalizedTags = (input.tags ?? []).map((tag) => tag.toLowerCase())
  const mode = input.mode ?? "contains"
  const filtered = records
    .filter((record) => isScopeAllowed(record.scope, input.readableScopes))
    .filter((record) => organizationMatches(record, input.organizationIds))
    .filter((record) => metadataMatches(record, input.metadata))
    .filter((record) => tagsMatch(record, normalizedTags))
    .filter((record) => textMatches(record, normalizedQuery, mode))
    .map(copyRecord)

  if (input.limit === undefined) {
    return filtered
  }
  return filtered.slice(0, input.limit)
}

export function copyRecord(record: MemoryRecord): MemoryRecord {
  return {
    id: record.id,
    scope: record.scope,
    organizationIds:
      record.organizationIds === undefined
        ? undefined
        : [...record.organizationIds],
    content: record.content,
    tags: record.tags === undefined ? undefined : [...record.tags],
    metadata:
      record.metadata === undefined ? undefined : { ...record.metadata },
  }
}

function organizationMatches(
  record: MemoryRecord,
  requestedOrganizations: string[] | undefined,
): boolean {
  if (
    requestedOrganizations === undefined ||
    requestedOrganizations.length === 0
  ) {
    return true
  }
  const recordOrganizations = record.organizationIds ?? [
    organizationFromScope(record.scope),
  ]
  return recordOrganizations.some((organizationId) =>
    requestedOrganizations.includes(organizationId),
  )
}

function metadataMatches(
  record: MemoryRecord,
  metadata: Record<string, string> | undefined,
): boolean {
  if (metadata === undefined) {
    return true
  }
  return Object.entries(metadata).every(
    ([key, value]) => record.metadata?.[key] === value,
  )
}

function tagsMatch(record: MemoryRecord, tags: string[]): boolean {
  if (tags.length === 0) {
    return true
  }
  const recordTags = (record.tags ?? []).map((tag) => tag.toLowerCase())
  return tags.every((tag) => recordTags.includes(tag))
}

function textMatches(
  record: MemoryRecord,
  normalizedQuery: string,
  mode: SearchMode,
): boolean {
  if (normalizedQuery.length === 0) {
    return true
  }
  if (mode === "semantic") {
    const haystack = [record.content, record.id, ...(record.tags ?? [])].join(
      " ",
    )
    return (
      cosineSimilarity(
        embedSearchText(normalizedQuery),
        embedSearchText(haystack),
      ) > 0
    )
  }
  const haystack = [record.content, record.id, ...(record.tags ?? [])]
    .join(" ")
    .toLowerCase()
  if (mode === "exact") {
    return (
      haystack === normalizedQuery ||
      record.content.toLowerCase() === normalizedQuery
    )
  }
  const terms = normalizedQuery.split(SEARCH_TERMS_PATTERN).filter(Boolean)
  if (mode === "all") {
    return terms.every((term) => haystack.includes(term))
  }
  if (mode === "any") {
    return terms.some((term) => haystack.includes(term))
  }
  return haystack.includes(normalizedQuery)
}

function organizationFromScope(scope: Scope): string {
  return scope.split("/").slice(0, 2).join("/")
}
