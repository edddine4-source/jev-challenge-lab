const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    let message = "Request failed";
    try {
      const detail = (await response.json()).detail;
      message = typeof detail === "string" ? detail : JSON.stringify(detail || message);
    } catch (_) { /* response was not JSON */ }
    throw new Error(message);
  }
  return response.json();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

let questionSequence = 0;
let activeDraftId = null;
let savedView = "history";

const challengeExamples = {
  tone: {
    format: "text",
    contextFacts: [
      { key: "conversation", type: "text", value: "A short message between two colleagues. Judge only the wording that is present." },
    ],
    state: "Could you send me the final document today? I need it before the meeting. Thanks!",
    questions: [
      { type: "choice", name: "tone", instructions: "What is the main tone of this message?", criteria: [["friendly", "Warm, polite, or appreciative"], ["neutral", "Direct and emotionally neutral"], ["impatient", "Shows frustration or pressure"], ["hostile", "Aggressive or insulting"]] },
      { type: "noul", name: "contains_request", instructions: "Does the message ask the recipient to do something?" },
    ],
  },
  astronomy: {
    format: "json",
    contextFacts: [
      { key: "observation_context", type: "text", value: "A hobby astronomer is reviewing one observation. Do not assume facts that are not in the measurement." },
      { key: "known_categories", type: "json", value: '["planet", "star", "galaxy", "comet", "instrument artifact", "unknown"]' },
    ],
    state: JSON.stringify({ object: "HD-219134 b candidate transit", brightness_drop_percent: 0.035, duration_minutes: 58, repeated_after_days: 3.09, telescope: "20 cm backyard telescope", cloud_cover: "low" }, null, 2),
    questions: [
      { type: "choice", name: "most_likely_explanation", instructions: "What best explains this repeating brightness dip?", criteria: [["planet_transit", "An orbiting planet passes in front of the star"], ["variable_star", "The star changes brightness by itself"], ["instrument_artifact", "The detector or processing created the signal"], ["insufficient_data", "The observation cannot distinguish the causes"]] },
      { type: "score", name: "evidence_strength", instructions: "How strong is this evidence on its own?", criteria: ["Very weak", "Weak", "Moderate", "Strong", "Very strong"] },
    ],
  },
  support: {
    format: "text",
    contextFacts: [
      { key: "business_context", type: "text", value: "We provide payment software to businesses. Payout failures are handled by Technical Support. Requests blocking next-day operations are urgent." },
      { key: "customer", type: "group", children: [
        { key: "tier", type: "text", value: "enterprise" },
        { key: "region", type: "text", value: "Europe" },
      ] },
      { key: "service_rules", type: "group", children: [
        { key: "response_sla_hours", type: "number", value: "2" },
        { key: "production_blocked", type: "boolean", value: "true" },
        { key: "routing", type: "group", children: [
          { key: "payment_connection_failure", type: "text", value: "technical" },
          { key: "duplicate_charge", type: "text", value: "billing" },
        ] },
      ] },
    ],
    state: "I have tried to connect my payment account for three days. It still fails, and I need payouts working before tomorrow. Please help.",
    questions: [
      { type: "choice", name: "department", instructions: "Which team should handle this request?", context: "Use our internal ownership rules in the shared business context.", criteria: [["billing", "Charges, invoices, or refunds"], ["technical", "Bugs or integration failures"], ["sales", "Pricing or purchasing questions"], ["other", "None of these clearly fits"]] },
      { type: "score", name: "urgency", instructions: "How urgent is this request?", context: "Judge operational impact and deadline, independent of the customer's emotional tone.", criteria: ["Can wait", "Needs attention this week", "Needs attention today", "Immediate action required"] },
      { type: "noul", name: "is_frustrated", instructions: "Does the customer sound frustrated?", criteria: ["The customer expresses frustration or repeated failure", "The tone is calm and neutral"] },
    ],
  },
  purchase: {
    format: "json",
    contextFacts: [
      { key: "business_context", type: "text", value: "This purchase is for a quiet, energy-efficient homelab." },
      { key: "budget_eur", type: "number", value: "300" },
      { key: "must_run_24_7", type: "boolean", value: "true" },
    ],
    state: JSON.stringify({ product: "Used mini PC", price_eur: 240, ram_gb: 32, storage_gb: 1000, use: "24/7 homelab server", condition: "Good, two years old" }, null, 2),
    questions: [
      { type: "choice", name: "recommendation", instructions: "What is the best purchase decision?", criteria: [["buy", "Good value and suitable for the stated use"], ["negotiate", "Suitable, but the price should be lower"], ["skip", "Poor value or unsuitable"], ["need_more_info", "Important facts are missing"]] },
      { type: "score", name: "value", instructions: "How good is the value for money?", criteria: ["Very poor", "Poor", "Fair", "Good", "Excellent"] },
      { type: "noul", name: "fits_homelab", instructions: "Is this machine suitable as a 24/7 homelab server?", criteria: ["Hardware and condition fit the use", "Hardware or condition does not fit the use"] },
    ],
  },
  news: {
    format: "text",
    contextFacts: [
      { key: "reader_context", type: "text", value: "The reader follows local and open-source AI, and values reproducible claims over marketing announcements." },
      { key: "reader_interests", type: "json", value: '["local AI", "open-source models", "reproducible research"]' },
      { key: "require_independent_evidence", type: "boolean", value: "true" },
    ],
    state: "A small open-source language model claims benchmark results close to much larger models and can run on a consumer laptop. The release includes model weights and evaluation code.",
    questions: [
      { type: "choice", name: "topic", instructions: "What is the primary topic?", criteria: [["ai_release", "A new AI model or AI product"], ["research", "A scientific result or paper"], ["developer_tool", "Software mainly for developers"], ["other", "None of these"]] },
      { type: "score", name: "importance", instructions: "How important is this for someone interested in local AI?", criteria: ["Irrelevant", "Mildly interesting", "Useful", "Highly important", "Essential"] },
      { type: "noul", name: "verify_claims", instructions: "Should the benchmark claims be independently verified before trusting them?" },
    ],
  },
  release: {
    format: "json",
    contextFacts: [
      { key: "product", type: "group", children: [
        { key: "name", type: "text", value: "Atlas Notes" },
        { key: "users", type: "number", value: "42000" },
        { key: "critical_workflow", type: "text", value: "Users create and synchronize encrypted notes across devices." },
        { key: "availability_target_percent", type: "number", value: "99.95" },
      ] },
      { key: "release_policy", type: "group", children: [
        { key: "blocking_rules", type: "json", value: '["known data loss", "encryption regression", "failed rollback test", "unresolved critical security issue"]' },
        { key: "warning_rules", type: "json", value: '["p95 latency increase above 15%", "error budget burn above 10%", "missing noncritical documentation"]' },
        { key: "allowed_rollout", type: "text", value: "A staged rollout may start at 5%, then 25%, then 100% if monitoring stays healthy for two hours at each stage." },
      ] },
      { key: "quality_evidence", type: "group", children: [
        { key: "automated_tests", type: "group", children: [
          { key: "passed", type: "number", value: "1842" },
          { key: "failed", type: "number", value: "2" },
          { key: "failure_notes", type: "text", value: "Both failures are flaky visual snapshot tests and pass on rerun." },
        ] },
        { key: "security_review", type: "text", value: "Completed. No critical or high findings; one medium dependency issue is mitigated at runtime." },
        { key: "rollback_tested", type: "boolean", value: "true" },
        { key: "load_test", type: "text", value: "p95 write latency increased by 11%; error rate stayed below 0.2%." },
      ] },
      { key: "operations", type: "group", children: [
        { key: "support_staffed", type: "boolean", value: "true" },
        { key: "on_call_engineer_available", type: "boolean", value: "true" },
        { key: "next_safe_window_days", type: "number", value: "5" },
      ] },
    ],
    state: JSON.stringify({ version: "4.8.0", changes: ["new offline sync engine", "faster search index", "dependency security updates"], open_bugs: [{ severity: "medium", description: "Search may briefly show stale results after reconnect" }, { severity: "low", description: "Progress icon occasionally remains visible" }], planned_start: "Tuesday 09:00 UTC" }, null, 2),
    questions: [
      { type: "choice", name: "release_decision", instructions: "What is the safest release decision under the supplied policy?", context: "Treat explicit blocking rules as mandatory. Consider staged rollout when evidence is good but uncertainty remains.", criteria: [["full_release", "Release to everyone immediately"], ["staged_release", "Start a monitored staged rollout"], ["delay", "Delay until specific concerns are resolved"], ["cancel", "Cancel this release and redesign it"]] },
      { type: "score", name: "operational_risk", instructions: "How much operational risk remains?", criteria: ["Minimal", "Low", "Moderate", "High", "Critical"] },
      { type: "noul", name: "rollback_ready", instructions: "Is the team ready to roll back safely if monitoring becomes unhealthy?", criteria: ["Rollback was tested and staff can execute it", "Rollback ability or staffing is inadequate"] },
    ],
  },
  research: {
    format: "json",
    contextFacts: [
      { key: "study", type: "group", children: [
        { key: "objective", type: "text", value: "Determine whether a deep-water warming event is real or caused by sensor drift." },
        { key: "location", type: "text", value: "North Atlantic monitoring station A17" },
        { key: "baseline_years", type: "number", value: "12" },
        { key: "expected_seasonal_range_c", type: "json", value: '{"minimum": 3.6, "maximum": 4.3}' },
      ] },
      { key: "instrument_network", type: "group", children: [
        { key: "primary_sensor", type: "group", children: [
          { key: "depth_m", type: "number", value: "1800" },
          { key: "last_calibrated_days_ago", type: "number", value: "410" },
          { key: "manufacturer_drift_per_year_c", type: "number", value: "0.04" },
        ] },
        { key: "reference_sensor", type: "group", children: [
          { key: "distance_km", type: "number", value: "18" },
          { key: "depth_m", type: "number", value: "1750" },
          { key: "last_calibrated_days_ago", type: "number", value: "80" },
        ] },
        { key: "satellite_relevance", type: "text", value: "Satellite readings measure the surface and cannot directly validate temperature at 1800 metres." },
      ] },
      { key: "quality_rules", type: "group", children: [
        { key: "independent_confirmation_required", type: "boolean", value: "true" },
        { key: "flag_if_change_exceeds_c", type: "number", value: "0.15" },
        { key: "preferred_checks", type: "json", value: '["deploy calibrated reference probe", "compare nearby moorings", "inspect salinity and current changes", "review sensor voltage and fouling logs"]' },
      ] },
      { key: "environment", type: "group", children: [
        { key: "recent_storm", type: "boolean", value: "false" },
        { key: "current_speed_change_percent", type: "number", value: "22" },
        { key: "salinity_shift_psu", type: "number", value: "0.08" },
      ] },
    ],
    state: JSON.stringify({ observation_window_days: 21, primary_temperature_c: [4.18, 4.26, 4.31, 4.39, 4.43], reference_temperature_c: [4.07, 4.09, 4.12, 4.14, 4.16], primary_sensor_voltage_stable: true, missing_samples_percent: 1.2, technician_note: "Light biological fouling visible during the previous inspection." }, null, 2),
    questions: [
      { type: "choice", name: "leading_explanation", instructions: "Which explanation is currently best supported?", context: "Distinguish a real environmental signal from instrument error, but allow an uncertain result when independent confirmation is insufficient.", criteria: [["real_warming", "The water mass has genuinely warmed"], ["sensor_drift", "The primary sensor has drifted upward"], ["mixed_causes", "Environmental change and sensor drift both contribute"], ["undetermined", "The evidence cannot yet distinguish the causes"]] },
      { type: "score", name: "confidence", instructions: "How strong is the present conclusion?", criteria: ["Speculative", "Low confidence", "Moderate confidence", "High confidence", "Conclusive"] },
      { type: "noul", name: "collect_more_data", instructions: "Should the team collect independent measurements before publishing a warming claim?", criteria: ["The quality rules or current uncertainty require confirmation", "Existing evidence is sufficient for the claim"] },
    ],
  },
  space: {
    format: "json",
    contextFacts: [
      { key: "mission", type: "group", children: [
        { key: "name", type: "text", value: "Asteria-3" },
        { key: "objective", type: "text", value: "Land an autonomous science package near the lunar south pole and operate for 14 Earth days." },
        { key: "minimum_science_days", type: "number", value: "8" },
        { key: "crew_onboard", type: "boolean", value: "false" },
      ] },
      { key: "spacecraft", type: "group", children: [
        { key: "battery_state_percent", type: "number", value: "87" },
        { key: "propellant_margin_percent", type: "number", value: "13" },
        { key: "navigation", type: "group", children: [
          { key: "primary_camera", type: "text", value: "healthy" },
          { key: "radar_altimeter", type: "text", value: "intermittent dropouts below 600 metres" },
          { key: "inertial_unit", type: "text", value: "healthy" },
        ] },
        { key: "abort_to_orbit_supported", type: "boolean", value: "true" },
      ] },
      { key: "landing_policy", type: "group", children: [
        { key: "maximum_slope_degrees", type: "number", value: "12" },
        { key: "minimum_illumination_hours", type: "number", value: "160" },
        { key: "minimum_communication_score", type: "number", value: "0.75" },
        { key: "hard_blockers", type: "json", value: '["slope above limit", "navigation uncertainty above 100 m", "propellant margin below 8%", "no abort path"]' },
      ] },
      { key: "candidate_sites", type: "json", value: '[{"id":"ridge_alpha","slope_deg":8,"illumination_hours":184,"communication_score":0.82,"navigation_uncertainty_m":74,"science_value":"high","boulder_density":"medium"},{"id":"crater_beta","slope_deg":5,"illumination_hours":142,"communication_score":0.91,"navigation_uncertainty_m":48,"science_value":"very high","boulder_density":"low"},{"id":"plain_gamma","slope_deg":11,"illumination_hours":201,"communication_score":0.71,"navigation_uncertainty_m":62,"science_value":"medium","boulder_density":"low"}]' },
      { key: "decision_priority", type: "json", value: '["safety policy", "mission survival", "minimum science duration", "science value"]' },
    ],
    state: JSON.stringify({ phase: "landing site selection", time_to_commit_minutes: 17, orbital_passes_remaining: 2, latest_telemetry: { thermal: "nominal", communications: "stable", radar_dropout_rate_percent: 7 }, flight_team_note: "Radar dropouts are understood and the inertial fallback was verified in simulation, but no live descent test exists." }, null, 2),
    questions: [
      { type: "choice", name: "landing_action", instructions: "What should the autonomous mission do now?", context: "Apply the landing policy and decision priority in order. A site that violates a hard constraint is not eligible.", criteria: [["land_ridge_alpha", "Commit to ridge_alpha"], ["land_crater_beta", "Commit to crater_beta"], ["land_plain_gamma", "Commit to plain_gamma"], ["wait_one_orbit", "Use one more orbit to collect data"], ["abort_to_orbit", "Stop descent planning and remain in orbit"]] },
      { type: "score", name: "mission_risk", instructions: "What is the remaining mission risk if the recommended action is taken?", criteria: ["Very low", "Low", "Moderate", "High", "Extreme"] },
      { type: "noul", name: "policy_compliant", instructions: "Does the recommended action comply with every hard mission constraint?", criteria: ["All hard constraints are satisfied", "At least one hard constraint is violated"] },
    ],
  },
};

