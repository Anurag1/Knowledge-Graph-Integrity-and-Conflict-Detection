import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 16 * 1024 * 1024;
const MAX_FACTS = 100_000;
const MAX_SEARCH_RESULTS = 50;

const STATUS = new Set(["active", "disputed", "superseded"]);

function cleanText(value, field, maxLength) {
  if (typeof value !== "string") throw new TypeError(`${field} must be a string`);
  const cleaned = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!cleaned) throw new TypeError(`${field} must not be empty`);
  if (cleaned.length > maxLength) throw new RangeError(`${field} exceeds ${maxLength} characters`);
  return cleaned;
}

function canonical(value) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

function tokenize(value) {
  return new Set((value.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}_-]+/gu) ?? []).filter((token) => token.length > 1));
}

function validateFact(fact) {
  return Boolean(
    fact &&
    typeof fact.id === "string" &&
    typeof fact.subject === "string" &&
    typeof fact.predicate === "string" &&
    typeof fact.object === "string" &&
    typeof fact.source === "string" &&
    typeof fact.confidence === "number" &&
    Number.isFinite(fact.confidence) &&
    fact.confidence >= 0 && fact.confidence <= 1 &&
    STATUS.has(fact.status) &&
    typeof fact.createdAt === "string" &&
    typeof fact.updatedAt === "string" &&
    Array.isArray(fact.tags) &&
    fact.tags.every((tag) => typeof tag === "string")
  );
}

function validateDocument(document) {
  if (!document || document.version !== STORE_VERSION || !Array.isArray(document.facts)) {
    throw new Error("Graph memory store has an unsupported or invalid format; refusing to overwrite it");
  }
  if (document.facts.length > MAX_FACTS || !document.facts.every(validateFact)) {
    throw new Error("Graph memory store contains invalid or excessive fact records; refusing to overwrite it");
  }
  return document;
}

function nodeKey(value) {
  return canonical(value);
}

export class GraphMemoryStore {
  #filePath;
  #writeQueue = Promise.resolve();

