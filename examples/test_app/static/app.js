// Vanilla-JS frontend for the simple-steps-core test app. No build step, no
// framework — this is a manual test harness, kept deliberately simple.
//
// Design note on argument fields: every argument is rendered as a plain text
// input (never <input type="number">), because the workflow builder needs to
// let you type EITHER a literal ("5") OR an earlier step's id ("step1") into
// the same field. We apply the engine's own rule — a value matching
// `^step[\w-]*` (optionally followed by `.field` / `[index]`) is sent through
// untouched as a reference; everything else is coerced to the type the tool's
// JSON Schema declares (integer/number/boolean), falling back to a raw
// string. This mirrors how the engine's own reference resolver decides
// "reference vs. literal" (see docs: tokens must start with "step").

const STEP_REF_RE = /^step[\w-]*((\.[\w]+)|(\[[^\]]+\]))*$/i;

const state = {
  tools: [],
  toolsById: {},
  selectedTool: null,
  steps: [],       // { step_id, name, params, argValues: {name: rawString}, orchestration: null | {mode, over, concurrency} }
  stepCounter: 0,
};

const el = (id) => document.getElementById(id);

function isStepRef(value) {
  return typeof value === "string" && STEP_REF_RE.test(value.trim());
}

/** Coerce a raw text-field string into the JSON type its schema declares,
 * unless it looks like a step reference — in which case it is passed through
 * untouched so the engine's resolver can treat it as one. */
function coerceValue(raw, schemaType) {
  const trimmed = raw.trim();
  if (trimmed === "") return trimmed;
  if (isStepRef(trimmed)) return trimmed;
  switch (schemaType) {
    case "integer": {
      const n = parseInt(trimmed, 10);
      return Number.isNaN(n) ? trimmed : n;
    }
    case "number": {
      const n = parseFloat(trimmed);
      return Number.isNaN(n) ? trimmed : n;
    }
    case "boolean":
      return trimmed === "true" || trimmed === "1";
    default:
      return trimmed;
  }
}

async function fetchJSON(url, options) {
  const resp = await fetch(url, options);
  let body = null;
  try {
    body = await resp.json();
  } catch {
    // no body / not JSON
  }
  return { ok: resp.ok, status: resp.status, body };
}

