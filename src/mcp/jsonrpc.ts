/** JSON-RPC 2.0 types and helpers for the MCP stdio server. */

export type JsonRpcId = string | number | null;

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  if (rec.jsonrpc !== "2.0") return false;
  if (typeof rec.method !== "string" || rec.method.length === 0) return false;
  if ("id" in rec && !isJsonRpcId(rec.id)) return false;
  return true;
}

export function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === "string" || typeof value === "number";
}

export function isNotification(msg: JsonRpcRequest): boolean {
  return !("id" in msg);
}

export function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function fail(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  const error: JsonRpcErrorObject = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

export function parseLine(line: string): { ok: true; value: unknown } | { ok: false; error: JsonRpcResponse } {
  try {
    return { ok: true, value: JSON.parse(line) as unknown };
  } catch {
    return { ok: false, error: fail(null, PARSE_ERROR, "Parse error") };
  }
}

export function encodeMessage(msg: JsonRpcResponse): string {
  return JSON.stringify(msg) + "\n";
}

/** Split incoming stdio bytes into JSON-RPC lines (`\n` / `\r\n`). */
export class LineBuffer {
  private buf = "";

  push(chunk: string): string[] {
    this.buf += chunk;
    const lines: string[] = [];
    while (true) {
      const idx = this.buf.indexOf("\n");
      if (idx === -1) break;
      const line = this.buf.slice(0, idx).replace(/\r$/, "");
      this.buf = this.buf.slice(idx + 1);
      if (line.trim().length > 0) lines.push(line);
    }
    return lines;
  }
}
