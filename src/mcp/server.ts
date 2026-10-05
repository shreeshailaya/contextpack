import type { Readable, Writable } from "node:stream";
import {
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  LineBuffer,
  METHOD_NOT_FOUND,
  encodeMessage,
  fail,
  isJsonRpcRequest,
  isNotification,
  ok,
  parseLine,
  type JsonRpcId,
  type JsonRpcResponse,
} from "./jsonrpc.js";
import { MCP_TOOLS, callTool } from "./tools.js";

/** Protocol versions this server can speak. Echo the client's if we know it. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"] as const;
export const PREFERRED_PROTOCOL_VERSION = "2024-11-05";

export interface McpServerOptions {
  cwd: string;
  version: string;
}

function negotiateProtocolVersion(requested: unknown): string {
  if (typeof requested === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
    return requested;
  }
  return PREFERRED_PROTOCOL_VERSION;
}

function toolCallParams(params: unknown): { name: string; arguments: unknown } | { error: string } {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return { error: "params must be an object" };
  }
  const rec = params as Record<string, unknown>;
  if (typeof rec.name !== "string" || rec.name.length === 0) {
    return { error: "params.name must be a non-empty string" };
  }
  return { name: rec.name, arguments: rec.arguments };
}

/**
 * In-process MCP session. Drive this from tests; stdio wraps it.
 */
export class McpServer {
  readonly cwd: string;
  readonly version: string;

  constructor(opts: McpServerOptions) {
    this.cwd = opts.cwd;
    this.version = opts.version;
  }

  /**
   * Handle one parsed JSON-RPC value (single message, not a batch).
   * Returns a response, or null for notifications.
   */
  dispatch(raw: unknown): JsonRpcResponse | null {
    if (!isJsonRpcRequest(raw)) {
      const id =
        raw !== null && typeof raw === "object" && !Array.isArray(raw) && "id" in raw
          ? ((raw as { id?: JsonRpcId }).id ?? null)
          : null;
      return fail(id, INVALID_REQUEST, "Invalid Request");
    }

    if (isNotification(raw)) {
      return null;
    }

    const id = raw.id as JsonRpcId;

    try {
      return this.handleRequest(id, raw.method, raw.params);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(id, INTERNAL_ERROR, message);
    }
  }

  private handleRequest(id: JsonRpcId, method: string, params: unknown): JsonRpcResponse {
    switch (method) {
      case "initialize":
        return this.initialize(id, params);
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: MCP_TOOLS });
      case "tools/call":
        return this.callTool(id, params);
      default:
        return fail(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  private initialize(id: JsonRpcId, params: unknown): JsonRpcResponse {
    const requested =
      params !== null && typeof params === "object" && !Array.isArray(params)
        ? (params as { protocolVersion?: unknown }).protocolVersion
        : undefined;
    const protocolVersion = negotiateProtocolVersion(requested);
    return ok(id, {
      protocolVersion,
      capabilities: { tools: {} },
      serverInfo: {
        name: "contextpack",
        version: this.version,
      },
      instructions:
        "Pack a repository into a token-budgeted digest. Call list to preview which files fit a budget (no bodies). Call pack for the digest. Token counts are estimates (characters/4). Default root is the server cwd; relative paths only. Secret redaction is on. Project config (.contextpack.json) is respected.",
    });
  }

  private callTool(id: JsonRpcId, params: unknown): JsonRpcResponse {
    const parsed = toolCallParams(params);
    if ("error" in parsed) {
      return fail(id, INVALID_PARAMS, parsed.error);
    }
    const result = callTool(this.cwd, parsed.name, parsed.arguments);
    return ok(id, result);
  }
}

export interface McpStdioOptions extends McpServerOptions {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
}

/**
 * Run the MCP server on stdio. stdout is protocol-only; logs go to stderr.
 * Resolves when stdin ends.
 */
export function runMcpStdio(opts: McpStdioOptions): Promise<void> {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const server = new McpServer({ cwd: opts.cwd, version: opts.version });
  const buffer = new LineBuffer();

  const write = (msg: JsonRpcResponse): void => {
    stdout.write(encodeMessage(msg));
  };

  const handleLine = (line: string): void => {
    const parsed = parseLine(line);
    if (!parsed.ok) {
      write(parsed.error);
      return;
    }
    if (Array.isArray(parsed.value)) {
      for (const item of parsed.value) {
        const response = server.dispatch(item);
        if (response) write(response);
      }
      return;
    }
    const response = server.dispatch(parsed.value);
    if (response) write(response);
  };

  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer | string): void => {
      try {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        for (const line of buffer.push(text)) {
          handleLine(line);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        stderr.write(`contextpack mcp: ${message}\n`);
        cleanup();
        reject(err instanceof Error ? err : new Error(message));
      }
    };

    const onError = (err: Error): void => {
      stderr.write(`contextpack mcp: ${err.message}\n`);
      cleanup();
      reject(err);
    };

    const onEnd = (): void => {
      cleanup();
      resolve();
    };

    const cleanup = (): void => {
      stdin.off("data", onData);
      stdin.off("error", onError);
      stdin.off("end", onEnd);
    };

    stdin.on("data", onData);
    stdin.on("error", onError);
    stdin.on("end", onEnd);

    if (typeof (stdin as NodeJS.ReadStream).resume === "function") {
      (stdin as NodeJS.ReadStream).resume();
    }
  });
}
