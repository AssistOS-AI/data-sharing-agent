import { readTextLimited } from './http-util.mjs';
import { terms } from './ranking.mjs';

const VOCAB = 'https://w3id.org/edc/v0.0.1/ns/';
const DCAT = 'http://www.w3.org/ns/dcat#';
const ODRL = 'http://www.w3.org/ns/odrl/2/';
const CTX = { '@vocab': VOCAB, dcat: 'http://www.w3.org/ns/dcat#', odrl: ODRL, dct: 'http://purl.org/dc/terms/' };
const field = (obj, ...names) => names.map(n => obj?.[n]).find(v => v !== undefined);
const value = x => typeof x === 'object' && x !== null ? (x['@value'] || x.value || x['@id'] || '') : x;
const list = x => x === undefined ? [] : Array.isArray(x) ? x : [x];
export function prohibitedUses(policy) {
  const rules = list(field(policy, 'odrl:prohibition', `${ODRL}prohibition`, 'prohibition'));
  const result = new Set();
  for (const rule of rules) {
    if (list(field(rule, 'odrl:constraint', `${ODRL}constraint`, 'constraint')).length) continue;
    const action = String(value(field(rule, 'odrl:action', `${ODRL}action`, 'action'))).toLowerCase();
    if (/(^|[/#:_-])use$/.test(action)) for (const use of ['research', 'training', 'commercial']) result.add(use);
    if (/(ai[_-]?training|training)/.test(action)) result.add('training');
    if (/commercial/.test(action)) result.add('commercial');
  }
  return [...result];
}

export class EdcConnector {
  constructor({ id = 'main', managementUrl, apiKey, providerUrl, participantId, protocol }) {
    const url = new URL(managementUrl); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('EDC_MANAGEMENT_URL invalid');
    this.id = id; this.managementUrl = managementUrl.replace(/\/$/, ''); this.apiKey = apiKey; this.providerUrl = providerUrl; this.participantId = participantId; this.protocol = protocol;
  }
  async request(path, method = 'GET', data) {
    const response = await fetch(`${this.managementUrl}${path}`, { method, headers: { 'content-type': 'application/json', ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}) }, body: data ? JSON.stringify(data) : undefined, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`EDC Management API HTTP ${response.status}`);
    const raw = await readTextLimited(response, 5_000_000);
    return raw ? JSON.parse(raw) : {};
  }
  async catalog(query = '') {
    if (!this.providerUrl || !this.participantId) throw new Error('Configure the provider DSP URL and participant ID');
    const data = await this.request('/v3/catalog/request', 'POST', { '@context': CTX, '@type': 'CatalogRequest', counterPartyAddress: this.providerUrl, counterPartyId: this.participantId, protocol: this.protocol, querySpec: { '@type': 'QuerySpec', offset: 0, limit: 50 } });
    const raw = field(data, 'dcat:dataset', `${DCAT}dataset`, 'dataset') || [];
    const list = Array.isArray(raw) ? raw : [raw];
    const queryTerms = terms(query);
    return list.map(x => this.mapDataset(x)).filter(Boolean).filter(x => !queryTerms.length || queryTerms.some(term => `${x.title} ${x.description} ${x.id}`.toLowerCase().includes(term)));
  }
  mapDataset(raw) {
    const assetId = value(field(raw, '@id', 'id', `${VOCAB}id`)); if (!assetId || typeof assetId !== 'string') return null;
    const title = value(field(raw, 'dct:title', 'title', 'https://purl.org/dc/terms/title', 'http://purl.org/dc/terms/title')) || assetId;
    const description = value(field(raw, 'dct:description', 'description', 'http://purl.org/dc/terms/description')) || '';
    const offer = field(raw, 'odrl:hasPolicy', `${ODRL}hasPolicy`, 'hasPolicy'); const policy = Array.isArray(offer) ? offer[0] : offer;
    const offerId = field(policy, '@id', 'id');
    return { id: `eds:${this.id}:${encodeURIComponent(assetId)}`, sourceId: this.id, sourceType: 'eds-dsp', title: String(title), description: String(description), tags: [], formats: [], license: 'unknown', policyUnknown: true, prohibitedUses: prohibitedUses(policy), provider: this.participantId, accessMode: 'contract-negotiation', sourceUrl: this.providerUrl, updatedAt: null, files: [], assetId, offerId, offerPolicy: policy || null };
  }
  async getDataset(id) { const items = await this.catalog(''); return items.find(x => x.id === id) || null; }
  async acquire(item) {
    if (!item.offerId || !item.offerPolicy) throw new Error('The EDC offer has no policy for negotiation');
    const offer = { ...item.offerPolicy, '@type': 'Offer', '@id': item.offerId, target: item.assetId, assigner: this.participantId };
    const result = await this.request('/v3/contractnegotiations', 'POST', { '@context': CTX, '@type': 'ContractRequest', counterPartyAddress: this.providerUrl, counterPartyId: this.participantId, protocol: this.protocol, policy: offer });
    const negotiationId = result['@id'] || result.id; if (!negotiationId) throw new Error('EDC did not return a negotiation ID');
    return { status: 'NEGOTIATING', negotiationId };
  }
  async negotiation(id) { if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('Invalid ID'); return this.request(`/v3/contractnegotiations/${id}`); }
  async startTransfer(agreementId, assetId) {
    return this.request('/v3/transferprocesses', 'POST', { '@context': CTX, '@type': 'TransferRequest', counterPartyAddress: this.providerUrl, counterPartyId: this.participantId, protocol: this.protocol, contractId: agreementId, assetId, transferType: 'HttpData-PULL' });
  }
  async transfer(id) { if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('Invalid ID'); return this.request(`/v3/transferprocesses/${id}`); }
  async edr(id) { if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('Invalid ID'); return this.request(`/v3/edrs/${id}/dataaddress`); }
}
