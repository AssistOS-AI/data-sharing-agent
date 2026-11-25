import { EdcConnector } from './edc.mjs';
import { DcatCatalog } from './dcat.mjs';

const bad = message => { throw Object.assign(new Error(message), { status: 400, code: 'INVALID_SOURCE_CONFIG' }); };
const validId = id => typeof id === 'string' && /^[a-z][a-z0-9-]{1,39}$/.test(id) && !['hf', 'zenodo'].includes(id);
const validUrl = (value, field) => {
  let url; try { url = new URL(value); } catch { bad(`${field} must be a valid URL`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) bad(`${field} must use HTTP(S) without embedded credentials`);
  return url.href.replace(/\/$/, '');
};

export class SourceConfig {
  constructor(store) { this.store = store; }
  async init() {
    if (this.store.data.sources) return;
    const sources = {
      hf: { id: 'hf', type: 'huggingface', name: 'Hugging Face', enabled: true, token: process.env.HF_TOKEN || '' },
      zenodo: { id: 'zenodo', type: 'zenodo', name: 'Zenodo', enabled: true, token: process.env.ZENODO_TOKEN || '', url: process.env.HUB_ZENODO_URL || 'https://zenodo.org' }
    };
    if (process.env.EDC_MANAGEMENT_URL) sources.main = { id: 'main', type: 'edc', name: 'EDC main', enabled: true, managementUrl: process.env.EDC_MANAGEMENT_URL, apiKey: process.env.EDC_API_KEY || '', providerUrl: process.env.EDC_PROVIDER_URL || '', participantId: process.env.EDC_PARTICIPANT_ID || '', protocol: process.env.EDC_PROTOCOL || 'dataspace-protocol-http', dataHosts: process.env.EDC_DATA_HOSTS || '' };
    if (process.env.HUB_DCAT_URL) sources['dcat-main'] = { id: 'dcat-main', type: 'dcat', name: 'DCAT main', enabled: true, url: process.env.HUB_DCAT_URL, dataHosts: process.env.HUB_DCAT_DATA_HOSTS || '' };
    await this.store.update(d => { d.sources = sources; });
  }
  all() { return Object.values(this.store.data.sources || {}); }
  get(id) { return this.store.data.sources?.[id] || null; }
  publicList() { return this.all().map(({ token, apiKey, ...source }) => ({ ...source, hasToken: Boolean(token), hasApiKey: Boolean(apiKey) })); }
  hfToken() { return this.get('hf')?.token || ''; }
  hfEnabled() { return Boolean(this.get('hf')?.enabled); }
  zenodoEnabled() { return Boolean(this.get('zenodo')?.enabled); }
  zenodoToken() { return this.get('zenodo')?.token || ''; }
  zenodoUrl() { return this.get('zenodo')?.url || 'https://zenodo.org'; }
  edcs() { return this.all().filter(x => x.type === 'edc' && x.enabled).map(x => [x.id, new EdcConnector({ ...x, managementUrl: x.managementUrl, apiKey: x.apiKey, providerUrl: x.providerUrl, participantId: x.participantId, protocol: x.protocol })]); }
  dcats() { return this.all().filter(x => x.type === 'dcat' && x.enabled).map(x => [x.id, new DcatCatalog(x.url, x.id, x.dataHosts)]); }
  edc(id) { return this.edcs().find(([key]) => key === id)?.[1] || null; }
  dcat(id) { return this.dcats().find(([key]) => key === id)?.[1] || null; }
  sourceId(datasetId) { return datasetId.split(':')[1]; }
  async save(input, id = input?.id) {
    if (!input || typeof input !== 'object' || !validId(id) && !['hf', 'zenodo'].includes(id)) bad('Invalid source ID');
    const existing = this.get(id); const type = existing?.type || input.type;
    if (!['huggingface', 'zenodo', 'edc', 'dcat'].includes(type)) bad('Unsupported source type');
    if ((type === 'huggingface' && id !== 'hf') || (type === 'zenodo' && id !== 'zenodo') || (['edc', 'dcat'].includes(type) && !validId(id))) bad('Source ID does not match its type');
    const source = { id, type, name: String(input.name ?? existing?.name ?? id).trim().slice(0, 80), enabled: input.enabled === undefined ? existing?.enabled ?? true : input.enabled };
    if (!source.name || typeof source.enabled !== 'boolean') bad('Name and enabled state are required');
    if (type === 'huggingface' || type === 'zenodo') source.token = input.clearToken ? '' : input.token === undefined || input.token === '' ? existing?.token || '' : String(input.token).trim();
    if (type === 'zenodo') {
      source.url = validUrl(input.url ?? existing?.url ?? 'https://zenodo.org', 'Zenodo URL');
      const allowed = ['https://zenodo.org', 'https://sandbox.zenodo.org', process.env.HUB_ZENODO_URL].filter(Boolean);
      if (!allowed.includes(source.url)) bad('Zenodo URL must be the production or sandbox service');
    }
    if (type === 'edc') {
      source.managementUrl = validUrl(input.managementUrl ?? existing?.managementUrl, 'Management URL');
      source.providerUrl = validUrl(input.providerUrl ?? existing?.providerUrl, 'Provider DSP URL');
      source.participantId = String(input.participantId ?? existing?.participantId ?? '').trim();
      source.protocol = String(input.protocol ?? existing?.protocol ?? 'dataspace-protocol-http').trim();
      source.apiKey = input.clearApiKey ? '' : input.apiKey === undefined || input.apiKey === '' ? existing?.apiKey || '' : String(input.apiKey).trim();
      source.dataHosts = String(input.dataHosts ?? existing?.dataHosts ?? '').trim();
      if (!source.participantId || !source.protocol) bad('Participant ID and protocol are required');
    }
    if (type === 'dcat') { source.url = validUrl(input.url ?? existing?.url, 'Catalog URL'); source.dataHosts = String(input.dataHosts ?? existing?.dataHosts ?? '').trim(); }
    await this.store.update(d => { d.sources[id] = source; });
    return this.publicList().find(x => x.id === id);
  }
  async remove(id) { if (['hf', 'zenodo'].includes(id)) bad('Built-in sources can be disabled but not removed'); if (!this.get(id)) bad('Source not found'); await this.store.update(d => { delete d.sources[id]; }); }
}