const challengeNotes = {
  tone: "A quick language test: identify the tone of a colleague’s message and whether it contains a request. Use only the wording shown.",
  astronomy: "Assess a repeating brightness dip and distinguish a possible planet transit from stellar variation or instrument error. Judge how much one observation can prove.",
  support: "Route a payment-support request, rate its urgency, and identify frustration by applying the shared service rules as well as the customer’s message.",
  purchase: "Decide whether a used mini PC fits a 24/7 homelab and a €300 budget. Keep suitability separate from value for money.",
  news: "Classify an AI model announcement for a reader interested in local, open-source AI, while treating benchmark claims as something to verify.",
  release: "Review a software release using nested product, quality, and operations context. Apply hard blockers before considering a staged rollout.",
  research: "Evaluate whether deep-water warming is real or sensor drift. Compare independent measurements and quality rules before supporting a published claim.",
  space: "Choose an action for an autonomous lunar lander with uncertain radar data. Apply hard safety constraints before science value.",
  incident: "Triage suspicious homelab login activity without assuming a breach. Distinguish attempted access from confirmed compromise and select a proportionate response.",
  devsecops: "Review a public web-service release gate using security findings, ownership, evidence, and rollout controls before deciding whether to ship.",
};

function contextValueField(type, value = "") {
  if (type === "group") {
    const children = Array.isArray(value) ? value : [];
    return `<div class="nested-context">
      <div class="context-children">${children.map(contextFactRow).join("")}</div>
      <button type="button" class="add-context-child">+ Add item inside this group</button>
    </div>`;
  }
  if (type === "text" || type === "json") {
    const placeholder = type === "json"
      ? 'Enter a JSON list or object, for example:\n["rule one", "rule two"]'
      : "Enter the full text, policy, history, or explanation";
    return `<textarea class="context-value expanded" rows="${type === "json" ? 5 : 3}" placeholder="${escapeHtml(placeholder)}" aria-label="Context value">${escapeHtml(value)}</textarea>`;
  }
  return `<input class="context-value" value="${escapeHtml(value)}" placeholder="${type === "boolean" ? "yes or no" : "Value"}" aria-label="Context value" />`;
}

