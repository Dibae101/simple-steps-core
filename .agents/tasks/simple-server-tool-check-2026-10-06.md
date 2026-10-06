# Simple Server Tool Check — Findings Report

**Date:** 2026-10-06
**Scope:** `examples/simple_server` (FastAPI tool server) — `/tools`, `/call`, `/run` endpoints verified against `examples/simple_server/README.md`
**Repo state:** commit `d401dd5`, clean working tree (`git status --short` empty)

## Summary verdict: Partially working

The server starts cleanly, every registered tool runs correctly through `/call`, and step-to-step data-reference wiring in `/run` works exactly as documented. But two real discrepancies were found against the README's documented behavior:

1. The README's own flagship `/run` example (`make_list` → `square` via `map`, with `"concurrency": 4` nested inside `"orchestration"`) is **rejected with HTTP 422** by the current code — that field moved to a separate `execution` config in an intentional, documented schema migration, and the README (plus one example in `docs/how-it-works.md`) was never updated to match. Once reshaped to the current schema, the orchestrated-map result matches the README's documented shape exactly.
2. `/call` does **not** return HTTP 422 for a type-mismatched literal argument (e.g. a string passed where `add` expects an `int`); it returns HTTP 400 with a raw Python exception message instead, because literal-argument type checking is deliberately permissive (every field is typed `Any` in the validation model) and the real `TypeError` only surfaces when the tool function actually executes.

Everything else — tool listing, all four tools' successful calls, missing-argument validation, and plain step-to-step reference passing — matches the README exactly.

## Environment

- venv: `.venv` (Python 3.12.13) already had `fastapi==0.141.1` and `uvicorn==0.53.0` installed — the `api` extra was already present, no install needed (verified with `pip list`).
- Server launched: `uvicorn examples.simple_server.app:app --port 8001`, run in the background, stdout/stderr captured to `/tmp/simple_server_8001.log`.
- Startup log (clean, no errors/warnings):
  ```
  INFO:     Started server process [42882]
  INFO:     Waiting for application startup.
  INFO:     Application startup complete.
  INFO:     Uvicorn running on http://127.0.0.1:8001 (Press CTRL+C to quit)
  ```
  This confirms `examples/simple_server/app.py` imports `tools.py` (registering the 4 tools), calls `register_orchestrators(REGISTRY)`, `REGISTRY.freeze()`, and builds the FastAPI app with no import-time failures.
- `GET /docs` returned `200 OK` (Swagger UI), confirming the app object is fully wired.
- Server stopped cleanly at the end (SIGTERM; process exited without needing SIGKILL; port 8001 confirmed free afterward). Full log showed only `200`/`400`/`422` responses — no `500`s, no unhandled stack traces, across the entire session.

## Evidence: calls made

### 1. `GET /tools`

Request: `GET /tools`
Response: `200 OK`, JSON array of **10** entries:
- The 4 declared tools — `add`, `make_list`, `square`, `to_upper` — each with a correct JSON Schema (`input_schema.properties`: `a`/`b` → `integer` for `add`, `n` → `integer`, `x` → `integer`, `text` → `string`) and correct `output_schema`.
- 6 orchestration tools from `register_orchestrators`, registered under the `orchestration` resource namespace: `orchestration-map`, `orchestration-filter`, `orchestration-expand`, `orchestration-collapse`, `orchestration-group`, `orchestration-identity` (bare aliases `map`/`filter`/`expand`/`collapse`/`group`/`identity` also resolve to these — confirmed later by successfully calling `"mode": "map"` in `/run`).

This matches the README's documented shape ("id, description, params, JSON Schema").