function describeError(result) {
  const detail = result.body && result.body.detail !== undefined
    ? result.body.detail
    : JSON.stringify(result.body);
  return `HTTP ${result.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
}

// ---------------------------------------------------------------------------
// Tool palette
// ---------------------------------------------------------------------------

async function loadTools() {
  const listEl = el("tool-list");
  try {
    const result = await fetchJSON("/api/tools");
    if (!result.ok) {
      listEl.innerHTML = `<li class="muted">Failed to load tools: ${describeError(result)}</li>`;
      return;
    }
    state.tools = result.body;
    state.toolsById = Object.fromEntries(state.tools.map((t) => [t.operation_id, t]));
    renderToolList();
  } catch (err) {
    listEl.innerHTML = `<li class="muted">Failed to load tools: ${err}</li>`;
  }
}

function renderToolList() {
  const listEl = el("tool-list");
  listEl.innerHTML = "";
  state.tools.forEach((tool) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "tool-item" + (state.selectedTool && state.selectedTool.operation_id === tool.operation_id ? " selected" : "");
    btn.innerHTML = `<span class="tool-id">${tool.operation_id}</span><span class="tool-desc">${tool.description || ""}</span>`;
    btn.addEventListener("click", () => selectTool(tool.operation_id));
    li.appendChild(btn);
    listEl.appendChild(li);
  });
}

function selectTool(operationId) {
  state.selectedTool = state.toolsById[operationId];
  renderToolList();
  renderCallForm();
}

// ---------------------------------------------------------------------------
// Call form (shared by "Run now" and "Add to workflow")
// ---------------------------------------------------------------------------

function schemaPropsOf(tool) {
  const schema = tool.input_schema || {};
  return {
    properties: schema.properties || {},
    required: new Set(schema.required || []),
  };
}

function renderCallForm() {
  const tool = state.selectedTool;
  const container = el("call-form-container");
  if (!tool) {
    container.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");
  el("selected-tool-name").textContent = tool.operation_id;
  el("selected-tool-description").textContent = tool.description || "";

  const { properties, required } = schemaPropsOf(tool);
  const form = el("call-form");
  form.innerHTML = "";

  Object.entries(properties).forEach(([name, prop]) => {
    const schemaType = prop.type || "string";
    const isRequired = required.has(name);

    const wrap = document.createElement("div");
    wrap.className = "field";

    const label = document.createElement("label");
    label.setAttribute("for", `arg_${name}`);
    label.innerHTML = `${name}${isRequired ? '<span class="required">*</span>' : ""}`;
    wrap.appendChild(label);

    const input = document.createElement("input");
    input.type = "text";
    input.id = `arg_${name}`;
    input.name = name;
    input.dataset.paramName = name;
    input.dataset.schemaType = schemaType;
    input.placeholder = isRequired ? "required" : "optional";
    wrap.appendChild(input);

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = `type: ${schemaType} — or type an earlier step id (e.g. step1) to reference its output`;
    wrap.appendChild(hint);

    form.appendChild(wrap);
  });

  el("call-result").classList.add("hidden");
}

/** Read the current call-form's fields into {name: coercedValue}. */
function collectFormArguments() {
  const form = el("call-form");
  const args = {};
  form.querySelectorAll("input[data-param-name]").forEach((input) => {
    if (input.value.trim() === "") return; // omit empty optional fields
    args[input.dataset.paramName] = coerceValue(input.value, input.dataset.schemaType);
  });
  return args;
}

function showResult(targetEl, result, successValue) {
  targetEl.classList.remove("hidden", "ok", "error");
  if (result.ok) {
    targetEl.classList.add("ok");
    targetEl.textContent = JSON.stringify(successValue !== undefined ? successValue : result.body, null, 2);
  } else {
    targetEl.classList.add("error");
    targetEl.textContent = describeError(result);
  }
}

async function runNow() {
  const tool = state.selectedTool;
  if (!tool) return;
  const resultEl = el("call-result");
  resultEl.classList.remove("hidden", "ok", "error");
  resultEl.textContent = "Running…";

  const payload = { operation_id: tool.operation_id, arguments: collectFormArguments() };
  const result = await fetchJSON("/api/call", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  showResult(resultEl, result, result.ok ? result.body.value : undefined);
}

// ---------------------------------------------------------------------------
// Workflow builder
// ---------------------------------------------------------------------------

function addToWorkflow() {
  const tool = state.selectedTool;
  if (!tool) return;

  state.stepCounter += 1;
  const stepId = `step${state.stepCounter}`;
  const { properties } = schemaPropsOf(tool);

  state.steps.push({
    step_id: stepId,
    name: tool.operation_id,
    properties,
    argValues: collectFormArguments(),
    orchestration: null, // null = single call; otherwise {mode, over, concurrency}
    result: null,
  });
  renderWorkflow();
}

function removeStep(stepId) {
  state.steps = state.steps.filter((s) => s.step_id !== stepId);
  renderWorkflow();
}

function toggleOrchestration(stepId, enabled) {
  const step = state.steps.find((s) => s.step_id === stepId);
  if (!step) return;
  step.orchestration = enabled ? { mode: "map", over: "", concurrency: "" } : null;
  renderWorkflow();
}

function updateOrchestrationField(stepId, field, value) {
  const step = state.steps.find((s) => s.step_id === stepId);
  if (!step || !step.orchestration) return;
  step.orchestration[field] = value;
}

function renderWorkflow() {
  const listEl = el("step-list");
  listEl.innerHTML = "";

  if (state.steps.length === 0) {
    listEl.innerHTML = '<li class="muted">No steps yet. Select a tool on the left and click "Add to workflow".</li>';
    return;
  }

  state.steps.forEach((step) => {
    const li = document.createElement("li");
    li.className = "step-card";

    const argsText = Object.entries(step.argValues)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");

    li.innerHTML = `
      <div class="step-head">
        <span class="step-id">${step.step_id}</span>
        <button type="button" class="danger" data-action="remove">Remove</button>
      </div>
      <div class="step-tool">tool: ${step.name}</div>
      <div class="step-args">${step.orchestration ? "(arguments cleared — item comes from the fan-out)" : (argsText || "(no arguments)")}</div>
      <label class="orch-toggle">
        <input type="checkbox" data-action="toggle-orch" ${step.orchestration ? "checked" : ""}>
        Orchestrate (map / filter / expand / collapse) over an earlier step
      </label>
      ${step.orchestration ? `
        <div class="orch-fields">
          <select data-action="orch-mode">
            ${["map", "filter", "expand", "collapse"].map((m) => `<option value="${m}" ${step.orchestration.mode === m ? "selected" : ""}>${m}</option>`).join("")}
          </select>
          <input type="text" data-action="orch-over" placeholder="over: step id, e.g. step1" value="${step.orchestration.over || ""}">
          <input type="text" data-action="orch-concurrency" placeholder="concurrency (map only, optional)" value="${step.orchestration.concurrency || ""}">
        </div>
      ` : ""}
      <div class="step-result ${step.result ? (step.result.ok ? "ok" : "error") : ""}">${step.result ? step.result.text : ""}</div>
    `;

    li.querySelector('[data-action="remove"]').addEventListener("click", () => removeStep(step.step_id));
    li.querySelector('[data-action="toggle-orch"]').addEventListener("change", (e) => toggleOrchestration(step.step_id, e.target.checked));

    const modeEl = li.querySelector('[data-action="orch-mode"]');
    if (modeEl) modeEl.addEventListener("change", (e) => updateOrchestrationField(step.step_id, "mode", e.target.value));
    const overEl = li.querySelector('[data-action="orch-over"]');
    if (overEl) overEl.addEventListener("input", (e) => updateOrchestrationField(step.step_id, "over", e.target.value));
    const concEl = li.querySelector('[data-action="orch-concurrency"]');
    if (concEl) concEl.addEventListener("input", (e) => updateOrchestrationField(step.step_id, "concurrency", e.target.value));

    listEl.appendChild(li);
  });
}

/** Build the /api/run request body from the current workflow steps. */
function buildRunPayload() {
  const steps = state.steps.map((step) => {
    const spec = { step_id: step.step_id, name: step.name };
    if (step.orchestration) {
      // Orchestrated steps take their item from `over`, not from `arguments` —
      // clearing arguments keeps this simple for single-item-param tools like
      // our demo tools. Shape (mode/over) is separate from conduct
      // (concurrency), per the engine's isolated OrchestrationConfig /
      // StepExecutionConfig split — concurrency must NOT be nested inside
      // "orchestration" or the engine rejects it (extra_forbidden).
      spec.arguments = {};
      spec.orchestration = { mode: step.orchestration.mode, over: step.orchestration.over };
      const conc = parseInt(step.orchestration.concurrency, 10);
      if (!Number.isNaN(conc) && conc > 0) {
        spec.execution = { concurrency: conc };
      }
    } else {
      spec.arguments = step.argValues;
    }
    return spec;
  });
  return { steps };
}

async function runWorkflow() {
  const resultEl = el("workflow-result");
  resultEl.classList.remove("hidden", "ok", "error");
  resultEl.textContent = "Running…";

  // Clear any previous per-step result markers before this run.
  state.steps.forEach((s) => (s.result = null));
  renderWorkflow();

  const payload = buildRunPayload();
  const result = await fetchJSON("/api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!result.ok) {
    resultEl.classList.add("error");
    resultEl.textContent = describeError(result);
    return;
  }

  resultEl.classList.remove("error");
  resultEl.classList.add("ok");
  resultEl.textContent = JSON.stringify(result.body, null, 2);

  // Also annotate each step card with its own outcome.
  const byId = Object.fromEntries((result.body.steps || []).map((s) => [s.step_id, s]));
  state.steps.forEach((step) => {
    const stepResult = byId[step.step_id];
    if (!stepResult) return;
    const ok = stepResult.status === "completed";
    step.result = {
      ok,
      text: ok ? `value: ${JSON.stringify(stepResult.value)}` : `error: ${stepResult.error}`,
    };
  });
  renderWorkflow();
}

function clearWorkflow() {
  state.steps = [];
  state.stepCounter = 0;
  el("workflow-result").classList.add("hidden");
  renderWorkflow();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

el("btn-run-now").addEventListener("click", runNow);
el("btn-add-to-workflow").addEventListener("click", addToWorkflow);
el("btn-run-workflow").addEventListener("click", runWorkflow);
el("btn-clear-workflow").addEventListener("click", clearWorkflow);

loadTools();
