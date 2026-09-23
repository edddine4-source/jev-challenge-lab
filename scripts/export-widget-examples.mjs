import fs from 'node:fs';
import vm from 'node:vm';

// Keep the Omarchy examples in sync with the browser editor's source examples.
const source = fs.readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
const start = source.indexOf('const challengeExamples =');
const end = source.indexOf('\nfunction contextValueField', start);
if (start < 0 || end < 0) throw new Error('Could not find the browser examples');
const sandbox = vm.createContext({});
vm.runInContext(source.slice(start, end) + '\nthis.examples = challengeExamples;', sandbox);

function contextObject(facts) {
  const result = {};
  for (const fact of facts || []) {
    if (fact.type === 'group') result[fact.key] = contextObject(fact.children);
    else if (fact.type === 'number') result[fact.key] = Number(fact.value);
    else if (fact.type === 'boolean') result[fact.key] = String(fact.value) === 'true';
    else if (fact.type === 'json') result[fact.key] = JSON.parse(fact.value);
    else result[fact.key] = String(fact.value);
  }
  return result;
}

function requestFor(example) {
  const context = contextObject(example.contextFacts);
  const content = example.format === 'json' ? JSON.parse(example.state) : example.state;
  const state = Object.keys(context).length ? { context, content } : content;
  const questions = {};
  for (const question of example.questions) {
    const value = { type: question.type };
    value.instructions = question.context
      ? { task: question.instructions || 'Evaluate this decision.', context: question.context }
      : question.instructions;
    if (question.type === 'choice') value.criteria = Object.fromEntries(question.criteria);
    else if (question.type === 'score') value.criteria = question.criteria;
    else if (question.criteria) value.criteria = {
      true: question.criteria[0] || null,
      false: question.criteria[1] || null,
    };
    questions[question.name] = value;
  }
  return { model: 'jev-latest', state, questions };
}

