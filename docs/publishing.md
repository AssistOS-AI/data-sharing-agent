# Publishing datasets

The **Publish** tab and REST API use the same workflow. Upload a file into the local sink, select it, fill the destination form, review the metadata, confirm your publication rights, and submit. Only files explicitly uploaded for publication are eligible; cached files acquired from other sources are excluded. The Hub stores publication history and audit events in `data/hub.json`. Files expire according to the local sink TTL; publication records remain.

## Hugging Face

1. Open [Hugging Face token settings](https://huggingface.co/settings/tokens). Create a token with write access to the target dataset repository. Fine-grained tokens can limit access to a particular repository or organization.
2. Save the token under **Settings → Data sources → Hugging Face account**. The Settings API returns only `hasToken`.
3. In **Publish**, choose a local file and enter `owner/name` and a file name. Select **Create repository** if necessary. New repositories default to private. Review visibility and license before submitting.
4. Submitting uploads a file commit through the official `@huggingface/hub` library. The Hub stores the resulting URL in publication history. A token with read-only access cannot publish.

[Token guide](https://huggingface.co/docs/hub/security-tokens) · [JavaScript Hub library](https://huggingface.co/docs/huggingface.js/hub/README)

## Zenodo

1. Create an account on [Zenodo](https://zenodo.org/) or [Zenodo Sandbox](https://sandbox.zenodo.org/) for test deposits. These services use separate accounts and tokens.
2. Create an access token in the account's application settings with `deposit:write` and `deposit:actions` scopes. Save it in **Settings → Data sources → Zenodo account**, selecting the matching service.
3. In **Publish**, enter a title, description, creator in `Last, First` form, and a supported license ID. Submit to create a draft and upload the file.
4. Review the draft on Zenodo. Use **Publish Zenodo draft** in publication history when ready. Publishing is a separate, irreversible action.

[Zenodo deposit API](https://developers.zenodo.org/) · [Zenodo Sandbox](https://sandbox.zenodo.org/)

## ALA form assistance

Enable ALA in **Settings → Hub settings**. In **Publish**, describe the dataset and known rights, then select **Suggest fields**. ALA fills proposed metadata for review. It receives no Hub destination token. The Hub makes the commit or creates the deposit only after the user submits the form. Every ALA invocation appears in **Monitoring**, including completion status and saved output. When ALA is disabled, forms work manually.

## Supported destinations

Hugging Face and Zenodo have concrete publication adapters. DCAT is a catalog metadata format, so a DCAT URL alone does not provide a generic write API. EDC publication requires a configured provider connector's asset and policy management, which varies by installation; this Hub currently uses EDC consumer APIs for discovery, negotiation, and transfer. Neither DCAT nor EDC is shown as a publishing destination until an explicit write adapter exists.
