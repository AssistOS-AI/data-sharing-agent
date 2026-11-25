# Optional ALA analysis and BM25 fallback

The Hub does not call an LLM API directly. Search and analysis work with federated retrieval, BM25 ranking, metadata/schema inspection, and deterministic policy evaluation. ALA is **disabled by default**. When enabled, it receives a temporary dossier of candidates and already computed policy decisions. Its answer is advice, not authorization.

The Hub looks for `HUB_ALA_CLI`, then `ALA_CLI`, then a sibling checkout at `../AdvancedLanguageAgent/bin/ala.mjs`. `GET /api/v1/settings` reports the detected location and readiness. The UI Settings page can enable or disable ALA. The Hub selects the Codex coding-agent backend explicitly and does not fall back to another coding agent.

ALA requires its own runtime prerequisites, including Bubblewrap on Linux and an installed, authenticated Codex agent. Check it with `node ../AdvancedLanguageAgent/bin/ala.mjs status --json`. Set `HUB_ALA_CLI` if it lives elsewhere. The minimal Hub Docker image does not include ALA, Bubblewrap, or a coding-agent login.

The Hub passes [the Dataset Analyst skill](../skills/dataset-analyst/SKILL.md) or [the Publication Assistant skill](../skills/publication-assistant/SKILL.md) with a temporary dossier. Hub/source tokens and common secret environment variables are removed from the child environment. ALA runs with `--permissions ask-for-approval`. It proposes metadata but does not commit or publish. Temporary files are removed afterwards. The **Monitoring** tab and `/api/v1/ala/runs` preserve run status and output in `data/hub.json`, including failures and interrupted runs after a server restart.

If ALA is disabled, missing, or fails, `/api/v1/analyze` returns its BM25 result. A runtime failure records the run and an audit event while the response falls back to BM25. ALA remains enabled so an operator can inspect and retry it. In this development environment ALA was found, but Bubblewrap could not prepare procfs (`EPERM`); the real coding-agent path therefore remains unverified here. A simulated CLI integration test passes.
