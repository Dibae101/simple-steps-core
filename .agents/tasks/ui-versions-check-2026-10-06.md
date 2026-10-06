# UI versions check — simple-steps-core

## Direct answer

**No — there are not "two versions" of a step-wise collapsible-button UI inside this repo.** There is exactly **one** visual UI surface in `simple-steps-core`: the **Streamlit dashboard** (`Dashboard().run()`, implemented in `src/simple_steps_core/streamlit/`). It genuinely does render each step as a **collapsible card** (`st.expander`) with **run/reset buttons** attached — so the premise "step-wise collapsible buttons and functions" is confirmed, but it's confirmed as **one** UI, not two.

Everything else that looks UI-like in this repo is either:
- a **pure JSON API** with no visual rendering at all (the FastAPI servers), or
- a **reference backend** (`examples/simple_steps_backend/`) whose actual visual frontend ("simple-steps", React) is **not in this repo** — it's documented as living in a separate project, or
- **leftover/dead prototype files** inside the Streamlit package that were superseded by the current dashboard and are no longer wired into anything (not a second shipped UI, but could plausibly be what someone noticed and read as "a second version").

If what the user actually saw was two *different-looking* dashboards, the likeliest explanation is history, not two live surfaces: `git log` shows the Streamlit dashboard was rewritten in place (commit `aeb884d "god awful streamlit implementation"` → later `"modularized form on streamlit application"` etc.), and three now-orphaned files from an earlier layout (`components/workflow_management_ui.py`, `components/step_control_card/step_control_card.py`, `components/step_ui.py`) still sit in the tree unimported. See point 4 below.

---

## 1. Every distinct runnable surface in this repo

| Surface | What it is | How it's launched | Visual UI? |
|---|---|---|---|
| `examples/api_server/` | FastAPI example (`app.py`, `operations.py`, `store.py`) exposing `/operations`, `/workflows`, `/workflows/{id}/run`, `/workflows/{id}`, `/workflows/{id}/dag` | `uvicorn examples.api_server.app:app --reload` (per `examples/api_server/app.py:1-16`) | No — pure JSON API. Swagger docs at `/docs` are FastAPI's auto-generated API explorer, not a product UI. |
| `examples/simple_server/` | Minimal FastAPI example (`tools.py`, `server.py`, `app.py`) exposing `GET /tools`, `POST /call`, `POST /run` (`examples/simple_server/server.py:1-13`) | `python mytools.py` or `uvicorn` | No — pure JSON API. (Already verified working in a prior investigation per the brief.) |
| `examples/simple_steps_backend/` | Reference FastAPI backend (`app.py`, `agent.py`, `demo.py`, `store.py`) plus a `types.ts` typed client, meant to be copied into a **separate** `simple-steps` repo | `uvicorn examples.simple_steps_backend.demo:app --reload` (`examples/simple_steps_backend/README.md:16-19`) | No — pure JSON API (`/operations`, `/workflows`, `/agent/propose`, etc., per `examples/simple_steps_backend/README.md:22-32`). No HTML/Jinja templates found (`grep` for `Jinja\|HTMLResponse\|templates` in `app.py` returned nothing). |
| **`src/simple_steps_core/streamlit/` — the Dashboard** | A local Streamlit app: tool palette, step cards, run controls, workflow JSON import/export | `python mytools.py` (re-execs under `streamlit run`) after `from simple_steps_core.streamlit import Dashboard; Dashboard().run()` — see `src/simple_steps_core/streamlit/dashboard.py:462-503` | **Yes** — this is the one actual rendered UI in the repo. Detailed in point 2. |
| `streamlit_example/` | Two runnable tools files (`example_tools_and_resources.py`, `media_and_dataframes.py`) that just call `Dashboard().run()` at the bottom (`streamlit_example/example_tools_and_resources.py:144`, `streamlit_example/media_and_dataframes.py:156`) | `python streamlit_example/example_tools_and_resources.py` | Yes, but it's the **same** Dashboard code as above — just a different tools file registering different example tools. Not a second implementation. |
| `src/simple_steps_core/streamlit/components/right_sidebar/` | A **vendored third-party Streamlit custom component** (`streamlit-right-sidebar`, by `stuartsynakowski`, pulled in as source with its own `pyproject.toml`, `README.md`, and a React/TypeScript frontend under `right_sidebar/frontend/`) that adds a collapsible sidebar docked to the right edge | Its own `example/app.py` (`streamlit run example/app.py`) | Yes, but it is a **standalone demo of a dependency**, not wired into the Dashboard. `grep -rln "right_sidebar"` across `src/`, `examples/`, `streamlit_example/`, `tests/` found **no references outside its own folder** — the main dashboard does not import or use it today. |

