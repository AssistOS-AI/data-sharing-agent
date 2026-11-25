# Implementation plan and current status

## Delivered

1. **Local core:** Node.js 22+ server with one direct runtime package for Hugging Face publishing; static UI; JSON persistence; audit hash chain; local sink with size limits, SHA-256, and TTL.
2. **Source adapters:** Hugging Face public/account search, dataset detail, schema preview, and controlled file transfer; Zenodo records and files; JSON-LD DCAT catalogs; EDC v3 catalog, contract negotiation, transfer process, EDR, and local download.
3. **Source settings:** Persistent HF and Zenodo tokens, production/sandbox Zenodo selection, multiple EDC connectors, multiple DCAT catalogs, enabled state, edit/remove, secret redaction, connection tests, and first-run import from environment variables.
4. **Governance and agents:** Deterministic policy, simulation, human approval queue, REST, MCP tools, BM25 analysis, and optional ALA coding agent integration. ALA is disabled by default.
5. **Publishing:** Local file uploads; Hugging Face dataset repository commits; Zenodo deposit draft, upload, and explicit publication; persistent publication history; optional ALA metadata suggestions.
6. **Monitoring:** Durable ALA run status, result, and error history through API and UI.
7. **Deployment:** `npm ci && npm start` without a Hub password, external-authentication boundary, Docker image, and Compose profile with host-loopback port binding.

## Still required before organization-wide production use

- Test the exact EDC distribution and Management API version, its DSP provider, contract policies, EDR behavior, and transfer profile with real credentials. The current implementation and tests use EDC v3 mocks.
- Put the Hub behind the organization's authentication/authorization proxy. Restrict routes there and block direct network access. Decide whether the proxy should inject a verified user header for audit.
- Confirm the organization's allowed licenses, treatment of personal data, storage quota, retention periods, backup, and external audit retention.
- Add dedicated adapters for priority portals whose catalog APIs are not JSON-LD DCAT, and consider SQLite/FTS when data volume or process concurrency warrants it.
- Add resumable transfers and provider-specific contract tests for large production workloads.
- Confirm Hugging Face and Zenodo write scopes with organization credentials. Mock integration tests cover the API flow; no real dataset was published from this environment.

The browser and API can already be used locally with public HF and Zenodo. EDC requires an existing consumer connector and a provider's DSP address; there is no universal public EDC endpoint to preload.