**Minor cosmetic observation (not a functional discrepancy):** every `ToolParam.type_name` in the response reads `"Any"` (e.g. `add`'s `a`/`b` both show `"type_name": "Any"`) instead of `"int"`. Root cause, read in `src/simple_steps_core/operations/registry.py` (`_params_from_signature`): it reads `parameter.annotation` directly from `inspect.signature`, but `examples/simple_server/tools.py` has `from __future__ import annotations` (PEP 563), so annotations are unresolved strings at that point; the function doesn't resolve them via `get_type_hints` the way `src/simple_steps_core/operations/schema.py` (`_resolved_hints`) does for the JSON Schema. The actual `input_schema` is correctly typed (`"type": "integer"` etc.) — only the human-readable `type_name` field is wrong, and it doesn't affect validation or execution.

### 2. `POST /call` — valid arguments (all four tools)

| # | Request body | Response body | Status | Matches README? |
|---|---|---|---|---|
| 1 | `{"operation_id":"add","arguments":{"a":2,"b":3}}` | `{"value":5}` | 200 | **Yes** — exact match to documented example |
| 2 | `{"operation_id":"make_list","arguments":{"n":4}}` | `{"value":[0,1,2,3]}` | 200 | Yes |
| 3 | `{"operation_id":"square","arguments":{"x":5}}` | `{"value":25}` | 200 | Yes |
| 4 | `{"operation_id":"to_upper","arguments":{"text":"hi"}}` | `{"value":"HI"}` | 200 | Yes |

### 3. `POST /call` — invalid/missing arguments

| # | Request body | Response body | Status | Brief expected | Match? |
|---|---|---|---|---|---|
| 5 | `{"operation_id":"add","arguments":{"a":2}}` (missing `b`) | `{"detail":"Missing required argument 'b' for 'add'"}` | 422 | 422 + validation detail | **Yes** |
| 6 | `{"operation_id":"add","arguments":{"a":"two","b":3}}` (string where `int` expected) | `{"detail":"can only concatenate str (not \"int\") to str"}` | **400** | 422 + validation detail | **No — discrepancy** |
| 7 | `{"operation_id":"add","arguments":{"a":2,"b":"three"}}` (other arg, wrong type) | `{"detail":"unsupported operand type(s) for +: 'int' and 'str'"}` | **400** | 422 | **No — same discrepancy, confirms it's systematic, not a fluke** |
| 8 | `{"operation_id":"add","arguments":{"a":2,"b":3,"c":9}}` (unexpected extra arg) | `{"detail":"Unexpected argument(s) for 'add': c"}` | 422 | — (bonus check) | matches `validate_tool_call`'s own contract |
| 9 | `{"operation_id":"does_not_exist","arguments":{}}` | `{"detail":"Unknown operation: 'does_not_exist'"}` | 422 | — (bonus check) | matches |

Rows 6/7 are the discrepancy flagged by task 4 in the brief ("pass a string where add expects an int ... confirm 422, not a 500 or silent wrong value"). It is not a 500 and not a silently-wrong value — but it is also not a 422. Root cause, read in `src/simple_steps_core/operations/validation.py` (`build_arg_model`): every argument field in the dynamically-built Pydantic validation model is deliberately typed `Any` — the code comment explains this is so a reference token (e.g. `"step1"`) can stand in for any required type at validation time — so Pydantic never rejects a literal of the wrong type during `validate_tool_call`. The call then proceeds into `examples/simple_server/server.py`'s `/call` handler, which wraps workflow execution in a bare `except Exception` that maps *any* runtime failure to HTTP 400 (returning the raw exception string). So a bad literal type is never caught as a validation (422) problem — it surfaces as a 400 with an internal, implementation-specific Python error message instead of a stable validation message.

### 4. `POST /run` — README's two-step map example, exactly as written

Request (byte-for-byte from the README):
```json
{"steps": [
  {"step_id": "step_nums", "name": "make_list", "arguments": {"n": 4}},
  {"step_id": "step_squared", "name": "square",
   "orchestration": {"mode": "map", "over": "step_nums", "concurrency": 4}}
]}
```
Response:
```json
{"detail":[{"type":"extra_forbidden","loc":["body","steps",1,"orchestration","concurrency"],"msg":"Extra inputs are not permitted","input":4}]}
```
Status: **422** — but this is FastAPI/pydantic rejecting the request body's *shape* before the workflow ever runs. **This is a discrepancy: the README's own worked example does not run as written.**

Root cause: `OrchestrationConfig` (`src/simple_steps_core/domain/models.py`) declares `model_config = {"frozen": True, "extra": "forbid"}` and only has fields `mode`, `over`, `item_arg`, `initial` — `concurrency` is **not** one of them; it lives on `StepExecutionConfig` instead. This split is intentional and documented in `docs/config-isolation.md` ("Status: implemented ... All four configs now set extra='forbid'. Passing a field to the wrong config raises instead of being silently dropped") and is directly covered by a passing unit test, `tests/unit/test_step_spec.py::test_conduct_fields_are_rejected_by_orchestration_config`, which asserts exactly this construction raises `ValidationError`. The example in `examples/simple_server/README.md` — and a near-identical stale example in `docs/how-it-works.md` (around line 652: `OrchestrationConfig(mode="map", over="step_nums", concurrency=4)`) — predates that migration and was never updated. This is a documentation staleness issue, not a server defect: the engine's behavior here is intentional and tested.

Corrected request (moving `concurrency` into a sibling `"execution"` block):
```json
{"steps": [
  {"step_id": "step_nums", "name": "make_list", "arguments": {"n": 4}},
  {"step_id": "step_squared", "name": "square",
   "orchestration": {"mode": "map", "over": "step_nums"},
   "execution": {"concurrency": 4}}
]}
```
Response (200 OK, confirmed identical result with or without the `execution.concurrency` field present):
```json
{"steps":[
  {"step_id":"step_nums","status":"completed","value":[0,1,2,3],"error":null},
  {"step_id":"step_squared","status":"completed",
   "value":{"outcomes":[
     {"index":0,"status":"completed","value":0,"error":null},
     {"index":1,"status":"completed","value":1,"error":null},
     {"index":2,"status":"completed","value":4,"error":null},
     {"index":3,"status":"completed","value":9,"error":null}
   ]},"error":null}
]}
```
This matches the README's documented *result* shape exactly once correctly shaped: `step_nums` = `[0,1,2,3]`; `step_squared` is a `MapResult`-shaped value with an `outcomes` list, one entry per item, values `0, 1, 4, 9` (squares of `0,1,2,3`).

### 5. `POST /run` — three-step plain data-reference chain (task 6)

Request:
```json
{"steps": [
  {"step_id": "step_a", "name": "add", "arguments": {"a": 2, "b": 3}},
  {"step_id": "step_b", "name": "square", "arguments": {"x": "step_a"}},
  {"step_id": "step_c", "name": "add", "arguments": {"a": "step_b", "b": 10}}
]}
```
Response (200 OK):
```json
{"steps":[
  {"step_id":"step_a","status":"completed","value":5,"error":null},
  {"step_id":"step_b","status":"completed","value":25,"error":null},
  {"step_id":"step_c","status":"completed","value":35,"error":null}
]}
```
`step_b`'s `arguments: {"x": "step_a"}` correctly resolved to `step_a`'s output (`5`), squaring it to `25`; `step_c`'s `arguments: {"a": "step_b"}` resolved to `25`, `+10 = 35`. This confirms the README's `"arguments": {"data": "step_nums"}` wiring style — a plain string argument naming an earlier `step*` id — works correctly as a general mechanism, independent of orchestration's `over=`. **No discrepancy.** This exercises a different code path (`ReferenceResolver.resolve_value` in `src/simple_steps_core/execution/resolver.py`) than `over=` (which flows through the orchestrator's own `_source`/`items_of` helpers in `src/simple_steps_core/operations/orchestrations.py`), and both were verified to work correctly.

