import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GraphMemoryStore } from "../src/store.js";

async function withStore(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openclaw-graph-memory-"));
  const file = path.join(directory, "store.json");
  try {
    await run(new GraphMemoryStore(file), { directory, file });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const fact = (overrides = {}) => ({
  subject: "Project Atlas",
  predicate: "uses",
  object: "PostgreSQL",
  source: "user-approved project note",
  confidence: 0.95,
  tags: ["database", "project"],
  ...overrides
});

test("add persists a source-backed fact and stats count graph nodes and edges", async () => {
  await withStore(async (store) => {
    const added = await store.add(fact());
    assert.equal(added.duplicate, false);
    assert.ok(added.fact.id);
    assert.equal(added.fact.status, "active");
    assert.equal((await store.stats()).facts, 1);
    assert.equal((await store.stats()).entities, 2);
    assert.equal((await store.stats()).edges, 1);
  });
});

test("duplicate active triples are idempotent", async () => {
  await withStore(async (store) => {
    const first = await store.add(fact());
    const second = await store.add(fact({ source: "a repeated note" }));
    assert.equal(second.duplicate, true);
    assert.equal(second.fact.id, first.fact.id);
    assert.equal((await store.stats()).facts, 1);
  });
});

test("search returns direct matches and graph-connected neighbors", async () => {
  await withStore(async (store) => {
    await store.add(fact());
    await store.add(fact({ subject: "PostgreSQL", predicate: "runs on", object: "managed cloud database", tags: [] }));
    await store.add(fact({ subject: "Project Atlas", predicate: "owned by", object: "Platform Team", tags: [] }));
    const direct = await store.search({ query: "Project Atlas", depth: 0 });
    assert.equal(direct.results.length, 2);
    assert.ok(direct.results.every((item) => item.matchType === "direct"));
    const expanded = await store.search({ query: "Project Atlas", depth: 1, limit: 10 });
    assert.ok(expanded.results.some((item) => item.matchType === "graph-neighbor"));
  });
});

test("superseding a fact preserves its history and marks the old record", async () => {
  await withStore(async (store) => {
    const old = await store.add(fact());
    const replacement = await store.add(fact({
      object: "PostgreSQL 18",
      source: "updated approved architecture decision",
      supersedesId: old.fact.id
    }));
    assert.equal(replacement.supersededId, old.fact.id);
    const historical = await store.search({ query: "Project Atlas", includeHistorical: true, depth: 0, limit: 10 });
    assert.ok(historical.results.some((item) => item.fact.id === old.fact.id && item.fact.status === "superseded"));
    assert.ok(historical.results.some((item) => item.fact.id === replacement.fact.id && item.fact.status === "active"));
    await assert.rejects(() => store.updateStatus({ id: old.fact.id, status: "active" }), /immutable historical evidence/);
  });
});

test("disputed facts are excluded from default search and can be restored", async () => {
  await withStore(async (store) => {
    const added = await store.add(fact());
    await store.updateStatus({ id: added.fact.id, status: "disputed", reason: "Conflicting source found" });
    assert.equal((await store.search({ query: "Project Atlas" })).results.length, 0);
    assert.equal((await store.search({ query: "Project Atlas", includeHistorical: true })).results.length, 1);
    await store.updateStatus({ id: added.fact.id, status: "active", reason: "Source reconciled" });
    assert.equal((await store.search({ query: "Project Atlas" })).results.length, 1);
  });
});

test("concurrent writes within one plugin instance are serialized", async () => {
  await withStore(async (store) => {
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.add(fact({
      subject: `Task ${index}`,
      object: `Result ${index}`
    }))));
    assert.equal((await store.stats()).facts, 20);
  });
});

test("corrupt stores fail closed and are not overwritten", async () => {
  await withStore(async (store, paths) => {
    await writeFile(paths.file, "{ definitely not valid json", "utf8");
    await assert.rejects(() => store.add(fact()), /not valid JSON/);
    assert.equal(await readFile(paths.file, "utf8"), "{ definitely not valid json");
  });
});

test("symbolic-link storage targets are rejected", async () => {
  await withStore(async (_store, paths) => {
    const target = path.join(paths.directory, "target.json");
    await writeFile(target, JSON.stringify({ version: 1, facts: [] }));
    await rm(paths.file, { force: true });
    await symlink(target, paths.file);
    const linkedStore = new GraphMemoryStore(paths.file);
    await assert.rejects(() => linkedStore.add(fact()), /regular file|symlink/);
  });
});

test("input and search bounds are enforced", async () => {
  await withStore(async (store) => {
    await assert.rejects(() => store.add(fact({ confidence: 2 })), /between 0 and 1/);
    await assert.rejects(() => store.search({ query: "hello", depth: 3 }), /depth/);
    await assert.rejects(() => store.search({ query: "hello", limit: 51 }), /limit/);
  });
});
