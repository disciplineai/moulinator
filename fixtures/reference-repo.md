# Reference repo (smoke test)

The Phase 2 integration gate uses a known-green reference repository so the end-to-end flow can be verified without depending on an individual student's account.

Until the real reference repo exists, the smoke-test script should:

1. Spin up a fake GitHub server (e.g., via `nock` or a local bare repo + git-http-backend) pre-populated with a tiny C project that passes the seeded `cpool-day06/tests/harness.sh`.
2. Register the local URL as a `Repository` row.
3. Trigger a run and assert it reaches `passed`.

Once the tests-repo is live on GitHub, replace the placeholder here with:

- `url`: `https://github.com/<org>/moulinator-reference-<slug>`
- `commit_sha`: a pinned commit known to pass
- `expected_cases`: list of expected passing case names

Placeholder:

```
url: https://github.com/moulinator-org/reference-cpool-day06
commit_sha: 0000000000000000000000000000000000000000
expected_cases:
  - basic_case_01
  - basic_case_02
```

The `runner_image_digest: sha256:0000…` in fixture configs is also a placeholder — the devops-expert agent replaces it with a real digest after building the runner image in Phase 1.
