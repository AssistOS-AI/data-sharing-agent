export const USES = ['research', 'training', 'commercial'];
const DEFAULT_POLICY = { autoLicenses: ['cc0-1.0', 'cc-by-4.0', 'mit', 'apache-2.0'], deniedLicenses: [] };
let policyConfig = structuredClone(DEFAULT_POLICY);
export function getPolicyConfig() { return structuredClone(policyConfig); }
export function configurePolicy(input) { if (!input || !Array.isArray(input.autoLicenses) || !Array.isArray(input.deniedLicenses)) throw Object.assign(new Error('Invalid policy configuration'), { status: 400, code: 'INVALID_POLICY' }); for (const list of [input.autoLicenses, input.deniedLicenses]) if (list.length > 50 || list.some(x => typeof x !== 'string' || !/^[a-z0-9][a-z0-9.+-]{0,79}$/.test(x))) throw Object.assign(new Error('Invalid licenses'), { status: 400, code: 'INVALID_POLICY' }); if (input.autoLicenses.some(x => input.deniedLicenses.includes(x))) throw Object.assign(new Error('A license cannot be both approved and denied'), { status: 400, code: 'INVALID_POLICY' }); if (input.autoLicenses.some(x => ['unknown', 'other', 'custom'].includes(x))) throw Object.assign(new Error('Unknown licenses cannot be auto approved'), { status: 400, code: 'INVALID_POLICY' }); policyConfig = { autoLicenses: [...new Set(input.autoLicenses)], deniedLicenses: [...new Set(input.deniedLicenses)] }; return getPolicyConfig(); }

export function evaluatePolicy(dataset, intendedUse = 'research') {
  if (!USES.includes(intendedUse)) throw Object.assign(new Error('Invalid intended use'), { status: 400, code: 'INVALID_USE' });
  const license = String(dataset.license || 'unknown').toLowerCase().trim();
  const reasons = [];
  if (policyConfig.deniedLicenses.includes(license)) return { decision: 'DENIED', reasons: [`License ${license} is denied by organization policy.`] };
  if (dataset.accessMode === 'contract-negotiation' || dataset.sourceType === 'eds-dsp') reasons.push('A steward must review the DSP contract.');
  if (dataset.gated) reasons.push('Gated dataset access.');
  if (dataset.containsPii) reasons.push('Metadata indicates possible personal data.');
  if (dataset.policyUnknown) reasons.push('Usage terms are unknown.');
  if (!policyConfig.autoLicenses.includes(license)) reasons.push(`License ${license || 'unknown'} is not auto approved.`);
  const forbidden = (dataset.prohibitedUses || []).includes(intendedUse);
  if (forbidden) return { decision: 'DENIED', reasons: [`Use for ${intendedUse} is explicitly prohibited.`] };
  if (reasons.length) return { decision: 'NEEDS_HUMAN_APPROVAL', reasons };
  return { decision: 'AUTO_APPROVED', reasons: [`License ${license} is on the local allowlist; verify source terms.`] };
}
