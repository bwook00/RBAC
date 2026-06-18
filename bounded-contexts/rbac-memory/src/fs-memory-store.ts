import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import type {
  MemoryStore,
  StoreSearchInput,
  StoreWriteInput,
} from "./memory-store.js"
import { copyRecord } from "./memory-store.js"
import { isScopeAllowed, isValidScope } from "./scope.js"
import type { MemoryRecord, Scope, SearchMode } from "./types.js"
import { cosineSimilarity, embedSearchText } from "./vector-search.js"

const INDEX_DIR_NAME = ".index"
const INDEX_FILE_NAME = "search.json"
const INDEX_SCHEMA_VERSION = 2
const SEARCH_TERMS_PATTERN = /\s+/
const WORD_PATTERN = /[\p{L}\p{N}_-]+/gu

type FileEntry = {
  name: string
  isDirectory(): boolean
  isFile(): boolean
}

type SearchIndex = {
  schemaVersion: number
  records: SearchIndexRecord[]
}

type SearchIndexRecord = MemoryRecord & {
  key: string
  normalizedText: string
  tokens: string[]
  vector: number[]
}

type ScoredRecord = {
  record: SearchIndexRecord
  score: number
}

export type FsMemoryStoreOptions = {
  id?: string
  rootDir: string
}

export class FsMemoryStore implements MemoryStore {
  readonly id: string
  readonly #rootDir: string

  constructor(options: FsMemoryStoreOptions) {
    this.id = options.id ?? "fs"
    this.#rootDir = resolve(options.rootDir)
  }

  async write(input: StoreWriteInput): Promise<void> {
    const record = copyRecord(input.record)
    const filePath = this.#recordPath(record.scope, record.id)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8")
    await this.#upsertIndexRecord(record)
  }

  async search(input: StoreSearchInput): Promise<MemoryRecord[]> {
    const index = await this.#loadOrRebuildSearchIndex()
    const normalizedQuery = normalize(input.query)
    const mode = input.mode ?? "contains"
    const scored = index.records
      .filter((record) => isScopeAllowed(record.scope, input.readableScopes))
      .filter((record) => organizationMatches(record, input.organizationIds))
      .filter((record) => metadataMatches(record, input.metadata))
      .filter((record) => tagsMatch(record, input.tags ?? []))
      .map((record) => ({
        record,
        score: searchScore(record, normalizedQuery, mode),
      }))
      .filter((result) => result.score > 0)
      .sort(compareScoredRecords)

    return scored.slice(0, input.limit).map(({ record }) => copyRecord(record))
  }

  async list(): Promise<MemoryRecord[]> {
    const files = await this.#listJsonFiles(this.#rootDir)
    const records = await Promise.all(
      files.map(async (file) =>
        parseMemoryRecord(await readFile(file, "utf8")),
      ),
    )
    return records.map(copyRecord)
  }

  async clear(): Promise<void> {
    await rm(this.#rootDir, { recursive: true, force: true })
    await mkdir(this.#rootDir, { recursive: true })
  }

  async #loadOrRebuildSearchIndex(): Promise<SearchIndex> {
    try {
      return parseSearchIndex(await readFile(this.#indexPath(), "utf8"))
    } catch (error) {
      if (!shouldRebuildIndex(error)) {
        throw error
      }
    }

    const index = buildSearchIndex(await this.list())
    await this.#writeSearchIndex(index)
    return index
  }

  async #upsertIndexRecord(record: MemoryRecord): Promise<void> {
    let index: SearchIndex
    try {
      index = await this.#loadOrRebuildSearchIndex()
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error
      }
      index = buildSearchIndex([])
    }

    const indexed = toSearchIndexRecord(record)
    const records = index.records.filter((entry) => entry.key !== indexed.key)
    records.push(indexed)
    await this.#writeSearchIndex({
      schemaVersion: INDEX_SCHEMA_VERSION,
      records,
    })
  }

  async #writeSearchIndex(index: SearchIndex): Promise<void> {
    const indexPath = this.#indexPath()
    await mkdir(dirname(indexPath), { recursive: true })
    await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8")
  }

  #indexPath(): string {
    return this.#safeJoin(INDEX_DIR_NAME, INDEX_FILE_NAME)
  }

  #recordPath(scope: string, id: string): string {
    if (!isValidScope(scope)) {
      throw new Error("invalid memory scope")
    }
    const encodedId = encodeURIComponent(id)
    if (encodedId.length === 0 || encodedId.includes("%2F")) {
      throw new Error("invalid memory id")
    }
    return this.#safeJoin(...scope.split("/"), `${encodedId}.json`)
  }

  #safeJoin(...segments: string[]): string {
    const candidate = resolve(this.#rootDir, ...segments)
    const rootRelative = relative(this.#rootDir, candidate)
    if (
      rootRelative.startsWith("..") ||
      rootRelative.includes(`${sep}..${sep}`)
    ) {
      throw new Error("path escapes memory root")
    }
    return candidate
  }

  async #listJsonFiles(directory: string): Promise<string[]> {
    let entries: FileEntry[]
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return []
      }
      throw error
    }

    const childResults = await Promise.all(
      entries.map(async (entry) => {
        if (entry.name === INDEX_DIR_NAME) {
          return []
        }
        const child = join(directory, entry.name)
        if (entry.isDirectory()) {
          return this.#listJsonFiles(child)
        }
        if (entry.isFile() && entry.name.endsWith(".json")) {
          return [child]
        }
        return []
      }),
    )
    return childResults.flat()
  }
}