No other frontend/UI surface exists: `find . -name "package.json"` (excluding `node_modules`/`.venv`) returns only the one inside `right_sidebar/frontend/`; `find . -name "*.tsx" -o -name "*.jsx"` likewise returns only `right_sidebar`'s two files. The only other `.ts` file in the whole repo is `examples/simple_steps_backend/types.ts`, which is type *definitions*, not a UI (see point 3).

---

## 2. The Streamlit dashboard — is it step-wise collapsible cards with buttons?

**Yes, concretely confirmed.** Reading `src/simple_steps_core/streamlit/dashboard.py` and `src/simple_steps_core/streamlit/panels/step_card.py` in full:

### Each step is an `st.expander` (collapsible)

In `_render_app`'s per-step loop, every visible step is wrapped in its own fragment, which opens with an expander keyed by the step's id:

```python
# src/simple_steps_core/streamlit/dashboard.py:349-351
with st.expander(f"{draft.id}", expanded=True):
    render_step_card(
        st, draft, key=f"card_{draft.id}", registry=REGISTRY,
```
(`dashboard.py:338-367`, function `_step_fragment`)

Inside that card, the Inputs section and the Result section are **themselves** separate nested expanders:

```python
# src/simple_steps_core/streamlit/panels/step_card.py:80
with st.expander(":material/input: :material/function:  Inputs", type="compact",expanded=True):
```
```python
# src/simple_steps_core/streamlit/panels/step_card.py:315
with st.expander(":material/output: Result", expanded=True, type="compact"):
```

So one step renders as a collapsible card containing two further collapsible sub-sections (Inputs, Result) — this is literally "step wise collapsable" UI.

### Each step card has attached buttons (run / reset)

```python
# src/simple_steps_core/streamlit/panels/step_card.py:106-121
def render_step_controls(st, draft: DraftStep, *, key: str, on_run=None,
                         on_reset=None, can_reset: bool = False) -> None:
    """Run / clear controls. Behavior is entirely caller-supplied."""
    with st.container(horizontal=True, gap="xxsmall", width="content",
                      key=f"step_{draft.id}_controller"):
        if on_run is not None and st.button(
            ":material/play_arrow:", key=f"run_{draft.id}",
            help="Run this step", type="primary",
        ):
            on_run(draft)
        if on_reset is not None:
            st.button(":material/refresh:", key=f"reset_{draft.id}",
                        help="Clear this step's output", disabled=not can_reset,
                        type="secondary", on_click=on_reset, args=(draft,))
```

`on_run`/`on_reset` are wired from the dashboard to actually queue/execute the step and clear its output (`dashboard.py:360-375`, `_request_run` / `_reset_step`). There's also a **tool selector** (dropdown) and, per card, a **"views" segmented control** (`:material/step:`, `:material/function:`, `:material/dataset:` — toggle which sub-panels show) defined as `STEP_VIEWS` in `step_card.py:34-35` and surfaced (currently commented out in the live render path — see `dashboard.py:352-353` `#_view_picker(st, draft.id)` — "ui for view_picker is not clean need to work on later").

### Beyond individual steps, the whole workflow area is collapsible too

