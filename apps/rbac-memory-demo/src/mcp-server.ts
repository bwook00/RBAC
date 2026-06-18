import type { MemoryRecord } from "@runbear/rbac-memory"
import { callerFromRole, type DemoState } from "./demo-state.js"

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
    description: "Store memory using the caller role scope.",
    inputSchema: {
      type: "object",
      required: ["roleId", "record"],
      properties: {
        roleId: { type: "string" },
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
    description: "Search memory visible to the caller role scope.",
    inputSchema: {
      type: "object",
      required: ["roleId", "query"],
      properties: {
        roleId: { type: "string" },
        query: { type: "string" },
        requestedScopes: { type: "array", items: { type: "string" } },
      },
    },
  },
]

export type McpCall =
  | {
      name: "memory_write"
      arguments: { roleId: string; record: MemoryRecord }
    }
  | {
      name: "memory_search"
      arguments: { roleId: string; query: string; requestedScopes?: string[] }
    }

export async function callMcpTool(
  state: DemoState,
  call: McpCall,
): Promise<unknown> {
  if (call.name === "memory_write") {
    return state.memory.memoryWrite({
      caller: callerFromRole(call.arguments.roleId),
      record: call.arguments.record,
    })
  }

  return state.memory.memorySearch({
    caller: callerFromRole(call.arguments.roleId),
    query: call.arguments.query,
    requestedScopes: call.arguments.requestedScopes,
    explain: "runtime",
  })
}

export async function handleMcpRequest(
  state: DemoState,
  request: Request,
): Promise<Response> {
  const parsed = parseJsonRpcRequest(await request.json())
  if (parsed === undefined) {
    return mcpResponse(null, undefined, {
      code: -32_600,
      message: "invalid_request",
    })
  }

  if (parsed.method === "initialize") {
    return mcpResponse(parsed.id, {
      protocolVersion: "2025-06-18",
      serverInfo: { name: "rbac-memory-demo", version: "0.0.0" },
      capabilities: { tools: {} },
    })
  }

  if (parsed.method === "tools/list") {
    return mcpResponse(parsed.id, { tools: listMcpTools() })
  }

  const call = parseToolCall(parsed.params)
  if (call === undefined) {
    return mcpResponse(parsed.id, undefined, {
      code: -32_602,
      message: "invalid_tool_call",
    })
  }

  const result = await callMcpTool(state, call)
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
    const roleId = value.arguments.roleId
    const record = value.arguments.record
    if (typeof roleId !== "string" || !isMemoryRecord(record)) {
      return undefined
    }
    return { name: "memory_write", arguments: { roleId, record } }
  }
  if (value.name === "memory_search") {
    const roleId = value.arguments.roleId
    const query = value.arguments.query
    const requestedScopes = value.arguments.requestedScopes
    if (typeof roleId !== "string" || typeof query !== "string") {
      return undefined
    }
    if (requestedScopes !== undefined && !isStringArray(requestedScopes)) {
      return undefined
    }
    return {
      name: "memory_search",
      arguments: { roleId, query, requestedScopes },
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
