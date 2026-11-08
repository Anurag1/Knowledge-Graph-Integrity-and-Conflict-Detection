import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GraphMemoryStore } from "../src/store.js";

const facts = [
  ["Project Atlas", "uses", "PostgreSQL"],
  ["PostgreSQL", "hosted on", "Managed Cloud"],
  ["Managed Cloud", "has region", "ap-south-1"],
  ["Project Atlas", "owned by", "Platform Team"],
  ["Project Beacon", "uses", "SQLite"],
  ["SQLite", "stored on", "local volume"]
];

const cases = [
  { query: "Project Atlas", target: ["Managed Cloud", "has region", "ap-south-1"], hops: 2 },
  { query: "Project Beacon", target: ["SQLite", "stored on", "local volume"], hops: 1 },
  { query: "Project Atlas", target: ["Project Atlas", "owned by", "Platform Team"], hops: 0 }
];

const triple = (fact) => [fact.subject, fact.predicate, fact.object]
  .map((value) => value.toLocaleLowerCase("en-US")).join("\u0000");

const directory = await mkdtemp(path.join(os.tmpdir(), "openclaw-graph-memory-benchmark-"));
try {
  const store = new GraphMemoryStore(path.join(directory, "benchmark.json"));
  for (const [subject, predicate, object] of facts) {
    await store.add({
      subject, predicate, object,
      source: "synthetic benchmark fixture",
      confidence: 1
    });
  }

  let lexicalHits = 0;
  let graphHits = 0;
  const rows = [];
  for (const scenario of cases) {
    const expected = triple({
      subject: scenario.target[0],
      predicate: scenario.target[1],
      object: scenario.target[2]
    });
    const lexical = await store.search({
      query: scenario.query, depth: 0, limit: 50
    });
    const graph = await store.search({
      query: scenario.query, depth: 2, limit: 50
    });
    const lexicalHit = lexical.results.some((entry) => triple(entry.fact) === expected);
    const graphHit = graph.results.some((entry) => triple(entry.fact) === expected);
    lexicalHits += Number(lexicalHit);
    graphHits += Number(graphHit);
    rows.push({
      query: scenario.query,
      requiredHops: scenario.hops,
      lexicalHit,
      graphHit
    });
  }

  const report = {
    benchmark: "synthetic-graph-neighbour-retrieval-v1",
    cases: cases.length,
    lexicalBaseline: {
      hits: lexicalHits,
      recall: lexicalHits / cases.length,
      depth: 0
    },
    graphRetrieval: {
      hits: graphHits,
      recall: graphHits / cases.length,
      maxDepth: 2
    },
    incrementalHits: graphHits - lexicalHits,
    scenarios: rows,
    limitations: [
      "Synthetic fixture; not a user study or production workload.",
      "Does not compare native OpenClaw memory or an LLM baseline.",
      "Does not measure answer correctness, latency under load or token cost."
    ]
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
