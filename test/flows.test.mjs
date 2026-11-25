import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function mockSource() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://local'); res.setHeader('content-type', 'application/json');
    const hf = { id: 'owner/energy', tags: ['license:cc0-1.0'], cardData: { license: 'cc0-1.0' }, siblings: [{ rfilename: 'train.csv' }], description: 'Hourly energy Europe' };
    const zenodo = { id: 123, metadata: { title: 'Energy research data', description: 'Hourly energy Europe', license: { id: 'cc0-1.0' } }, files: [{ key: 'data.csv', size: 8, links: { self: `http://127.0.0.1:${server.address().port}/api/files/data.csv` } }] };
    if (u.pathname === '/api/datasets') return res.end(JSON.stringify([hf]));
    if (u.pathname === '/api/whoami-v2') return res.end(JSON.stringify({ name: 'test-account' }));
    if (u.pathname === '/api/datasets/owner/energy') return res.end(JSON.stringify(hf));
    if (u.pathname === '/splits') return res.end(JSON.stringify({ splits: [{ config: 'default', split: 'train' }] }));
    if (u.pathname === '/first-rows') return res.end(JSON.stringify({ features: [{ name: 'hour', type: { dtype: 'int32' } }], rows: [{ row: { hour: 1 } }] }));
    if (u.pathname === '/api/records') return res.end(JSON.stringify({ hits: { hits: [zenodo] } }));
    if (u.pathname === '/api/records/123') return res.end(JSON.stringify(zenodo));
    if (u.pathname === '/api/deposit/depositions' && req.method === 'POST') return res.end(JSON.stringify({ id: 456, links: { bucket: `http://127.0.0.1:${server.address().port}/api/files/bucket`, html: `http://127.0.0.1:${server.address().port}/deposit/456` } }));
    if (u.pathname === '/api/files/bucket/data.csv' && req.method === 'PUT') { req.resume(); return req.on('end', () => res.end('{}')); }
    if (u.pathname === '/api/deposit/depositions/456/actions/publish' && req.method === 'POST') return res.end(JSON.stringify({ id: 456, links: { record_html: `http://127.0.0.1:${server.address().port}/records/456` } }));
    if (u.pathname === '/catalog') return res.end(JSON.stringify({ 'dcat:dataset': [{ '@id': 'https://catalog.example/datasets/energy', 'dct:title': 'European energy DCAT', 'dct:description': 'Hourly energy Europe', 'dct:license': 'cc-by-4.0', 'dcat:distribution': [{ 'dct:title': 'energy.csv', 'dcat:downloadURL': `http://127.0.0.1:${server.address().port}/dcat.csv` }] }] }));
    if (u.pathname === '/datasets/owner/energy/resolve/main/train.csv') { res.setHeader('content-type', 'text/csv'); return res.end('hour\n1\n'); }
    if (u.pathname === '/api/files/data.csv') { res.setHeader('content-type', 'text/csv'); return res.end('hour\n2\n'); }
    if (u.pathname === '/dcat.csv') { res.setHeader('content-type', 'text/csv'); return res.end('hour\n3\n'); }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); return server;
}

