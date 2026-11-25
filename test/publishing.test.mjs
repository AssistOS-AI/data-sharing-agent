import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishHf, createZenodoDraft, publishZenodoDraft, fileName, parsePublicationSuggestions } from '../src/publishing.mjs';

test('publication suggestions can be extracted from an ALA transcript', () => {
  assert.deepEqual(parsePublicationSuggestions('progress\n```json\n{"title":"Dataset","creator":"Researcher"}\n```\nDone.'), { title: 'Dataset', creator: 'Researcher' });
  assert.equal(parsePublicationSuggestions('No form available'), null);
});

test('Hugging Face publishing passes a file URL to the official adapter with a private repo by default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-publish-'));
  try {
    const path = join(dir, 'data.csv'); await writeFile(path, 'a,b\n1,2\n');
    const calls = [];
    const hub = { createRepo: async x => { calls.push(['create', x]); return { repoUrl: 'example' }; }, uploadFile: async x => { calls.push(['upload', x]); return { commitOid: 'abc' }; } };
    const result = await publishHf({ repoId: 'team/data', path: 'data.csv', createRepo: true }, path, 'secret', hub);
    assert.equal(result.status, 'PUBLISHED'); assert.equal(calls[0][1].visibility, 'private'); assert.equal(calls[1][1].file.content.protocol, 'file:');
    assert.equal(calls[1][1].accessToken, 'secret'); assert.equal(calls[1][1].repo.type, 'dataset');
    assert.throws(() => fileName('../bad.csv'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Zenodo creates and uploads a draft, then publishes only on a second call', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-zenodo-')); const originalFetch = globalThis.fetch;
  try {
    const path = join(dir, 'data.csv'); await writeFile(path, 'a,b\n1,2\n');
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), method: options.method, auth: options.headers.Authorization, body: options.body });
      if (String(url).endsWith('/api/deposit/depositions')) return new Response(JSON.stringify({ id: 123, links: { bucket: 'https://sandbox.zenodo.org/api/files/bucket', html: 'https://sandbox.zenodo.org/deposit/123' } }), { status: 201 });
      if (String(url).endsWith('/data.csv')) return new Response('{}', { status: 200 });
      if (String(url).endsWith('/actions/publish')) return new Response(JSON.stringify({ id: 123, links: { record_html: 'https://sandbox.zenodo.org/records/123' } }), { status: 202 });
      return new Response('{}', { status: 404 });
    };
    const draft = await createZenodoDraft({ title: 'Data', description: 'Test data', creator: 'Researcher, A', license: 'cc-by-4.0', path: 'data.csv' }, path, 'secret', 'https://sandbox.zenodo.org');
    assert.equal(draft.status, 'DRAFT'); assert.deepEqual(calls.map(x => x.method), ['POST', 'PUT']);
    assert.equal(JSON.parse(calls[0].body).metadata.upload_type, 'dataset');
    assert.equal(calls[0].auth, 'Bearer secret');
    const published = await publishZenodoDraft(draft.remoteId, 'secret', draft.baseUrl);
    assert.equal(published.status, 'PUBLISHED'); assert.equal(calls[2].method, 'POST');
  } finally { globalThis.fetch = originalFetch; await rm(dir, { recursive: true, force: true }); }
});