The sidebar sections and the toolbar are also `st.expander`s:
```python
# dashboard.py:233   with st.expander("Manage Workflow"):
# dashboard.py:240   with st.expander("Tools"):
# dashboard.py:242   with st.expander("Resources"):
# dashboard.py:251   with st.expander("Workflow Manager", expanded=True):
```

And at the toolbar level there are Add/Remove/Swap/Group buttons operating on the selected steps (`src/simple_steps_core/streamlit/panels/toolbar.py:38-66`, `render_workflow_toolbar`), plus Run-all/Reset buttons (`toolbar.py:70-83`, `render_run_controls`).

**Conclusion for point 2:** `src/simple_steps_core/streamlit/dashboard.py` + `panels/step_card.py` is precisely the "step-wise collapsible buttons and functions" UI the user is asking about. To launch it: write a tools file that does `from simple_steps_core.streamlit import Dashboard` and calls `Dashboard().run()` at the bottom, then run `python yourtools.py` (needs `pip install -e ".[dashboard]"`). A ready-made example is `streamlit_example/example_tools_and_resources.py` (`python streamlit_example/example_tools_and_resources.py`).

---

## 3. Is there a separate React/TypeScript frontend ("simple-steps")?

**Yes, it's real, but it is explicitly NOT in this repo.** Evidence:

- `examples/simple_steps_backend/types.ts` is a `.ts` file containing **type definitions and a typed HTTP client** (`SimpleStepsClient`) for a React app to consume — it contains zero rendering/component code. It mirrors the Python domain models (comment at `types.ts:1-3`: "TypeScript types for the simple-steps React frontend... Keep them in sync with the Python models").
- `docs/simple-steps-integration.md` states this directly: *"This guide shows how to use `simple-steps-core` as the backend for the `simple-steps` application — a React frontend plus an optional LangGraph agent"* (`docs/simple-steps-integration.md:3-5`), and gives an architecture diagram with `subgraph FE["simple-steps (React)"]` as an external box feeding the backend over HTTP (`docs/simple-steps-integration.md:18-20`).
- `examples/simple_steps_backend/README.md` confirms the backend is a **drop-in reference meant to be copied into the other repo**: *"A drop-in FastAPI backend that exposes `simple-steps-core` to the `simple-steps` React app... Copy this folder into the `simple-steps` repo and register your own operations."* (`README.md:3-5`)
- The repo-wide search for actual frontend code (`*.tsx`, `*.jsx`, `package.json`) found nothing related to this "simple-steps" React app — only the unrelated vendored `right_sidebar` Streamlit-component demo (point 1) has any `package.json`/`.tsx`.
- `agent.py` in `examples/simple_steps_backend/` wires an optional LangGraph planner (`build_langgraph_planner`) that proposes steps but never executes them (`docs/simple-steps-integration.md:150-156`), consistent with the "agent proposes, human runs" model described for that external app.

**So: "simple-steps" (capital-R React frontend) and "simple-steps-core" (this repo, a Python library) are two different projects by design, and only the backend-facing half of that pairing (a FastAPI reference server + a `.ts` types/client file) is vendored here.** The actual React UI is not present in this repository at all — only documented and typed-for.

---

## 4. Signs of two parallel/duplicate dashboard implementations inside THIS repo

This is the point most relevant to explaining *why* the user might believe "two versions" exist. Findings:

**a. There is only one *wired* dashboard entry point.** `grep -rn "Dashboard()"` across the repo matches exactly: `src/simple_steps_core/streamlit/dashboard.py` (the class itself, `dashboard.py:470`, plus its own docstring example) and the two files under `streamlit_example/` that call it (`example_tools_and_resources.py:144`, `media_and_dataframes.py:156`). There is no `DashboardV2`, no `StepManager` class, no alternate `class Dashboard` elsewhere (`grep -rn "class Dashboard"` across the repo returns only `dashboard.py`).

**b. But there ARE three orphaned/dead files inside `streamlit/components/` that look like an earlier, abandoned attempt at the same step-card-with-buttons UI:**