test('search, preview, BM25/ALA, HF proxy, cache, and Zenodo work together', async () => {
  const source = await mockSource(); const dir = await mkdtemp(join(tmpdir(), 'hub-flow-')); const port = await freePort(); const sourceUrl = `http://127.0.0.1:${source.address().port}`;
  const child = spawn(process.execPath, ['src/server.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, HUB_DATA_DIR: dir, HUB_PORT: String(port), HUB_HF_URL: sourceUrl, HUB_HF_VIEWER_URL: sourceUrl, HUB_ZENODO_URL: sourceUrl, HUB_DCAT_URL: `${sourceUrl}/catalog`, HUB_ALLOW_HTTP_SOURCES: '1', HUB_ALA_CLI: new URL('fixtures/fake-ala.mjs', import.meta.url).pathname }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('server timeout')), 5000); child.stdout.on('data', x => { if (x.toString().includes('Achilles IDE Datasharing Hub')) { clearTimeout(timer); resolve(); } }); child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exit ${code}`)); }); });
    const base = `http://127.0.0.1:${port}`;
    const request = async (path, method = 'GET', data) => { const r = await fetch(base + path, { method, headers: { ...(data ? { 'content-type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined }); const value = await r.json(); assert.ok(r.ok, `${path}: ${JSON.stringify(value)}`); return value; };
    const search = await request('/api/v1/search?q=energy&sources=hf,zenodo'); assert.equal(search.items.length, 2); assert.equal(search.items[0].policy.decision, 'AUTO_APPROVED');
    await request('/api/v1/sources/hf', 'PUT', { name: 'Hugging Face', enabled: true, token: 'hf_test_token' });
    const sourceSettings = await request('/api/v1/sources'); assert.equal(sourceSettings.sources.find(x => x.id === 'hf').hasToken, true); assert.equal(JSON.stringify(sourceSettings).includes('hf_test_token'), false);
    const hfStatus = await request('/api/v1/sources/hf/test', 'POST'); assert.equal(hfStatus.account, 'test-account');
    await request('/api/v1/sources/hf', 'PUT', { name: 'Hugging Face', enabled: false });
    assert.equal((await request('/api/v1/search?q=energy&sources=hf')).items.length, 0);
    await request('/api/v1/sources/hf', 'PUT', { name: 'Hugging Face', enabled: true });
    assert.equal((await request('/api/v1/search?q=energy&sources=hf')).items.length, 1);
    await request('/api/v1/sources', 'POST', { id: 'second-catalog', type: 'dcat', name: 'Second catalog', enabled: true, url: `${sourceUrl}/catalog`, dataHosts: '127.0.0.1' });
    const twoCatalogs = await request('/api/v1/search?q=energy&sources=dcat'); assert.equal(twoCatalogs.items.length, 2);
    await request('/api/v1/sources/second-catalog', 'DELETE');
    const filtered = await request('/api/v1/search?q=energy&sources=hf,zenodo&policy=AUTO_APPROVED&access_mode=proxy-stream'); assert.equal(filtered.items.length, 1); assert.equal(filtered.items[0].sourceType, 'huggingface');
    const policy = await request('/api/v1/policy/config'); await request('/api/v1/policy/config', 'PUT', { ...policy, deniedLicenses: ['cc0-1.0'], autoLicenses: policy.autoLicenses.filter(x => x !== 'cc0-1.0') }); const denied = await request('/api/v1/simulate', 'POST', { license: 'cc0-1.0', intendedUse: 'research' }); assert.equal(denied.decision, 'DENIED'); await request('/api/v1/policy/config', 'PUT', policy);
    const checked = await request('/api/v1/connectors/test', 'POST'); assert.ok(checked.items.every(x => x.status === 'online'));
    const preview = await request('/api/v1/datasets/hf%3Aowner%2Fenergy/preview'); assert.equal(preview.schema[0].column, 'hour'); assert.equal(preview.rows.length, 1);
    const analyzed = await request('/api/v1/analyze', 'POST', { problemStatement: 'hourly energy in Europe', intendedUse: 'research' }); assert.equal(analyzed.method, 'bm25'); assert.ok(analyzed.recommendations.length);
    const stream = await fetch(`${base}/api/v1/analyze`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ problemStatement: 'hourly energy in Europe', intendedUse: 'research' }) }); assert.equal(stream.status, 200); const events = await stream.text(); assert.match(events, /event: progress/); assert.match(events, /event: result/);
    await request('/api/v1/settings', 'POST', { alaEnabled: true }); const withAla = await request('/api/v1/analyze', 'POST', { problemStatement: 'hourly energy in Europe', intendedUse: 'research' }); assert.equal(withAla.method, 'bm25+ala'); assert.match(withAla.agentAnswer, /Simulated ALA/);
    const runs = await request('/api/v1/ala/runs'); assert.equal(runs.items[0].status, 'COMPLETED'); assert.equal((await request(`/api/v1/ala/runs/${runs.items[0].id}`)).output, withAla.agentAnswer);
    const upload = await fetch(`${base}/api/v1/uploads?name=data.csv`, { method: 'POST', body: 'x,y\n1,2\n' }); assert.equal(upload.status, 201); const local = await upload.json();
    const suggestion = await request('/api/v1/publications/assist', 'POST', { destination: 'zenodo', artifactId: local.artifact.id, description: 'Hourly sample of energy readings' }); assert.equal(suggestion.fields.title, 'Energy sample'); assert.ok(suggestion.runId);
    assert.equal((await request('/api/v1/ala/runs')).items[0].type, 'publication_assist');
    await request('/api/v1/sources/zenodo', 'PUT', { enabled: true, name: 'Zenodo', url: sourceUrl, token: 'zenodo-test-token' });
    const draft = await request('/api/v1/publications', 'POST', { destination: 'zenodo', artifactId: local.artifact.id, rightsConfirmed: true, path: 'data.csv', title: 'Test data', description: 'A small dataset', creator: 'Researcher, A', license: 'cc-by-4.0' }); assert.equal(draft.status, 'DRAFT');
    assert.equal((await request(`/api/v1/publications/${draft.id}/publish`, 'POST')).status, 'PUBLISHED');
    assert.equal((await request('/api/v1/publications')).items[0].status, 'PUBLISHED');
    const acquired = await request('/api/v1/datasets/hf%3Aowner%2Fenergy/acquire', 'POST', { intendedUse: 'research', filePath: 'train.csv' }); assert.equal(acquired.status, 'READY');
    const cached = await request(acquired.cacheUrl, 'POST'); assert.equal(cached.artifact.bytes, 7); const stored = await fetch(base + cached.downloadUrl, { headers: {} }); assert.equal(await stored.text(), 'hour\n1\n');
    const zenodoAcquire = await request('/api/v1/datasets/zenodo%3A123/acquire', 'POST', { intendedUse: 'research', filePath: 'data.csv' }); const zenodoFile = await fetch(base + zenodoAcquire.downloadUrl, { headers: {} }); assert.equal(await zenodoFile.text(), 'hour\n2\n');
    const dcatSearch = await request('/api/v1/search?q=energy&sources=dcat'); assert.equal(dcatSearch.items.length, 1); const dcatId = encodeURIComponent(dcatSearch.items[0].id); const dcatPending = await request(`/api/v1/datasets/${dcatId}/acquire`, 'POST', { intendedUse: 'research', filePath: 'energy.csv', justification: 'European data analysis' }); assert.equal(dcatPending.status, 'PENDING_HUMAN_APPROVAL'); await request(`/api/v1/approvals/${dcatPending.approvalId}/decision`, 'POST', { decision: 'APPROVED' }); const dcatReady = await request(`/api/v1/datasets/${dcatId}/acquire`, 'POST', { intendedUse: 'research', filePath: 'energy.csv' }); const dcatFile = await fetch(base + dcatReady.downloadUrl, { headers: {} }); assert.equal(await dcatFile.text(), 'hour\n3\n');
    const artifacts = await request('/api/v1/artifacts'); assert.equal(artifacts.items.length, 2);
  } finally { child.kill(); await new Promise(r => source.close(r)); await rm(dir, { recursive: true, force: true }); }
});