## Discrepancies found

1. **README `/run` example is broken as written** (`examples/simple_server/README.md`, "Run a workflow" section). Nesting `"concurrency": 4` inside `"orchestration"` is rejected with HTTP 422 (`extra_forbidden`) by the current `OrchestrationConfig` schema; `concurrency` belongs in a sibling `"execution"` block (`StepExecutionConfig`) per an intentional, already-documented config-isolation migration (`docs/config-isolation.md`). The identical stale shape also appears in `docs/how-it-works.md` (~line 652), so this is doc-wide staleness rather than a one-off typo. **Severity: medium.** Anyone copy-pasting the README's own example gets a 422 on the first try; the underlying map orchestration itself works correctly once the request is reshaped to the current schema.

2. **`/call` does not return 422 for a type-mismatched literal argument.** Passing a string where `add` expects an `int` (or vice versa) returns HTTP 400 with a raw, implementation-specific Python exception message, not HTTP 422 with a clean validation message. Root cause: `validate_tool_call`'s `build_arg_model` (`src/simple_steps_core/operations/validation.py`) types every argument as `Any` by design (to let reference tokens pass through), so no literal type-checking happens at validation time; the type error only appears when the tool function actually executes, and `/call`'s handler (`examples/simple_server/server.py`) maps any such runtime exception to 400. **Severity: medium.** Not a crash and not a silently-wrong value, but inconsistent with the clean "422 for bad input" contract the brief (and the missing-argument case) otherwise demonstrates, and it leaks raw Python error text to the client.

