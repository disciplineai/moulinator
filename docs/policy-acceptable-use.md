# Acceptable-use policy — tests-repo reconstruction

**Decision recorded:** 2026-04-17
**Approver:** project owner (Gabriel Brument, gabriel.brument@epitech.eu)

## Context

Moulinator lets students contribute missing tests to a shared tests-repo after they've seen the official Epitech automated tester (AT) trace on their own submissions. The plan's Phase 0 step 1 explicitly called this out as a policy/legal question — reconstructing tests from AT traces touches Epitech's intellectual property and student-conduct policies, not just engineering.

## Decision

The project owner green-lit the contribution flow as specified in the approved plan, understanding that:

1. **Moulinator does not publish AT traces directly.** It only ingests student-authored test PRs on a separate tests-repo. The AT trace is observed by the student on Epitech's own platform; moulinator never scrapes, mirrors, or redistributes it.
2. **Contributions flow through reviewed GitHub PRs** with CODEOWNERS approval on `main`, so every merged test is human-reviewed.
3. **The tests-repo is content-addressed per run** (`TestRun.tests_repo_commit_sha` pinned at trigger time), so any bad merge can be rolled back by reverting the commit and re-pinning — no silent state on the platform.
4. **If Epitech raises a concern**, the remediation is (a) freeze merges on the tests-repo, (b) remove the offending content, (c) bump the pinned SHAs used by new runs. No student PII or AT output is otherwise persisted.

## Out of scope for this decision

This memo does not authorize:
- Scraping the AT platform directly.
- Storing AT traces on the moulinator control plane.
- Distributing tests attributed to Epitech staff without consent.

Any of those would require a separate review. Moulinator's current implementation does none of them.

## Revisitation

If Epitech publishes a formal policy on student test reconstruction, or if a concern is raised, this decision is re-opened and moulinator's contribution flow is frozen pending review. Surface any such concern in a GitHub issue tagged `policy`.

## References

- `/Users/sobsh/.claude/plans/you-are-claude-a-valiant-marble.md` — Phase 0 "policy gate"
- `docs/ARCHITECTURE.md §5.3` — tests-repo governance
- `docs/phase-0.md` — contract freeze, test-contribution flow decision