  constructor(filePath) {
    if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
      throw new TypeError("storagePath must be an absolute path");
    }
    this.#filePath = path.resolve(filePath);
  }

  async #serial(operation) {
    const result = this.#writeQueue.then(operation);
    this.#writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async #read() {
    let info;
    try {
      info = await lstat(this.#filePath);
    } catch (error) {
      if (error?.code === "ENOENT") return { version: STORE_VERSION, facts: [] };
      throw error;
    }
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error("Graph memory storage must be a regular file, not a symlink or directory");
    }
    if (info.size > MAX_STORE_BYTES) {
      throw new Error(`Graph memory store exceeds the ${MAX_STORE_BYTES} byte safety limit`);
    }
    const raw = await readFile(this.#filePath, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Graph memory store is not valid JSON; refusing to overwrite it");
    }
    return validateDocument(parsed);
  }

  async #write(document) {
    validateDocument(document);
    const serialized = `${JSON.stringify(document, null, 2)}\n`;
    const byteLength = Buffer.byteLength(serialized, "utf8");
    if (byteLength > MAX_STORE_BYTES) {
      throw new Error(`Graph memory store would exceed the ${MAX_STORE_BYTES} byte safety limit`);
    }

    const directory = path.dirname(this.#filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });

    try {
      const existing = await lstat(this.#filePath);
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new Error("Refusing to replace a non-regular graph memory storage target");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    const temporaryPath = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporaryPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.#filePath);
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async add(input) {
    return this.#serial(async () => {
      const subject = cleanText(input.subject, "subject", 500);
      const predicate = cleanText(input.predicate, "predicate", 120);
      const object = cleanText(input.object, "object", 2_000);
      const source = cleanText(input.source, "source", 1_000);
      const confidence = input.confidence ?? 1;
      if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new RangeError("confidence must be a finite number between 0 and 1");
      }
      if (input.tags !== undefined && !Array.isArray(input.tags)) throw new TypeError("tags must be an array of strings");
      if (Array.isArray(input.tags) && input.tags.length > 20) throw new RangeError("tags must contain at most 20 entries");
      const tags = Array.isArray(input.tags) ? [...new Set(input.tags.map((tag) => cleanText(tag, "tag", 80)))] : [];

      const document = await this.#read();
      const existing = document.facts.find((fact) =>
        fact.status === "active" &&
        canonical(fact.subject) === canonical(subject) &&
        canonical(fact.predicate) === canonical(predicate) &&
        canonical(fact.object) === canonical(object)
      );
      if (existing) return { fact: existing, duplicate: true, supersededId: null };
      if (document.facts.length >= MAX_FACTS) throw new Error(`Graph memory store reached the ${MAX_FACTS} fact limit`);

      let priorFact = null;
      if (input.supersedesId !== undefined) {
        const supersedesId = cleanText(input.supersedesId, "supersedesId", 100);
        priorFact = document.facts.find((fact) => fact.id === supersedesId);
        if (!priorFact) throw new Error(`supersedesId ${input.supersedesId} was not found`);
        if (priorFact.status === "superseded") throw new Error("A superseded fact cannot be superseded again");
      }

      const now = new Date().toISOString();
      const fact = {
        id: randomUUID(),
        subject,
        predicate,
        object,
        source,
        confidence,
        status: "active",
        createdAt: now,
        updatedAt: now,
        tags,
        ...(priorFact ? { supersedesId: priorFact.id } : {})
      };
      if (priorFact) {
        priorFact.status = "superseded";
        priorFact.supersededBy = fact.id;
        priorFact.updatedAt = now;
      }
      document.facts.push(fact);
      await this.#write(document);
      return { fact, duplicate: false, supersededId: priorFact?.id ?? null };
    });
  }

  async search({ query, limit = 10, depth = 0, includeHistorical = false }) {
    await this.#writeQueue;
    const normalizedQuery = cleanText(query, "query", 500);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_RESULTS) {
      throw new RangeError(`limit must be an integer between 1 and ${MAX_SEARCH_RESULTS}`);
    }
    if (!Number.isInteger(depth) || depth < 0 || depth > 2) {
      throw new RangeError("depth must be an integer between 0 and 2");
    }
    const document = await this.#read();
    const queryTerms = tokenize(normalizedQuery);
    if (queryTerms.size === 0) throw new Error("query must contain at least one searchable word or number");

    const candidates = document.facts.filter((fact) => includeHistorical || fact.status === "active");
    const direct = candidates.map((fact) => {
      const searchable = `${fact.subject} ${fact.predicate} ${fact.object} ${fact.tags.join(" ")}`.toLocaleLowerCase("en-US");
      const terms = tokenize(searchable);
      const matches = [...queryTerms].filter((term) => terms.has(term)).length;
      const coverage = matches / queryTerms.size;
      const exactPhraseBonus = searchable.includes(normalizedQuery.toLocaleLowerCase("en-US")) ? 0.5 : 0;
      const subjectObjectBonus = [fact.subject, fact.object].some((value) => canonical(value).includes(canonical(normalizedQuery))) ? 0.2 : 0;
      return { fact, score: Math.min(1, coverage + exactPhraseBonus + subjectObjectBonus) };
    }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || b.fact.updatedAt.localeCompare(a.fact.updatedAt));

    const results = direct.slice(0, limit).map(({ fact, score }) => ({ fact, matchType: "direct", score: Number(score.toFixed(4)), connectedVia: [] }));
    if (depth === 0 || results.length >= limit) {
      return { query: normalizedQuery, totalDirectMatches: direct.length, results };
    }

    const selected = new Set(results.map((entry) => entry.fact.id));
    let frontier = new Set(results.flatMap((entry) => [nodeKey(entry.fact.subject), nodeKey(entry.fact.object)]));
    for (let level = 1; level <= depth && results.length < limit && frontier.size > 0; level += 1) {
      const nextFrontier = new Set();
      for (const fact of candidates) {
        if (selected.has(fact.id)) continue;
        const endpoints = [nodeKey(fact.subject), nodeKey(fact.object)];
        const shared = endpoints.filter((endpoint) => frontier.has(endpoint));
        if (shared.length === 0) continue;
        selected.add(fact.id);
        results.push({ fact, matchType: "graph-neighbor", score: 0, connectedVia: shared });
        for (const endpoint of endpoints) nextFrontier.add(endpoint);
        if (results.length >= limit) break;
      }
      frontier = nextFrontier;
    }
    return { query: normalizedQuery, totalDirectMatches: direct.length, results };
  }

  async updateStatus({ id, status, reason }) {
    return this.#serial(async () => {
      if (typeof id !== "string" || !id.trim()) throw new TypeError("id must be a non-empty string");
      if (!STATUS.has(status)) throw new TypeError("status must be active, disputed, or superseded");
      if (status === "superseded") throw new Error("Use graph_memory_add with supersedesId to supersede a fact safely");
      const document = await this.#read();
      const fact = document.facts.find((entry) => entry.id === id);
      if (!fact) throw new Error(`Fact ${id} was not found`);
      if (fact.status === "superseded") throw new Error("A superseded fact is immutable historical evidence");
      const updatedAt = new Date().toISOString();
      fact.status = status;
      fact.updatedAt = updatedAt;
      if (reason !== undefined) fact.statusReason = cleanText(reason, "reason", 500);
      await this.#write(document);
      return fact;
    });
  }

  async stats() {
    await this.#writeQueue;
    const document = await this.#read();
    const entities = new Set();
    const counts = { active: 0, disputed: 0, superseded: 0 };
    for (const fact of document.facts) {
      entities.add(nodeKey(fact.subject));
      entities.add(nodeKey(fact.object));
      counts[fact.status] += 1;
    }
    return { facts: document.facts.length, entities: entities.size, edges: document.facts.length, ...counts };
  }
}
