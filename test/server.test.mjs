import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

async function freePort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }

test('password-free startup, local API/MCP, and proxy identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-test-'));
  const port = await freePort();
  const dataset = { id: 'hf:owner/test', sourceType: 'huggingface', title: 'Test', license: 'unknown', accessMode: 'proxy-stream', files: ['data.csv'], cachedAt: Date.now() };
  await writeFile(join(dir, 'hub.json'), JSON.stringify({ admin: 'old-hash', tokens: [{ hash: 'old-token' }], settings: { alaEnabled: false }, datasets: { [dataset.id]: dataset }, approvals: [], jobs: [], audit: [] }));
  const child = spawn(process.execPath, ['src/server.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, HUB_DATA_DIR: dir, HUB_PORT: String(port), HUB_EXTERNAL_USER_HEADER: 'X-Authenticated-User' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('server timeout')), 5000); child.stdout.on('data', chunk => { if (chunk.toString().includes('Achilles IDE Datasharing Hub')) { clearTimeout(timer); resolve(); } }); child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exit ${code}`)); }); });
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/docs`)).status, 200);
    const home = await (await fetch(base)).text(); assert.match(home, /id="workspace"/); assert.match(home, /id="hfForm"/); assert.match(home, /id="edcForm"/); assert.match(home, /id="dcatForm"/); assert.doesNotMatch(home, /id="loginForm"/);
    assert.equal((await fetch(`${base}/api/v1/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/v1/login`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${base}/api/v1/tokens`)).status, 404);
    const saved = JSON.parse(await readFile(join(dir, 'hub.json'), 'utf8'));
    assert.equal('admin' in saved, false); assert.equal('tokens' in saved, false);
    const mcp = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Authenticated-User': 'agent1' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }); assert.equal(mcp.status, 200); assert.ok((await mcp.json()).result.tools.length >= 5);
    const post = (path, data) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Authenticated-User': 'alice' }, body: JSON.stringify(data) });
    const request = await post('/api/v1/datasets/hf%3Aowner%2Ftest/acquire', { intendedUse: 'research', filePath: 'data.csv', justification: 'Test local' }); assert.equal(request.status, 202); const approvalId = (await request.json()).approvalId;
    assert.equal((await post(`/api/v1/approvals/${approvalId}/decision`, { decision: 'APPROVED' })).status, 200);
    const approvals = await fetch(`${base}/api/v1/approvals`); assert.equal((await approvals.json()).items[0].actor, 'alice');
    const audit = await fetch(`${base}/api/v1/audit`); assert.ok((await audit.json()).items.some(x => x.actor === 'alice'));
  } finally { child.kill(); await rm(dir, { recursive: true, force: true }); }
});