1. **`src/simple_steps_core/streamlit/components/workflow_management_ui.py`** (222 lines) — a **free-standing, self-executing Streamlit script**. It calls `st.set_page_config(...)` at import time (`workflow_management_ui.py:19`) — something a component module should never do — and independently reimplements almost the same concepts as the real dashboard: its own `st.session_state.containers` list, its own `add_step`/`remove_step`/`group_steps`/`ungroup_steps` functions, its own `render_step(c)` that draws per-step `st.expander(f"Step {c['id']}", ...)` cards (`workflow_management_ui.py:168-199`, and the loop at `workflow_management_ui.py:206-223`) with its own run/refresh/fast-forward buttons. It is **not imported anywhere** — `grep -rn "workflow_management_ui"` across the whole repo matches nothing except the file itself. It is dead code, not a second shipped surface.
2. **`src/simple_steps_core/streamlit/components/step_control_card/step_control_card.py`** — the entire body is a Python **triple-quoted string** (`_='''...'''`, lines 24-69) containing commented-out prototype code for a step control card using `streamlit_extras.resizable_columns` and `streamlit_extras.steps`. It imports `streamlit_extras` (`step_control_card.py:2`) which is not declared anywhere in `pyproject.toml`'s dependencies/extras. Not imported anywhere (`grep -rn "step_control_card"` matches nothing else). Dead prototype.
3. **`src/simple_steps_core/streamlit/components/step_ui.py`** — 2 lines, just `import streamlit as st` and a comment. Empty stub, unused.
   Also **`components/control_wigit.py`** — 0 bytes, empty.
   And **`arg_form_idea.py`** at the package root — 12 lines of pseudocode/notes (not valid Python — e.g. `for each\narg_name with info ()` — would raise `SyntaxError` if imported), clearly a scratch note, not code.

