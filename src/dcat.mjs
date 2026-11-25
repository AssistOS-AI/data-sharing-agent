import { createHash } from 'node:crypto';
import { readTextLimited } from './http-util.mjs';
import { terms } from './ranking.mjs';

const prop = (x, ...keys) => keys.map(k => x?.[k]).find(v => v !== undefined);
const val = x => typeof x === 'object' && x !== null ? (x['@value'] ?? x['@id'] ?? x.value ?? '') : x;
const arr = x => x === undefined ? [] : Array.isArray(x) ? x : [x];

export class DcatCatalog {
  constructor(url, id = 'main', dataHosts = '') { this.url = new URL(url); this.id = id; this.dataHosts = dataHosts; if (!['https:', 'http:'].includes(this.url.protocol)) throw new Error('Invalid DCAT URL'); }
  async all() {
    const response = await fetch(this.url, { headers: { accept: 'application/ld+json, application/json' }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Catalog DCAT HTTP ${response.status}`);
    const raw = await readTextLimited(response, 5_000_000);
    const data = JSON.parse(raw); const records = arr(prop(data, 'dcat:dataset', 'http://www.w3.org/ns/dcat#dataset', 'https://www.w3.org/ns/dcat#dataset', 'dataset') || data['@graph'] || (Array.isArray(data) ? data : []));
    return records.map(x => this.map(x)).filter(Boolean);
  }
  map(raw) {
    const externalId = String(val(prop(raw, '@id', 'id', 'identifier', 'dct:identifier')) || ''); if (!externalId) return null;
    const title = String(val(prop(raw, 'dct:title', 'http://purl.org/dc/terms/title', 'title')) || externalId);
    const description = String(val(prop(raw, 'dct:description', 'http://purl.org/dc/terms/description', 'description')) || '');
    const license = String(val(prop(raw, 'dct:license', 'http://purl.org/dc/terms/license', 'license')) || 'unknown');
    const distributions = arr(prop(raw, 'dcat:distribution', 'http://www.w3.org/ns/dcat#distribution', 'distribution')).map((d, i) => { const link = String(val(prop(d, 'dcat:downloadURL', 'http://www.w3.org/ns/dcat#downloadURL', 'downloadURL', 'dcat:accessURL', 'accessURL')) || ''); if (!link) return null; let url; try { url = new URL(link); if (!['http:', 'https:'].includes(url.protocol)) return null; } catch { return null; } const path = String(val(prop(d, 'dct:title', 'title')) || `distribution-${i + 1}`); return { path, url: url.href, format: String(val(prop(d, 'dct:format', 'format')) || ''), size: Number(val(prop(d, 'dcat:byteSize', 'byteSize')) || 0) || null }; }).filter(Boolean);
    const id = createHash('sha256').update(externalId).digest('hex').slice(0, 24);
    return { id: `dcat:${this.id}:${id}`, sourceId: this.id, sourceType: 'dcat', externalId, title, description, tags: [], formats: distributions.map(x => x.format).filter(Boolean), license, policyUnknown: true, provider: this.url.hostname, accessMode: distributions.length ? 'direct-download' : 'metadata-only', sourceUrl: externalId.startsWith('https:') ? externalId : this.url.href, updatedAt: null, files: distributions.map(x => x.path), distributions };
  }
  async search(q) { const all = await this.all(); const queryTerms = terms(q); return all.filter(x => !queryTerms.length || queryTerms.some(term => `${x.title} ${x.description}`.toLowerCase().includes(term))); }
  async get(id) { return (await this.all()).find(x => x.id === id) || null; }
  fileUrl(item, path) { const d = item.distributions?.find(x => x.path === path); if (!d) throw Object.assign(new Error('Unknown DCAT distribution'), { status: 400 }); const url = new URL(d.url); const hosts = [this.url.hostname, ...this.dataHosts.split(',').map(x => x.trim()).filter(Boolean)]; if (!hosts.includes(url.hostname)) throw Object.assign(new Error('DCAT download host is not allowed'), { status: 403 }); return url; }
}
