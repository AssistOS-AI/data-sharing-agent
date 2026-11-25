# Achilles IDE Datasharing Hub

A self-hosted Node.js server for discovering, using, and publishing datasets. It connects to Hugging Face, Zenodo, DCAT catalogs, and EDC/Dataspace Protocol consumers. It provides a browser UI, REST API, and MCP endpoint. Search uses BM25 and metadata heuristics. ALA is optional and disabled by default. The server uses the official `@huggingface/hub` library for publishing; no web framework or separate database is required.

## Start

Requires Node.js 22 or newer. Run:

```bash
npm ci
npm start
```

Open <http://127.0.0.1:8787>. The interface opens without a Hub password. To use an `.env` file, copy `config/example.env` to `.env` and run `bash scripts/start.sh`. For a container, run `docker compose up --build`; the published port is bound to `127.0.0.1` on the host.

The Hub has **no built-in login, sessions, or API tokens**. In a deployed system, place it behind your organization's authentication proxy and block direct access to the Hub port. All clients that can reach the port can use administration routes. If your proxy injects a verified username, set `HUB_EXTERNAL_USER_HEADER` to that header's name. The proxy must strip any client-supplied copy first. Without it, audit events use `external` as the actor. When preserving a public `Host` header, add that hostname (and port, if present) to `HUB_ALLOWED_HOSTS`.

## Configure sources in Settings

- **Hugging Face:** Public dataset search works without an account. Add a token in Settings for private/gated access or a write token for publishing. Use **Test connection** to verify the account and search API. The token is stored in the local data file with mode `0600` and never returned by the settings API.
- **Zenodo:** Enabled by default and requires no account for public records. Save a deposit token to create drafts and publish records; choose production or sandbox in Settings.
- **EDC / European data spaces:** Add a consumer EDC Management API URL, provider DSP URL, provider participant ID, protocol, optional Management API key, and allowed EDR download hosts. You can add multiple connectors. [EDC setup guide](docs/edc-setup.md).
- **DCAT:** Add one or more JSON-LD catalog URLs and allowed distribution hosts. This adapter supports directly readable JSON-LD DCAT catalogs; portals with proprietary APIs need a dedicated adapter.

Existing `HF_TOKEN`, `ZENODO_TOKEN`, `EDC_*`, and `HUB_DCAT_URL` environment settings are imported into the editable source list on the first start of a new data directory. Later changes are made in Settings. The Hub does not ship an EDC connector binary; it connects to your organization's consumer EDC. An EDC connector and data-space membership are required before DSP search or transfer can work.

The **Publish** tab handles local uploads and Hugging Face commits or Zenodo drafts. The **Monitoring** tab shows ALA sessions and saved execution history. See the [publishing guide](docs/publishing.md), [specification](docs/specification.md), [implementation plan](docs/plan.md), [API guide](docs/api.md), [MCP agent skill](skills/hub-mcp/SKILL.md), [ALA guide](docs/ala.md), and [verification report](docs/verification.md).