**c. Git history confirms a rewrite, not two parallel products.** `git log --oneline -- src/simple_steps_core/streamlit`:
```
862cfdc added needed modalities bounded tools to resources and some necessary oechstration components
b0245a3 added examples
5a5108f added stuff
d6ac30f bug fixes for form
9a5cf0e updated workflow
ff351c4 fixed orchestration component
aaa877e added api reference
ec1034e trying to fix mapping component
55abbe9 bug fixes to dashboard
5c73e5f added notes for updates
79dc088 modularized form on streamlit application
bb3596c added play form
b08659f updating layout of streamlit app
c81b689 better tutorials
f3b7f96 updated streamlit module component
3df63e9 added side bar for assistent
9dea88a components
499e9f6 added wigit placeholder
126ce46 added dashboard components
384ff14 updated wigit
f505999 updating UI component
c7857d4 added better UI component
aeb884d god awful streamlit implementation
```
Reading this oldest-first: `aeb884d` ("god awful streamlit implementation") is the very first commit to this directory — and `workflow_management_ui.py` traces back to that era (`git log --follow` on it shows only `b0245a3`, `f505999`, `c7857d4` — the early "UI component" commits). The current `panels/step_card.py` was introduced later, in `79dc088 "modularized form on streamlit application"` and refined through `5a5108f`/`d6ac30f`/`9a5cf0e`/`862cfdc`. So the orphaned files are leftovers from an earlier pass at the dashboard that was superseded by the current `dashboard.py` + `panels/` + `components/` layered design (described explicitly in `dashboard.py`'s own module docstring, lines 1-27, as "since the component extraction, only a wiring layer"). They were never deleted, just stopped being imported.

**d. The vendored `right_sidebar` component (point 1) is a true second, independent "collapsible UI," but it's a third-party dependency's demo, not an alternate version of *this* project's dashboard** — its own README (`right_sidebar/README.md:1-3`) describes it as a generic reusable "collapsible Streamlit sidebar docked to the right edge," authored upstream by someone else and vendored as source. It is unrelated to step cards specifically and currently unused by `dashboard.py`.

**Settling point 4: "two versions" inside this repo most plausibly means the current dashboard (`dashboard.py` + `panels/` + `components/steps.py` etc.) versus these dead `components/workflow_management_ui.py` / `step_control_card.py` leftovers from an earlier rewrite pass — not two live, selectable UI modes.** Only one is reachable by any entry point a user would actually run.

---

## 5. Conclusion

- **How many distinct UI surfaces exist in this repo today, with a visual rendering (not just JSON)?** **One.** The Streamlit dashboard at `src/simple_steps_core/streamlit/dashboard.py` (plus its `panels/`/`components/` support code), reachable via `Dashboard().run()`. The vendored `right_sidebar` custom component is technically a second renderable Streamlit thing, but it's an unused third-party dependency demo, not part of the product's own UI.
- **Which one matches "step-wise collapsible buttons and functions"?** The dashboard, exactly: `src/simple_steps_core/streamlit/dashboard.py` (`_step_fragment`, lines 338-367) wrapping each step in `st.expander(f"{draft.id}", expanded=True)`, delegating to `src/simple_steps_core/streamlit/panels/step_card.py` (`render_step_card`, lines 42-100) which nests further `st.expander` sections for Inputs/Result and attaches run (`:material/play_arrow:`) / reset (`:material/refresh:`) buttons per step (`render_step_controls`, lines 106-121). Launch with `python streamlit_example/example_tools_and_resources.py` (ready-made) or any tools file ending in `Dashboard().run()`, after `pip install -e ".[dashboard]"`.
- **Does a second, different UI version exist in this repo, or only externally?** Only externally, and only partially: the **"simple-steps" React frontend** referenced throughout `docs/simple-steps-integration.md` and typed by `examples/simple_steps_backend/types.ts` is a **separate application that is not vendored in this repository** — this repo only ships the backend half (a reference FastAPI server) meant to be copied into that other project. No React/Vite/JS UI code for it exists here.
- **If the user's "two versions" premise doesn't cleanly match the repo — what's actually there?** It doesn't cleanly match. What's actually there is: **one working dashboard UI** (confirmed collapsible-step-cards-with-buttons), **two/three pure-JSON API examples** with no visual UI at all, **one reference backend** meant to pair with an **external, not-present** React frontend, and **a handful of orphaned/dead prototype files** inside the Streamlit package (`workflow_management_ui.py`, `step_control_card.py`, `step_ui.py`, `arg_form_idea.py`, `control_wigit.py`) left over from an earlier, superseded rewrite of that same dashboard — these are the closest thing to "a second version," but they are dead code, not a second running surface.

## Recommendations (not implemented — investigation only)

1. Delete or clearly quarantine the dead files identified in point 4b (`components/workflow_management_ui.py`, `components/step_control_card/step_control_card.py`, `components/step_ui.py`, `components/control_wigit.py`, `arg_form_idea.py`) — they cost nothing functionally since nothing imports them, but they're exactly the kind of leftover that creates "wait, is there a second dashboard?" confusion (as apparently happened here). If any snippet inside them is still wanted (e.g. the `streamlit_extras.steps` horizontal-stepper idea in `step_control_card.py`), move it into `todos.md`/`issues.md` as a note instead of as inert code.
2. If the vendored `right_sidebar` component is intended to eventually back the commented-out `_view_picker` / "Assistant" popover in `dashboard.py` (lines 258-259, 380-398), say so in a comment or todo; right now it reads as unused, licensed, third-party source with no connection to the rest of the package, which is also something a reader could mistake for "another UI version."
3. Consider a short note at the top of `src/simple_steps_core/streamlit/` (or in the SKILL.md) distinguishing "the dashboard" (this repo's own Streamlit UI) from "the simple-steps frontend" (the external React app documented in `docs/simple-steps-integration.md`) — the naming similarity (`simple-steps-core` vs `simple-steps`) is the most likely root cause of the user's "two versions?" question.
