export const MCP_VERSION = '2025-11-25';

const str = { type: 'string' };
export const MCP_TOOLS = [
  { name: 'list_sources', description: 'List configured Hugging Face, Zenodo, EDC, and DCAT sources without secrets.', inputSchema: { type: 'object', properties: {} } },
  { name: 'search_datasets', description: 'Search configured sources and return the policy decision for an intended use.', inputSchema: { type: 'object', properties: { query: str, sources: { type: 'string', description: 'hf,zenodo,eds,dcat' }, intended_use: { type: 'string', enum: ['research', 'training', 'commercial'] } }, required: ['query', 'intended_use'] } },
  { name: 'deep_analyze_datasets', description: 'Analyze candidates with BM25 and optionally ALA if enabled.', inputSchema: { type: 'object', properties: { problem_statement: str, intended_use: { type: 'string', enum: ['research', 'training', 'commercial'] } }, required: ['problem_statement', 'intended_use'] } },
  { name: 'inspect_dataset', description: 'Get dataset metadata and its policy decision.', inputSchema: { type: 'object', properties: { dataset_id: str, intended_use: { type: 'string', enum: ['research', 'training', 'commercial'] } }, required: ['dataset_id', 'intended_use'] } },
  { name: 'check_dataset_policy', description: 'Evaluate policy deterministically without transferring data.', inputSchema: { type: 'object', properties: { dataset_id: str, intended_use: { type: 'string', enum: ['research', 'training', 'commercial'] } }, required: ['dataset_id', 'intended_use'] } },
  { name: 'acquire_dataset', description: 'Request access or begin a controlled transfer; human approval may be required.', inputSchema: { type: 'object', properties: { dataset_id: str, intended_use: { type: 'string', enum: ['research', 'training', 'commercial'] }, file_path: str, justification: str }, required: ['dataset_id', 'intended_use', 'justification'] } },
  { name: 'get_job_status', description: 'Check the state of an EDC transfer.', inputSchema: { type: 'object', properties: { job_id: str }, required: ['job_id'] } }
];

export async function mcpResult(message, callRest) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid Request' } };
  if (!Object.hasOwn(message, 'id')) return null;
  const id = message.id;
  if (message.method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion: MCP_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'open-dataspace-hub', version: '0.1.0' }, instructions: 'Declare the intended use explicitly. The Hub determines policy and approvals.' } };
  if (message.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (message.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } };
  if (message.method !== 'tools/call') return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
  const name = message.params?.name; const args = message.params?.arguments || {};
  if (!MCP_TOOLS.some(t => t.name === name)) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } };
  try {
    let data;
    if (name === 'list_sources') data = await callRest('GET', '/api/v1/sources');
    if (name === 'search_datasets') data = await callRest('GET', `/api/v1/search?q=${encodeURIComponent(args.query || '')}&sources=${encodeURIComponent(args.sources || 'hf,zenodo,eds,dcat')}&intended_use=${encodeURIComponent(args.intended_use || '')}`);
    if (name === 'deep_analyze_datasets') data = await callRest('POST', '/api/v1/analyze', { problemStatement: args.problem_statement, intendedUse: args.intended_use });
    if (name === 'inspect_dataset') data = await callRest('GET', `/api/v1/datasets/${encodeURIComponent(args.dataset_id || '')}?intended_use=${encodeURIComponent(args.intended_use || '')}`);
    if (name === 'check_dataset_policy') data = await callRest('POST', '/api/v1/policy/check', { datasetId: args.dataset_id, intendedUse: args.intended_use });
    if (name === 'acquire_dataset') data = await callRest('POST', `/api/v1/datasets/${encodeURIComponent(args.dataset_id || '')}/acquire`, { intendedUse: args.intended_use, filePath: args.file_path, justification: args.justification });
    if (name === 'get_job_status') data = await callRest('GET', `/api/v1/jobs/${encodeURIComponent(args.job_id || '')}`);
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data } };
  } catch (e) { return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e.message }], isError: true } }; }
}
