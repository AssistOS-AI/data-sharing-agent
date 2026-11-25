import { spawn } from 'node:child_process';
import { access, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skill = resolve(root, 'skills/dataset-analyst');
const publicationSkill = resolve(root, 'skills/publication-assistant');
const sibling = resolve(root, '..', 'AdvancedLanguageAgent', 'bin', 'ala.mjs');
let busy = false;

export async function alaPath() {
  const path = process.env.HUB_ALA_CLI || process.env.ALA_CLI || sibling;
  try { await access(path); return path; } catch { return null; }
}

function runNode(path, args, { timeout = 10000, cwd = root, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(HUB_|EDC_)|TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH/i.test(key)));
    const child = spawn(process.execPath, [path, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: environment });
    let out = '', err = ''; const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.stdout.on('data', chunk => { out += chunk; onProgress?.(out.slice(-4000)); if (out.length > 100_000) child.kill('SIGTERM'); });
    child.stderr.on('data', chunk => { err += chunk; if (err.length > 20_000) err = err.slice(-20_000); });
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('close', code => { clearTimeout(timer); if (code === 0) resolve(out.trim()); else reject(new Error(`ALA failed (${code}): ${err.slice(-1000)}`)); });
  });
}

export async function alaStatus() {
  const path = await alaPath(); if (!path) return { found: false, ready: false, enabled: false, reason: 'ALA was not found' };
  try { const status = JSON.parse(await runNode(path, ['status', '--json'])); const agents = status.agents.filter(a => a.available && a.loggedIn).map(a => a.name); return { found: true, ready: agents.includes('codex'), enabled: false, path, agents, selectedAgent: 'codex' }; }
  catch (e) { return { found: true, ready: false, enabled: false, path, reason: e.message }; }
}

async function runTask(dossier, dataDir, selectedSkill, prompt, onProgress) {
  if (busy) throw Object.assign(new Error('ALA is busy with another analysis'), { status: 429, code: 'ALA_BUSY' });
  const path = await alaPath(); if (!path) throw Object.assign(new Error('ALA was not found'), { status: 503, code: 'ALA_UNAVAILABLE' });
  busy = true; const dir = resolve(dataDir, 'analysis', randomUUID());
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(resolve(dir, 'dossier.json'), JSON.stringify(dossier, null, 2), { mode: 0o600 });
    await writeFile(resolve(dir, 'task.md'), `Read ${resolve(selectedSkill, 'SKILL.md')} and ${resolve(dir, 'dossier.json')}. Follow the skill exactly. ${prompt} Do not edit files or contact publishing services.`, { mode: 0o600 });
    return await runNode(path, ['--ca', 'codex', '--permissions', 'ask-for-approval', '--cwd', dir, '--folder', selectedSkill, '--taskFile', resolve(dir, 'task.md')], { timeout: Number(process.env.HUB_ALA_TIMEOUT_MS || 180000), cwd: dir, onProgress });
  } finally { busy = false; await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
export async function runAlaAnalysis(dossier, dataDir, onProgress) { return runTask(dossier, dataDir, skill, `Answer the user's problem: ${JSON.stringify(dossier.problem)}.`, onProgress); }
export async function runAlaPublicationAssist(dossier, dataDir, onProgress) { return runTask(dossier, dataDir, publicationSkill, 'Return only a JSON object with suggested form fields.', onProgress); }