3. **Minor/cosmetic:** `GET /tools` reports `type_name: "Any"` for every parameter of every tool in this example, instead of `"int"`/`"str"`, because `examples/simple_server/tools.py` uses `from __future__ import annotations` and the registry's `_params_from_signature` doesn't resolve the resulting string annotations the way `operations/schema.py` does for the JSON Schema. The JSON Schema itself is correctly typed, so this doesn't affect validation or execution. **Severity: low.**

No other discrepancies found. Tool listing, all four `/call` happy-path examples (including `add` returning exactly `{"value": 5}`), the missing-argument 422 case, the orchestrated-map example (once shaped per the current, documented schema), and step-to-step plain reference wiring all match the README's documented behavior exactly.

## Recommendations (not implemented, per instructions)

- Update `examples/simple_server/README.md`'s `/run` example to move `concurrency` into an `"execution": {"concurrency": 4}` block (or drop it entirely, since the example doesn't need concurrency to demonstrate the shape). Apply the same fix to the matching stale example in `docs/how-it-works.md` (~line 652).
- Consider tightening `validate_tool_call`/`build_arg_model` to type-check literal (non-reference) arguments against their real declared types before execution, so a type mismatch surfaces as a 422 with a clean message rather than a 400 with a raw internal exception string. This would also avoid leaking implementation details (exact Python error text) to API clients.
- Consider resolving string annotations (via `get_type_hints`, matching `operations/schema.py`'s approach) in `operations/registry.py`'s `_params_from_signature`, so `ToolParam.type_name` is accurate for modules using `from __future__ import annotations` — a pattern already used by this very example and increasingly common in modern Python code.

## Files/symbols read (citations)

- `examples/simple_server/tools.py` — the 4 tool definitions
- `examples/simple_server/app.py` — app wiring (`register_orchestrators`, `freeze`, `build_app`)
- `examples/simple_server/server.py` — the 3 endpoints (`list_tools`, `call_tool`, `run_workflow`)
- `examples/simple_server/README.md` — the behavioral spec being verified
- `src/simple_steps_core/operations/registry.py` — `ToolRegistry`, `_params_from_signature`, alias resolution
- `src/simple_steps_core/operations/validation.py` — `validate_tool_call`, `build_arg_model`
- `src/simple_steps_core/operations/orchestrations.py` — `map_op`, `_gather_outcomes`, etc.
- `src/simple_steps_core/operations/schema.py` — `build_input_schema`, `_resolved_hints`
- `src/simple_steps_core/domain/models.py` — `OrchestrationConfig`, `StepExecutionConfig`, `Operation.to_tool_call`, `MapResult`, `ItemOutcome`
- `src/simple_steps_core/execution/resolver.py` — `ReferenceResolver` (plain data-reference wiring)
- `src/simple_steps_core/execution/workflow.py`, `src/simple_steps_core/execution/engine.py` — step/workflow execution
- `docs/config-isolation.md` — documents the concurrency/orchestration-vs-execution migration
- `docs/how-it-works.md` — contains the same stale example as the README (~line 652)
- `tests/unit/test_step_spec.py` — unit test confirming the config split is intentional (`test_conduct_fields_are_rejected_by_orchestration_config`)
- `pyproject.toml` — `api` extra dependencies (`fastapi>=0.110`, `uvicorn[standard]>=0.27`)
