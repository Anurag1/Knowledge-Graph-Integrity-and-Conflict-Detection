# Knowledge Graph Integrity and Conflict Detection

This repository contains experiments and integrations for representing contextual information as graphs and detecting integrity issues.

## OpenClaw Graph Memory

A local OpenClaw plugin is available at [`integrations/openclaw-graph-memory/`](integrations/openclaw-graph-memory/). It stores explicit, source-backed relationships, preserves superseded facts, supports graph-neighborhood retrieval, and keeps all tools opt-in.

Start with the [plugin README](integrations/openclaw-graph-memory/README.md) for requirements, build/test commands, installation, configuration, and known limitations. The [synthetic retrieval benchmark](integrations/openclaw-graph-memory/benchmarks/RESULTS.md) documents the first controlled smoke experiment and its limitations.

## Existing context engine experiment

See [`context_engine/`](context_engine/) for the original temporal context graph proof of concept.
