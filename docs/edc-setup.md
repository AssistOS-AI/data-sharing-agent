# Connecting a European data space through EDC

The Hub contains an EDC **client adapter**, not an EDC connector binary. DSP discovery and transfer require an existing consumer EDC connector, membership/credentials accepted by the target data space, and at least one provider DSP endpoint. There is no universal European data-space account or endpoint.

## Obtain the connection details

1. Ask the target data space or provider for its onboarding procedure, participant identifier, provider DSP endpoint, trust framework requirements, and contract terms. Some spaces require a DID, certificate, wallet, or signed membership agreement.
2. Deploy or obtain access to a **consumer** Eclipse Dataspace Components connector using the distribution and version required by that space. Your connector operator supplies the Management API URL and, if enabled, its API key. This key authenticates the Hub to your own consumer connector; it is not a provider credential.
3. Get the provider's DSP URL and participant ID from the provider or its catalog. Record the protocol identifier expected by your EDC distribution, for example `dataspace-protocol-http`.
4. Allowlist the data-plane hostname that an EDR may return. The Hub will not fetch an EDR endpoint from an unlisted host. Confirm network routes from the Hub to the consumer Management API, provider DSP endpoint, and data plane.
5. In **Settings → EDC connector**, enter a unique source ID, name, Management API URL, provider DSP URL, participant ID, protocol, optional Management API key, and EDR data hosts. Save, then click **Test connection**. The test requests a catalog. Search with the EDC source filter after it succeeds.

For a local setup, the Management API might be `http://127.0.0.1:29193/management` and the provider DSP URL might be `https://provider.example/api/dsp`. In a container, `127.0.0.1` means the container itself; use a reachable internal hostname instead. Never put secrets in the URL. The Hub stores the Management API key in its local data file with mode `0600` and omits it from settings responses.

The implemented flow is: `POST /v3/catalog/request` → map offers and ODRL → policy check/human approval → `POST /v3/contractnegotiations` → poll finalization → `POST /v3/transferprocesses` with `HttpData-PULL` → obtain EDR from `/v3/edrs/:id/dataaddress` → bounded download or cache. It was tested with a simulated v3 connector. Test it against your actual distribution before relying on transfer results; newer EDC releases may use different Management API paths or transfer profiles.

For HF private or gated datasets, create a read-only user token in [Hugging Face token settings](https://huggingface.co/settings/tokens), obtain access to the dataset in that account, then save the token under **Settings → Hugging Face account**. Public HF and Zenodo discovery need no account.

References: [Eclipse EDC catalog and negotiation sample](https://github.com/eclipse-edc/Samples/blob/main/transfer/transfer-01-negotiation/README.md), [Dataspace Protocol](https://github.com/eclipse-dataspace-protocol-base/DataspaceProtocol), [Hugging Face tokens](https://huggingface.co/docs/hub/security-tokens).
