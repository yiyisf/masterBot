# Refactor branch workflow

The next architecture is implemented incrementally without direct work on `master`.

## Rules

- Create each vertical-slice or focused infrastructure branch from the latest `master`.
- Use short-lived names such as `refactor/contracts-run-events`, `refactor/postgres-foundation`, or `refactor/conversation-run-slice`.
- Merge only through a reviewed pull request after CI, PostgreSQL integration tests, and relevant evaluations pass.
- Keep unfinished behavior unreachable through feature flags or unmounted routes rather than accumulating it on a long-lived integration branch.
- Commit schema migrations with the code that uses them and introduce shared contracts compatibly before dependent pull requests.
- Keep pull requests focused; remove replaced legacy code in a separate, reviewable commit.
- Rebase stale branches rather than accumulating unrelated merge commits.
- Use `design/next-architecture` only for this design baseline, not production implementation.
