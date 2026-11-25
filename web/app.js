const $ = id => document.getElementById(id);
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href : '#'; } catch { return '#'; } };
async function api(path, options = {}) { const r = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...options }); const data = await r.json(); if (!r.ok) throw new Error(data.error?.message || `HTTP ${r.status}`); return data; }
async function analyzeStream(payload, onProgress) { const r = await fetch('/api/v1/analyze', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(payload) }); if (!r.ok) { const error = await r.json(); throw new Error(error.error?.message || `HTTP ${r.status}`); } const reader = r.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let result = null; while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const parts = buffer.split('\n\n'); buffer = parts.pop(); for (const part of parts) { const event = part.match(/^event: (.+)$/m)?.[1]; const data = part.match(/^data: (.+)$/m)?.[1]; if (!data) continue; const value = JSON.parse(data); if (event === 'progress') onProgress(value.message); if (event === 'result') result = value; } } if (!result) throw new Error('Analysis returned no result'); return result; }
document.querySelectorAll('nav button[data-tab]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('nav button[data-tab]').forEach(x => x.classList.toggle('active', x === b)); document.querySelectorAll('.tab').forEach(x => x.classList.toggle('hidden', x.id !== b.dataset.tab)); if (b.dataset.tab === 'approvals') { loadApprovals(); loadAudit(); } if (b.dataset.tab === 'settings') loadConnectors(); if (b.dataset.tab === 'artifacts') loadArtifacts(); if (b.dataset.tab === 'publish') { loadPublicationArtifacts(); loadPublications(); } if (b.dataset.tab === 'monitoring') loadAlaRuns(); }));
$('searchForm').addEventListener('submit', async e => { e.preventDefault(); const f = new FormData(e.target); $('searchStatus').textContent = 'Searching sources…'; $('results').replaceChildren(); try { const data = await api(`/api/v1/search?q=${encodeURIComponent(f.get('q'))}&sources=${encodeURIComponent(f.get('sources'))}&intended_use=${encodeURIComponent(f.get('use'))}&policy=${encodeURIComponent(f.get('policy'))}&access_mode=${encodeURIComponent(f.get('access'))}`); $('searchStatus').textContent = `${data.items.length} results${data.errors.length ? ` · Errors: ${data.errors.map(x => `${x.source}: ${x.message}`).join('; ')}` : ''}`; for (const item of data.items) { const div = document.createElement('div'); div.className = 'card'; div.innerHTML = `<span class="badge source">${escapeHtml(item.sourceType)}</span><span class="badge ${escapeHtml(item.policy.decision)}">${escapeHtml(item.policy.decision)}</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.description).slice(0, 350)}</p><p><small>ID: ${escapeHtml(item.id)} · License: ${escapeHtml(item.license)} · Access: ${escapeHtml(item.accessMode)}</small></p><p>${escapeHtml(item.policy.reasons.join(' '))}</p><button class="secondary">Details and use</button><div class="detail hidden"></div>`; div.querySelector('button').onclick = () => detail(item.id, div.querySelector('.detail'), f.get('use')); $('results').append(div); } } catch (err) { $('searchStatus').textContent = err.message; } });
async function detail(id, target, use) {
  target.classList.remove('hidden'); target.textContent = 'Loading…';
  try {
    const item = await api(`/api/v1/datasets/${encodeURIComponent(id)}?intended_use=${use}`);
    target.innerHTML = `<p><a href="${escapeHtml(safeUrl(item.sourceUrl))}" target="_blank" rel="noopener noreferrer">Source page</a></p><p><strong>Policy:</strong> ${escapeHtml(item.policy.reasons.join(' '))}</p><p><strong>Files:</strong></p><select class="file"><option value="">Select a file</option>${(item.files || []).slice(0, 100).map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('')}</select><p><button class="preview secondary">HF preview / schema</button></p><pre class="previewResult hidden"></pre><label>Justification</label><textarea class="justification" rows="2" placeholder="Describe the intended use"></textarea><p><button class="acquire">Request access / download</button></p><pre class="acquireResult"></pre><div class="jobControls"></div><details><summary>Metadata JSON</summary><pre>${escapeHtml(JSON.stringify(item, null, 2))}</pre></details>`;
    const code = document.createElement('details'); code.innerHTML = '<summary>Node.js example for the local API</summary><pre></pre>'; const updateCode = () => { const selected = target.querySelector('.file').value || null; code.querySelector('pre').textContent = `const r = await fetch('http://127.0.0.1:8787/api/v1/datasets/${encodeURIComponent(id)}/acquire', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify(${JSON.stringify({ intendedUse: use, filePath: selected, justification: 'Describe the purpose' })})\n});\nconsole.log(await r.json());`; }; target.querySelector('.file').addEventListener('change', updateCode); updateCode(); target.append(code);
    target.querySelector('.preview').onclick = async () => { const out = target.querySelector('.previewResult'); out.classList.remove('hidden'); out.textContent = 'Loading preview…'; try { out.textContent = JSON.stringify(await api(`/api/v1/datasets/${encodeURIComponent(id)}/preview?intended_use=${use}`), null, 2); } catch (err) { out.textContent = err.message; } };
    target.querySelector('.acquire').onclick = async () => {
      const filePath = target.querySelector('.file').value || null; const justification = target.querySelector('.justification').value; const output = target.querySelector('.acquireResult'); const controls = target.querySelector('.jobControls'); controls.replaceChildren();
      try {
        const result = await api(`/api/v1/datasets/${encodeURIComponent(id)}/acquire`, { method: 'POST', body: JSON.stringify({ intendedUse: use, justification, filePath }) }); output.textContent = JSON.stringify(result, null, 2);
        if (result.downloadUrl) { const a = document.createElement('a'); a.href = result.downloadUrl; a.textContent = 'Download now'; controls.append(a); }
        if (result.cacheUrl) { const b = document.createElement('button'); b.className = 'secondary'; b.textContent = 'Save to local sink'; b.onclick = async () => { try { const saved = await api(result.cacheUrl, { method: 'POST' }); output.textContent = JSON.stringify(saved, null, 2); controls.replaceChildren(); const a = document.createElement('a'); a.href = saved.downloadUrl; a.textContent = 'Download saved file'; controls.append(a); } catch (err) { output.textContent = err.message; } }; controls.append(' ', b); }
        if (result.id && result.negotiationId) { const b = document.createElement('button'); b.className = 'secondary'; b.textContent = 'Check EDC transfer'; b.onclick = async () => { try { const job = await api(`/api/v1/jobs/${result.id}`); output.textContent = JSON.stringify(job, null, 2); if (job.downloadUrl && !controls.querySelector('a')) { const a = document.createElement('a'); a.href = job.downloadUrl; a.textContent = 'Download EDC data'; controls.append(' ', a); } if (job.cacheUrl && !controls.querySelector('.cacheEdc')) { const cache = document.createElement('button'); cache.className = 'secondary cacheEdc'; cache.textContent = 'Save EDC data locally'; cache.onclick = async () => { try { const saved = await api(job.cacheUrl, { method: 'POST' }); output.textContent = JSON.stringify(saved, null, 2); } catch (err) { output.textContent = err.message; } }; controls.append(' ', cache); } } catch (err) { output.textContent = err.message; } }; controls.append(b); }
      } catch (err) { output.textContent = err.message; }
    };
  } catch (err) { target.textContent = err.message; }
}
$('simulateForm').addEventListener('submit', async e => { e.preventDefault(); const f = new FormData(e.target); try { const result = await api('/api/v1/simulate', { method: 'POST', body: JSON.stringify({ license: f.get('license'), intendedUse: f.get('intendedUse'), gated: f.has('gated'), containsPii: f.has('containsPii') }) }); $('simulationResult').textContent = JSON.stringify(result, null, 2); } catch (err) { $('simulationResult').textContent = err.message; } });
async function loadApprovals() { try { const { items } = await api('/api/v1/approvals'); $('approvalList').replaceChildren(); for (const a of items) { const div = document.createElement('div'); div.className = 'card'; div.innerHTML = `<strong>${escapeHtml(a.datasetId)}</strong> · ${escapeHtml(a.status)}<p>${escapeHtml(a.intendedUse)} · ${escapeHtml(a.filePath || 'whole dataset')}</p><p>${escapeHtml(a.justification)}</p><small>${escapeHtml(a.reasons.join(' '))}</small>`; if (a.status === 'PENDING') for (const decision of ['APPROVED', 'REJECTED']) { const button = document.createElement('button'); button.textContent = decision === 'APPROVED' ? 'Approve' : 'Reject'; button.className = decision === 'REJECTED' ? 'danger' : ''; button.onclick = async () => { try { await api(`/api/v1/approvals/${a.id}/decision`, { method: 'POST', body: JSON.stringify({ decision }) }); loadApprovals(); } catch (err) { alert(err.message); } }; div.append(' ', button); } $('approvalList').append(div); } if (!items.length) $('approvalList').textContent = 'No approval requests.'; } catch (err) { $('approvalList').textContent = err.message; } }
async function loadAudit() { try { $('auditList').textContent = JSON.stringify((await api('/api/v1/audit')).items, null, 2); } catch (err) { $('auditList').textContent = err.message; } }
async function loadConnectors() { try { const { sources } = await api('/api/v1/sources'); $('connectors').textContent = JSON.stringify(sources, null, 2); renderSources(sources); $('hfForm').elements.enabled.checked = sources.find(x => x.id === 'hf')?.enabled ?? true; const zenodo = sources.find(x => x.id === 'zenodo'); $('zenodoForm').elements.enabled.checked = zenodo?.enabled ?? true; $('zenodoForm').elements.url.value = zenodo?.url || 'https://zenodo.org'; const settings = await api('/api/v1/settings'); $('alaEnabled').checked = settings.ala.enabled; $('alaStatus').textContent = settings.ala.found ? `Found: ${settings.ala.path}; coding agents: ${(settings.ala.agents || []).join(', ') || 'none authenticated'}` : 'ALA was not found. Set HUB_ALA_CLI.'; $('policyConfig').value = JSON.stringify(await api('/api/v1/policy/config'), null, 2); } catch (err) { $('connectors').textContent = err.message; } }
$('refreshApprovals').onclick = loadApprovals; $('refreshAudit').onclick = loadAudit;
$('saveAla').onclick = async () => { try { await api('/api/v1/settings', { method: 'POST', body: JSON.stringify({ alaEnabled: $('alaEnabled').checked }) }); loadConnectors(); } catch (err) { $('alaStatus').textContent = err.message; } };
$('savePolicy').onclick = async () => { try { const config = JSON.parse($('policyConfig').value); await api('/api/v1/policy/config', { method: 'PUT', body: JSON.stringify(config) }); $('policyMessage').textContent = 'Policy saved.'; } catch (err) { $('policyMessage').textContent = err.message; } };
$('analysisForm').addEventListener('submit', async e => { e.preventDefault(); const f = new FormData(e.target); $('analysisStatus').textContent = 'Searching and ranking…'; $('analysisResults').replaceChildren(); try { const result = await analyzeStream({ problemStatement: f.get('problemStatement'), intendedUse: f.get('intendedUse') }, message => { $('analysisStatus').textContent = message; }); $('analysisStatus').textContent = `${result.recommendations.length} recommendations · ${result.method}${result.errors.length ? ` · ${result.errors.length} source errors` : ''}${result.agentError ? ` · ALA: ${result.agentError}` : ''}`; if (result.agentAnswer) { const div = document.createElement('div'); div.className = 'card'; div.innerHTML = `<h2>ALA analysis</h2><pre>${escapeHtml(result.agentAnswer)}</pre>`; $('analysisResults').append(div); } for (const rec of result.recommendations) { const div = document.createElement('div'); div.className = 'card'; div.innerHTML = `<span class="badge ${escapeHtml(rec.policy.decision)}">${escapeHtml(rec.policy.decision)}</span><h2>${escapeHtml(rec.dataset.title)}</h2><p>${escapeHtml(rec.dataset.id)}</p><p>${escapeHtml(rec.matchReasons.join(' · '))}</p><p class="muted">${escapeHtml(rec.limitations.join(' · '))}</p><button class="secondary">Details</button><div class="detail hidden"></div>`; div.querySelector('button').onclick = () => detail(rec.dataset.id, div.querySelector('.detail'), f.get('intendedUse')); $('analysisResults').append(div); } if (!result.recommendations.length) $('analysisResults').textContent = 'No datasets found; check source errors.'; } catch (err) { $('analysisStatus').textContent = err.message; } });
async function loadArtifacts() { try { const { items } = await api('/api/v1/artifacts'); $('artifactList').replaceChildren(); for (const a of items) { const div = document.createElement('div'); div.className = 'card'; div.innerHTML = `<strong>${escapeHtml(a.name)}</strong><p>${escapeHtml(a.datasetId)} · ${a.bytes} bytes · expires ${escapeHtml(a.expiresAt)}</p><small>SHA-256: ${escapeHtml(a.sha256)}</small><p><a href="/api/v1/artifacts/${encodeURIComponent(a.id)}/download">Download</a></p>`; const b = document.createElement('button'); b.className = 'danger'; b.textContent = 'Delete'; b.onclick = async () => { await api(`/api/v1/artifacts/${a.id}`, { method: 'DELETE' }); loadArtifacts(); }; div.append(b); $('artifactList').append(div); } if (!items.length) $('artifactList').textContent = 'No local files.'; } catch (err) { $('artifactList').textContent = err.message; } }
$('refreshArtifacts').onclick = loadArtifacts;
$('testConnectors').onclick = async () => { $('connectorTest').classList.remove('hidden'); $('connectorTest').textContent = 'Testing sources…'; try { $('connectorTest').textContent = JSON.stringify(await api('/api/v1/connectors/test', { method: 'POST' }), null, 2); } catch (err) { $('connectorTest').textContent = err.message; } };

function renderSources(sources) {
  const list = $('sourceList'); list.replaceChildren();
  for (const source of sources) {
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<strong>${escapeHtml(source.name)}</strong> <span class="badge source">${escapeHtml(source.type)}</span><p>${escapeHtml(source.id)} · ${source.enabled ? 'Enabled' : 'Disabled'}${source.hasToken ? ' · token saved' : ''}${source.hasApiKey ? ' · EDC API key saved' : ''}</p><small>${escapeHtml(source.managementUrl || source.url || source.providerUrl || '')}</small><p class="status muted"></p>`;
    const test = document.createElement('button'); test.className = 'secondary'; test.textContent = 'Test connection'; test.onclick = async () => { const status = card.querySelector('.status'); status.textContent = 'Testing…'; try { const result = await api(`/api/v1/sources/${source.id}/test`, { method: 'POST' }); status.textContent = `Online · ${result.count} records${result.account ? ` · account: ${result.account}` : ''}${result.mode === 'public' ? ' · public access' : ''}`; } catch (err) { status.textContent = err.message; } }; card.append(test);
    if (source.type === 'edc' || source.type === 'dcat') {
      const edit = document.createElement('button'); edit.className = 'secondary'; edit.textContent = 'Edit'; edit.onclick = () => { const form = $(source.type === 'edc' ? 'edcForm' : 'dcatForm'); for (const [key, value] of Object.entries(source)) if (form.elements[key] && !['apiKey', 'token'].includes(key)) { if (form.elements[key].type === 'checkbox') form.elements[key].checked = Boolean(value); else form.elements[key].value = value ?? ''; } form.elements.id.readOnly = true; form.closest('details').open = true; form.scrollIntoView({ behavior: 'smooth' }); }; card.append(' ', edit);
      const remove = document.createElement('button'); remove.className = 'danger'; remove.textContent = 'Remove'; remove.onclick = async () => { if (!confirm(`Remove ${source.name}?`)) return; try { await api(`/api/v1/sources/${source.id}`, { method: 'DELETE' }); loadConnectors(); } catch (err) { card.querySelector('.status').textContent = err.message; } }; card.append(' ', remove);
    }
    list.append(card);
  }
}

$('hfForm').addEventListener('submit', async event => { event.preventDefault(); const form = event.target; const input = { name: 'Hugging Face', enabled: form.elements.enabled.checked, token: form.elements.token.value, clearToken: form.elements.clearToken.checked }; try { await api('/api/v1/sources/hf', { method: 'PUT', body: JSON.stringify(input) }); form.elements.token.value = ''; form.elements.clearToken.checked = false; $('hfMessage').textContent = 'Hugging Face settings saved. Use Test connection to verify access.'; loadConnectors(); } catch (err) { $('hfMessage').textContent = err.message; } });
$('zenodoForm').addEventListener('submit', async event => { event.preventDefault(); const form = event.target; const input = { name: 'Zenodo', enabled: form.elements.enabled.checked, url: form.elements.url.value, token: form.elements.token.value, clearToken: form.elements.clearToken.checked }; try { await api('/api/v1/sources/zenodo', { method: 'PUT', body: JSON.stringify(input) }); form.elements.token.value = ''; form.elements.clearToken.checked = false; $('zenodoMessage').textContent = 'Zenodo settings saved.'; loadConnectors(); } catch (err) { $('zenodoMessage').textContent = err.message; } });
for (const type of ['edc', 'dcat']) {
  const form = $(`${type}Form`); const message = $(`${type}Message`);
  form.addEventListener('submit', async event => { event.preventDefault(); const fields = form.elements; const data = { id: fields.id.value.trim(), type, name: fields.name.value.trim(), enabled: fields.enabled.checked, dataHosts: fields.dataHosts.value.trim() }; if (type === 'edc') Object.assign(data, { managementUrl: fields.managementUrl.value.trim(), providerUrl: fields.providerUrl.value.trim(), participantId: fields.participantId.value.trim(), protocol: fields.protocol.value.trim(), apiKey: fields.apiKey.value.trim(), clearApiKey: fields.clearApiKey.checked }); else data.url = fields.url.value.trim(); try { const exists = (await api('/api/v1/sources')).sources.some(x => x.id === data.id); await api(exists ? `/api/v1/sources/${data.id}` : '/api/v1/sources', { method: exists ? 'PUT' : 'POST', body: JSON.stringify(data) }); message.textContent = `${type.toUpperCase()} source saved. Test its connection above.`; if (type === 'edc') { fields.apiKey.value = ''; fields.clearApiKey.checked = false; } loadConnectors(); } catch (err) { message.textContent = err.message; } });
  $(`reset${type[0].toUpperCase()}${type.slice(1)}`).onclick = () => { form.reset(); form.elements.id.readOnly = false; message.textContent = ''; };
}
loadConnectors();

document.querySelectorAll('[data-settings-tab]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('[data-settings-tab]').forEach(tab => tab.classList.toggle('active', tab === button)); document.querySelectorAll('.settings-pane').forEach(pane => pane.classList.toggle('hidden', pane.id !== button.dataset.settingsTab)); }));
const initialTab = new URLSearchParams(location.search).get('tab');
if (initialTab) document.querySelector(`nav button[data-tab="${CSS.escape(initialTab)}"]`)?.click();
if (new URLSearchParams(location.search).get('settings') === 'hub') document.querySelector('[data-settings-tab="settingsHub"]')?.click();

async function loadPublicationArtifacts() {
  try {
    const selected = $('publicationArtifact').value;
    const { items: allItems } = await api('/api/v1/artifacts'); const items = allItems.filter(item => item.datasetId === 'local:upload');
    $('publicationArtifact').innerHTML = '<option value="">Select a local file</option>' + items.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} · ${a.bytes} bytes</option>`).join('');
    if (items.some(a => a.id === selected)) $('publicationArtifact').value = selected;
  } catch (error) { $('uploadStatus').textContent = error.message; }
}
$('publicationArtifact').addEventListener('change', () => { const text = $('publicationArtifact').selectedOptions[0]?.textContent || ''; if (!$('publicationPath').value) $('publicationPath').value = text.split(' · ')[0]; });
$('publicationDestination').addEventListener('change', () => { const hf = $('publicationDestination').value === 'hf'; $('hfPublicationFields').classList.toggle('hidden', !hf); $('zenodoPublicationFields').classList.toggle('hidden', hf); });
$('uploadForm').addEventListener('submit', async event => {
  event.preventDefault(); const file = $('uploadFile').files[0]; if (!file) return;
  const name = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, 'file_');
  $('uploadStatus').textContent = 'Uploading…';
  try {
    const response = await fetch(`/api/v1/uploads?name=${encodeURIComponent(name)}`, { method: 'POST', body: file, credentials: 'same-origin' });
    const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
    await loadPublicationArtifacts(); $('publicationArtifact').value = data.artifact.id; $('publicationPath').value = data.artifact.name;
    $('uploadStatus').textContent = `Saved locally: ${data.artifact.name} (${data.artifact.bytes} bytes).`;
  } catch (error) { $('uploadStatus').textContent = error.message; }
});
$('assistPublication').onclick = async () => {
  const description = $('publicationPrompt').value.trim(); $('assistStatus').textContent = 'ALA is preparing suggestions…';
  try {
    const result = await api('/api/v1/publications/assist', { method: 'POST', body: JSON.stringify({ destination: $('publicationDestination').value, artifactId: $('publicationArtifact').value, description, currentFields: { repoId: $('publicationRepo').value, title: $('publicationTitle').value, creator: $('publicationCreator').value, license: $('publicationDestination').value === 'hf' ? $('publicationHfLicense').value : $('publicationZenodoLicense').value } }) });
    const fields = result.fields;
    for (const [key, id] of Object.entries({ repoId: 'publicationRepo', path: 'publicationPath', title: 'publicationTitle', description: 'publicationDescription', creator: 'publicationCreator' })) if (fields[key]) $(id).value = fields[key];
    if (fields.license) $( $('publicationDestination').value === 'hf' ? 'publicationHfLicense' : 'publicationZenodoLicense').value = fields.license;
    $('assistStatus').innerHTML = `Suggestions filled. Review every field. <a href="/?tab=monitoring">View ALA run</a>.`;
  } catch (error) { $('assistStatus').textContent = error.message; }
};
$('submitPublication').onclick = async () => {
  const destination = $('publicationDestination').value;
  const input = { destination, artifactId: $('publicationArtifact').value, rightsConfirmed: $('publicationRights').checked, path: $('publicationPath').value, repoId: $('publicationRepo').value, visibility: $('publicationVisibility').value, createRepo: $('publicationCreateRepo').checked, title: $('publicationTitle').value, description: $('publicationDescription').value, creator: $('publicationCreator').value, license: destination === 'hf' ? $('publicationHfLicense').value : $('publicationZenodoLicense').value };
  if (!input.artifactId) { $('publicationStatus').textContent = 'Select or upload a local file first.'; return; } if (!input.rightsConfirmed) { $('publicationStatus').textContent = 'Confirm your publication rights first.'; return; }
  if (!confirm(destination === 'hf' ? 'Commit this file to Hugging Face?' : 'Create a Zenodo draft and upload this file?')) return;
  $('publicationStatus').textContent = 'Sending…'; $('submitPublication').disabled = true;
  try { const result = await api('/api/v1/publications', { method: 'POST', body: JSON.stringify(input) }); $('publicationStatus').textContent = `${result.status}: ${result.url}`; await loadPublications(); }
  catch (error) { $('publicationStatus').textContent = error.message; await loadPublications(); }
  finally { $('submitPublication').disabled = false; }
};
async function loadPublications() {
  try {
    const { items } = await api('/api/v1/publications'); $('publicationList').replaceChildren();
    for (const item of items) {
      const card = document.createElement('div'); card.className = 'card';
      card.innerHTML = `<strong>${escapeHtml(item.destination.toUpperCase())}</strong> · ${escapeHtml(item.status)}<p>${escapeHtml(item.metadata?.title || item.metadata?.repoId || item.artifactId)}</p><small>${escapeHtml(item.createdAt)}</small><p>${item.url ? `<a href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">Open destination</a>` : escapeHtml(item.error || '')}</p>`;
      if (item.destination === 'zenodo' && item.status === 'DRAFT') { const button = document.createElement('button'); button.textContent = 'Publish Zenodo draft'; button.onclick = async () => { if (!confirm('Publish this Zenodo record? Zenodo publication is permanent.')) return; try { await api(`/api/v1/publications/${item.id}/publish`, { method: 'POST' }); loadPublications(); } catch (error) { $('publicationStatus').textContent = error.message; } }; card.append(button); }
      $('publicationList').append(card);
    }
    if (!items.length) $('publicationList').textContent = 'No publications yet.';
  } catch (error) { $('publicationList').textContent = error.message; }
}
$('refreshPublications').onclick = loadPublications;
async function loadAlaRuns() {
  try {
    const { items } = await api('/api/v1/ala/runs'); $('alaRunList').replaceChildren();
    for (const run of items) {
      const card = document.createElement('div'); card.className = 'card';
      card.innerHTML = `<strong>${escapeHtml(run.type)}</strong> · ${escapeHtml(run.status)}<p><small>${escapeHtml(run.startedAt)} · ${escapeHtml(run.actor)}</small></p><p>${escapeHtml(run.error || run.outputPreview || '')}</p>`;
      const button = document.createElement('button'); button.className = 'secondary'; button.textContent = 'View full run';
      button.onclick = async () => { try { const full = await api(`/api/v1/ala/runs/${run.id}`); const pre = document.createElement('pre'); pre.textContent = JSON.stringify(full, null, 2); card.append(pre); button.remove(); } catch (error) { card.append(error.message); } }; card.append(button); $('alaRunList').append(card);
    }
    if (!items.length) $('alaRunList').textContent = 'No ALA runs yet.';
  } catch (error) { $('alaRunList').textContent = error.message; }
}
$('refreshAlaRuns').onclick = loadAlaRuns;
setInterval(() => { if (!$('monitoring').classList.contains('hidden')) loadAlaRuns(); }, 3000);
$('runApiTest').onclick = async () => {
  const path = $('apiPath').value.trim(); const method = $('apiMethod').value;
  if (!(path.startsWith('/api/v1/') || path === '/mcp') || path.includes('://')) { $('apiTestResult').textContent = 'Enter a local /api/v1/ path or /mcp.'; return; }
  try {
    const body = ['POST', 'PUT'].includes(method) && $('apiBody').value.trim() ? JSON.stringify(JSON.parse($('apiBody').value)) : undefined;
    const result = await api(path, { method, ...(body ? { body } : {}) });
    $('apiTestResult').textContent = JSON.stringify(result, null, 2);
  } catch (error) { $('apiTestResult').textContent = error.message; }
};
