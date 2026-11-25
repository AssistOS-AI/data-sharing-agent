# REST and MCP API guide

The local base URL is `http://127.0.0.1:8787`. The Hub has no built-in login or token. Use the organization's external authentication proxy in a deployment and block direct access to the Hub port.

## Source settings

`GET /api/v1/sources` lists sources without secrets. The built-ins `hf` and `zenodo` may be disabled but not removed. `POST /api/v1/sources` creates an `edc` or `dcat` source. `PUT /api/v1/sources/:id` updates it. `DELETE /api/v1/sources/:id` removes a custom source. `POST /api/v1/sources/:id/test` checks its connection; `POST /api/v1/connectors/test` checks all enabled sources. Changes apply without restart.

A Hugging Face account token is optional for public data:

```bash
curl -X PUT http://127.0.0.1:8787/api/v1/sources/hf \
  -H 'Content-Type: application/json' \
  -d '{"name":"Hugging Face","enabled":true,"token":"hf_your_read_token"}'
```

The token is not returned by `GET /api/v1/sources`; `hasToken` indicates whether one is saved. An empty token preserves the current one; `"clearToken":true` removes it. The same pattern applies to Zenodo tokens and EDC `apiKey` / `clearApiKey`.

An EDC entry needs a consumer connector and a provider address:

```bash
curl -X POST http://127.0.0.1:8787/api/v1/sources \
  -H 'Content-Type: application/json' \
  -d '{"id":"energy-space","type":"edc","name":"Energy space","enabled":true,"managementUrl":"http://127.0.0.1:29193/management","providerUrl":"https://provider.example/api/dsp","participantId":"did:web:provider.example","protocol":"dataspace-protocol-http","apiKey":"consumer-management-key","dataHosts":"data.provider.example"}'
```

A DCAT entry uses `{"id":"research-catalog","type":"dcat","name":"Research catalog","url":"https://catalog.example/catalog.jsonld","dataHosts":"files.example"}`. The current adapter expects a directly readable JSON-LD document, not a portal-specific search API.

## Search, inspect, and analyze

```bash
curl 'http://127.0.0.1:8787/api/v1/search?q=energy&sources=hf,zenodo,eds,dcat&intended_use=research'
curl 'http://127.0.0.1:8787/api/v1/datasets/hf%3Aowner%2Fname'
```

Search returns `{items,errors,nextCursor:null}`. Source groups are `hf`, `zenodo`, `eds`, and `dcat`. Optional filters are `policy=AUTO_APPROVED|NEEDS_HUMAN_APPROVAL|DENIED` and `access_mode=proxy-stream|direct-download|contract-negotiation|metadata-only`. Intended use is `research`, `training`, or `commercial`.

`GET /api/v1/datasets/:id/preview` requests a policy-allowed HF schema and sample. `POST /api/v1/policy/check` accepts `{"datasetId":"hf:owner/name","intendedUse":"research"}`. `POST /api/v1/simulate` evaluates hypothetical metadata. `POST /api/v1/analyze` accepts `{"problemStatement":"hourly European energy data","intendedUse":"research"}`; add `Accept: text/event-stream` for progress/result events. BM25 is the default; ALA is optional.

## Acquisition and administration

`POST /api/v1/datasets/:id/acquire` accepts `intendedUse`, `justification`, and `filePath` for file sources. A permitted HF/Zenodo/DCAT request returns temporary `downloadUrl` and `cacheUrl`. A request requiring review returns HTTP 202 with `approvalId`; decide it with `POST /api/v1/approvals/:id/decision` and retry. EDC returns an asynchronous job ID; poll `GET /api/v1/jobs/:id`. Cached files are listed at `GET /api/v1/artifacts` and deleted with `DELETE /api/v1/artifacts/:id`.

`GET/PUT /api/v1/policy/config` edits the validated license lists. `GET /api/v1/audit` returns recent audit events. `GET/POST /api/v1/settings` reads or toggles ALA. All administration routes require protection by the external proxy in a deployment.

## Publishing and ALA monitoring

`POST /api/v1/uploads?name=data.csv` accepts raw file bytes (`Content-Type: application/octet-stream`) and returns a local artifact. The default maximum is 100 MB. `GET /api/v1/artifacts` lists files available for publication.

`POST /api/v1/publications` accepts `{destination:"hf",artifactId,rightsConfirmed:true,repoId:"owner/name",path:"data.csv",createRepo:true,visibility:"private",license:"cc-by-4.0"}` for a Hugging Face commit, or `{destination:"zenodo",artifactId,rightsConfirmed:true,path:"data.csv",title,description,creator:"Last, First",license:"cc-by-4.0"}` for a Zenodo draft. The artifact must come from the upload endpoint; cached acquired files cannot be published. `GET /api/v1/publications` returns durable history. `POST /api/v1/publications/:id/publish` publishes a Zenodo draft. The UI asks for confirmation before both actions; API clients must implement their own review.

`POST /api/v1/publications/assist` accepts `{destination,artifactId,description,currentFields}` and returns proposed fields when ALA is enabled. ALA receives no destination token and does not publish. `GET /api/v1/ala/runs` lists current and historical runs; `GET /api/v1/ala/runs/:id` returns a full saved run. These routes correspond to the **Publish** and **Monitoring** tabs. See the [publishing guide](publishing.md).

**Settings → Hub settings → API tester** can call any JSON REST or MCP route from the browser. The specific Search, Analysis, Publish, Approvals, Local files, Monitoring, and Settings views expose the main workflows as forms and controls.

## MCP

`POST /mcp` is a stateless JSON-RPC endpoint using protocol version `2025-11-25`. It exposes `list_sources`, `search_datasets`, `deep_analyze_datasets`, `inspect_dataset`, `check_dataset_policy`, `acquire_dataset`, and `get_job_status`. See [the MCP skill](../skills/hub-mcp/SKILL.md) for tool inputs and agent workflow.

```bash
curl -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Current limits: 20 HF/Zenodo results per upstream query, 50 EDC catalog offers per request, a 5 MB DCAT catalog, a 100 MB default file limit, and one server process with JSON storage. Pagination and resumable transfers are not implemented.
