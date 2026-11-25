import { searchHf, searchZenodo, hfPreview } from './sources.mjs';
import { rankDatasets, searchQueries } from './ranking.mjs';
import { evaluatePolicy } from './policy.mjs';

export async function analyze(problem, intendedUse, { edc, dcat, edcs = edc ? [['main', edc]] : [], dcats = dcat ? [['main', dcat]] : [], hfToken, hfEnabled = true, zenodoEnabled = true, zenodoUrl, cached = [] } = {}) {
  if (typeof problem !== 'string' || problem.trim().length < 8 || problem.length > 1000) throw Object.assign(new Error('The problem statement must contain 8–1000 characters'), { status: 400 });
  const queries = searchQueries(problem); const tasks = [];
  for (const q of queries) { if (hfEnabled) tasks.push({ source: 'hf', query: q, run: () => searchHf(q, hfToken) }); if (zenodoEnabled) tasks.push({ source: 'zenodo', query: q, run: () => searchZenodo(q, zenodoUrl) }); for (const [id, connector] of edcs) tasks.push({ source: id, query: q, run: () => connector.catalog(q) }); for (const [id, catalog] of dcats) tasks.push({ source: id, query: q, run: () => catalog.search(q) }); }
  const settled = await Promise.allSettled(tasks.map(t => t.run())); const results = new Map(cached.map(x => [x.id, x])); const errors = [];
  settled.forEach((r, i) => { if (r.status === 'fulfilled') for (const item of r.value) results.set(item.id, item); else errors.push({ source: tasks[i].source, query: tasks[i].query, message: r.reason.message }); });
  const ranked = rankDatasets([...results.values()], problem).slice(0, 10);
  const recommendations = [];
  for (const item of ranked) {
    const policy = evaluatePolicy(item, intendedUse);
    let schema = null;
    if (item.sourceType === 'huggingface' && policy.decision === 'AUTO_APPROVED' && recommendations.length < 5) { try { const p = await hfPreview(item.id.slice(3), hfToken); schema = p.schema; } catch {} }
    recommendations.push({ dataset: item, policy, schema, matchReasons: [item.relevanceScore > 0 ? `BM25 lexical match: ${item.relevanceScore}` : 'Weak match; inspect metadata manually.', schema?.length ? `Schema available: ${schema.length} columns` : 'Schema was not verified.'], limitations: [!item.description ? 'Description unavailable.' : null, policy.decision !== 'AUTO_APPROVED' ? 'Access requires further review or a decision.' : null].filter(Boolean) });
  }
  return { method: 'bm25', queries, recommendations, errors, generatedAt: new Date().toISOString(), codeExample: recommendations[0] ? `const r = await fetch('http://127.0.0.1:8787/api/v1/datasets/${encodeURIComponent(recommendations[0].dataset.id)}');\nconsole.log(await r.json());` : null };
}
