import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }

test('EDC catalog, approval, negotiation, transfer, EDR, and download', async () => {
  const calls = []; let catalogCalls = 0;
  const mock = http.createServer((req, res) => { calls.push(`${req.method} ${req.url}`); const origin = `http://127.0.0.1:${mock.address().port}`; res.setHeader('content-type', 'application/json');
    if (req.url === '/management/v3/catalog/request') return res.end(JSON.stringify({ 'dcat:dataset': [{ '@id': 'asset-1', 'dct:title': 'Energy EDC', 'odrl:hasPolicy': { '@id': `offer-${++catalogCalls}`, permission: [] } }] }));
    if (req.url === '/management/v3/contractnegotiations' && req.method === 'POST') return res.end('{"@id":"neg-1"}');
    if (req.url === '/management/v3/contractnegotiations/neg-1') return res.end('{"state":"FINALIZED","contractAgreementId":"agreement-1"}');
    if (req.url === '/management/v3/transferprocesses' && req.method === 'POST') return res.end('{"@id":"transfer-1"}');
    if (req.url === '/management/v3/transferprocesses/transfer-1') return res.end('{"state":"STARTED"}');
    if (req.url === '/management/v3/edrs/transfer-1/dataaddress') return res.end(JSON.stringify({ endpoint: `${origin}/data`, authorization: 'secret-edr' }));
    if (req.url === '/data') { assert.equal(req.headers.authorization, 'Bearer secret-edr'); res.setHeader('content-type', 'text/plain'); return res.end('EDC DATA'); }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r)); const dir = await mkdtemp(join(tmpdir(), 'hub-edc-flow-')); const port = await freePort(); const origin = `http://127.0.0.1:${mock.address().port}`;
  const child = spawn(process.execPath, ['src/server.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, HUB_DATA_DIR: dir, HUB_PORT: String(port), EDC_MANAGEMENT_URL: `${origin}/management`, EDC_API_KEY: 'key', EDC_PROVIDER_URL: `${origin}/dsp`, EDC_PARTICIPANT_ID: 'did:web:provider', EDC_DATA_HOSTS: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('server timeout')), 5000); child.stdout.on('data', x => { if (x.toString().includes('Achilles IDE Datasharing Hub')) { clearTimeout(timer); resolve(); } }); child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exit ${code}`)); }); });
    const base = `http://127.0.0.1:${port}`;
    const request = async (path, method = 'GET', data) => { const r = await fetch(base + path, { method, headers: { ...(data ? { 'content-type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined }); const value = await r.json(); assert.ok(r.ok, `${path}: ${JSON.stringify(value)}`); return value; };
    const found = await request('/api/v1/search?q=Energy&sources=eds'); assert.equal(found.items.length, 1); assert.equal(found.items[0].policy.decision, 'NEEDS_HUMAN_APPROVAL');
    await request('/api/v1/sources', 'POST', { id: 'second-edc', type: 'edc', name: 'Second EDC', enabled: true, managementUrl: `${origin}/management`, apiKey: 'second-key', providerUrl: `${origin}/dsp`, participantId: 'did:web:provider', protocol: 'dataspace-protocol-http', dataHosts: '127.0.0.1' });
    const sourceSettings = await request('/api/v1/sources'); assert.equal(sourceSettings.sources.find(x => x.id === 'second-edc').hasApiKey, true); assert.equal(JSON.stringify(sourceSettings).includes('second-key'), false);
    assert.equal((await request('/api/v1/sources/second-edc/test', 'POST')).status, 'online');
    const both = await request('/api/v1/search?q=Energy&sources=eds'); assert.equal(both.items.length, 2); assert.ok(both.items.some(x => x.id.startsWith('eds:second-edc:')));
    await request('/api/v1/sources/second-edc', 'DELETE');
    const id = encodeURIComponent(found.items[0].id); const first = await request(`/api/v1/datasets/${id}/acquire`, 'POST', { intendedUse: 'research', justification: 'Test EDC complet' }); assert.equal(first.status, 'PENDING_HUMAN_APPROVAL');
    await request(`/api/v1/approvals/${first.approvalId}/decision`, 'POST', { decision: 'APPROVED' });
    const job = await request(`/api/v1/datasets/${id}/acquire`, 'POST', { intendedUse: 'research' }); assert.equal(job.status, 'NEGOTIATING');
    const negotiating = await request(`/api/v1/jobs/${job.id}`); assert.equal(negotiating.status, 'TRANSFERRING');
    const ready = await request(`/api/v1/jobs/${job.id}`); assert.equal(ready.status, 'READY');
    const data = await fetch(base + ready.downloadUrl, { headers: {} }); assert.equal(data.status, 200); assert.equal(await data.text(), 'EDC DATA'); assert.ok(calls.includes('GET /management/v3/edrs/transfer-1/dataaddress'));
    const cached = await request(ready.cacheUrl, 'POST'); assert.equal(cached.artifact.bytes, 8); const saved = await fetch(base + cached.downloadUrl, { headers: {} }); assert.equal(await saved.text(), 'EDC DATA');
  } finally { child.kill(); await new Promise(r => mock.close(r)); await rm(dir, { recursive: true, force: true }); }
});
