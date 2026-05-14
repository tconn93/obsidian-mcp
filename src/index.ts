import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import http from "http";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { authorised, handleMetadata } from "./auth.js";

import { fileToolDefs, handleFileTool } from "./tools/files.js";

// Load .env from project root (needed for stdio mode)
function loadEnv(): void {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(__dirname, "../.env"),
    path.resolve(__dirname, "../../.env"),
  ];
  for (const envPath of candidates) {
    try {
      const content = fs.readFileSync(envPath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = value;
      }
    } catch {
      // .env not found at this path — try next
    }
  }
}
loadEnv();

const allTools = [...fileToolDefs];

const fileTool = new Set(fileToolDefs.map((t) => t.name));

async function dispatch(name: string, args: Record<string, unknown>): Promise<string> {
  if (fileTool.has(name)) return handleFileTool(name, args);
  throw new Error(`Unknown tool: ${name}`);
}

function makeServer(): Server {
  const server = new Server(
    { name: "obsidian-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allTools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const text = await dispatch(name, (args ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text", text }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  });

  return server;
}

const useStdio = process.argv.includes("--stdio");

if (useStdio) {
  const server = makeServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
} else {
  const PORT = parseInt(process.env.PORT ?? "8083", 10);
  const HOST = process.env.HOST ?? "0.0.0.0";

  const sessions = new Map<string, StreamableHTTPServerTransport>();

  function forgetTransport(transport: StreamableHTTPServerTransport): void {
    const sid = transport.sessionId;
    if (sid) {
      sessions.delete(sid);
      console.error(`[obsidian-mcp] Session removed: ${sid} | active: ${sessions.size}`);
    }
  }

  const httpServer = http.createServer(async (req, res) => {
    // Handle connection drops without crashing
    req.on("error", (err) => {
      console.error(`[obsidian-mcp] Request error: ${err.message}`);
    });
    res.on("error", (err) => {
      console.error(`[obsidian-mcp] Response error: ${err.message}`);
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/.well-known/oauth-authorization-server" && req.method === "GET") {
      const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";
      const host  = req.headers.host ?? `localhost:${PORT}`;
      handleMetadata(req, res, `${proto}://${host}`);
      return;
    }

    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", active_sessions: sessions.size }));
      return;
    }

    if (req.url === "/mcp") {
      if (!(await authorised(req))) {
        res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId) {
        const transport = sessions.get(sessionId);
        if (!transport) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Session not found: ${sessionId}` }));
          return;
        }
        try {
          await transport.handleRequest(req, res);
        } catch (err) {
          console.error(`[obsidian-mcp] Session error: ${sessionId} — removing`);
          forgetTransport(transport);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Session error — reconnect required" }));
          }
        }
        return;
      }

      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "New sessions must start with POST /mcp" }));
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      transport.onclose = () => {
        forgetTransport(transport);
      };

      transport.onerror = (err) => {
        console.error(`[obsidian-mcp] Transport error: ${err.message}`);
        forgetTransport(transport);
      };

      const server = makeServer();
      await server.connect(transport);
      await transport.handleRequest(req, res);

      const sid = transport.sessionId;
      if (sid) {
        sessions.set(sid, transport);
        console.error(`[obsidian-mcp] New session:    ${sid} | active: ${sessions.size}`);
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. MCP endpoint is POST /mcp" }));
  });

  httpServer.listen(PORT, HOST, () => {
    console.error(`[obsidian-mcp] HTTP server listening on http://${HOST}:${PORT}`);
    console.error(`[obsidian-mcp]   MCP  →  http://${HOST}:${PORT}/mcp`);
    console.error(`[obsidian-mcp]   Health → http://${HOST}:${PORT}/health`);
    console.error(`[obsidian-mcp]   Stdio mode: node dist/index.js --stdio`);
  });

  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      console.error("[obsidian-mcp] Shutting down...");
      httpServer.close(() => process.exit(0));
    });
  }
}
