import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class Sink {
  constructor(dir, maxBytes = 100_000_000) { this.dir = dir; this.maxBytes = maxBytes; }
  async init() { await mkdir(this.dir, { recursive: true, mode: 0o700 }); }
  async save(stream, name, ttlHours = 168) {
    if (!Number.isFinite(ttlHours) || ttlHours <= 0) throw Object.assign(new Error('Invalid TTL'), { status: 400 });
    const id = randomUUID(); const temp = join(this.dir, `${id}.tmp`); const file = join(this.dir, id);
    const handle = await open(temp, 'wx', 0o600); let bytes = 0; const hash = createHash('sha256');
    try { for await (const chunk of stream) { bytes += chunk.length; if (bytes > this.maxBytes) throw Object.assign(new Error('File is too large for the local sink'), { status: 413 }); hash.update(chunk); await handle.writeFile(chunk); } await handle.sync(); await handle.close(); await rename(temp, file); return { id, name: String(name).slice(0, 200), bytes, sha256: hash.digest('hex'), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + Math.min(Math.max(ttlHours, 1), 720) * 3600_000).toISOString() }; }
    catch (e) { await handle.close().catch(() => {}); await rm(temp, { force: true }); throw e; }
  }
  async prune(artifacts) { const expired = artifacts.filter(x => Date.parse(x.expiresAt) <= Date.now()); for (const a of expired) await rm(join(this.dir, a.id), { force: true }); return artifacts.filter(x => Date.parse(x.expiresAt) > Date.now()); }
  async stats(artifacts) { let bytes = 0; for (const a of artifacts) { try { bytes += (await stat(join(this.dir, a.id))).size; } catch {} } return { count: artifacts.length, bytes, maxFileBytes: this.maxBytes }; }
  path(id) { if (!/^[a-f0-9-]{36}$/.test(id)) throw Object.assign(new Error('Invalid ID'), { status: 400 }); return join(this.dir, id); }
}
