import http from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { Store } from './store.mjs';
import { evaluatePolicy, USES, configurePolicy, getPolicyConfig } from './policy.mjs';
import { searchHf, searchZenodo, getHf, getZenodo, hfFileUrl, hfPreview, zenodoFileUrl, hfAccount } from './sources.mjs';
import { SourceConfig } from './source-config.mjs';
import { Sink } from './sink.mjs';
import { rankDatasets } from './ranking.mjs';
import { analyze } from './analysis.mjs';
import { alaStatus, runAlaAnalysis, runAlaPublicationAssist } from './ala.mjs';
import { publishHf, createZenodoDraft, publishZenodoDraft, fileName, parsePublicationSuggestions } from './publishing.mjs';
import { mcpResult, MCP_VERSION } from './mcp.mjs';

const host = process.env.HUB_HOST || '127.0.0.1';
const port = Number(process.env.HUB_PORT || 8787);
const store = new Store(resolve(process.env.HUB_DATA_DIR || './data'));
const sink = new Sink(resolve(process.env.HUB_DATA_DIR || './data', 'sink'), Number(process.env.HUB_MAX_FILE_BYTES || 100_000_000));
const sources = new SourceConfig(store);
const downloads = new Map();
const edcFor = datasetId => sources.edc(datasetId.split(':')[1]);
const dcatFor = datasetId => sources.dcat(datasetId.split(':')[1]);

function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
function json(res, status, obj, headers = {}) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }); res.end(JSON.stringify(obj)); }
function actor(req) { const header = process.env.HUB_EXTERNAL_USER_HEADER?.toLowerCase(); const value = header ? req.headers[header] : null; return typeof value === 'string' && /^[a-zA-Z0-9._@:-]{1,128}$/.test(value) ? value : 'external'; }
function checkOrigin(req) { if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return; const origin = req.headers.origin; if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) fail(403, 'BAD_ORIGIN', 'Origin is not allowed'); }
async function body(req) { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) fail(413, 'BODY_TOO_LARGE', 'Request body is too large'); } try { return raw ? JSON.parse(raw) : {}; } catch { fail(400, 'INVALID_JSON', 'Invalid JSON'); } }
function enrich(item, use) { return { ...item, policy: evaluatePolicy(item, use) }; }
function sourceActive(id) { if (id.startsWith('hf:')) return sources.hfEnabled(); if (id.startsWith('zenodo:')) return sources.zenodoEnabled(); if (id.startsWith('eds:')) return Boolean(edcFor(id)); if (id.startsWith('dcat:')) return Boolean(dcatFor(id)); return false; }
async function dataset(id, refresh = false) {
  if (!sourceActive(id)) fail(404, 'SOURCE_DISABLED', 'Dataset source is unavailable');
  if (!refresh && store.data.datasets[id] && Date.now() - store.data.datasets[id].cachedAt < 900_000) return store.data.datasets[id];
  let item;
  if (id.startsWith('hf:') && sources.hfEnabled()) item = await getHf(id.slice(3), sources.hfToken());
  else if (id.startsWith('zenodo:') && sources.zenodoEnabled()) item = await getZenodo(id.slice(7), sources.zenodoUrl());
  else if (id.startsWith('eds:') && edcFor(id)) item = await edcFor(id).getDataset(id);
  else if (id.startsWith('dcat:') && dcatFor(id)) item = await dcatFor(id).get(id);
  else fail(404, 'NOT_FOUND', 'Dataset not found or its source is disabled');
  if (!item) fail(404, 'NOT_FOUND', 'Dataset not found');
  await store.remember([item]); return item;
}
function policyFingerprint(item) { const policy = item.offerPolicy ? { ...item.offerPolicy } : null; if (policy) { delete policy['@id']; delete policy.id; } return createHash('sha256').update(JSON.stringify({ license: item.license, gated: item.gated, containsPii: item.containsPii, prohibitedUses: item.prohibitedUses, offerPolicy: policy, distributions: item.distributions, orgPolicy: getPolicyConfig() })).digest('hex'); }
function approvalFor(id, use, who, filePath, fingerprint) { return store.data.approvals.find(a => a.datasetId === id && a.intendedUse === use && a.actor === who && a.filePath === (filePath || null) && a.policyFingerprint === fingerprint && a.status === 'APPROVED' && Date.now() - Date.parse(a.decidedAt) < 24 * 3600_000); }
async function remoteFile(ticket) {
  if (!sourceActive(ticket.id)) fail(404, 'SOURCE_DISABLED', 'Dataset source is unavailable');
  const headers = ticket.id.startsWith('hf:') && sources.hfToken() ? { Authorization: `Bearer ${sources.hfToken()}` } : {};
  const first = ticket.id.startsWith('hf:') ? hfFileUrl(ticket.id.slice(3), ticket.filePath) : ticket.id.startsWith('zenodo:') ? zenodoFileUrl(await dataset(ticket.id, true), ticket.filePath, sources.zenodoUrl()) : dcatFor(ticket.id).fileUrl(await dataset(ticket.id, true), ticket.filePath);
  let url = new URL(first); const originalHost = url.hostname;
  let response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(60000) });
  for (let i = 0; i < 3 && [301, 302, 303, 307, 308].includes(response.status); i++) {
    url = new URL(response.headers.get('location') || '', url);
    const hosts = [originalHost, ...(process.env.HUB_DOWNLOAD_HOSTS || '').split(',').map(x => x.trim()).filter(Boolean)];
    const hfHost = ticket.id.startsWith('hf:') && (url.hostname === 'huggingface.co' || url.hostname.endsWith('.huggingface.co') || url.hostname.endsWith('.hf.co'));
    if (!(hosts.includes(url.hostname) || hfHost) || (url.protocol !== 'https:' && !(process.env.HUB_ALLOW_HTTP_SOURCES === '1' && url.protocol === 'http:'))) fail(502, 'UNSAFE_REDIRECT', 'Redirect not allowed; add the verified host to HUB_DOWNLOAD_HOSTS');
    response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60000) });
  }
  if (!response.ok) fail(502, 'UPSTREAM_ERROR', `Upstream source returned HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0); if (length > sink.maxBytes) fail(413, 'FILE_TOO_LARGE', 'File exceeds the size limit');
  return { response, length };
}
async function pipeLimited(body, res, limit) { let bytes = 0; for await (const chunk of body) { bytes += chunk.length; if (bytes > limit) { res.destroy(); return bytes; } if (!res.write(chunk)) await new Promise(done => res.once('drain', done)); } res.end(); return bytes; }
async function edcRemoteFile(job) { const connector = sources.edc(job.sourceId || 'main'); if (!connector) fail(404, 'SOURCE_DISABLED', 'EDC source is unavailable'); const edr = await connector.edr(job.transferId); const endpoint = new URL(edr.endpoint); const hosts = (sources.get(job.sourceId || 'main')?.dataHosts || '').split(',').map(x => x.trim()).filter(Boolean); if (!hosts.includes(endpoint.hostname) || !['http:', 'https:'].includes(endpoint.protocol)) fail(403, 'DATA_HOST_NOT_ALLOWED', 'EDR host is not in the allowed data hosts'); const token = edr.authorization; if (typeof token !== 'string' || !token) fail(502, 'EDR_AUTH_MISSING', 'EDR does not contain an access token'); const response = await fetch(endpoint, { headers: { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` }, redirect: 'manual', signal: AbortSignal.timeout(60000) }); if (!response.ok) fail(502, 'EDR_FETCH_FAILED', `Data plane HTTP ${response.status}`); const length = Number(response.headers.get('content-length') || 0); if (length > sink.maxBytes) fail(413, 'FILE_TOO_LARGE', 'File exceeds the size limit'); return { response, length, endpointHost: endpoint.hostname }; }
async function trackedAla(type, who, task) {
  const run = { id: randomUUID(), type, actor: who, status: 'RUNNING', startedAt: new Date().toISOString(), output: '', error: null };
  await store.update(d => d.alaRuns.push(run));
  await store.audit('ala_started', { actor: who, runId: run.id, type });
  try {
    let lastSaved = 0;
    const answer = await task(output => { run.output = String(output).slice(-4000); if (Date.now() - lastSaved > 1000) { lastSaved = Date.now(); store.update(() => {}).catch(console.error); } });
    await store.update(() => { run.output = String(answer).slice(0, 100000); run.status = 'COMPLETED'; run.finishedAt = new Date().toISOString(); });
    await store.audit('ala_completed', { actor: who, runId: run.id });
    return { answer, runId: run.id };
  } catch (error) {
    await store.update(() => { run.error = error.message.slice(0, 1000); run.status = 'FAILED'; run.finishedAt = new Date().toISOString(); });
    await store.audit('ala_failed', { actor: who, runId: run.id, reason: run.error });
    throw error;
  }
}

