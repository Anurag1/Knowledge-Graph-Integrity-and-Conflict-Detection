# Context Engine Experiment

A minimal proof-of-concept for interpreting the same words using conversational state plus tone, actions, movement, and temporal context.

## Hypothesis

A context-aware representation can distinguish meanings that are ambiguous at the text-only level.

## Example

The token `okay` is intentionally ambiguous. The interpreter incorporates:

- lexical content
- tone
- actions
- movement
- previous task state
- event ordering

This is **not** a claim of human-level understanding. It is a falsifiable architecture experiment.

## Run

```bash
cd context_engine
python -m unittest test_context_graph.py
```

Expected result: all tests pass.