const examples = Object.fromEntries(
  Object.entries(sandbox.examples).map(([name, value]) => [name, requestFor(value)]),
);
examples.incident = {
  model: 'jev-latest',
  state: {
    context: {
      role: 'Defensive incident triage for a small homelab. Use only the supplied evidence. Do not assert compromise from one weak signal.',
      environment: {
        assets: { reverse_proxy: 'public', media_server: 'private', backup_nas: 'private' },
        access: { vpn_required_for_admin: true, geo_blocking: false },
        response_policy: { isolate_on_confirmed_active_compromise: true, preserve_logs_before_reset: true, allow_monitoring_when_uncertain: true },
      },
      evidence_rules: { high_confidence_requires: 'Independent corroboration or direct evidence of successful unauthorized access', benign_explanation_must_be_considered: true },
    },
    content: {
      time_window: 'Last 30 minutes',
      reverse_proxy: { failed_logins: 96, successful_logins: 1, successful_login_source: 'usual VPN address', unusual_paths: ['/admin', '/wp-login.php'] },
      host: { cpu_percent: 42, new_processes: [], outbound_destinations: ['configured backup target'], file_integrity_alerts: 0 },
      notes: 'The failed logins came from rotating public IPs. The only success used a known account through the expected VPN address. No change was found on the private NAS.',
    },
  },
  questions: {
    incident_classification: {
      type: 'choice', instructions: { task: 'What is the best current classification?', context: 'Separate attempted access from successful compromise; allow uncertainty.' },
      criteria: { routine_noise: 'Expected background scanning with no targeted pattern', attempted_intrusion: 'Suspicious access attempts without evidence of success', likely_compromise: 'Independent evidence points to unauthorized access', insufficient_evidence: 'Available evidence cannot distinguish these states' },
    },
    response_priority: {
      type: 'score', instructions: 'Rate response priority using the supplied asset exposure and evidence.',
      criteria: ['Monitor', 'Investigate today', 'Urgent investigation', 'Immediate containment'],
    },
    isolate_reverse_proxy_now: {
      type: 'noul', instructions: { task: 'Should the reverse proxy be isolated immediately?', context: 'Apply the response policy and consider service disruption and preservation of logs.' },
      criteria: { true: 'Evidence justifies immediate isolation', false: 'Continue investigation or monitoring without immediate isolation' },
    },
  },
};
examples.devsecops = {
  model: 'jev-latest',
  state: {
    context: {
      role: 'Defensive release review. Decide whether a small team can ship a web service update.',
      release_policy: {
        hard_blocks: { exploited_vulnerability_in_runtime: true, unsigned_production_artifact: true, failing_authz_regression: true },
        conditional_release: { medium_finding_requires_owner_and_deadline: true, staged_rollout_required_when_dependency_change_is_large: true },
        review_order: ['hard blocks', 'test evidence', 'mitigations', 'rollout readiness'],
      },
      deployment: { audience: 'public internet', data: 'user profiles; no payment data', rollback_minutes: 10 },
    },
    content: {
      change: 'Upgrade the API framework and rebuild the container image',
      artifact: { signed: true, provenance_attested: true, sbom_generated: true },
      scans: { critical: 0, high: 0, medium: 2, exploited_runtime_vulnerability: false },
      tests: { unit: 'pass', integration: 'pass', authorization_regression: 'pass', dynamic_scan: 'pass' },
      exceptions: [{ finding: 'Medium severity transitive dependency', owner: 'platform team', deadline_days: 14, compensating_control: 'affected feature disabled' }],
      rollout: { staged_percent: 10, monitoring_minutes: 60, rollback_drill_completed: true },
      uncertainty: 'The second medium finding has no assigned owner or due date.',
    },
  },
  questions: {
    release_decision: {
      type: 'choice', instructions: { task: 'Choose the release disposition under the stated policy.', context: 'Check hard blocks first, then conditional requirements. Treat missing ownership as meaningful.' },
      criteria: { approve: 'Ship normally now', approve_with_conditions: 'Ship only after explicit conditions are met', hold: 'Do not ship until gaps are fixed', escalate: 'Policy is insufficient and an authorized exception is required' },
    },
    residual_risk: {
      type: 'score', instructions: 'Rate residual release risk after current controls, not the unmitigated scanner severity.',
      criteria: ['Very low', 'Low', 'Moderate', 'High', 'Critical'],
    },
    policy_ready: {
      type: 'noul', instructions: 'Does the release currently satisfy every stated mandatory and conditional policy requirement?',
      criteria: { true: 'All requirements are met', false: 'At least one requirement remains unmet' },
    },
  },
};
const descriptions = {
  tone: 'A quick language test: identify the tone of a colleague’s message and whether it contains a request. Use only the words shown; do not invent the sender’s intent.',
  astronomy: 'Assess a repeating dip in a star’s brightness. Compare a possible planet transit with stellar variation and instrument error, then rate how strong one small-telescope observation really is.',
  purchase: 'Decide whether a used mini PC fits a 24/7 homelab and a €300 budget. Separate suitability from value for money, and allow “need more information” when essential details are missing.',
  news: 'Classify an AI model announcement for a reader interested in local, open-source AI. Weigh its relevance while treating unverified benchmark claims cautiously.',
  support: 'Route a payment-software support message to the right team, rate its urgency, and judge frustration. Apply the shared service rules instead of relying only on the message’s tone.',
  release: 'Review a software release using nested product, quality, and operations context. Decide between a full release, staged rollout, delay, or cancellation under explicit blocking rules.',
  research: 'Evaluate a deep-water warming signal against possible sensor drift. Compare independent measurements, calibration history, and quality rules before deciding whether the claim is ready to publish.',
  space: 'Choose an action for an autonomous lunar lander with limited time and uncertain radar data. Apply hard landing constraints before comparing science value and mission risk.',
  incident: 'Triage suspicious homelab login activity without assuming a breach. Distinguish attempted access from confirmed compromise and choose a response that follows the evidence and isolation policy.',
  devsecops: 'Review a public web-service release gate. Check hard blockers, artifact evidence, test results, open findings, ownership, and rollout controls before deciding whether to ship.',
};
const output = '.pragma library\n\n'
  + '// Generated from frontend/app.js by scripts/export-widget-examples.mjs.\n'
  + 'var examples = ' + JSON.stringify(examples, null, 2) + '\n\n'
  + 'var descriptions = ' + JSON.stringify(descriptions, null, 2) + '\n\n'
  + 'function names() { return Object.keys(examples) }\n'
  + 'function get(name) { return examples[name] || examples.tone }\n'
  + 'function description(name) { return descriptions[name] || "" }\n';
fs.writeFileSync(new URL('../LabExamples.js', import.meta.url), output);
console.log(`Exported ${Object.keys(examples).length} widget examples`);
