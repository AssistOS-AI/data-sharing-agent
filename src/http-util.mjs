export async function readTextLimited(response, limit) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit) throw new Error('Upstream response exceeds the limit');
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; if (bytes > limit) { await response.body.cancel().catch(() => {}); throw new Error('Upstream response exceeds the limit'); } chunks.push(chunk); }
  return Buffer.concat(chunks, bytes).toString('utf8');
}
