import { readTextLimited } from './http-util.mjs';
import { terms } from './ranking.mjs';

const HF_API = process.env.HUB_HF_URL || 'https://huggingface.co';
const HF_VIEWER = process.env.HUB_HF_VIEWER_URL || 'https://datasets-server.huggingface.co';
const ZENODO_API = process.env.HUB_ZENODO_URL || 'https://zenodo.org';

export async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Upstream source returned HTTP ${response.status}`);
  const raw = await readTextLimited(response, 3_000_000);
  return JSON.parse(raw);
}

export function validHfId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/.test(id) && !id.includes('..');
}

export function hfDataset(raw) {
  const id = raw.id || raw._id;
  if (!validHfId(id)) return null;
  const licenseTag = (raw.tags || []).find(t => t.startsWith('license:'));
  const license = raw.cardData?.license || licenseTag?.slice(8) || 'unknown';
  return { id: `hf:${id}`, sourceType: 'huggingface', title: id, description: raw.description || '', tags: (raw.tags || []).slice(0, 20), formats: [], license: Array.isArray(license) ? 'multiple' : license, provider: 'Hugging Face', accessMode: 'proxy-stream', sourceUrl: `${HF_API}/datasets/${id}`, gated: Boolean(raw.gated), updatedAt: raw.lastModified || null, files: (raw.siblings || []).map(s => s.rfilename).filter(Boolean) };
}

export function zenodoDataset(raw, baseUrl = ZENODO_API) {
  const id = String(raw.id || '');
  if (!/^\d+$/.test(id)) return null;
  const m = raw.metadata || {};
  const license = m.license?.id || m.license?.title || 'unknown';
  const files = (Array.isArray(raw.files) ? raw.files : (raw.files?.entries ? Object.entries(raw.files.entries).map(([key, value]) => ({ key, ...value })) : [])).filter(f => f.key || f.filename).map(f => ({ path: f.key || f.filename, size: f.size || null, checksum: f.checksum || null, url: f.links?.self || f.links?.content || null }));
  return { id: `zenodo:${id}`, sourceType: 'zenodo', title: m.title || `Zenodo ${id}`, description: (m.description || '').replace(/<[^>]*>/g, ' ').slice(0, 2000), tags: (m.keywords || []).slice(0, 20), formats: [...new Set(files.map(f => f.path.split('.').at(-1).toLowerCase()))], license, provider: 'Zenodo', accessMode: 'direct-download', sourceUrl: raw.links?.html || `${baseUrl}/records/${id}`, updatedAt: raw.updated || null, files: files.map(f => f.path), distributions: files };
}

export async function searchHf(q, token) {
  const url = new URL('/api/datasets', HF_API);
  url.searchParams.set('search', q); url.searchParams.set('limit', '20'); url.searchParams.set('full', 'true');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const data = await getJson(url, headers);
  if (!Array.isArray(data)) throw new Error('Unexpected Hugging Face response format');
  if (data.length) return data.map(hfDataset).filter(Boolean);
  const words = [...new Set(terms(q))].slice(0, 3).filter(word => word.toLowerCase() !== q.toLowerCase());
  const alternatives = await Promise.allSettled(words.map(word => { const u = new URL(url); u.searchParams.set('search', word); return getJson(u, headers); }));
  const found = new Map();
  for (const result of alternatives) if (result.status === 'fulfilled' && Array.isArray(result.value)) for (const raw of result.value) { const item = hfDataset(raw); if (item) found.set(item.id, item); }
  return [...found.values()].slice(0, 20);
}

export async function hfAccount(token) {
  if (!token) return { mode: 'public', account: null };
  const data = await getJson(`${HF_API}/api/whoami-v2`, { Authorization: `Bearer ${token}` });
  return { mode: 'account', account: data.name || data.fullname || null };
}

export async function getHf(id, token) {
  if (!validHfId(id)) throw Object.assign(new Error('Invalid Hugging Face ID'), { status: 400 });
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const raw = await getJson(`${HF_API}/api/datasets/${id}`, headers);
  return hfDataset(raw);
}

export async function searchZenodo(q, baseUrl = ZENODO_API) {
  const url = new URL('/api/records', baseUrl);
  url.searchParams.set('q', q); url.searchParams.set('size', '20');
  const data = await getJson(url, { 'user-agent': 'AchillesDatasharingHub/0.1 (local data discovery)' });
  return (data.hits?.hits || []).map(record => zenodoDataset(record, baseUrl)).filter(Boolean);
}

export async function getZenodo(id, baseUrl = ZENODO_API) {
  if (!/^\d+$/.test(id)) throw Object.assign(new Error('Invalid Zenodo ID'), { status: 400 });
  return zenodoDataset(await getJson(`${baseUrl}/api/records/${id}`, { 'user-agent': 'AchillesDatasharingHub/0.1 (local data discovery)' }), baseUrl);
}

export function hfFileUrl(id, filePath) {
  if (!validHfId(id) || typeof filePath !== 'string' || !filePath || filePath.length > 300 || filePath.startsWith('/') || filePath.split('/').some(x => !x || x === '.' || x === '..' || !/^[a-zA-Z0-9._ -]+$/.test(x))) throw Object.assign(new Error('Invalid file path'), { status: 400, code: 'INVALID_FILE' });
  return `${HF_API}/datasets/${id}/resolve/main/${filePath.split('/').map(encodeURIComponent).join('/')}`;
}

export async function hfPreview(id, token, config, split) {
  if (!validHfId(id)) throw Object.assign(new Error('Invalid Hugging Face ID'), { status: 400 });
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (!config || !split) {
    const url = new URL('/splits', HF_VIEWER); url.searchParams.set('dataset', id);
    const found = await getJson(url, headers); const first = found.splits?.[0];
    if (!first) return { available: false, reason: 'Preview unavailable', schema: [], rows: [] };
    config = first.config; split = first.split;
  }
  if (String(config).length > 120 || String(split).length > 120) throw Object.assign(new Error('Invalid config or split'), { status: 400 });
  const url = new URL('/first-rows', HF_VIEWER); url.searchParams.set('dataset', id); url.searchParams.set('config', config); url.searchParams.set('split', split);
  const data = await getJson(url, headers);
  return { available: true, config, split, schema: (data.features || []).map(f => ({ column: f.name, type: f.type?.dtype || f.type?._type || JSON.stringify(f.type || {}) })), rows: (data.rows || []).slice(0, 5).map(r => r.row) };
}

export function zenodoFileUrl(item, path, baseUrl = ZENODO_API) {
  const file = item.distributions?.find(x => x.path === path);
  if (!file || !file.url) throw Object.assign(new Error('Unknown Zenodo file'), { status: 400 });
  const url = new URL(file.url);
  const base = new URL(baseUrl);
  if (url.origin !== base.origin) throw Object.assign(new Error('Zenodo host is not allowed'), { status: 400 });
  return url;
}
