import type {
  MemoryStore,
  StoreSearchInput,
  StoreWriteInput,
} from "./memory-store.js"
import { copyRecord } from "./memory-store.js"
import { isScopeAllowed, isValidScope } from "./scope.js"
import type { MemoryRecord, Scope } from "./types.js"
import { cosineSimilarity, embedSearchText } from "./vector-search.js"

const ORGANIZATION_IDS_KEY = "organization_ids"
const TAGS_KEY = "tags"

export type ExternalMemoryEntry = {
  id: string
  text: string
  metadata: Record<string, string>
}

export type ExternalMemoryClient = {
  add(entry: ExternalMemoryEntry): Promise<void>
  search(input: {
    query: string
    scopes: Scope[]
    organizationIds?: string[]
    tags?: string[]
    metadata?: Record<string, string>
    limit?: number
    mode?: string
  }): Promise<ExternalMemoryEntry[]>
  list(): Promise<ExternalMemoryEntry[]>
}

export type ExternalMemoryStoreOptions = {
  id?: string
  client: ExternalMemoryClient
}

export class ExternalMemoryStore implements MemoryStore {
  readonly id: string
  readonly #client: ExternalMemoryClient

  constructor(options: ExternalMemoryStoreOptions) {
    this.id = options.id ?? "external-memory"
    this.#client = options.client
  }

  async write(input: StoreWriteInput): Promise<void> {
    await this.#client.add(toExternalEntry(input.record))
  }

  async search(input: StoreSearchInput): Promise<MemoryRecord[]> {
    const entries = await this.#client.search({
      query: input.query,
      scopes: input.readableScopes,
      organizationIds: input.organizationIds,
      tags: input.tags,
      metadata: input.metadata,
      limit: input.limit,
      mode: input.mode,
    })
    return entries
      .map(fromExternalEntry)
      .filter((record) => isScopeAllowed(record.scope, input.readableScopes))
  }

  async list(): Promise<MemoryRecord[]> {
    const entries = await this.#client.list()
    return entries.map(fromExternalEntry)
  }
}

export class DeterministicExternalMemoryClient implements ExternalMemoryClient {
  readonly #entries = new Map<string, ExternalMemoryEntry>()

  async add(entry: ExternalMemoryEntry): Promise<void> {
    this.#entries.set(entry.id, copyEntry(entry))
  }

  async search(input: {
    query: string
    scopes: Scope[]
    organizationIds?: string[]
    tags?: string[]
    metadata?: Record<string, string>
    limit?: number
    mode?: string
  }): Promise<ExternalMemoryEntry[]> {
    const normalizedQuery = input.query.toLowerCase()
    const normalizedTags = (input.tags ?? []).map((tag) => tag.toLowerCase())
    const entries = Array.from(this.#entries.values())
      .filter((entry) =>
        isScopeAllowed(entry.metadata.scope ?? "", input.scopes),
      )
      .filter((entry) => organizationMatches(entry, input.organizationIds))
      .filter((entry) => tagsMatch(entry, normalizedTags))
      .filter((entry) => metadataMatches(entry, input.metadata))
      .filter((entry) => textMatches(entry.text, normalizedQuery, input.mode))
      .map(copyEntry)

    if (input.limit === undefined) {
      return entries
    }
    return entries.slice(0, input.limit)
  }

  async list(): Promise<ExternalMemoryEntry[]> {
    return Array.from(this.#entries.values()).map(copyEntry)
  }
}

export function toExternalEntry(record: MemoryRecord): ExternalMemoryEntry {
  return {
    id: record.id,
    text: record.content,
    metadata: {
      ...(record.metadata ?? {}),
      scope: record.scope,
      ...(record.organizationIds === undefined
        ? {}
        : { [ORGANIZATION_IDS_KEY]: record.organizationIds.join(",") }),
      ...(record.tags === undefined
        ? {}
        : { [TAGS_KEY]: record.tags.join(",") }),
    },
  }
}

export function fromExternalEntry(entry: ExternalMemoryEntry): MemoryRecord {
  const { scope, organization_ids, tags, ...metadata } = entry.metadata
  if (scope === undefined || !isValidScope(scope)) {
    throw new Error("external memory entry has invalid scope metadata")
  }

  return copyRecord({
    id: entry.id,
    scope,
    organizationIds: splitMetadataList(organization_ids),
    content: entry.text,
    tags: splitMetadataList(tags),
    metadata,
  })
}

function organizationMatches(
  entry: ExternalMemoryEntry,
  organizationIds: string[] | undefined,
): boolean {
  if (organizationIds === undefined || organizationIds.length === 0) {
    return true
  }
  const entryOrganizations = splitMetadataList(
    entry.metadata[ORGANIZATION_IDS_KEY],
  )
  if (entryOrganizations === undefined) {
    return true
  }
  return entryOrganizations.some((organizationId) =>
    organizationIds.includes(organizationId),
  )
}

function tagsMatch(entry: ExternalMemoryEntry, tags: string[]): boolean {
  if (tags.length === 0) {
    return true
  }
  const entryTags = splitMetadataList(entry.metadata[TAGS_KEY]) ?? []
  return tags.every((tag) =>
    entryTags.map((entryTag) => entryTag.toLowerCase()).includes(tag),
  )
}

function metadataMatches(
  entry: ExternalMemoryEntry,
  metadata: Record<string, string> | undefined,
): boolean {
  if (metadata === undefined) {
    return true
  }
  return Object.entries(metadata).every(
    ([key, value]) => entry.metadata[key] === value,
  )
}

function textMatches(
  text: string,
  normalizedQuery: string,
  mode: string | undefined,
): boolean {
  if (normalizedQuery.length === 0) {
    return true
  }
  if (mode === "semantic") {
    return (
      cosineSimilarity(
        embedSearchText(normalizedQuery),
        embedSearchText(text),
      ) > 0
    )
  }
  return text.toLowerCase().includes(normalizedQuery)
}

function splitMetadataList(value: string | undefined): string[] | undefined {
  if (value === undefined || value.length === 0) {
    return undefined
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function copyEntry(entry: ExternalMemoryEntry): ExternalMemoryEntry {
  return {
    id: entry.id,
    text: entry.text,
    metadata: { ...entry.metadata },
  }
}
