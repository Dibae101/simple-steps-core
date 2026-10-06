# simple_steps test app (FastAPI + static frontend)

A manual test harness: the same minimal tool API as
[`examples/simple_server`](../simple_server), plus a small static HTML/CSS/JS
page served from the same process so you can call tools and run workflows
from a browser instead of `curl`. No npm/node, no build step — plain
`<script>` and `fetch`.

## Files

| File | What it is |
| --- | --- |
| [`tools.py`](tools.py) | The only file you'd edit to add capabilities — decorate plain functions with `@register_tool`. |
| [`server.py`](server.py) | `build_app(registry, engine)` FastAPI factory: `/api/*` routes + the static mount. |
| [`app.py`](app.py) | Wires tools + orchestrators into a running app. |
| [`static/`](static) | `index.html`, `app.js`, `styles.css` — the browser UI. |

## Run

```bash
python -m pip install -e ".[api]"
uvicorn examples.test_app.app:app --reload   # http://127.0.0.1:8000/
```

Or use the convenience script from the repo root:

```bash
./scripts/run_test_app.sh
```

Open `http://127.0.0.1:8000/` — pick a tool, fill in arguments, and either
run it immediately or add it as a step to the workflow builder on the right.

## API routes

| Method & path | Purpose |
| --- | --- |
| `GET /api/tools` | The tool palette: id, description, params, JSON Schema. |
| `POST /api/call` | Run one tool immediately: `{operation_id, arguments}`. |
| `POST /api/run` | Run a workflow of steps; later steps reference earlier outputs. |

These mirror `examples/simple_server`'s `/tools` / `/call` / `/run` exactly,
just namespaced under `/api` so they share the origin with the static
frontend mounted at `/`.

## Using the frontend

- **Tool palette** (left): click a tool to open its argument form, built
  from the tool's JSON Schema (`input_schema.properties`). Required fields
  are marked with `*`.
- **Run now**: calls `POST /api/call` with the form's values and shows the
  result or error inline.
- **Add to workflow**: appends the current tool + arguments as a step
  (`step1`, `step2`, ...) to the workflow builder on the right. Type an
  earlier step's id (e.g. `step1`) into any argument field to wire that
  step's output in as a reference, the same way the engine's own
  `"arguments": {"data": "step1"}` wiring works.
- **Orchestrate**: check the box on a step to fan it out with
  `map`/`filter`/`expand`/`collapse` over an earlier step's output, with an
  optional `concurrency` for `map`. This sends `orchestration` and
  `execution` as separate objects on the step, matching the engine's
  isolated shape-vs-conduct config split (`concurrency` is **not** nested
  inside `orchestration`).
- **Run workflow**: calls `POST /api/run` with all steps and shows each
  step's status/value/error, both in the raw JSON result box and annotated
  on each step card.

## Known quirks (inherited from the engine, not bugs in this app)

- `GET /api/tools` reports every parameter's `type_name` as `"Any"` — a
  cosmetic registry quirk unrelated to the real (and correctly typed)
  `input_schema`. The frontend reads `input_schema.properties[name].type`
  instead, which is accurate.
- `POST /api/call` returns `422` for a missing argument, but `400` with a
  raw Python error string for a type-mismatched literal (e.g. a string where
  an `int` is expected) — literal arguments are validated as `Any` by
  design, so a bad type only fails at execution time. The frontend displays
  whichever `detail` string comes back either way.
