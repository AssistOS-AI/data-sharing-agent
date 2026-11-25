import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { Sink } from '../src/sink.mjs';

test('audit hash chain detects event tampering', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-store-'));
  try { const store = new Store(dir); await store.init(); await store.audit('test', { actor: 'admin' }); await store.audit('test2', { actor: 'admin' }); const reloaded = new Store(dir); await reloaded.init(); assert.equal(reloaded.data.audit.length, 2); const file = join(dir, 'hub.json'); const data = JSON.parse(await readFile(file, 'utf8')); data.audit[0].actor = 'intruder'; await writeFile(file, JSON.stringify(data)); await assert.rejects(new Store(dir).init(), /Audit log integrity/); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test('sink computes SHA-256 and removes expired artifacts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-sink-'));
  try { const sink = new Sink(dir, 100); await sink.init(); const artifact = await sink.save([Buffer.from('abc')], 'a.txt', 1); assert.equal(artifact.bytes, 3); assert.equal(artifact.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'); const remaining = await sink.prune([{ ...artifact, expiresAt: new Date(0).toISOString() }]); assert.equal(remaining.length, 0); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test('ALA runs and publication history survive restart and interrupted runs are closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-history-'));
  try {
    const first = new Store(dir); await first.init();
    await first.update(data => { data.alaRuns.push({ id: 'run-1', status: 'RUNNING', output: 'partial output' }); data.publications.push({ id: 'publication-1', status: 'DRAFT' }, { id: 'publication-2', status: 'PREPARING' }); });
    const second = new Store(dir); await second.init();
    assert.equal(second.data.alaRuns[0].status, 'INTERRUPTED');
    assert.equal(second.data.alaRuns[0].output, 'partial output');
    assert.equal(second.data.publications[0].status, 'DRAFT');
    assert.equal(second.data.publications[1].status, 'INTERRUPTED');
    const persisted = JSON.parse(await readFile(join(dir, 'hub.json'), 'utf8'));
    assert.equal(persisted.alaRuns[0].status, 'INTERRUPTED');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
