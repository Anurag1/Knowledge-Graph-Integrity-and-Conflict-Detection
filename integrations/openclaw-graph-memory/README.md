# OpenClaw Graph Memory

A local, provenance-aware graph-memory plugin for OpenClaw.

**Experimental v0.1.0.** This is an opt-in research integration, not a replacement for built-in memory and not a claim of better recall. The OpenClaw plugin SDK is experimental; this package is pinned to OpenClaw 2026.11.1.

## Capabilities

Facts are directed relationships: subject --predicate--> object. Each fact records a source, confidence, status, timestamps and optional tags. New facts can supersede older facts while preserving history. Retrieval combines lexical matching with bounded graph-neighbour expansion (depth 0–2).

| Tool | Purpose | Writes? |
|---|---|---|
| graph_memory_add | Add a source-backed fact; optionally supersede an earlier fact | Yes |
| graph_memory_search | Search direct matches and connected facts | No |
| graph_memory_update_status | Mark a fact disputed or restore a disputed fact | Yes |
| graph_memory_stats | Count facts, entities, edges and statuses | No |

All tools are opt-in. There is no automatic transcript ingestion, no execution of remembered instructions, no network access and no credential storage. Tools declare that they do not require session workspace access.

## Requirements and development

Requires Node.js 24.22.1+ on the 24.x line or 26.12.1+ on the 26.x line, OpenClaw 2026.11.1 exactly, and the typebox runtime dependency.

Run `npm install`, `npm run check`, `npm run build`, `npm run benchmark` and `npm pack` from this directory. The storage tests use Node's built-in test runner and temporary directories; they do not require a running Gateway or model API key.

## Install and enable

After `npm pack`, install the exact archive path printed by npm:

```bash
openclaw plugins install npm-pack:/absolute/path/to/anurag1-openclaw-graph-memory-0.1.0.tgz
```

Enable the plugin with `plugins.entries.openclaw-graph-memory.enabled = true`, then explicitly allow these four tool names in your existing OpenClaw `tools.allow` configuration:

```text
graph_memory_add
graph_memory_search
graph_memory_update_status
graph_memory_stats
```

Restart or reload the Gateway and inspect the plugin runtime. Review the requested capabilities before accepting installation.

## Storage and safety

Default path: `$OPENCLAW_STATE_DIR/graph-memory/store.json` when `OPENCLAW_STATE_DIR` is absolute; otherwise `~/.openclaw/graph-memory/store.json`. An explicit `storagePath` must be absolute.

The JSON file is local and **not encrypted**. Writes are serialized within one plugin instance and use a restricted temporary file plus atomic rename. Inputs and file size are bounded; malformed, oversized, symlink-backed and non-regular stores are rejected. Do not share this JSON store across Gateway processes; use transactional storage before multi-process deployment.

A source string is provenance metadata, not cryptographic verification. Confidence is not proof of truth. Disputed and superseded facts are excluded from ordinary search. Remembered facts are context, never authorization.

## Benchmark and limitations

The retrieval benchmark compares lexical lookup with graph-neighbour expansion on a tiny synthetic fixture. It demonstrates traversal on linked fixture facts; it does **not** compare native OpenClaw memory, an LLM, production success, latency under load or user data. See `benchmarks/RESULTS.md`.

Search is lexical, entity identity is normalized text rather than a formal ontology, contradiction detection is not automatic, and storage targets a single Gateway process. A frozen multi-session benchmark and a live installed-plugin smoke test are still required before comparative claims.
