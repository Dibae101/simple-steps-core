"""A FastAPI factory that serves the tool API plus a static test frontend.

``build_app(registry, engine)`` exposes:

- ``GET  /api/tools``  — the palette (each tool's id, description, JSON Schema).
- ``POST /api/call``   — run one tool immediately: ``{operation_id, arguments}``.
- ``POST /api/run``    — run a workflow of :class:`Operation` steps, wiring
                         outputs between steps and orchestrating (map/filter/...)
                         inline.
- ``/`` (static)       — the browser UI (``static/index.html`` + friends).

The session (data store, references) is created and managed per request, so
the caller only thinks in terms of tools and steps.

Route ordering matters here: the ``/api/*`` routes are registered first, and
the static files mount at ``/`` is added last. Starlette matches routes in
registration order, so mounting the catch-all static directory before the
API routes would shadow them.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from simple_steps_core import (
    CoreEngine,
    ToolRegistry,
    Operation,
    ToolCall,
    ValidationError,
    Workflow,
    make_session_id,
    validate_tool_call,
)

STATIC_DIR = Path(__file__).parent / "static"


class CallIn(BaseModel):
    operation_id: str = Field(..., examples=["add"])
    arguments: dict[str, Any] = Field(default_factory=dict, examples=[{"a": 2, "b": 3}])


class RunIn(BaseModel):
    steps: list[Operation]


def _jsonable(value: Any) -> Any:
    """Best-effort conversion of a payload to something JSON-serializable."""
    if value is None or isinstance(value, (bool, int, float, str, list, dict)):
        return value
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return repr(value)


def build_app(
    registry: ToolRegistry,
    engine: CoreEngine,
    *,
    title: str = "simple_steps test app",
) -> FastAPI:
    app = FastAPI(title=title, version="0.1.0")

    @app.get("/api/tools")
    def list_tools() -> list[dict]:
        """The tool palette: id, description, params, and JSON Schema."""
        return [d.model_dump() for d in registry.list_definitions()]

    @app.post("/api/call")
    def call_tool(body: CallIn) -> dict:
        """Run a single tool immediately and return its value."""
        call = ToolCall(operation_id=body.operation_id, arguments=body.arguments)
        try:
            validate_tool_call(call, registry)
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        wf = Workflow(engine, session_id="call")
        wf["result"] = call
        try:
            wf.run()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"value": _jsonable(wf["result"].output.value)}

    @app.post("/api/run")
    def run_workflow(body: RunIn) -> dict:
        """Run a workflow of steps; later steps reference earlier outputs."""
        wf = Workflow(engine, session_id=make_session_id("test_app", "wf", "run"))
        for spec in body.steps:
            try:
                wf.add(spec)  # compiles the Operation (validates orchestration)
            except (ValueError, TypeError) as exc:
                raise HTTPException(
                    status_code=422, detail=f"Invalid step {spec.step_id!r}: {exc}"
                ) from exc

        results: list[dict] = []
        for spec in body.steps:
            try:
                step = wf.run_step(spec.step_id)
            except Exception as exc:
                results.append(
                    {"step_id": spec.step_id, "status": "failed", "value": None, "error": str(exc)}
                )
                break
            results.append(
                {
                    "step_id": step.step_id,
                    "status": step.status.value,
                    "value": _jsonable(step.output.value),
                    "error": None,
                }
            )
        return {"steps": results}

    # Registered LAST: this mounts a catch-all at "/" that serves index.html
    # plus app.js/styles.css. If this were added before the /api routes above,
    # it would shadow them since Starlette matches routes in registration order.
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

    return app
