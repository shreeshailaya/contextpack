import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createProgram } from "../src/cli.js";
import { LineBuffer, PARSE_ERROR, isNotification, parseLine } from "../src/mcp/jsonrpc.js";
import { McpServer, PREFERRED_PROTOCOL_VERSION, runMcpStdio } from "../src/mcp/server.js";
import { MCP_TOOLS, callTool, resolveToolRoot } from "../src/mcp/tools.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO = "fixtures/demo-project";
const PKG_VERSION = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { version: string })
  .version;

const temps: string[] = [];

function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-mcp-"));
  temps.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

afterEach(() => {
  for (const d of temps.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function server(cwd: string = REPO_ROOT, version = PKG_VERSION): McpServer {
  return new McpServer({ cwd, version });
}

function rpc(
  s: McpServer,
  method: string,
  params?: unknown,
  id: number | string = 1,
): Record<string, unknown> {
  const response = s.dispatch({ jsonrpc: "2.0", id, method, params });
  expect(response).not.toBeNull();
  return response as Record<string, unknown>;
}

function toolText(response: Record<string, unknown>): { text: string; isError?: boolean } {
  const result = response.result as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.content[0]?.type).toBe("text");
  return { text: result.content[0]!.text, isError: result.isError };
}

describe("MCP CLI", () => {
  it("registers the mcp command", () => {
    const program = createProgram();
    const mcp = program.commands.find((c) => c.name() === "mcp");
    expect(mcp).toBeDefined();
    expect(mcp!.description()).toMatch(/Model Context Protocol/i);
  });
});

describe("initialize + tools/list", () => {
  it("answers initialize with protocol version, tools capability, and serverInfo", () => {
    const res = rpc(server(), "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });

    expect(res.error).toBeUndefined();
    const result = res.result as {
      protocolVersion: string;
      capabilities: { tools: object };
      serverInfo: { name: string; version: string };
    };
    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.capabilities.tools).toEqual({});
    expect(result.serverInfo.name).toBe("contextpack");
    expect(result.serverInfo.version).toBe(PKG_VERSION);
  });

  it("falls back to the preferred protocol version when the client asks for an unknown one", () => {
    const res = rpc(server(), "initialize", { protocolVersion: "nope" });
    const result = res.result as { protocolVersion: string };
    expect(result.protocolVersion).toBe(PREFERRED_PROTOCOL_VERSION);
  });

  it("lists pack and list with JSON Schema args", () => {
    const res = rpc(server(), "tools/list");
    const result = res.result as { tools: { name: string; inputSchema: { properties: object } }[] };
    const names = result.tools.map((t) => t.name);
    expect(names).toEqual(["pack", "list"]);
    expect(result.tools).toEqual(MCP_TOOLS);

    const pack = result.tools.find((t) => t.name === "pack")!;
    const list = result.tools.find((t) => t.name === "list")!;
    expect(pack.inputSchema.properties).toMatchObject({
      path: { type: "string" },
      budget: { type: "number" },
      focus: expect.anything(),
      since: { type: "string" },
      diff: { type: "boolean" },
      paths: { type: "array" },
      ignore: expect.anything(),
      include: expect.anything(),
      format: { enum: ["md", "json"] },
      noMap: { type: "boolean" },
    });
    expect(list.inputSchema.properties).toMatchObject({
      format: { enum: ["json", "plain"] },
    });
  });

  it("answers ping with an empty result", () => {
    const res = rpc(server(), "ping");
    expect(res.result).toEqual({});
  });

  it("returns no response for notifications/initialized", () => {
    const s = server();
    const response = s.dispatch({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(response).toBeNull();
    expect(
      isNotification({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ).toBe(true);
  });

  it("returns method-not-found for unknown requests", () => {
    const res = rpc(server(), "resources/list");
    expect(res.error).toMatchObject({ code: -32601 });
  });
});

describe("pack + list tools", () => {
  it("packs fixtures/demo-project under a budget", () => {
    const res = rpc(server(), "tools/call", {
      name: "pack",
      arguments: { path: DEMO, budget: 500 },
    });
    const { text, isError } = toolText(res);
    expect(isError).toBeUndefined();
    expect(text).toContain("# contextpack digest");
    expect(text).toContain("README.md");
    expect(text).toContain("Demo Project");
    expect(text).toContain("src/index.js");
    expect(text).not.toContain("vendor/pad-lib");
    expect(text).not.toContain("build/bundle.js");
  });

  it("lists fixtures/demo-project without file bodies", () => {
    const res = rpc(server(), "tools/call", {
      name: "list",
      arguments: { path: DEMO, budget: 500 },
    });
    const { text, isError } = toolText(res);
    expect(isError).toBeUndefined();
    const parsed = JSON.parse(text) as {
      entries: { path: string; status: string }[];
      summary: { included: number };
    };
    expect(parsed.entries.length).toBeGreaterThan(0);
    expect(parsed.entries.some((e) => e.path === "README.md")).toBe(true);
    expect(parsed.summary.included).toBeGreaterThan(0);
    expect(text).not.toContain("Demo Project");
    expect(text).not.toContain("npm start");
  });

  it("rejects absolute pack roots and .. escapes outside cwd", () => {
    const s = server();

    const abs = toolText(
      rpc(s, "tools/call", { name: "pack", arguments: { path: "/etc" } }, 10),
    );
    expect(abs.isError).toBe(true);
    expect(abs.text).toMatch(/rejecting absolute path/);

    const parent = toolText(
      rpc(s, "tools/call", { name: "list", arguments: { path: ".." } }, 11),
    );
    expect(parent.isError).toBe(true);
    expect(parent.text).toMatch(/rejecting path outside server cwd/);
  });

  it("rejects absolute and outside-root listed paths", () => {
    const s = server();

    const abs = toolText(
      rpc(
        s,
        "tools/call",
        { name: "pack", arguments: { path: DEMO, paths: ["/etc/passwd"] } },
        12,
      ),
    );
    expect(abs.isError).toBe(true);
    expect(abs.text).toMatch(/rejecting absolute path/);

    const escape = toolText(
      rpc(
        s,
        "tools/call",
        { name: "list", arguments: { path: DEMO, paths: ["../../package.json"] } },
        13,
      ),
    );
    expect(escape.isError).toBe(true);
    expect(escape.text).toMatch(/rejecting path outside root/);
  });

  it("redacts obvious secrets by default", () => {
    const fakeGithub = "ghp_exampletokenexampletoken";
    const root = tmpProject({
      "src/config.ts": `export const token = "${fakeGithub}";\n`,
    });

    const res = rpc(server(root), "tools/call", {
      name: "pack",
      arguments: { budget: 0 },
    });
    const { text, isError } = toolText(res);
    expect(isError).toBeUndefined();
    expect(text).toContain("[REDACTED:github-token]");
    expect(text).not.toContain(fakeGithub);
  });

  it("respects .contextpack.json the same way the CLI does", () => {
    const root = tmpProject({
      ".contextpack.json": JSON.stringify({ format: "json", budget: 8000 }),
      "README.md": "# Hello\n",
    });

    const res = rpc(server(root), "tools/call", {
      name: "pack",
      arguments: {},
    });
    const { text, isError } = toolText(res);
    expect(isError).toBeUndefined();
    const parsed = JSON.parse(text) as { budget: number; files: { path: string }[] };
    expect(parsed.budget).toBe(8000);
    expect(parsed.files.some((f) => f.path === "README.md")).toBe(true);
  });

  it("unknown tool names are tool errors, not protocol crashes", () => {
    const { text, isError } = toolText(
      rpc(server(), "tools/call", { name: "compare", arguments: {} }),
    );
    expect(isError).toBe(true);
    expect(text).toMatch(/unknown tool/);
  });
});

describe("path safety helpers", () => {
  it("resolveToolRoot allows . and relative children, rejects absolute and ..", () => {
    const cwd = tmpProject({ "src/a.ts": "export {}\n" });
    expect(resolveToolRoot(cwd, undefined).ok).toBe(true);
    expect(resolveToolRoot(cwd, ".").ok).toBe(true);
    expect(resolveToolRoot(cwd, "src").ok).toBe(true);
    expect(resolveToolRoot(cwd, "/tmp").ok).toBe(false);
    expect(resolveToolRoot(cwd, "..").ok).toBe(false);
  });
});

describe("stdio loop", () => {
  it("writes only JSON-RPC lines to stdout for initialize + tools/list + pack", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let stderrText = "";
    stderr.on("data", (c: Buffer) => {
      stderrText += c.toString("utf8");
    });

    const running = runMcpStdio({
      cwd: REPO_ROOT,
      version: PKG_VERSION,
      stdin,
      stdout,
      stderr,
    });

    const messages = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "pack", arguments: { path: DEMO, budget: 500 } },
      },
    ];

    let raw = "";
    stdout.on("data", (c: Buffer) => {
      raw += c.toString("utf8");
    });

    stdin.write(messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
    stdin.end();
    await running;

    const lines = raw.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(3);
    const parsed = lines.map((l) => JSON.parse(l) as { id: number; result?: unknown; error?: unknown });
    expect(parsed.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(parsed.every((p) => p.error === undefined)).toBe(true);

    const packResult = parsed[2]!.result as { content: { text: string }[] };
    expect(packResult.content[0]!.text).toContain("# contextpack digest");
    expect(raw).not.toContain("# contextpack digest\n");
    expect(stderrText).toBe("");
  });
});

describe("JSON-RPC framing", () => {
  it("LineBuffer splits on newlines and drops blanks", () => {
    const buf = new LineBuffer();
    expect(buf.push('{"a":1}\n\n{"b":2}\r\n')).toEqual(['{"a":1}', '{"b":2}']);
    expect(buf.push('{"c":')).toEqual([]);
    expect(buf.push("3}\n")).toEqual(['{"c":3}']);
  });

  it("parseLine returns a -32700 error for invalid JSON", () => {
    const parsed = parseLine("not-json");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.error?.code).toBe(PARSE_ERROR);
    }
  });
});
