import type { CallerContext, MemoryRecord } from "@runbear/rbac-memory"
import { resolveBearerCaller } from "./auth.js"
import type { DemoState } from "./demo-state.js"

export type McpToolName = "memory_write" | "memory_search"

type JsonRpcId = number | string | null

type JsonRpcRequest = {
  jsonrpc: "2.0"
  id: JsonRpcId
  method: "initialize" | "tools/list" | "tools/call"
  params?: unknown
}

export type McpToolDefinition = {
  name: McpToolName
  description: string
  inputSchema: {
    type: "object"
    required: string[]
    properties: Record<string, unknown>
  }
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "memory_write",
    description:
      "Store memory using the scope of the authenticated bearer token.",
    inputSchema: {
      type: "object",
      required: ["record"],
      properties: {
        record: {
          type: "object",
          required: ["id", "scope", "content"],
          properties: {
            id: { type: "string" },
            scope: { type: "string" },
            content: { type: "string" },
          },
        },
      },
    },
  },
  {
    name: "memory_search",
    description:
      "Search memory visible to the authenticated bearer token's scope.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        requestedScopes: { type: "array", items: { type: "string" } },
      },
    },
  },
]

export type McpCall =
  | {
      name: "memory_write"
      arguments: { record: MemoryRecord }
    }
  | {
      name: "memory_search"
      arguments: { query: string; requestedScopes?: string[] }
    }

export async function callMcpTool(
  state: DemoState,
  caller: CallerContext,
  call: McpCall,
): Promise<unknown> {
  if (call.name === "memory_write") {
    return state.memory.memoryWrite({
      caller,
      record: call.arguments.record,
    })
  }

  return state.memory.memorySearch({
    caller,
    query: call.arguments.query,
    requestedScopes: call.arguments.requestedScopes,
    explain: "runtime",
  })
}

export async function handleMcpRequest(
  state: DemoState,
  request: Request,
  now: number,
): Promise<Response> {
  const payload = await request.json()

  // JSON-RPC notifications (e.g. `notifications/initialized`) carry no `id`
  // and expect no response body — acknowledge with 202 per the MCP handshake.
  if (isNotificationPayload(payload)) {
    return new Response(null, { status: 202 })
  }

  const parsed = parseJsonRpcRequest(payload)
  if (parsed === undefined) {
    return mcpResponse(null, undefined, {
      code: -32_600,
      message: "invalid_request",
    })
  }

  if (parsed.method === "initialize") {
    return mcpResponse(parsed.id, {
      protocolVersion: requestedProtocolVersion(parsed.params),
      serverInfo: { name: "rbac-memory-demo", version: "0.0.0" },
      capabilities: { tools: {} },
    })
  }

  if (parsed.method === "tools/list") {
    return mcpResponse(parsed.id, { tools: listMcpTools() })
  }

  const caller = resolveBearerCaller(state.directory, request, now)
  if (caller === undefined) {
    return mcpResponse(parsed.id, undefined, {
      code: -32_001,
      message: "unauthorized",
    })
  }

  const call = parseToolCall(parsed.params)
  if (call === undefined) {
    return mcpResponse(parsed.id, undefined, {
      code: -32_602,
      message: "invalid_tool_call",
    })
  }

  const result = await callMcpTool(state, caller, call)
  return mcpResponse(parsed.id, {
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError: isDeniedResult(result),
  })
}

export function listMcpTools(): McpToolDefinition[] {
  return MCP_TOOLS.map((tool) => ({
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      required: [...tool.inputSchema.required],
      properties: { ...tool.inputSchema.properties },
    },
  }))
}

function parseJsonRpcRequest(value: unknown): JsonRpcRequest | undefined {
  if (!isObject(value)) {
    return undefined
  }
  const { jsonrpc, id, method, params } = value
  if (jsonrpc !== "2.0" || !isJsonRpcId(id)) {
    return undefined
  }
  if (
    method !== "initialize" &&
    method !== "tools/list" &&
    method !== "tools/call"
  ) {
    return undefined
  }
  return { jsonrpc, id, method, params }
}

function parseToolCall(value: unknown): McpCall | undefined {
  if (!(isObject(value) && isObject(value.arguments))) {
    return undefined
  }
  if (value.name === "memory_write") {
    const record = value.arguments.record
    if (!isMemoryRecord(record)) {
      return undefined
    }
    return { name: "memory_write", arguments: { record } }
  }
  if (value.name === "memory_search") {
    const query = value.arguments.query
    const requestedScopes = value.arguments.requestedScopes
    if (typeof query !== "string") {
      return undefined
    }
    if (requestedScopes !== undefined && !isStringArray(requestedScopes)) {
      return undefined
    }
    return {
      name: "memory_search",
      arguments: { query, requestedScopes },
    }
  }
  return undefined
}

function isMemoryRecord(value: unknown): value is MemoryRecord {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.scope === "string" &&
    typeof value.content === "string"
  )
}

function isDeniedResult(value: unknown): boolean {
  return isObject(value) && value.allowed === false
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return (
    value === null || typeof value === "string" || typeof value === "number"
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNotificationPayload(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.method === "string" &&
    value.id === undefined
  )
}

const DEFAULT_PROTOCOL_VERSION = "2025-06-18"

function requestedProtocolVersion(params: unknown): string {
  if (isObject(params) && typeof params.protocolVersion === "string") {
    return params.protocolVersion
  }
  return DEFAULT_PROTOCOL_VERSION
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function mcpResponse(
  id: JsonRpcId,
  result?: unknown,
  error?: { code: number; message: string },
): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result, error }), {
    headers: { "content-type": "application/json" },
  })
}
