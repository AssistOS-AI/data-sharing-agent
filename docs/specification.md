# Achilles IDE Datasharing Hub — technical specification

## Purpose

The Hub offers one local interface for people and agents to discover, inspect, evaluate, and acquire datasets from Hugging Face, Zenodo, DCAT catalogs, and European data spaces accessed through EDC/DSP. A result carries a stable source-qualified ID, provenance, metadata, available files, and a policy decision for a declared intended use. Search does not authorize transfer.

## Review of the original proposal

- A license label, dataset card, gated-access terms, and DSP contract can disagree. Unknown or custom terms require human review. The policy engine is a local control, not a legal opinion.
- Free-form policy expressions are not evaluated as code. The current policy is a validated allow/deny list of license identifiers plus explicit ODRL prohibitions; unrecognized conditions do not auto-approve transfer.
- EDC Management API versions and connector distributions differ. The implemented adapter targets a v3 consumer Management API and `HttpData-PULL` EDR flow. A real connector profile must be tested before production use.
- Zenodo has its own records API. DCAT catalogs vary, and a catalog record may have metadata but no downloadable distribution.
- File transfers use a dataset ID and listed file, bounded streams, host allowlists, timeouts, TTL, and audit events. The Hub does not provide an arbitrary-URL proxy.
- HF previews may reveal sensitive sample rows. They are requested explicitly and gated by policy. Audit hash chaining detects local changes but is not independent immutability.

## Architecture

Browser / REST client / MCP agent → external authentication proxy (in deployment) → Hub HTTP API → source registry → HF, Zenodo, DCAT, or EDC adapter → deterministic policy → approval queue → controlled transfer/local sink. Settings are persisted in a single-process JSON store; secrets remain on the server. The browser UI is static HTML, CSS, and JavaScript served by the same Node.js process.

## Source model

Built-in sources `hf` and `zenodo` can be enabled or disabled. Administrators can add multiple `edc` and `dcat` entries with unique IDs. Dataset IDs are `hf:owner/name`, `zenodo:record-id`, `eds:connector-id:asset-id`, and `dcat:catalog-id:hash`. Search accepts source groups `hf,zenodo,eds,dcat`; each configured entry runs independently and errors are reported per entry. EDC requires a consumer Management API plus provider DSP address and participant ID. HF account tokens are optional for public datasets.

## Policy and acquisition

Supported intended uses are `research`, `training`, and `commercial`. A dataset is auto-approved only when its license is on the organization's allowlist and no known restriction requires review. Explicit prohibitions yield `DENIED`; unknown licenses, gated access, possible personal data, and DSP offers yield `NEEDS_HUMAN_APPROVAL`. An approval is tied to the actor, dataset, use, file, and policy fingerprint. Changing policy or offer metadata invalidates an old approval. DSP negotiations and transfers are asynchronous jobs.

## Interfaces

The UI has Search, Analysis, Policy simulation, Approvals, Local files, and Settings pages. Settings can add, edit, remove, enable, disable, and test sources without a server restart. Secrets are redacted in settings responses. REST routes are under `/api/v1`; `/mcp` exposes JSON-RPC tools described in [the agent skill](../skills/hub-mcp/SKILL.md). ALA may enrich analysis, but BM25 works without it and ALA cannot make policy decisions.

## Deployment boundary

The Hub has no built-in authentication. By default it listens on `127.0.0.1`. In production, the organization's proxy must authenticate users and agents and prevent direct network access to the Hub. The proxy may inject a verified user header for audit after stripping client-supplied values. A single-process JSON store is suitable for a local instance; SQLite, quotas, resumable transfers, backup, and real EDC interoperability tests are future production work.

## Primary references

- [Hugging Face Dataset Viewer API](https://huggingface.co/docs/dataset-viewer/en/quick_start)
- [Hugging Face user access tokens](https://huggingface.co/docs/hub/security-tokens)
- [Eclipse EDC catalog and negotiation sample](https://github.com/eclipse-edc/Samples/blob/main/transfer/transfer-01-negotiation/README.md)
- [Dataspace Protocol specification](https://github.com/eclipse-dataspace-protocol-base/DataspaceProtocol)
