import { homedir } from "node:os";
import path from "node:path";
import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { GraphMemoryStore } from "./store.js";

function resolveStoragePath(pluginConfig) {
  const configured = pluginConfig?.storagePath;
  if (configured !== undefined) {
    if (typeof configured !== "string" || !path.isAbsolute(configured)) {
      throw new Error("plugins.entries.openclaw-graph-memory.config.storagePath must be an absolute path");
    }
    return path.resolve(configured);
  }
  const stateRoot = process.env.OPENCLAW_STATE_DIR && path.isAbsolute(process.env.OPENCLAW_STATE_DIR)
    ? path.resolve(process.env.OPENCLAW_STATE_DIR)
    : path.join(homedir(), ".openclaw");
  return path.join(stateRoot, "graph-memory", "store.json");
}

function textResult(details) {
  return {
    content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
    details
  };
}

export default definePluginEntry({
  id: "openclaw-graph-memory",
  name: "OpenClaw Graph Memory",
  description: "Local graph memory with provenance, temporal status, and relationship-aware retrieval.",
  register(api) {
    const store = new GraphMemoryStore(resolveStoragePath(api.pluginConfig));

    api.registerTool({
      name: "graph_memory_add",
      description: "Store one explicit, source-backed relationship in local graph memory. Use only when the user has asked you to remember information or when recording a clearly established project fact. This tool writes local persistent memory.",
      parameters: Type.Object({
        subject: Type.String({ minLength: 1, maxLength: 500 }),
        predicate: Type.String({ minLength: 1, maxLength: 120 }),
        object: Type.String({ minLength: 1, maxLength: 2000 }),
        source: Type.String({ minLength: 1, maxLength: 1000 }),
        confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
        tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 20 })),
        supersedesId: Type.Optional(Type.String({ minLength: 1 }))
      }, { additionalProperties: false }),
      async execute(_toolCallId, params) {
        return textResult(await store.add(params));
      }
    }, { name: "graph_memory_add", optional: true });

    api.registerTool({
      name: "graph_memory_search",
      description: "Search local graph memory and optionally traverse connected facts. Returns each fact with its source, confidence, status, and whether it matched directly or through graph relationships. Read-only.",
      parameters: Type.Object({
        query: Type.String({ minLength: 1, maxLength: 500 }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
        depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 2 })),
        includeHistorical: Type.Optional(Type.Boolean())
      }, { additionalProperties: false }),
      async execute(_toolCallId, params) {
        return textResult(await store.search(params));
      }
    }, { name: "graph_memory_search", optional: true });

    api.registerTool({
      name: "graph_memory_update_status",
      description: "Mark a stored fact as disputed or restore a disputed fact as active, with an optional reason. Superseded facts remain immutable; use graph_memory_add with supersedesId to replace one.",
      parameters: Type.Object({
        id: Type.String({ minLength: 1 }),
        status: Type.Union([Type.Literal("active"), Type.Literal("disputed")]),
        reason: Type.Optional(Type.String({ maxLength: 500 }))
      }, { additionalProperties: false }),
      async execute(_toolCallId, params) {
        return textResult(await store.updateStatus(params));
      }
    }, { name: "graph_memory_update_status", optional: true });

    api.registerTool({
      name: "graph_memory_stats",
      description: "Return local graph memory counts: facts, unique entities, edges, and fact status distribution. Read-only.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        return textResult(await store.stats());
      }
    }, { name: "graph_memory_stats", optional: true });

    api.logger.info("OpenClaw Graph Memory registered; all tools are opt-in and writes are explicit.");
  }
});