function contextFactRow(fact = {}) {
  const type = fact.type || "text";
  return `
    <div class="context-fact-row" data-context-type="${type}">
      <div class="context-fact-meta">
        <input class="context-key" value="${escapeHtml(fact.key || "")}" placeholder="Name, e.g. customer_tier" aria-label="Context name" />
        <select class="context-type" aria-label="Context data type">
          <option value="text" ${type === "text" ? "selected" : ""}>Text</option>
          <option value="number" ${type === "number" ? "selected" : ""}>Number</option>
          <option value="boolean" ${type === "boolean" ? "selected" : ""}>Yes / No</option>
          <option value="json" ${type === "json" ? "selected" : ""}>List or object</option>
          <option value="group" ${type === "group" ? "selected" : ""}>Group</option>
        </select>
        <button type="button" class="remove-context" title="Remove context" aria-label="Remove context">×</button>
      </div>
      ${contextValueField(type, type === "group" ? fact.children : (fact.value || ""))}
    </div>`;
}

function contextRowSnapshot(row) {
  const type = row.querySelector(":scope > .context-fact-meta .context-type").value;
  const fact = {
    key: row.querySelector(":scope > .context-fact-meta .context-key").value,
    type,
  };
  if (type === "group") {
    const children = row.querySelector(":scope > .nested-context > .context-children");
    fact.children = [...children.children].map(contextRowSnapshot);
  } else {
    fact.value = row.querySelector(":scope > .context-value").value;
  }
  return fact;
}

function editorDraftSnapshot() {
  const questions = [...$("#questionList").querySelectorAll(".question-card")].map((card) => {
    const type = card.dataset.questionType;
    const question = {
      type,
      name: card.querySelector(".question-name").value,
      instructions: card.querySelector(".question-instructions").value,
      context: card.querySelector(".question-context textarea").value,
    };
    if (type === "choice") {
      question.criteria = [...card.querySelectorAll(".criterion-row")].map((row) => [
        row.querySelector(".criterion-key").value,
        row.querySelector(".criterion-description").value,
      ]);
    } else if (type === "score") {
      question.criteria = [...card.querySelectorAll(".level-description")].map((input) => input.value);
    } else {
      question.criteria = [card.querySelector(".noul-true").value, card.querySelector(".noul-false").value];
    }
    return question;
  });
  return {
    model: $("#jevModel").value,
    format: $("#stateFormat").value,
    memo: $("#challengeMemo").value,
    state: $("#challengeState").value,
    contextFacts: [...$("#contextFacts").children].map(contextRowSnapshot),
    questions,
  };
}

function setActiveDraft(id = null) {
  activeDraftId = id;
  $("#saveDraft span").textContent = id ? "Update draft" : "Save draft";
  $("#saveDraft small").textContent = id ? "Save your latest changes" : "Complete or incomplete";
}