async function route(req, res) {
  const permittedHosts = new Set([`${host}:${port}`, ...(host === '127.0.0.1' ? [`localhost:${port}`] : []), ...(process.env.HUB_ALLOWED_HOSTS || '').split(',').map(x => x.trim()).filter(Boolean)]);
  if (host !== '0.0.0.0' && !permittedHosts.has(req.headers.host)) fail(403, 'BAD_HOST', 'Host is not allowed');
  checkOrigin(req);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  if (req.method === 'GET' && p === '/') { const html = await readFile(new URL('../web/index.html', import.meta.url)); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'", 'x-content-type-options': 'nosniff' }); return res.end(html); }
  if (req.method === 'GET' && (p === '/docs' || p === '/docs/')) { const html = await readFile(new URL('../docs/index.html', import.meta.url)); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' }); return res.end(html); }
  if (req.method === 'GET' && /^\/docs\/(specification|plan|api|edc-setup|ala|verification|publishing)\.md$/.test(p)) { const name = p.split('/').at(-1); const markdown = await readFile(new URL(`../docs/${name}`, import.meta.url)); res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'x-content-type-options': 'nosniff' }); return res.end(markdown); }
  if (req.method === 'GET' && p === '/app.js') { const js = await readFile(new URL('../web/app.js', import.meta.url)); res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }); return res.end(js); }
  if (p === '/mcp') { if (req.method !== 'POST') return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for MCP' } }, { allow: 'POST' }); if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) fail(403, 'BAD_ORIGIN', 'MCP Origin is not allowed'); if (req.headers['mcp-protocol-version'] && req.headers['mcp-protocol-version'] !== MCP_VERSION) fail(400, 'MCP_VERSION_UNSUPPORTED', 'Unsupported MCP version'); const message = await body(req); const address = host === '0.0.0.0' ? '127.0.0.1' : host; const callRest = async (method, path, data) => { const response = await fetch(`http://${address}:${port}${path}`, { method, headers: { ...(process.env.HUB_EXTERNAL_USER_HEADER ? { [process.env.HUB_EXTERNAL_USER_HEADER]: actor(req) } : {}), ...(data ? { 'content-type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined }); const value = await response.json(); if (!response.ok) throw new Error(value.error?.message || `HTTP ${response.status}`); return value; }; const result = await mcpResult(message, callRest); if (!result) { res.writeHead(202); return res.end(); } return json(res, 200, result); }
  const who = actor(req);
  if (req.method === 'GET' && p === '/api/v1/health') return json(res, 200, { status: 'ok', connectors: { huggingface: sources.hfEnabled(), zenodo: sources.zenodoEnabled(), edc: sources.edcs().length, dcat: sources.dcats().length, ala: store.data.settings.alaEnabled }, storage: 'json-single-process' });
  if (req.method === 'GET' && p === '/api/v1/settings') return json(res, 200, { ala: { ...(await alaStatus()), enabled: Boolean(store.data.settings.alaEnabled) }, sink: await sink.stats(store.data.artifacts) });
  if (req.method === 'GET' && p === '/api/v1/ala/runs') return json(res, 200, { items: [...store.data.alaRuns].reverse().map(({ output, ...run }) => ({ ...run, outputPreview: output?.slice(-300) || '' })) });
  const alaRunMatch = p.match(/^\/api\/v1\/ala\/runs\/([a-f0-9-]+)$/);
  if (req.method === 'GET' && alaRunMatch) { const run = store.data.alaRuns.find(x => x.id === alaRunMatch[1]); if (!run) fail(404, 'NOT_FOUND', 'ALA run not found'); return json(res, 200, run); }
  if (req.method === 'GET' && p === '/api/v1/policy/config') return json(res, 200, getPolicyConfig());
  if (req.method === 'PUT' && p === '/api/v1/policy/config') { const config = configurePolicy(await body(req)); await store.update(d => { d.settings.policy = config; }); await store.audit('policy_config_changed', { actor: who, config }); return json(res, 200, config); }
  if (req.method === 'POST' && p === '/api/v1/settings') { const input = await body(req); if (typeof input.alaEnabled !== 'boolean') fail(400, 'INVALID_SETTING', 'alaEnabled must be a boolean'); if (input.alaEnabled && !(await alaStatus()).ready) fail(409, 'ALA_UNAVAILABLE', 'ALA is not ready or has no authenticated coding agent'); await store.update(d => { d.settings.alaEnabled = input.alaEnabled; }); await store.audit('setting_changed', { actor: who, setting: 'alaEnabled', value: input.alaEnabled }); return json(res, 200, { alaEnabled: input.alaEnabled }); }
  if (req.method === 'GET' && (p === '/api/v1/connectors' || p === '/api/v1/sources')) return json(res, 200, { sources: sources.publicList() });
  if (req.method === 'POST' && p === '/api/v1/sources') { const input = await body(req); if (sources.get(input.id)) fail(409, 'SOURCE_EXISTS', 'A source with this ID already exists'); const source = await sources.save(input); await store.audit('source_saved', { actor: who, sourceId: source.id, type: source.type }); return json(res, 201, source); }
  const sourceMatch = p.match(/^\/api\/v1\/sources\/([a-z0-9-]+)$/);
  if (sourceMatch && req.method === 'PUT') { if (!sources.get(sourceMatch[1])) fail(404, 'SOURCE_NOT_FOUND', 'Source not found'); const source = await sources.save(await body(req), sourceMatch[1]); await store.audit('source_saved', { actor: who, sourceId: source.id, type: source.type }); return json(res, 200, source); }
  if (sourceMatch && req.method === 'DELETE') { await sources.remove(sourceMatch[1]); await store.audit('source_removed', { actor: who, sourceId: sourceMatch[1] }); return json(res, 200, { ok: true }); }
  const testSource = async source => { if (!source || !source.enabled) fail(400, 'SOURCE_DISABLED', 'Source is unavailable'); if (source.type === 'huggingface') { const account = await hfAccount(sources.hfToken()); const items = await searchHf('energy', sources.hfToken()); return { count: items.length, ...account }; } if (source.type === 'zenodo') return { count: (await searchZenodo('energy', sources.zenodoUrl())).length }; if (source.type === 'edc') return { count: (await sources.edc(source.id).catalog('')).length }; return { count: (await sources.dcat(source.id).all()).length }; };
  if (req.method === 'POST' && p === '/api/v1/connectors/test') { const checks = sources.all().filter(x => x.enabled); const results = await Promise.allSettled(checks.map(testSource)); const items = results.map((r, i) => ({ source: checks[i].id, status: r.status === 'fulfilled' ? 'online' : 'error', count: r.status === 'fulfilled' ? r.value.count : null, error: r.status === 'rejected' ? r.reason.message : null })); await store.audit('connectors_tested', { actor: who, statuses: items.map(x => [x.source, x.status]) }); return json(res, 200, { items }); }
  const sourceTestMatch = p.match(/^\/api\/v1\/sources\/([a-z0-9-]+)\/test$/);
  if (req.method === 'POST' && sourceTestMatch) { const source = sources.get(sourceTestMatch[1]); const result = await testSource(source); await store.audit('source_tested', { actor: who, sourceId: source.id }); return json(res, 200, { source: source.id, status: 'online', ...result }); }
  if (req.method === 'GET' && p === '/api/v1/search') {
    const q = (url.searchParams.get('q') || '').trim(); if (!q || q.length > 200) fail(400, 'INVALID_QUERY', 'The query must contain 1–200 characters');
    const use = url.searchParams.get('intended_use') || 'research'; if (!USES.includes(use)) fail(400, 'INVALID_USE', 'Invalid intended use');
    const requested = (url.searchParams.get('sources') || 'hf,zenodo,eds,dcat').split(','); if (!requested.length || requested.some(x => !['hf', 'zenodo', 'eds', 'dcat'].includes(x))) fail(400, 'INVALID_SOURCE', 'Invalid source'); const tasks = [];
    if (requested.includes('hf') && sources.hfEnabled()) tasks.push(['hf', () => searchHf(q, sources.hfToken())]);
    if (requested.includes('zenodo') && sources.zenodoEnabled()) tasks.push(['zenodo', () => searchZenodo(q, sources.zenodoUrl())]);
    if (requested.includes('eds')) for (const [id, connector] of sources.edcs()) tasks.push([id, () => connector.catalog(q)]);
    if (requested.includes('dcat')) for (const [id, catalog] of sources.dcats()) tasks.push([id, () => catalog.search(q)]);
    const results = await Promise.allSettled(tasks.map(([, fn]) => fn())); const items = []; const errors = [];
    results.forEach((r, i) => { if (r.status === 'fulfilled') items.push(...r.value); else errors.push({ source: tasks[i][0], message: r.reason.message }); });
    if (requested.includes('hf') && !sources.hfEnabled()) errors.push({ source: 'hf', message: 'Hugging Face is disabled in Settings.' });
    if (requested.includes('zenodo') && !sources.zenodoEnabled()) errors.push({ source: 'zenodo', message: 'Zenodo is disabled in Settings.' });
    if (requested.includes('eds') && !sources.edcs().length) errors.push({ source: 'eds', message: 'No EDC connector is configured. Add one in Settings.' });
    if (requested.includes('dcat') && !sources.dcats().length) errors.push({ source: 'dcat', message: 'No DCAT catalog is configured. Add one in Settings.' });
    const ranked = rankDatasets(items, q); await store.remember(ranked); const policyFilter = url.searchParams.get('policy'); const accessFilter = url.searchParams.get('access_mode'); if (policyFilter && !['AUTO_APPROVED', 'NEEDS_HUMAN_APPROVAL', 'DENIED'].includes(policyFilter)) fail(400, 'INVALID_FILTER', 'Invalid policy filter'); if (accessFilter && !['proxy-stream', 'direct-download', 'contract-negotiation', 'metadata-only'].includes(accessFilter)) fail(400, 'INVALID_FILTER', 'Invalid access mode'); const filtered = ranked.map(x => enrich(x, use)).filter(x => (!policyFilter || x.policy.decision === policyFilter) && (!accessFilter || x.accessMode === accessFilter)); await store.audit('search', { actor: who, query: q, sources: tasks.map(x => x[0]), count: filtered.length });
    return json(res, 200, { items: filtered, errors, nextCursor: null });
  }
  if (req.method === 'POST' && p === '/api/v1/analyze') { const input = await body(req); const use = input.intendedUse || 'research'; if (!USES.includes(use)) fail(400, 'INVALID_USE', 'Invalid intended use'); const sse = req.headers.accept?.includes('text/event-stream'); if (sse) { res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' }); res.write(`event: progress\ndata: ${JSON.stringify({ step: 'search', message: 'Searching and ranking datasets' })}\n\n`); } const recent = Object.values(store.data.datasets).filter(x => sourceActive(x.id) && Date.now() - x.cachedAt < 900_000).slice(-50); const result = await analyze(input.problemStatement, use, { edcs: sources.edcs(), dcats: sources.dcats(), hfToken: sources.hfToken(), hfEnabled: sources.hfEnabled(), zenodoEnabled: sources.zenodoEnabled(), zenodoUrl: sources.zenodoUrl(), cached: recent }); await store.remember(result.recommendations.map(x => x.dataset)); if (store.data.settings.alaEnabled) { if (sse) res.write(`event: progress\ndata: ${JSON.stringify({ step: 'ala', message: 'ALA is analyzing candidates' })}\n\n`); try { const ala = await trackedAla('analysis', who, onProgress => runAlaAnalysis({ problem: input.problemStatement, intendedUse: use, recommendations: result.recommendations, errors: result.errors }, store.dir, onProgress)); result.agentAnswer = ala.answer; result.alaRunId = ala.runId; result.method = 'bm25+ala'; } catch (e) { result.agentError = e.message; await store.audit('ala_analysis_fallback', { actor: who, reason: e.message.slice(0, 500) }); } } await store.audit('analysis', { actor: who, method: result.method, count: result.recommendations.length }); if (sse) { res.write(`event: result\ndata: ${JSON.stringify(result)}\n\n`); return res.end(); } return json(res, 200, result); }
  const datasetMatch = p.match(/^\/api\/v1\/datasets\/([^/]+)$/); if (req.method === 'GET' && datasetMatch) { const id = decodeURIComponent(datasetMatch[1]); return json(res, 200, enrich(await dataset(id), url.searchParams.get('intended_use') || 'research')); }
  const previewMatch = p.match(/^\/api\/v1\/datasets\/([^/]+)\/preview$/); if (req.method === 'GET' && previewMatch) { const id = decodeURIComponent(previewMatch[1]); const item = await dataset(id); const use = url.searchParams.get('intended_use') || 'research'; const policy = evaluatePolicy(item, use); if (policy.decision !== 'AUTO_APPROVED' && !approvalFor(id, use, who, null, policyFingerprint(item))) fail(403, 'PREVIEW_REQUIRES_APPROVAL', 'Preview requires approval'); if (item.sourceType !== 'huggingface') fail(501, 'PREVIEW_UNAVAILABLE', 'Preview is available only for Hugging Face'); const preview = await hfPreview(id.slice(3), sources.hfToken(), url.searchParams.get('config'), url.searchParams.get('split')); await store.audit('preview', { actor: who, datasetId: id, intendedUse: use }); return json(res, 200, preview); }
  if (req.method === 'POST' && p === '/api/v1/policy/check') { const input = await body(req); const item = await dataset(input.datasetId); const policy = evaluatePolicy(item, input.intendedUse); await store.audit('policy_check', { actor: who, datasetId: item.id, intendedUse: input.intendedUse, decision: policy.decision }); return json(res, 200, { datasetId: item.id, ...policy }); }
  if (req.method === 'POST' && p === '/api/v1/simulate') { const input = await body(req); const item = input.datasetId ? await dataset(input.datasetId) : { id: 'simulation', license: input.license || 'unknown', sourceType: input.sourceType || 'huggingface', gated: Boolean(input.gated), containsPii: Boolean(input.containsPii), prohibitedUses: input.prohibitedUses || [] }; const policy = evaluatePolicy(item, input.intendedUse); await store.audit('policy_simulation', { actor: who, datasetId: item.id, decision: policy.decision }); return json(res, 200, { datasetId: item.id, ...policy }); }
  const acquireMatch = p.match(/^\/api\/v1\/datasets\/([^/]+)\/acquire$/); if (req.method === 'POST' && acquireMatch) {
    const id = decodeURIComponent(acquireMatch[1]); const input = await body(req); const use = input.intendedUse || 'research'; const filePath = input.filePath || null; const hasApproval = store.data.approvals.some(a => a.datasetId === id && a.actor === who && a.status === 'APPROVED'); const item = await dataset(id, hasApproval); const policy = evaluatePolicy(item, use); const fingerprint = policyFingerprint(item);
    if (policy.decision === 'DENIED') { await store.audit('acquire_denied', { actor: who, datasetId: id, intendedUse: use }); fail(403, 'POLICY_DENIED', policy.reasons.join(' ')); }
    if (!['huggingface', 'eds-dsp', 'zenodo', 'dcat'].includes(item.sourceType)) fail(501, 'SOURCE_NOT_SUPPORTED', 'Transfer is not implemented for this source');
    if (item.sourceType === 'huggingface') { if (!filePath || !item.files.includes(filePath)) fail(400, 'UNKNOWN_FILE', 'Select a file from the dataset file list'); hfFileUrl(id.slice(3), filePath); }
    if (item.sourceType === 'zenodo') { if (!filePath) fail(400, 'UNKNOWN_FILE', 'Select a file from the dataset file list'); zenodoFileUrl(item, filePath, sources.zenodoUrl()); }
    if (item.sourceType === 'dcat') { if (!filePath) fail(400, 'UNKNOWN_FILE', 'Select a distribution from the dataset'); dcatFor(id).fileUrl(item, filePath); }
    if (policy.decision === 'NEEDS_HUMAN_APPROVAL' && !approvalFor(id, use, who, filePath, fingerprint)) {
      if (!input.justification || String(input.justification).length < 5) fail(400, 'JUSTIFICATION_REQUIRED', 'Justification must contain at least 5 characters');
      const request = { id: randomUUID(), datasetId: id, intendedUse: use, actor: who, filePath, policyFingerprint: fingerprint, justification: String(input.justification).slice(0, 1000), reasons: policy.reasons, status: 'PENDING', createdAt: new Date().toISOString() };
      await store.update(d => d.approvals.push(request)); await store.audit('approval_requested', { actor: who, datasetId: id, approvalId: request.id }); return json(res, 202, { status: 'PENDING_HUMAN_APPROVAL', approvalId: request.id });
    }
    if (item.sourceType === 'eds-dsp') { const connector = edcFor(id); const started = await connector.acquire(item); const job = { sourceId: item.sourceId || 'main', id: randomUUID(), datasetId: id, actor: who, assetId: item.assetId, negotiationId: started.negotiationId, status: 'NEGOTIATING', createdAt: new Date().toISOString() }; await store.update(d => d.jobs.push(job)); await store.audit('edc_negotiation_started', { actor: who, datasetId: id, jobId: job.id, negotiationId: job.negotiationId }); return json(res, 202, job); }
    const ticket = randomBytes(24).toString('hex'); downloads.set(ticket, { id, filePath, actor: who, expires: Date.now() + 300_000 }); await store.audit('acquire_authorized', { actor: who, datasetId: id, filePath }); return json(res, 200, { status: 'READY', downloadUrl: `/api/v1/download/${ticket}`, cacheUrl: `/api/v1/download/${ticket}/cache`, expiresInSeconds: 300 });
  }
  const downloadMatch = p.match(/^\/api\/v1\/download\/([a-f0-9]+)$/); if (req.method === 'GET' && downloadMatch) {
    const ticket = downloads.get(downloadMatch[1]); if (!ticket || ticket.expires < Date.now() || ticket.actor !== who) fail(404, 'NOT_FOUND', 'Expired link'); downloads.delete(downloadMatch[1]);
    const { response: remote, length } = await remoteFile(ticket);
    await store.audit('download_started', { actor: who, datasetId: ticket.id, filePath: ticket.filePath, bytes: length });
    res.writeHead(200, { 'content-type': 'application/octet-stream', ...(length ? { 'content-length': String(length) } : {}), 'content-disposition': `attachment; filename="${ticket.filePath.split('/').at(-1).replace(/[^a-zA-Z0-9._-]/g, '_')}"`, 'cache-control': 'no-store' });
    return pipeLimited(remote.body, res, sink.maxBytes);
  }
  const cacheMatch = p.match(/^\/api\/v1\/download\/([a-f0-9]+)\/cache$/); if (req.method === 'POST' && cacheMatch) { const ticket = downloads.get(cacheMatch[1]); if (!ticket || ticket.expires < Date.now() || ticket.actor !== who) fail(404, 'NOT_FOUND', 'Expired link'); downloads.delete(cacheMatch[1]); const { response } = await remoteFile(ticket); const artifact = { ...await sink.save(response.body, ticket.filePath, Number(process.env.HUB_DEFAULT_TTL_HOURS || 168)), datasetId: ticket.id, actor: who }; await store.update(d => d.artifacts.push(artifact)); await store.audit('cached', { actor: who, datasetId: ticket.id, artifactId: artifact.id, bytes: artifact.bytes, sha256: artifact.sha256 }); return json(res, 201, { artifact, downloadUrl: `/api/v1/artifacts/${artifact.id}/download` }); }
  if (req.method === 'GET' && p === '/api/v1/artifacts') return json(res, 200, { items: store.data.artifacts });
  if (req.method === 'POST' && p === '/api/v1/uploads') {
    const name = fileName(url.searchParams.get('name'));
    if (Number(req.headers['content-length'] || 0) > sink.maxBytes) fail(413, 'FILE_TOO_LARGE', 'File exceeds the size limit');
    const artifact = { ...await sink.save(req, name, Number(process.env.HUB_DEFAULT_TTL_HOURS || 168)), datasetId: 'local:upload', actor: who };
    await store.update(d => d.artifacts.push(artifact)); await store.audit('uploaded', { actor: who, artifactId: artifact.id, bytes: artifact.bytes, sha256: artifact.sha256 });
    return json(res, 201, { artifact });
  }
  if (req.method === 'GET' && p === '/api/v1/publications') return json(res, 200, { items: [...store.data.publications].reverse() });
  if (req.method === 'POST' && p === '/api/v1/publications/assist') {
    if (!store.data.settings.alaEnabled) fail(409, 'ALA_DISABLED', 'Enable ALA in Hub settings to use form assistance');
    const input = await body(req);
    if (!['hf', 'zenodo'].includes(input.destination) || typeof input.description !== 'string' || input.description.trim().length < 8 || input.description.length > 3000) fail(400, 'INVALID_REQUEST', 'Destination and a description of 8–3000 characters are required');
    const artifact = store.data.artifacts.find(x => x.id === input.artifactId && Date.parse(x.expiresAt) > Date.now());
    if (!artifact) fail(404, 'ARTIFACT_NOT_FOUND', 'Select a local file first');
    if (artifact.datasetId !== 'local:upload') fail(403, 'PUBLICATION_SOURCE_RESTRICTED', 'Only files explicitly uploaded for publication can be published');
    const { answer, runId } = await trackedAla('publication_assist', who, onProgress => runAlaPublicationAssist({ destination: input.destination, description: input.description, fileName: artifact.name, currentFields: input.currentFields || {} }, store.dir, onProgress));
    const fields = parsePublicationSuggestions(answer);
    if (!fields) fail(502, 'ALA_INVALID_OUTPUT', 'ALA did not return valid form JSON; inspect the run in Monitoring');
    const allowed = ['title', 'description', 'creator', 'license', 'repoId', 'path'];
    return json(res, 200, { runId, fields: Object.fromEntries(allowed.filter(key => typeof fields[key] === 'string').map(key => [key, fields[key].slice(0, 10000)])) });
  }
  if (req.method === 'POST' && p === '/api/v1/publications') {
    const input = await body(req);
    if (!['hf', 'zenodo'].includes(input.destination)) fail(400, 'INVALID_DESTINATION', 'Select Hugging Face or Zenodo');
    const artifact = store.data.artifacts.find(x => x.id === input.artifactId && Date.parse(x.expiresAt) > Date.now());
    if (!artifact) fail(404, 'ARTIFACT_NOT_FOUND', 'Select a local file first');
    if (artifact.datasetId !== 'local:upload') fail(403, 'PUBLICATION_SOURCE_RESTRICTED', 'Only files explicitly uploaded for publication can be published');
    if (input.rightsConfirmed !== true) fail(400, 'RIGHTS_CONFIRMATION_REQUIRED', 'Confirm that you have the right to publish this file');
    const publication = { id: randomUUID(), destination: input.destination, artifactId: artifact.id, actor: who, status: 'PREPARING', createdAt: new Date().toISOString(), metadata: Object.fromEntries(['repoId', 'path', 'title', 'description', 'creator', 'license', 'visibility'].filter(key => typeof input[key] === 'string').map(key => [key, input[key].slice(0, 10000)])) };
    await store.update(d => d.publications.push(publication)); await store.audit('publication_started', { actor: who, publicationId: publication.id, destination: input.destination, artifactId: artifact.id });
    try {
      if (input.destination === 'hf') { if (!sources.hfEnabled()) fail(409, 'SOURCE_DISABLED', 'Hugging Face is disabled'); Object.assign(publication, await publishHf(input, sink.path(artifact.id), sources.hfToken())); }
      else { if (!sources.zenodoEnabled()) fail(409, 'SOURCE_DISABLED', 'Zenodo is disabled'); Object.assign(publication, await createZenodoDraft(input, sink.path(artifact.id), sources.zenodoToken(), sources.zenodoUrl())); }
      publication.finishedAt = new Date().toISOString(); await store.update(() => {}); await store.audit('publication_prepared', { actor: who, publicationId: publication.id, status: publication.status, url: publication.url });
      return json(res, 201, publication);
    } catch (error) { publication.status = 'FAILED'; publication.error = error.message.slice(0, 1000); publication.finishedAt = new Date().toISOString(); await store.update(() => {}); await store.audit('publication_failed', { actor: who, publicationId: publication.id, reason: publication.error }); throw error; }
  }
  const publishMatch = p.match(/^\/api\/v1\/publications\/([a-f0-9-]+)\/publish$/);
  if (req.method === 'POST' && publishMatch) {
    const publication = store.data.publications.find(x => x.id === publishMatch[1]);
    if (!publication) fail(404, 'NOT_FOUND', 'Publication not found');
    if (publication.destination !== 'zenodo' || publication.status !== 'DRAFT') fail(409, 'INVALID_STATE', 'Only a Zenodo draft can be published');
    if (!sources.zenodoEnabled()) fail(409, 'SOURCE_DISABLED', 'Zenodo is disabled');
    if (publication.baseUrl !== sources.zenodoUrl()) fail(409, 'SOURCE_CHANGED', 'The Zenodo service changed since draft creation');
    const result = await publishZenodoDraft(publication.remoteId, sources.zenodoToken(), publication.baseUrl);
    Object.assign(publication, result, { finishedAt: new Date().toISOString() }); await store.update(() => {}); await store.audit('publication_published', { actor: who, publicationId: publication.id, url: publication.url });
    return json(res, 200, publication);
  }
  const artifactMatch = p.match(/^\/api\/v1\/artifacts\/([a-f0-9-]+)\/download$/); if (req.method === 'GET' && artifactMatch) { const artifact = store.data.artifacts.find(x => x.id === artifactMatch[1] && Date.parse(x.expiresAt) > Date.now()); if (!artifact) fail(404, 'NOT_FOUND', 'Artifact not found or expired'); await store.audit('artifact_download', { actor: who, artifactId: artifact.id }); res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(artifact.bytes), 'content-disposition': `attachment; filename="${artifact.name.split('/').at(-1).replace(/[^a-zA-Z0-9._-]/g, '_')}"`, 'cache-control': 'no-store' }); return createReadStream(sink.path(artifact.id)).pipe(res); }
  const artifactDelete = p.match(/^\/api\/v1\/artifacts\/([a-f0-9-]+)$/); if (req.method === 'DELETE' && artifactDelete) { const artifact = store.data.artifacts.find(x => x.id === artifactDelete[1]); if (!artifact) fail(404, 'NOT_FOUND', 'Artifact not found'); await rm(sink.path(artifact.id), { force: true }); await store.update(d => { d.artifacts = d.artifacts.filter(x => x.id !== artifact.id); }); await store.audit('artifact_deleted', { actor: who, artifactId: artifact.id }); return json(res, 200, { ok: true }); }
  if (req.method === 'GET' && p === '/api/v1/approvals') { return json(res, 200, { items: [...store.data.approvals].reverse().slice(0, 200) }); }
  const jobMatch = p.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)$/); if (req.method === 'GET' && jobMatch) { const job = store.data.jobs.find(x => x.id === jobMatch[1] && x.actor === who); if (!job) fail(404, 'NOT_FOUND', 'Job not found'); if (job.status === 'NEGOTIATING') { const connector = sources.edc(job.sourceId || 'main'); if (!connector) fail(404, 'SOURCE_DISABLED', 'EDC source is unavailable'); const state = await connector.negotiation(job.negotiationId); if (state.state === 'FINALIZED' && state.contractAgreementId) { const transfer = await connector.startTransfer(state.contractAgreementId, job.assetId); await store.update(() => { job.status = 'TRANSFERRING'; job.agreementId = state.contractAgreementId; job.transferId = transfer['@id'] || transfer.id; }); await store.audit('edc_transfer_started', { actor: who, jobId: job.id, transferId: job.transferId }); } else if (['TERMINATED', 'DECLINED', 'ERROR'].includes(state.state)) await store.update(() => { job.status = 'FAILED'; job.error = `EDC negotiation: ${state.state}`; }); } else if (job.status === 'TRANSFERRING' && job.transferId) { const connector = sources.edc(job.sourceId || 'main'); if (!connector) fail(404, 'SOURCE_DISABLED', 'EDC source is unavailable'); const state = await connector.transfer(job.transferId); await store.update(() => { job.transferState = state.state || 'UNKNOWN'; if (['TERMINATED', 'ERROR'].includes(state.state)) job.status = 'FAILED'; if (['STARTED', 'COMPLETED'].includes(state.state)) job.status = 'READY'; }); } return json(res, 200, { ...job, downloadUrl: job.status === 'READY' ? `/api/v1/jobs/${job.id}/download` : null, cacheUrl: job.status === 'READY' ? `/api/v1/jobs/${job.id}/cache` : null }); }
  const jobCache = p.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)\/cache$/); if (req.method === 'POST' && jobCache) { const job = store.data.jobs.find(x => x.id === jobCache[1] && x.actor === who); if (!job || job.status !== 'READY') fail(404, 'NOT_READY', 'Transfer is not ready'); const { response, endpointHost } = await edcRemoteFile(job); const artifact = { ...await sink.save(response.body, `edc-${job.id}.bin`, Number(process.env.HUB_DEFAULT_TTL_HOURS || 168)), datasetId: job.datasetId, actor: who }; await store.update(d => d.artifacts.push(artifact)); await store.audit('edc_cached', { actor: who, jobId: job.id, endpointHost, artifactId: artifact.id, bytes: artifact.bytes }); return json(res, 201, { artifact, downloadUrl: `/api/v1/artifacts/${artifact.id}/download` }); }
  const jobDownload = p.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)\/download$/); if (req.method === 'GET' && jobDownload) { const job = store.data.jobs.find(x => x.id === jobDownload[1] && x.actor === who); if (!job || job.status !== 'READY') fail(404, 'NOT_READY', 'Transfer is not ready'); const { response, length, endpointHost } = await edcRemoteFile(job); await store.audit('edc_download_started', { actor: who, jobId: job.id, endpointHost, bytes: length }); res.writeHead(200, { 'content-type': 'application/octet-stream', ...(length ? { 'content-length': String(length) } : {}), 'content-disposition': `attachment; filename="edc-${job.id}.bin"`, 'cache-control': 'no-store' }); return pipeLimited(response.body, res, sink.maxBytes); }
  const approvalMatch = p.match(/^\/api\/v1\/approvals\/([a-f0-9-]+)\/decision$/); if (req.method === 'POST' && approvalMatch) { const input = await body(req); if (!['APPROVED', 'REJECTED'].includes(input.decision)) fail(400, 'INVALID_DECISION', 'Invalid decision'); const result = await store.update(d => { const a = d.approvals.find(x => x.id === approvalMatch[1]); if (!a) fail(404, 'NOT_FOUND', 'Request not found'); if (a.status !== 'PENDING') fail(409, 'ALREADY_DECIDED', 'Request already decided'); a.status = input.decision; a.decidedAt = new Date().toISOString(); a.decidedBy = who; a.decisionReason = String(input.reason || '').slice(0, 500); return a; }); await store.audit('approval_decided', { actor: who, approvalId: result.id, decision: result.status }); return json(res, 200, result); }
  if (req.method === 'GET' && p === '/api/v1/audit') { return json(res, 200, { items: [...store.data.audit].reverse().slice(0, 200) }); }
  fail(404, 'NOT_FOUND', 'Route not found');
}

await store.init();
await sources.init();
if (store.data.settings.policy) configurePolicy(store.data.settings.policy);
await sink.init();
const prune = async () => { const remaining = await sink.prune(store.data.artifacts); if (remaining.length !== store.data.artifacts.length) await store.update(d => { d.artifacts = remaining; }); };
await prune(); setInterval(() => prune().catch(console.error), 3600_000).unref();
http.createServer((req, res) => route(req, res).catch(e => { if (!e.status || e.status >= 500) console.error(e); if (!res.headersSent) json(res, e.status || 500, { error: { code: e.code || 'INTERNAL_ERROR', message: e.status ? e.message : 'Internal error', requestId: randomUUID() } }); else res.destroy(); })).listen(port, host, () => console.log(`Achilles IDE Datasharing Hub: http://${host}:${port}`));
