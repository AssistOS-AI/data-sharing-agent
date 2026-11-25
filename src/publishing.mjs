import { createReadStream } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRepo, uploadFile } from '@huggingface/hub';
import { validHfId } from './sources.mjs';

const invalid = message => { throw Object.assign(new Error(message), { status: 400, code: 'INVALID_PUBLICATION' }); };
export function fileName(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(value) || value.includes('..')) invalid('File name must be a simple name without directories');
  return value;
}
export function parsePublicationSuggestions(answer) {
  if (typeof answer !== 'string') return null;
  const candidates = [answer, ...[...answer.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(x => x[1])];
  for (const candidate of candidates.reverse()) {
    for (let start = candidate.length - 1; start >= 0; start--) {
      if (candidate[start] !== '{') continue;
      let depth = 0, quoted = false, escaped = false;
      for (let end = start; end < candidate.length; end++) {
        const char = candidate[end];
        if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
        if (char === '"') quoted = true;
        else if (char === '{') depth++;
        else if (char === '}' && --depth === 0) {
          try { const value = JSON.parse(candidate.slice(start, end + 1)); if (value && !Array.isArray(value) && typeof value === 'object' && ['title', 'description', 'repoId', 'creator', 'license'].some(key => typeof value[key] === 'string')) return value; } catch {}
          break;
        }
      }
    }
  }
  return null;
}
const required = (value, label, max = 2000) => { if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(`${label} is required (maximum ${max} characters)`); return value.trim(); };

export async function publishHf(input, artifactPath, token, hub = { createRepo, uploadFile }) {
  if (!token) invalid('A Hugging Face write token is required in Settings');
  const repoId = required(input.repoId, 'Repository ID', 120);
  if (!validHfId(repoId) || !repoId.includes('/')) invalid('Repository ID must be owner/name');
  const path = fileName(input.path);
  const visibility = input.visibility || 'private';
  if (!['private', 'public'].includes(visibility)) invalid('Invalid repository visibility');
  const repo = { type: 'dataset', name: repoId };
  if (input.createRepo) await hub.createRepo({ repo, accessToken: token, visibility, ...(input.license ? { license: required(input.license, 'License', 100) } : {}) });
  const commit = await hub.uploadFile({ repo, accessToken: token, file: { path, content: pathToFileURL(artifactPath) }, commitTitle: `Upload ${path}` });
  return { status: 'PUBLISHED', url: `https://huggingface.co/datasets/${repoId}/blob/main/${encodeURIComponent(path)}`, commit: commit?.commit?.oid || commit?.commitOid || null };
}

async function zenodoRequest(url, token, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }, redirect: 'manual', signal: AbortSignal.timeout(120000) });
  const raw = await response.text();
  if (!response.ok) throw Object.assign(new Error(`Zenodo returned HTTP ${response.status}: ${raw.slice(0, 500)}`), { status: 502, code: 'ZENODO_ERROR' });
  return raw ? JSON.parse(raw) : {};
}
export async function createZenodoDraft(input, artifactPath, token, baseUrl) {
  if (!token) invalid('A Zenodo deposit token is required in Settings');
  const base = new URL(baseUrl);
  const title = required(input.title, 'Title', 250);
  const description = required(input.description, 'Description', 10000);
  const creator = required(input.creator, 'Creator', 250);
  const license = required(input.license, 'License', 100);
  const path = fileName(input.path);
  const draft = await zenodoRequest(new URL('/api/deposit/depositions', base), token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ metadata: { upload_type: 'dataset', title, description, creators: [{ name: creator }], access_right: 'open', license } }) });
  if (!/^\d+$/.test(String(draft.id)) || !draft.links?.bucket) throw Object.assign(new Error('Zenodo returned an invalid draft'), { status: 502 });
  const bucket = new URL(draft.links.bucket);
  if (bucket.origin !== base.origin) throw Object.assign(new Error('Zenodo bucket host did not match the configured service'), { status: 502 });
  await zenodoRequest(new URL(encodeURIComponent(path), `${bucket.href.replace(/\/$/, '')}/`), token, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: createReadStream(artifactPath), duplex: 'half' });
  return { status: 'DRAFT', remoteId: String(draft.id), url: draft.links?.html || `${base.origin}/deposit/${draft.id}`, baseUrl: base.origin };
}
export async function publishZenodoDraft(remoteId, token, baseUrl) {
  if (!token) invalid('A Zenodo deposit token is required in Settings');
  if (!/^\d+$/.test(String(remoteId))) invalid('Invalid Zenodo draft ID');
  const record = await zenodoRequest(new URL(`/api/deposit/depositions/${remoteId}/actions/publish`, baseUrl), token, { method: 'POST' });
  return { status: 'PUBLISHED', remoteId: String(record.id || remoteId), url: record.links?.record_html || record.links?.html || `${baseUrl}/records/${remoteId}` };
}
