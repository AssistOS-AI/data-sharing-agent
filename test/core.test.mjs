import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy, configurePolicy, getPolicyConfig } from '../src/policy.mjs';
import { hfFileUrl } from '../src/sources.mjs';
import { EdcConnector, prohibitedUses } from '../src/edc.mjs';
import http from 'node:http';

test('policy denies explicit prohibitions and requests review for unknown terms', () => {
  assert.equal(evaluatePolicy({ license: 'cc-by-4.0' }, 'research').decision, 'AUTO_APPROVED');
  assert.equal(evaluatePolicy({ license: 'unknown' }, 'research').decision, 'NEEDS_HUMAN_APPROVAL');
  assert.equal(evaluatePolicy({ license: 'cc-by-4.0', prohibitedUses: ['training'] }, 'training').decision, 'DENIED');
});

test('license configuration is validated and can deny a license', () => {
  const original = getPolicyConfig();
  try { configurePolicy({ autoLicenses: ['mit'], deniedLicenses: ['cc0-1.0'] }); assert.equal(evaluatePolicy({ license: 'cc0-1.0' }, 'research').decision, 'DENIED'); assert.throws(() => configurePolicy({ autoLicenses: ['unknown'], deniedLicenses: [] })); }
  finally { configurePolicy(original); }
});

test('HF file path cannot escape the dataset', () => {
  assert.match(hfFileUrl('owner/data', 'folder/file.csv'), /owner\/data\/resolve\/main\/folder\/file.csv$/);
  assert.throws(() => hfFileUrl('owner/data', '../secret'));
  assert.throws(() => hfFileUrl('owner/data', '/etc/passwd'));
});

test('EDC catalog maps a dataset and offer', () => {
  const edc = new EdcConnector({ managementUrl: 'http://127.0.0.1:1234/management', providerUrl: 'https://provider.example/dsp', participantId: 'did:web:provider', protocol: 'dataspace-protocol-http' });
  const item = edc.mapDataset({ '@id': 'asset-1', 'dct:title': 'Date test', 'odrl:hasPolicy': { '@id': 'offer-1', permission: [] } });
  assert.equal(item.id, 'eds:main:asset-1'); assert.equal(item.offerId, 'offer-1');
  assert.equal(evaluatePolicy(item, 'research').decision, 'NEEDS_HUMAN_APPROVAL');
});

test('explicit ODRL prohibitions block the corresponding use', () => {
  assert.deepEqual(prohibitedUses({ 'odrl:prohibition': [{ 'odrl:action': 'ai_training' }] }), ['training']);
  assert.deepEqual(prohibitedUses({ prohibition: [{ action: 'use' }] }), ['research', 'training', 'commercial']);
  assert.deepEqual(prohibitedUses({ prohibition: [{ action: 'commercial', constraint: [{ leftOperand: 'region' }] }] }), []);
});

test('EDC client completes catalog, negotiation, transfer, and EDR with a mock connector', async () => {
  const calls = [];
  const server = http.createServer(async (req, res) => { calls.push(`${req.method} ${req.url}`); assert.equal(req.headers['x-api-key'], 'secret'); res.setHeader('content-type', 'application/json'); if (req.url.endsWith('/catalog/request')) res.end(JSON.stringify({ 'dcat:dataset': [{ '@id': 'asset-1', 'dct:title': 'Test', 'odrl:hasPolicy': { '@id': 'offer-1', permission: [] } }] })); else if (req.url.endsWith('/contractnegotiations') && req.method === 'POST') res.end('{"@id":"neg-1"}'); else if (req.url.endsWith('/contractnegotiations/neg-1')) res.end('{"state":"FINALIZED","contractAgreementId":"agreement-1"}'); else if (req.url.endsWith('/transferprocesses') && req.method === 'POST') res.end('{"@id":"transfer-1"}'); else if (req.url.endsWith('/transferprocesses/transfer-1')) res.end('{"state":"STARTED"}'); else if (req.url.endsWith('/edrs/transfer-1/dataaddress')) res.end('{"endpoint":"https://example.org/data","authorization":"token"}'); else { res.statusCode = 404; res.end('{}'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { const edc = new EdcConnector({ managementUrl: `http://127.0.0.1:${server.address().port}/management`, apiKey: 'secret', providerUrl: 'https://provider.example/dsp', participantId: 'did:web:provider', protocol: 'dataspace-protocol-http' }); const [item] = await edc.catalog('Test'); const negotiation = await edc.acquire(item); assert.equal(negotiation.negotiationId, 'neg-1'); assert.equal((await edc.negotiation('neg-1')).state, 'FINALIZED'); assert.equal((await edc.startTransfer('agreement-1', item.assetId))['@id'], 'transfer-1'); assert.equal((await edc.transfer('transfer-1')).state, 'STARTED'); assert.equal((await edc.edr('transfer-1')).authorization, 'token'); assert.equal(calls.length, 6); } finally { await new Promise(resolve => server.close(resolve)); }
});