function restoreEditorDraft(draft, id) {
  questionSequence = 0;
  $("#jevModel").value = draft.model || "jev-latest";
  $("#stateFormat").value = draft.format === "json" ? "json" : "text";
  $("#challengeMemo").value = typeof draft.memo === "string" ? draft.memo : "";
  $("#challengeState").value = typeof draft.state === "string" ? draft.state : "";
  $("#contextFacts").innerHTML = (Array.isArray(draft.contextFacts) ? draft.contextFacts : []).map(contextFactRow).join("");
  $("#questionList").innerHTML = (Array.isArray(draft.questions) ? draft.questions : []).map(questionCard).join("");
  setActiveDraft(id);
  updateStateHint();
  updateRequestPreview();
}

function parseContextFact(row) {
  const key = row.querySelector(":scope > .context-fact-meta .context-key").value.trim();
  const type = row.querySelector(":scope > .context-fact-meta .context-type").value;
  if (type === "group") {
    const value = {};
    const childContainer = row.querySelector(":scope > .nested-context > .context-children");
    if (!key && !childContainer.children.length) return null;
    if (!key) throw new Error("Every context group needs a name");
    [...childContainer.children].forEach((child) => {
      const parsed = parseContextFact(child);
      if (!parsed) return;
      if (Object.hasOwn(value, parsed[0])) throw new Error(`Context name “${parsed[0]}” is used twice inside “${key}”`);
      value[parsed[0]] = parsed[1];
    });
    if (!Object.keys(value).length) throw new Error(`Group “${key}” needs at least one item`);
    return [key, value];
  }
  const raw = row.querySelector(":scope > .context-value").value.trim();
  if (!key && !raw) return null;
  if (!key) throw new Error("Every structured context item needs a name");
  if (!raw) throw new Error(`Context “${key}” needs a value`);
  if (type === "number") {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`Context “${key}” must be a valid number`);
    return [key, value];
  }
  if (type === "boolean") {
    const normalized = raw.toLowerCase();
    if (!["true", "false", "yes", "no"].includes(normalized)) throw new Error(`Context “${key}” must be yes, no, true, or false`);
    return [key, normalized === "true" || normalized === "yes"];
  }
  if (type === "json") {
    let value;
    try { value = JSON.parse(raw); } catch { throw new Error(`Context “${key}” must contain valid JSON`); }
    if (value === null || typeof value !== "object") throw new Error(`Context “${key}” must be a JSON list or object`);
    return [key, value];
  }
  return [key, raw];
}

function contextFactsFromObject(context) {
  if (!context || Array.isArray(context) || typeof context !== "object") {
    throw new Error("state.context must be a JSON object to use the context menus");
  }
  return Object.entries(context).map(([key, value]) => {
    if (typeof value === "string") return { key, type: "text", value };
    if (typeof value === "number" && Number.isFinite(value)) return { key, type: "number", value: String(value) };
    if (typeof value === "boolean") return { key, type: "boolean", value: String(value) };
    if (value === null) throw new Error(`Context “${key}” is null, which the current menus cannot preserve`);
    if (Array.isArray(value) || (typeof value === "object" && !Object.keys(value).length)) {
      return { key, type: "json", value: JSON.stringify(value, null, 2) };
    }
    if (typeof value === "object") return { key, type: "group", children: contextFactsFromObject(value) };
    throw new Error(`Context “${key}” has a value that cannot be represented in the menus`);
  });
}

function questionFromJson(name, question) {
  if (!question || Array.isArray(question) || typeof question !== "object") {
    throw new Error(`Question “${name}” must be an object`);
  }
  const type = question.type;
  if (!["choice", "score", "noul"].includes(type)) {
    throw new Error(`Question “${name}” has unsupported type “${type || "missing"}”`);
  }
  const converted = { name, type, instructions: "", context: "" };
  if (typeof question.instructions === "string") {
    converted.instructions = question.instructions;
  } else if (question.instructions != null) {
    const instructions = question.instructions;
    const isMenuInstructions = !Array.isArray(instructions) && typeof instructions === "object";
    const keys = isMenuInstructions ? Object.keys(instructions) : [];
    if (isMenuInstructions && keys.every((key) => ["task", "context"].includes(key))) {
      if (instructions.task != null && typeof instructions.task !== "string") throw new Error(`Question “${name}” instructions.task must be text`);
      if (instructions.context != null && typeof instructions.context !== "string") throw new Error(`Question “${name}” instructions.context must be text`);
      converted.instructions = instructions.task || "";
      converted.context = instructions.context || "";
    } else {
      throw new Error(`Question “${name}” uses custom JSON instructions that the current menus cannot preserve`);
    }
  }
  if (type === "choice") {
    if (!question.criteria || Array.isArray(question.criteria) || typeof question.criteria !== "object") {
      throw new Error(`Choice “${name}” needs criteria as an object of options`);
    }
    converted.criteria = Object.entries(question.criteria).map(([key, description]) => {
      if (description != null && typeof description !== "string") throw new Error(`Choice “${name}” option “${key}” must have a text description`);
      return [key, description || ""];
    });
    if (!converted.criteria.length) throw new Error(`Choice “${name}” needs at least one option`);
  } else if (type === "score") {
    if (!Array.isArray(question.criteria) || !question.criteria.length) throw new Error(`Score “${name}” needs criteria as a list of levels`);
    if (question.criteria.some((level) => typeof level !== "string")) throw new Error(`Score “${name}” levels must be text`);
    converted.criteria = [...question.criteria];
  } else if (question.criteria != null) {
    const criteria = question.criteria;
    if (Array.isArray(criteria) || typeof criteria !== "object") throw new Error(`Yes / No question “${name}” criteria must be an object`);
    if (criteria.true != null && typeof criteria.true !== "string") throw new Error(`Yes / No question “${name}” true criterion must be text`);
    if (criteria.false != null && typeof criteria.false !== "string") throw new Error(`Yes / No question “${name}” false criterion must be text`);
    converted.criteria = [criteria.true || "", criteria.false || ""];
  }
  return converted;
}

