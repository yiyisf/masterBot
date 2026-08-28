# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence or suggest creating them upfront. The `/domain-modeling` skill creates them lazily when terms or decisions actually get resolved.

## File structure

This repository uses a single-context layout:

```text
/
├── CONTEXT.md
└── docs/
    └── adr/
        ├── 0001-web-first-server-execution.md
        └── ...
```

Do not introduce `CONTEXT-MAP.md` or per-package context files unless the repository later develops genuinely independent domain contexts and that change is explicitly accepted.

## Use the glossary's vocabulary

When your output names a domain concept — in an issue title, refactor proposal, hypothesis, or test name — use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, either reconsider whether you are inventing unnecessary language or note the genuine gap for `/domain-modeling`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (separate canonical events from UI streams) — but worth reopening because…_

System-wide decisions live in `docs/adr/`. Read only the ADRs relevant to the area being changed, plus any ADR directly referenced by them.
