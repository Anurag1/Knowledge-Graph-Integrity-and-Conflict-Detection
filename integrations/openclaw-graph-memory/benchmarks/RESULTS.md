# Synthetic graph retrieval benchmark: v1

Command:

```bash
npm run benchmark
```

Result from the implementation run on 2026-11-08:

| Retrieval mode | Hits | Recall |
|---|---:|---:|
| Lexical-only (`depth=0`) | 1 / 3 | 0.3333 |
| Graph expansion (`depth=2`) | 3 / 3 | 1.0000 |

The graph-expansion condition retrieved two additional linked facts that did not contain the direct query terms.

## Interpretation limits

This is a three-case synthetic fixture designed to exercise one-hop and two-hop relationship traversal. It demonstrates that the implemented traversal path works on the fixture. It does **not** establish a general retrieval improvement, user-facing answer quality, model reasoning gains, or superiority to OpenClaw's native memory. It does not measure latency under load, token usage, or production-scale storage behavior. A larger frozen multi-session dataset and a native-memory baseline are required before drawing comparative conclusions.