function importChallengePayload(payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") throw new Error("The request must be a JSON object");

  const hasQuestions = Object.hasOwn(payload, "questions");
  const looksLikeRequest = Object.hasOwn(payload, "state") || Object.hasOwn(payload, "model") || hasQuestions;
  if (!hasQuestions && !looksLikeRequest) {
    const contextFacts = contextFactsFromObject(payload);
    if (!contextFacts.length) throw new Error("The shared context object is empty");
    $("#contextFacts").innerHTML = contextFacts.map(contextFactRow).join("");
    $("#challengeMemo").value = "";
    updateRequestPreview();
    return "context";
  }
  if (!hasQuestions) {
    let content = payload.state;
    let contextFacts = [];
    if (payload.state && !Array.isArray(payload.state) && typeof payload.state === "object"
        && Object.hasOwn(payload.state, "context") && Object.hasOwn(payload.state, "content")) {
      contextFacts = contextFactsFromObject(payload.state.context);
      content = payload.state.content;
    }
    const format = typeof content === "string" ? "text" : "json";
    if (format === "json" && (content === null || typeof content !== "object")) throw new Error("state must be text, an object, or a list");
    if (typeof payload.model === "string" && payload.model.trim()) $("#jevModel").value = payload.model;
    $("#challengeMemo").value = typeof payload.memo === "string" ? payload.memo : "";
    $("#stateFormat").value = format;
    $("#contextFacts").innerHTML = contextFacts.map(contextFactRow).join("");
    $("#challengeState").value = format === "text" ? content : JSON.stringify(content, null, 2);
    updateStateHint();
    updateRequestPreview();
    return "state";
  }
  if (!payload.questions || Array.isArray(payload.questions) || typeof payload.questions !== "object") {
    throw new Error("questions must be a JSON object whose names identify the answers");
  }
  const questions = Object.entries(payload.questions).map(([name, question]) => questionFromJson(name, question));
  if (!questions.length) throw new Error("Add at least one question to the JSON request");

  let content = payload.state;
  let contextFacts = [];
  if (payload.state && !Array.isArray(payload.state) && typeof payload.state === "object"
      && Object.hasOwn(payload.state, "context") && Object.hasOwn(payload.state, "content")) {
    contextFacts = contextFactsFromObject(payload.state.context);
    content = payload.state.content;
  }
  const format = typeof content === "string" ? "text" : "json";
  if (format === "json" && (content === null || typeof content !== "object")) {
    throw new Error("state must be text, an object, or a list");
  }

  $("#jevModel").value = typeof payload.model === "string" && payload.model.trim() ? payload.model : "jev-latest";
  $("#challengeMemo").value = typeof payload.memo === "string" ? payload.memo : "";
  $("#stateFormat").value = format;
  $("#contextFacts").innerHTML = contextFacts.map(contextFactRow).join("");
  $("#challengeState").value = format === "text" ? content : JSON.stringify(content, null, 2);
  $("#questionList").innerHTML = questions.map(questionCard).join("");
  updateStateHint();
  updateRequestPreview();
  return "request";
}

function criterionRow(type, key = "", description = "", index = 0) {
  if (type === "choice") return `
    <div class="criterion-row">
      <input class="criterion-key" value="${escapeHtml(key)}" placeholder="Option name" aria-label="Option name" />
      <input class="criterion-description" value="${escapeHtml(description)}" placeholder="When should Jev choose it?" aria-label="Option description" />
      <button type="button" class="remove-row" title="Remove option" aria-label="Remove option">×</button>
    </div>`;
  return `
    <div class="criterion-row score-row">
      <span class="level-index">${index}</span>
      <input class="level-description" value="${escapeHtml(description)}" placeholder="Describe this level" aria-label="Score level ${index}" />
      <button type="button" class="remove-row" title="Remove level" aria-label="Remove level">×</button>
    </div>`;
}

function questionCard(question = { type: "choice" }) {
  const id = ++questionSequence;
  const type = question.type || "choice";
  const labels = { choice: "Choice", score: "Score", noul: "Yes / No" };
  let criteria = "";
  if (type === "choice") {
    const rows = question.criteria || [["option_a", "Describe when this option applies"], ["option_b", "Describe when this option applies"]];
    criteria = `<div class="criteria-list">${rows.map((row) => criterionRow("choice", row[0], row[1])).join("")}</div><button type="button" class="add-row">+ Add option</button>`;
  } else if (type === "score") {
    const rows = question.criteria || ["Low", "Medium", "High"];
    criteria = `<div class="criteria-list">${rows.map((value, index) => criterionRow("score", "", value, index)).join("")}</div><button type="button" class="add-row">+ Add level</button>`;
  } else {
    const yes = question.criteria?.[0] || "";
    const no = question.criteria?.[1] || "";
    criteria = `<div class="noul-definitions"><label>What counts as yes?<input class="noul-true" value="${escapeHtml(yes)}" placeholder="Optional definition of true" /></label><label>What counts as no?<input class="noul-false" value="${escapeHtml(no)}" placeholder="Optional definition of false" /></label></div>`;
  }
  return `
    <article class="question-card" data-question-id="${id}" data-question-type="${type}">
      <div class="question-topline"><span class="question-type ${type}">${labels[type]}</span><button type="button" class="remove-question">Remove</button></div>
      <div class="question-fields">
        <label>Answer name<input class="question-name" value="${escapeHtml(question.name || `${type}_${id}`)}" placeholder="Example: urgency" required /></label>
        <label>What should Jev decide?<input class="question-instructions" value="${escapeHtml(question.instructions || "")}" placeholder="Write a clear question or statement" /></label>
      </div>
      <label class="question-context">Context for this decision <span>optional</span><textarea rows="2" placeholder="Rules or facts only this question should use">${escapeHtml(question.context || "")}</textarea></label>
      <div class="criteria-block"><span>${type === "choice" ? "Options" : type === "score" ? "Ordered levels (lowest to highest)" : "Optional definitions"}</span>${criteria}</div>
    </article>`;
}

function renumberScoreLevels(card) {
  card.querySelectorAll(".level-index").forEach((label, index) => { label.textContent = index; });
}

function buildChallengePayload() {
  const rawState = $("#challengeState").value.trim();
  const structuredContext = {};
  [...$("#contextFacts").children].forEach((row) => {
    const parsed = parseContextFact(row);
    if (!parsed) return;
    if (Object.hasOwn(structuredContext, parsed[0])) throw new Error(`Context name “${parsed[0]}” is used twice`);
    structuredContext[parsed[0]] = parsed[1];
  });
  let content = rawState;
  if ($("#stateFormat").value === "json") {
    content = JSON.parse(rawState || "null");
    if (!content || (!["object"].includes(typeof content))) throw new Error("JSON state must be an object or list");
  }
  const context = structuredContext;
  const hasContext = Object.keys(context).length;
  const challengeState = hasContext
    ? { context, content }
    : content;
  const questions = {};
  const usedNames = new Set();
  $$(".question-card").forEach((card) => {
    const name = card.querySelector(".question-name").value.trim();
    const type = card.dataset.questionType;
    if (!name) throw new Error("Every decision needs an answer name");
    if (usedNames.has(name)) throw new Error(`Answer name “${name}” is used twice`);
    usedNames.add(name);
    const value = { type };
    const instructions = card.querySelector(".question-instructions").value.trim();
    const questionContext = card.querySelector(".question-context textarea").value.trim();
    if (questionContext) value.instructions = { task: instructions || "Evaluate this decision.", context: questionContext };
    else if (instructions) value.instructions = instructions;
    if (type === "choice") {
      value.criteria = {};
      card.querySelectorAll(".criterion-row").forEach((row) => {
        const key = row.querySelector(".criterion-key").value.trim();
        const description = row.querySelector(".criterion-description").value.trim();
        if (key) value.criteria[key] = description || null;
      });
      if (!Object.keys(value.criteria).length) throw new Error(`Choice “${name}” needs an option`);
    } else if (type === "score") {
      value.criteria = [...card.querySelectorAll(".level-description")].map((input) => input.value.trim()).filter(Boolean);
      if (!value.criteria.length) throw new Error(`Score “${name}” needs a level`);
    } else {
      const yes = card.querySelector(".noul-true").value.trim();
      const no = card.querySelector(".noul-false").value.trim();
      if (yes || no) value.criteria = { true: yes || null, false: no || null };
    }
    questions[name] = value;
  });
  if (!Object.keys(questions).length) throw new Error("Add at least one decision");
  return { model: $("#jevModel").value.trim() || "jev-latest", state: challengeState, questions };
}