function buildSearchIndex(records: MemoryRecord[]): SearchIndex {
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    records: records.map(toSearchIndexRecord),
  }
}

function toSearchIndexRecord(record: MemoryRecord): SearchIndexRecord {
  const copied = copyRecord(record)
  const normalizedText = normalize(
    [
      copied.id,
      copied.scope,
      copied.content,
      ...(copied.organizationIds ?? []),
      ...(copied.tags ?? []),
      ...Object.entries(copied.metadata ?? {}).flat(),
    ].join(" "),
  )

  return {
    ...copied,
    key: recordKey(copied.scope, copied.id),
    normalizedText,
    tokens: tokenize(normalizedText),
    vector: embedSearchText(normalizedText),
  }
}

function parseMemoryRecord(json: string): MemoryRecord {
  const value = JSON.parse(json)
  if (!isRecord(value)) {
    throw new Error("invalid memory record")
  }
  if (typeof value.id !== "string") {
    throw new Error("invalid memory record id")
  }
  if (typeof value.scope !== "string" || !isValidScope(value.scope)) {
    throw new Error("invalid memory record scope")
  }
  if (
    value.organizationIds !== undefined &&
    !isStringArray(value.organizationIds)
  ) {
    throw new Error("invalid memory record organizations")
  }
  if (typeof value.content !== "string") {
    throw new Error("invalid memory record content")
  }
  if (value.tags !== undefined && !isStringArray(value.tags)) {
    throw new Error("invalid memory record tags")
  }
  if (value.metadata !== undefined && !isStringRecord(value.metadata)) {
    throw new Error("invalid memory record metadata")
  }
  return {
    id: value.id,
    scope: value.scope,
    organizationIds: value.organizationIds,
    content: value.content,
    tags: value.tags,
    metadata: value.metadata,
  }
}

function parseSearchIndex(json: string): SearchIndex {
  const value = JSON.parse(json)
  if (!isRecord(value) || value.schemaVersion !== INDEX_SCHEMA_VERSION) {
    throw new Error("invalid fs search index")
  }
  if (!Array.isArray(value.records)) {
    throw new Error("invalid fs search index records")
  }
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    records: value.records.map(parseSearchIndexRecord),
  }
}

function parseSearchIndexRecord(value: unknown): SearchIndexRecord {
  if (!isRecord(value)) {
    throw new Error("invalid fs search index record")
  }
  const record = parseMemoryRecord(JSON.stringify(value))
  if (typeof value.key !== "string") {
    throw new Error("invalid fs search index key")
  }
  if (typeof value.normalizedText !== "string") {
    throw new Error("invalid fs search index text")
  }
  if (!isStringArray(value.tokens)) {
    throw new Error("invalid fs search index tokens")
  }
  if (!isNumberArray(value.vector)) {
    throw new Error("invalid fs search index vector")
  }
  return {
    ...record,
    key: value.key,
    normalizedText: value.normalizedText,
    tokens: value.tokens,
    vector: value.vector,
  }
}

function searchScore(
  record: SearchIndexRecord,
  normalizedQuery: string,
  mode: SearchMode,
): number {
  if (normalizedQuery.length === 0) {
    return 1
  }
  if (mode === "semantic") {
    return cosineSimilarity(embedSearchText(normalizedQuery), record.vector)
  }
  if (mode === "exact") {
    return record.normalizedText === normalizedQuery ||
      normalize(record.content) === normalizedQuery
      ? 1000
      : 0
  }
  if (mode === "contains") {
    return record.normalizedText.includes(normalizedQuery)
      ? 100 + countOccurrences(record.normalizedText, normalizedQuery)
      : 0
  }

  const terms = normalizedQuery.split(SEARCH_TERMS_PATTERN).filter(Boolean)
  const matchedTerms = terms.filter((term) =>
    record.normalizedText.includes(term),
  )
  if (mode === "all" && matchedTerms.length !== terms.length) {
    return 0
  }
  if (mode === "any" && matchedTerms.length === 0) {
    return 0
  }
  return (
    matchedTerms.length * 10 +
    matchedTerms.reduce(
      (total, term) => total + countOccurrences(record.normalizedText, term),
      0,
    )
  )
}

function compareScoredRecords(left: ScoredRecord, right: ScoredRecord): number {
  if (left.score !== right.score) {
    return right.score - left.score
  }
  return left.record.key.localeCompare(right.record.key)
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
  return tags.every((tag) => recordTags.includes(tag.toLowerCase()))
}

function tokenize(value: string): string[] {
  return Array.from(new Set(value.match(WORD_PATTERN) ?? []))
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0
  }
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

function recordKey(scope: Scope, id: string): string {
  return `${scope}\u0000${id}`
}

function organizationFromScope(scope: Scope): string {
  return scope.split("/").slice(0, 2).join("/")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  )
}
function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  )
}
function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false
  }
  return Object.values(value).every((entry) => typeof entry === "string")
}

function isNodeError(error: unknown): error is { code: string } {
  return isRecord(error) && typeof error.code === "string"
}
function shouldRebuildIndex(error: unknown): boolean {
  if (isNodeError(error) && error.code === "ENOENT") {
    return true
  }
  return (
    error instanceof Error &&
    error.message.startsWith("invalid fs search index")
  )
}
