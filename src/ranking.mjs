const STOP = new Set('a ai al ale and are ca care ce cu de din do for in is la mai of on or pentru pe si the to un unei unei unui with date data dataset datasets european europe europa europei caut vreau want need am as at by'.split(' '));
export function terms(text) { return (String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]{2,}/g) || []).filter(x => !STOP.has(x)); }
export function rankDatasets(items, query) {
  const q = [...new Set(terms(query))]; if (!q.length) return items;
  const docs = items.map(x => terms(`${x.title} ${x.title} ${x.tags?.join(' ') || ''} ${x.description || ''}`));
  const avg = Math.max(1, docs.reduce((a, d) => a + d.length, 0) / Math.max(1, docs.length));
  const df = new Map(q.map(t => [t, docs.filter(d => d.includes(t)).length]));
  return items.map((item, i) => { const doc = docs[i]; let score = 0; for (const t of q) { const tf = doc.filter(w => w === t).length; if (!tf) continue; const idf = Math.log(1 + (items.length - df.get(t) + .5) / (df.get(t) + .5)); score += idf * tf * 2.2 / (tf + 1.2 * (.25 + .75 * doc.length / avg)); } score += q.filter(t => terms(item.title).includes(t)).length * .35; return { ...item, relevanceScore: Math.round(score * 1000) / 1000 }; }).sort((a, b) => b.relevanceScore - a.relevanceScore || a.id.localeCompare(b.id));
}
export function searchQueries(problem) { const words = [...new Set(terms(problem))]; return [...new Set([problem.trim(), words.slice(0, 5).join(' '), words.slice(-4).join(' ')].filter(x => x && x.length <= 200))].slice(0, 3); }