function updateRequestPreview() {
  try {
    const payload = buildChallengePayload();
    $("#requestPreview").textContent = JSON.stringify(payload, null, 2);
    $("#requestPreview").classList.remove("has-error");
  } catch (error) {
    $("#requestPreview").textContent = `Complete the form to build valid JSON.\n\n${error.message}`;
    $("#requestPreview").classList.add("has-error");
  }
}

function loadChallengeExample(name) {
  const example = challengeExamples[name];
  setActiveDraft(null);
  $$('[data-example]').forEach((button) => {
    const selected = button.dataset.example === name;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  $("#stateFormat").value = example.format;
  $("#challengeMemo").value = challengeNotes[name] || "";
  $("#contextFacts").innerHTML = (example.contextFacts || []).map(contextFactRow).join("");
  $("#challengeState").value = example.state;
  $("#questionList").innerHTML = example.questions.map(questionCard).join("");
  updateStateHint();
  updateRequestPreview();
}

function clearChallenge() {
  questionSequence = 0;
  setActiveDraft(null);
  $$('[data-example]').forEach((button) => {
    button.classList.remove("selected");
    button.setAttribute("aria-pressed", "false");
  });
  $("#jevModel").value = "jev-latest";
  $("#stateFormat").value = "text";
  $("#challengeMemo").value = "";
  $("#contextFacts").innerHTML = "";
  $("#challengeState").value = "";
  $("#questionList").innerHTML = "";
  $("#jsonRequestInput").value = "";
  $("#jsonImportPanel").open = false;
  const importMessage = $("#jsonImportMessage");
  importMessage.textContent = "Your API key remains on the server.";
  importMessage.classList.remove("success", "error");
  $("#challengeResults").innerHTML = `<div class="results-placeholder">
    <span class="result-orb">J</span>
    <h2>Your answer will appear here</h2>
    <p>Jev returns typed decisions and probabilities. The lab translates them into plain language.</p>
  </div>`;
  updateStateHint();
  $("#jsonImportCard").scrollIntoView({ behavior: "smooth", block: "start" });
  showToast("Blank request ready");
}

function updateStateHint() {
  const isJson = $("#stateFormat").value === "json";
  $("#stateHint").textContent = isJson
    ? "Use valid JSON. Objects and lists let you give Jev structured facts."
    : "Write any message, situation, or content that Jev should judge.";
  $("#challengeState").placeholder = isJson ? '{\n  "message": "Your content",\n  "context": "Useful facts"\n}' : "Describe the situation Jev should evaluate.";
  updateRequestPreview();
}

function probabilityRows(details, answer) {
  return details.map(([key, probability]) => {
    let label = String(key).replaceAll("_", " ");
    if (answer?.type === "score" && answer.legend?.[String(key)] !== undefined) label = `${key} · ${answer.legend[String(key)]}`;
    const percent = Math.max(0, Math.min(100, Number(probability) * 100));
    return `<div class="probability-row"><div><span>${escapeHtml(label)}</span><b>${percent.toFixed(0)}%</b></div><i><span style="width:${percent}%"></span></i></div>`;
  }).join("");
}

function renderChallengeResult(result) {
  const answers = result.response.answers || {};
  const usage = result.response.usage || {};
  $("#challengeResults").innerHTML = `
    <div class="result-summary">
      <p class="eyebrow">JEV ANSWER</p>
      <h2>${result.interpretation.length} decision${result.interpretation.length === 1 ? "" : "s"} completed</h2>
      <p>Answered by <b>${escapeHtml(result.response.model)}</b> using ${Number(usage.input_tokens || 0).toLocaleString()} input tokens.</p>
    </div>
    <div class="answer-list">${result.interpretation.map((item) => `
      <article class="answer-card">
        <div class="answer-heading"><span class="question-type ${item.type}">${item.type === "noul" ? "Yes / No" : item.type}</span><h3>${escapeHtml(item.name.replaceAll("_", " "))}</h3></div>
        <p>${escapeHtml(item.text)}</p>
        <div class="probability-list">${probabilityRows(item.details, answers[item.name])}</div>
      </article>`).join("")}</div>
    <details class="raw-response"><summary>See Jev’s raw JSON reply</summary><pre>${escapeHtml(JSON.stringify(result.response, null, 2))}</pre></details>`;
}

function formatHistoryDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function historyCard(item) {
  return `<article class="history-card" data-saved-kind="history" data-saved-id="${item.id}" data-saved-title="${escapeHtml(item.title)}">
    <div class="history-card-main">
      <h3>${escapeHtml(item.title)}</h3>
      ${item.memo ? `<p class="saved-memo">${escapeHtml(item.memo)}</p>` : ""}
      <div class="history-meta"><span>${escapeHtml(formatHistoryDate(item.created_at))}</span><span>${escapeHtml(item.model)}</span><span>${item.question_count} decision${item.question_count === 1 ? "" : "s"}</span></div>
    </div>
    <div class="history-card-actions">
      <button type="button" class="open-history">Open & reuse</button>
      <button type="button" class="rename-history">Rename</button>
      <button type="button" class="delete-history">Delete</button>
    </div>
  </article>`;
}

function draftCard(item) {
  return `<article class="history-card" data-saved-kind="draft" data-saved-id="${item.id}" data-saved-title="${escapeHtml(item.title)}">
    <div class="history-card-main">
      <span class="draft-status ${item.is_complete ? "complete" : "incomplete"}">${item.is_complete ? "Complete request" : "Incomplete draft"}</span>
      <h3>${escapeHtml(item.title)}</h3>
      ${item.memo ? `<p class="saved-memo">${escapeHtml(item.memo)}</p>` : ""}
      <div class="history-meta"><span>Updated ${escapeHtml(formatHistoryDate(item.updated_at))}</span></div>
    </div>
    <div class="history-card-actions">
      <button type="button" class="open-history">Continue editing</button>
      <button type="button" class="rename-history">Rename</button>
      <button type="button" class="delete-history">Delete</button>
    </div>
  </article>`;
}

async function loadHistory(showList = true) {
  try {
    const [history, drafts] = await Promise.all([api("/api/history"), api("/api/drafts")]);
    $("#historyCount").textContent = history.total;
    $("#historyTabCount").textContent = history.total;
    $("#draftCount").textContent = drafts.total;
    if (showList) {
      const showingDrafts = savedView === "drafts";
      const selected = showingDrafts ? drafts : history;
      $("#historySummary").textContent = showingDrafts
        ? `${selected.total} saved draft${selected.total === 1 ? "" : "s"}`
        : `${selected.total} executed challenge${selected.total === 1 ? "" : "s"}`;
      $("#historyList").innerHTML = selected.items.length
        ? selected.items.map(showingDrafts ? draftCard : historyCard).join("")
        : showingDrafts
          ? '<div class="history-empty"><div><b>No drafts yet</b><p>Use Save draft below the editor to keep a complete or unfinished request.</p></div></div>'
          : '<div class="history-empty"><div><b>No history yet</b><p>Every successful Jev challenge will appear here automatically.</p></div></div>';
    }
  } catch (error) {
    if (showList) $("#historyList").innerHTML = `<div class="history-empty"><div><b>Saved work unavailable</b><p>${escapeHtml(error.message)}</p></div></div>`;
  }
}

function setHistoryDrawer(open) {
  $("#historyDrawer").hidden = !open;
  $("#historyOverlay").hidden = !open;
  $("#historyToggle").setAttribute("aria-expanded", String(open));
  document.body.style.overflow = open ? "hidden" : "";
  if (open) loadHistory(true);
}

async function openSavedChallenge(id) {
  const saved = await api(`/api/history/${id}`);
  importChallengePayload(saved.request);
  $("#challengeMemo").value = typeof saved.memo === "string" ? saved.memo : "";
  setActiveDraft(null);
  renderChallengeResult(saved);
  $$('[data-example]').forEach((button) => {
    button.classList.remove("selected");
    button.setAttribute("aria-pressed", "false");
  });
  setHistoryDrawer(false);
  $("#situationCard").scrollIntoView({ behavior: "smooth", block: "start" });
  showToast("Saved challenge restored");
}

async function openSavedDraft(id) {
  const saved = await api(`/api/drafts/${id}`);
  restoreEditorDraft(saved.draft, saved.id);
  $$('[data-example]').forEach((button) => {
    button.classList.remove("selected");
    button.setAttribute("aria-pressed", "false");
  });
  $("#challengeResults").innerHTML = `<div class="results-placeholder">
    <span class="result-orb">J</span>
    <h2>Draft ready to continue</h2>
    <p>Complete or change the request, save it again, or ask Jev when it is ready.</p>
  </div>`;
  setHistoryDrawer(false);
  $("#situationCard").scrollIntoView({ behavior: "smooth", block: "start" });
  showToast("Draft restored");
}

$$('[data-add-type]').forEach((button) => button.addEventListener("click", () => {
  $("#questionList").insertAdjacentHTML("beforeend", questionCard({ type: button.dataset.addType }));
  updateRequestPreview();
}));

$$('[data-example]').forEach((button) => button.addEventListener("click", () => loadChallengeExample(button.dataset.example)));
$("#clearRequest").addEventListener("click", clearChallenge);
$("#historyToggle").addEventListener("click", () => setHistoryDrawer(true));
$("#closeHistory").addEventListener("click", () => setHistoryDrawer(false));
$("#historyOverlay").addEventListener("click", () => setHistoryDrawer(false));
$("#refreshHistory").addEventListener("click", () => loadHistory(true));
$$('[data-saved-view]').forEach((button) => button.addEventListener("click", () => {
  savedView = button.dataset.savedView;
  $$('[data-saved-view]').forEach((tab) => {
    const selected = tab === button;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  loadHistory(true);
}));
$("#historyList").addEventListener("click", async (event) => {
  const card = event.target.closest(".history-card");
  if (!card) return;
  const id = Number(card.dataset.savedId);
  const isDraft = card.dataset.savedKind === "draft";
  const endpoint = isDraft ? `/api/drafts/${id}` : `/api/history/${id}`;
  try {
    if (event.target.closest(".open-history")) {
      if (isDraft) await openSavedDraft(id);
      else await openSavedChallenge(id);
    }
    if (event.target.closest(".rename-history")) {
      const title = window.prompt(`Name this saved ${isDraft ? "draft" : "challenge"}`, card.dataset.savedTitle);
      if (title === null) return;
      const cleanTitle = title.trim();
      if (!cleanTitle) throw new Error(`Enter a name for this ${isDraft ? "draft" : "challenge"}.`);
      await api(endpoint, { method: "PATCH", body: JSON.stringify({ title: cleanTitle }) });
      await loadHistory(true);
      showToast(isDraft ? "Draft renamed" : "Challenge renamed");
    }
    if (event.target.closest(".delete-history")) {
      if (!window.confirm(`Delete “${card.dataset.savedTitle}”?`)) return;
      await api(endpoint, { method: "DELETE" });
      if (isDraft && activeDraftId === id) setActiveDraft(null);
      await loadHistory(true);
      showToast(isDraft ? "Draft deleted" : "Challenge deleted");
    }
  } catch (error) {
    showToast(error.message);
  }
});
$("#importJsonRequest").addEventListener("click", () => {
  const message = $("#jsonImportMessage");
  try {
    const raw = $("#jsonRequestInput").value.trim();
    if (!raw) throw new Error("Paste a Jev JSON request first");
    const imported = importChallengePayload(JSON.parse(raw));
    setActiveDraft(null);
    message.textContent = imported === "context"
      ? "Shared context imported. Your existing situation and questions were kept."
      : imported === "state"
        ? "State imported. Your existing questions were kept."
        : "Complete request converted. Review the menus below, then ask Jev.";
    message.classList.remove("error");
    message.classList.add("success");
    $("#jsonImportPanel").open = false;
    $("#situationCard").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("JSON converted to visual menus");
  } catch (error) {
    message.textContent = error instanceof SyntaxError ? `Invalid JSON: ${error.message}` : error.message;
    message.classList.remove("success");
    message.classList.add("error");
  }
});
$("#addContextFact").addEventListener("click", () => {
  $("#contextFacts").insertAdjacentHTML("beforeend", contextFactRow());
  updateRequestPreview();
});
$("#contextFacts").addEventListener("click", (event) => {
  if (event.target.closest(".add-context-child")) {
    const nested = event.target.closest(".nested-context").querySelector(":scope > .context-children");
    nested.insertAdjacentHTML("beforeend", contextFactRow());
  }
  if (event.target.closest(".remove-context")) event.target.closest(".context-fact-row").remove();
  updateRequestPreview();
});
$("#contextFacts").addEventListener("change", updateRequestPreview);
$("#contextFacts").addEventListener("change", (event) => {
  if (!event.target.matches(".context-type")) return;
  const row = event.target.closest(".context-fact-row");
  const previousInput = row.querySelector(":scope > .context-value");
  const previousValue = previousInput ? previousInput.value : "";
  row.dataset.contextType = event.target.value;
  const oldValue = row.querySelector(":scope > .context-value, :scope > .nested-context");
  oldValue.outerHTML = contextValueField(event.target.value, previousValue);
  updateRequestPreview();
});
$("#stateFormat").addEventListener("change", updateStateHint);
$("#challengeForm").addEventListener("input", updateRequestPreview);
$("#questionList").addEventListener("click", (event) => {
  const card = event.target.closest(".question-card");
  if (!card) return;
  if (event.target.closest(".remove-question")) card.remove();
  if (event.target.closest(".remove-row")) event.target.closest(".criterion-row").remove();
  if (event.target.closest(".add-row")) {
    const list = card.querySelector(".criteria-list");
    const type = card.dataset.questionType;
    list.insertAdjacentHTML("beforeend", criterionRow(type, "", "", list.children.length));
  }
  renumberScoreLevels(card);
  updateRequestPreview();
});

$("#challengeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#runJev");
  try {
    const payload = buildChallengePayload();
    button.disabled = true;
    button.querySelector("span").textContent = "Jev is deciding…";
    $("#challengeResults").innerHTML = '<div class="results-placeholder"><span class="result-orb thinking">J</span><h2>Evaluating every decision</h2><p>All questions share the same situation and are submitted together.</p></div>';
    const result = await api("/api/jev/challenge", {
      method: "POST", body: JSON.stringify({ ...payload, memo: $("#challengeMemo").value.trim() })
    });
    renderChallengeResult(result);
    loadHistory(false);
  } catch (error) {
    $("#challengeResults").innerHTML = `<div class="results-placeholder error-result"><span class="result-orb">!</span><h2>Jev could not answer</h2><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = "Ask Jev";
  }
});

async function saveCurrentDraft() {
  const button = $("#saveDraft");
  let isComplete = false;
  try {
    buildChallengePayload();
    isComplete = true;
  } catch (_) {
    // A draft deliberately preserves work that is not ready to send yet.
  }

  button.disabled = true;
  button.querySelector("span").textContent = "Saving…";
  try {
    const draft = editorDraftSnapshot();
    const saved = activeDraftId
      ? await api(`/api/drafts/${activeDraftId}`, {
        method: "PATCH",
        body: JSON.stringify({ draft, is_complete: isComplete }),
      })
      : await api("/api/drafts", {
        method: "POST",
        body: JSON.stringify({ draft, is_complete: isComplete }),
      });
    setActiveDraft(saved.id);
    await loadHistory(false);
    showToast(isComplete ? "Complete request saved" : "Draft saved");
  } catch (error) {
    showToast(error.message);
    setActiveDraft(activeDraftId);
  } finally {
    button.disabled = false;
    if (activeDraftId) setActiveDraft(activeDraftId);
    else setActiveDraft(null);
  }
}

$("#saveDraft").addEventListener("click", saveCurrentDraft);

loadChallengeExample("support");


async function showConnectionStatus() {
  try {
    const health = await api("/api/health");
    const connected = Boolean(health.jev_connected);
    $("#connectionDot").classList.toggle("connected", connected);
    $("#connectionTitle").textContent = connected ? "Jev connected" : "API key needed";
    $("#connectionText").textContent = connected ? "Ready for challenges" : "Add TYPESAFE_API_KEY";
    $("#apiKeyToggle").textContent = "API keys";
  } catch (_) {
    $("#connectionTitle").textContent = "Service unavailable";
    $("#connectionText").textContent = "Check the server";
  }
}

function setApiKeyPanel(open) {
  $("#apiKeyPanel").hidden = !open;
  $("#apiKeyToggle").setAttribute("aria-expanded", String(open));
  if (open) {
    loadApiKeys();
    $("#apiKeyName").focus();
  }
}

async function loadApiKeys() {
  const list = $("#apiKeyList");
  try {
    const data = await api("/api/settings/api-keys");
    list.replaceChildren();
    for (const profile of data.keys) {
      const row = document.createElement("div");
      row.className = `api-key-profile${profile.active ? " active" : ""}`;
      const copy = document.createElement("div");
      copy.className = "api-key-profile-copy";
      const title = document.createElement("strong");
      title.textContent = `${profile.name}${profile.active ? " · ACTIVE" : ""}`;
      const masked = document.createElement("small");
      masked.textContent = profile.masked_key;
      copy.append(title, masked);
      row.append(copy);
      const rename = document.createElement("button");
      rename.type = "button";
      rename.textContent = "Rename";
      let renameInput = null;
      rename.addEventListener("click", async () => {
        if (!renameInput) {
          renameInput = document.createElement("input");
          renameInput.type = "text";
          renameInput.value = profile.name;
          renameInput.maxLength = 80;
          renameInput.setAttribute("aria-label", "New name for " + profile.name);
          renameInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") { event.preventDefault(); rename.click(); }
          });
          copy.replaceChildren(renameInput, masked);
          rename.textContent = "Save";
          renameInput.focus();
          return;
        }
        const name = renameInput.value.trim();
        if (!name) { renameInput.focus(); return; }
        try {
          await api(`/api/settings/api-keys/${encodeURIComponent(profile.id)}`, {
            method: "PATCH", body: JSON.stringify({ name })
          });
          await loadApiKeys();
        } catch (error) { showToast(error.message); }
      });
      row.append(rename);
      if (!profile.active) {
        const select = document.createElement("button");
        select.type = "button";
        select.textContent = "Use";
        select.addEventListener("click", async () => {
          try {
            await api(`/api/settings/api-keys/${encodeURIComponent(profile.id)}/activate`, { method: "PUT" });
            await loadApiKeys();
            await showConnectionStatus();
          } catch (error) { showToast(error.message); }
        });
        row.append(select);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete";
      remove.addEventListener("click", async () => {
        try {
          await api(`/api/settings/api-keys/${encodeURIComponent(profile.id)}`, { method: "DELETE" });
          await loadApiKeys();
          await showConnectionStatus();
        } catch (error) { showToast(error.message); }
      });
      row.append(remove);
      list.append(row);
    }
    if (!data.keys.length) list.textContent = "No saved keys yet.";
  } catch (error) { list.textContent = error.message; }
}

$("#apiKeyToggle").addEventListener("click", () => setApiKeyPanel($("#apiKeyPanel").hidden));
$("#closeApiKey").addEventListener("click", () => setApiKeyPanel(false));
$("#apiKeyPanel").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#apiKeyName").value.trim();
  const key = $("#apiKeyInput").value.trim();
  const message = $("#apiKeyMessage");
  const button = $("#saveApiKey");
  message.classList.remove("success", "error");
  if (!name || key.length < 16 || /\s/.test(key)) {
    message.textContent = "Enter a name and a valid API key without spaces.";
    message.classList.add("error");
    return;
  }
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    await api("/api/settings/api-keys", { method: "POST", body: JSON.stringify({ name, api_key: key }) });
    $("#apiKeyName").value = "";
    $("#apiKeyInput").value = "";
    message.textContent = "Saved and selected for Jev.";
    message.classList.add("success");
    await loadApiKeys();
    await showConnectionStatus();
    showToast("API key saved");
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  } finally {
    button.disabled = false;
    button.textContent = "Save and use";
  }
});

showConnectionStatus();
loadHistory(false);
