import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const hashEvent = event => createHash('sha256').update(JSON.stringify(event)).digest('hex');

export class Store {
  constructor(dir) { this.dir = dir; this.file = join(dir, 'hub.json'); this.data = { settings: { alaEnabled: false, policy: null }, datasets: {}, approvals: [], jobs: [], artifacts: [], publications: [], alaRuns: [], audit: [] }; this.queue = Promise.resolve(); }
  async init() { await mkdir(this.dir, { recursive: true, mode: 0o700 }); try { this.data = JSON.parse(await readFile(this.file, 'utf8')); this.data.jobs ||= []; this.data.artifacts ||= []; this.data.publications ||= []; this.data.alaRuns ||= []; this.data.settings ||= { alaEnabled: false }; let interrupted = false; for (const run of this.data.alaRuns) if (run.status === 'RUNNING') { run.status = 'INTERRUPTED'; run.finishedAt = new Date().toISOString(); interrupted = true; } for (const publication of this.data.publications) if (publication.status === 'PREPARING') { publication.status = 'INTERRUPTED'; publication.error = 'Server stopped during publication. Check the destination before retrying.'; publication.finishedAt = new Date().toISOString(); interrupted = true; } let previous = 'GENESIS'; for (const event of this.data.audit || []) { if (!event.hash) continue; const { hash, ...payload } = event; if (payload.prevHash !== previous || hashEvent(payload) !== hash) throw new Error('Audit log integrity check failed'); previous = hash; } if ('admin' in this.data || 'tokens' in this.data || interrupted) { delete this.data.admin; delete this.data.tokens; await this.save(); } } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  async save() { const temp = join(this.dir, `hub.${randomUUID()}.tmp`); await writeFile(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 }); await rename(temp, this.file); }
  async update(fn) { const task = this.queue.then(async () => { const result = fn(this.data); await this.save(); return result; }); this.queue = task.catch(() => {}); return task; }
  async remember(items) { await this.update(d => { for (const item of items) d.datasets[item.id] = { ...item, cachedAt: Date.now() }; }); }
  async audit(action, detail = {}) { await this.update(d => { const previous = [...d.audit].reverse().find(x => x.hash)?.hash || 'GENESIS'; const event = { id: randomUUID(), at: new Date().toISOString(), action, ...detail, prevHash: previous }; d.audit.push({ ...event, hash: hashEvent(event) }); }); }
}
