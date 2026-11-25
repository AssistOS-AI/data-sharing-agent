# Open Dataspace Hub MCP client guide

Use this skill when a local agent needs to discover, evaluate, or request datasets through Open Dataspace Hub. The Hub exposes a stateless JSON-RPC MCP endpoint at `POST /mcp`. Connect through the organization's authentication proxy when deployed. The Hub itself has no login or API token. Never send Hugging Face or EDC credentials through MCP.

## Available tools

| Tool | Use it for | Required inputs |
| --- | --- | --- |
| `list_sources` | Check which Hugging Face, Zenodo, EDC, and DCAT sources are configured and enabled. Secrets are omitted. | none |
| `search_datasets` | Fast federated lexical search, ranked with BM25; results include source errors and policy decisions. | `query`, `intended_use` |
| `deep_analyze_datasets` | Search several query variants, inspect metadata/schema where allowed, and rank candidates. ALA is optional and off by default. | `problem_statement`, `intended_use` |
| `inspect_dataset` | Read the full metadata and policy decision for a known dataset ID. | `dataset_id`, `intended_use` |
| `check_dataset_policy` | Re-evaluate the deterministic policy without starting a transfer. | `dataset_id`, `intended_use` |
| `acquire_dataset` | Request human approval or start a controlled download/EDC negotiation. | `dataset_id`, `intended_use`, `justification`; `file_path` for file sources |
| `get_job_status` | Poll an EDC negotiation/transfer until it is ready or fails. | `job_id` |

`intended_use` is one of `research`, `training`, or `commercial`. Source filters in `search_datasets` are comma-separated groups: `hf`, `zenodo`, `eds`, `dcat`. Dataset IDs identify their source: `hf:owner/name`, `zenodo:record`, `eds:connector-id:asset-id`, `dcat:catalog-id:hash`.

## Recommended workflow

1. Call `list_sources`; if an EDC or DCAT source is missing, tell the user to add it in Settings. Do not invent a connector or credentials.
2. Call `search_datasets` with a short domain query and explicit intended use. If results are sparse, try related terms or `deep_analyze_datasets`.
3. Inspect promising candidates. Treat license, provider description, schema, and availability as evidence with different confidence levels. A policy decision is scoped to the declared use.
4. Call `check_dataset_policy` before acquisition. `DENIED` means stop. `NEEDS_HUMAN_APPROVAL` means `acquire_dataset` creates an approval request; a human steward decides in the Hub UI.
5. After acquisition, use the returned local download/cache URL. For EDC, use `get_job_status`. Do not bypass the Hub with a provider URL or exposed token.

Search examples: `"hourly electricity load Europe"`, `"clinical trial metadata"`, `"French speech recognition"`. A DSP connector must be configured with a consumer EDC Management API and provider DSP endpoint. Zenodo and Hugging Face public search work without an account when their upstream services are reachable.

The policy engine is deterministic. Neither this skill nor ALA can approve a license or contract. For an unknown license or ODRL condition, report the uncertainty and request human review.
