import type {
  ExternalMemoryClient,
  ExternalMemoryEntry,
} from "./external-memory-store.js"
import { isScopeAllowed } from "./scope.js"
import type { Scope } from "./types.js"

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export type Mem0MemoryClientOptions = {
  apiKey: string
  userId: string
  baseUrl?: string
  topK?: number
  fetchFn?: FetchLike
}

export class Mem0MemoryClient implements ExternalMemoryClient {
  readonly #apiKey: string
  readonly #userId: string
  readonly #baseUrl: string
  readonly #topK: number
  readonly #fetchFn: FetchLike

  constructor(options: Mem0MemoryClientOptions) {
    if (options.apiKey.length === 0) {
      throw new Error("MEM0_API_KEY is required")
    }
    if (options.userId.length === 0) {
      throw new Error("Mem0 userId is required")
    }
    this.#apiKey = options.apiKey
    this.#userId = options.userId
    this.#baseUrl = options.baseUrl ?? "https://api.mem0.ai"
    this.#topK = options.topK ?? 25
    this.#fetchFn = options.fetchFn ?? fetch
  }

  async add(entry: ExternalMemoryEntry): Promise<void> {
    await this.#request("/v3/memories/add/", {
      user_id: this.#userId,
      messages: [{ role: "user", content: entry.text }],
      metadata: {
        ...entry.metadata,
        rbac_memory_id: entry.id,
      },
    })
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
    const response = await this.#request("/v3/memories/search/", {
      query: input.query,
      filters: {
        user_id: this.#userId,
        ...(input.metadata ?? {}),
      },
      top_k: input.limit ?? this.#topK,
    })
    return readMem0Entries(response).filter((entry) =>
      input.scopes.some((scope) =>
        isScopeAllowed(entry.metadata.scope ?? "", [scope]),
      ),
    )
  }

  async list(): Promise<ExternalMemoryEntry[]> {
    const response = await this.#request("/v3/memories/", {
      filters: { user_id: this.#userId },
      page: 1,
      page_size: 100,
    })
    return readMem0Entries(response)
  }

  async #request(
    path: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await this.#fetchFn(`${this.#baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Token ${this.#apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    })
    const payload = await response.json()
    if (!response.ok) {
      throw new Error(`mem0 request failed: ${response.status}`)
    }
    return payload
  }
}

function readMem0Entries(payload: unknown): ExternalMemoryEntry[] {
  if (!isRecord(payload)) {
    return []
  }
  const rawResults = Array.isArray(payload.results) ? payload.results : []
  return rawResults.flatMap((item) => {
    const entry = readMem0Entry(item)
    return entry === null ? [] : [entry]
  })
}

function readMem0Entry(value: unknown): ExternalMemoryEntry | null {
  if (!isRecord(value)) {
    return null
  }
  const metadata = readStringMetadata(value.metadata)
  const text = readMemoryText(value)
  const id = metadata.rbac_memory_id ?? readString(value.id)
  const scope = metadata.scope
  if (id === undefined || text === undefined || scope === undefined) {
    return null
  }
  const entryMetadata = removeInternalMetadata(metadata)
  return {
    id,
    text,
    metadata: entryMetadata,
  }
}

function readMemoryText(value: Record<string, unknown>): string | undefined {
  return (
    readString(value.memory) ??
    readString(value.text) ??
    readString(value.content)
  )
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function readStringMetadata(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {}
  }
  const metadata: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      metadata[key] = entry
    }
  }
  return metadata
}

function removeInternalMetadata(
  metadata: Record<string, string>,
): Record<string, string> {
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (key !== "rbac_memory_id") {
      clean[key] = value
    }
  }
  return clean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
