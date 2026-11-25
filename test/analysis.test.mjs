import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rankDatasets, searchQueries } from '../src/ranking.mjs';
import { alaStatus, runAlaAnalysis } from '../src/ala.mjs';
import { mcpResult, MCP_TOOLS } from '../src/mcp.mjs';

test('BM25 favors relevant titles and extracts search queries', () => {
  const items = [{ id: 'a', title: 'weather records', description: 'rain' }, { id: 'b', title: 'energy consumption', description: 'hourly electricity in Europe' }];
  assert.equal(rankDatasets(items, 'hourly energy Europe')[0].id, 'b');
  assert.ok(searchQueries('hourly energy consumption in Europe').length >= 1);
});

test('ALA is detected and receives a skill and dossier without an LLM API', async () => {
  const saved = process.env.HUB_ALA_CLI; const savedSecret = process.env.HF_TOKEN; process.env.HUB_ALA_CLI = new URL('fixtures/fake-ala.mjs', import.meta.url).pathname; process.env.HF_TOKEN = 'test-secret';
  const dir = await mkdtemp(join(tmpdir(), 'hub-ala-test-'));
  try { const status = await alaStatus(); assert.equal(status.ready, true); const answer = await runAlaAnalysis({ problem: 'energy data', recommendations: [] }, dir); assert.match(answer, /Simulated ALA/); }
  finally { if (saved === undefined) delete process.env.HUB_ALA_CLI; else process.env.HUB_ALA_CLI = saved; if (savedSecret === undefined) delete process.env.HF_TOKEN; else process.env.HF_TOKEN = savedSecret; await rm(dir, { recursive: true, force: true }); }
});

test('MCP exposes tools and calls the internal API', async () => {
  const list = await mcpResult({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, () => {});
  assert.equal(list.result.tools.length, MCP_TOOLS.length);
  assert.ok(list.result.tools.some(tool => tool.name === 'list_sources'));
  const sources = await mcpResult({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_sources', arguments: {} } }, async (method, path) => { assert.equal(method, 'GET'); assert.equal(path, '/api/v1/sources'); return { sources: [{ id: 'hf' }] }; });
  assert.equal(sources.result.structuredContent.sources[0].id, 'hf');
  const call = await mcpResult({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'check_dataset_policy', arguments: { dataset_id: 'hf:test/data', intended_use: 'research' } } }, async (method, path, data) => { assert.equal(path, '/api/v1/policy/check'); assert.equal(data.datasetId, 'hf:test/data'); return { decision: 'AUTO_APPROVED' }; });
  assert.equal(call.result.structuredContent.decision, 'AUTO_APPROVED');
});
