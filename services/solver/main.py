"""HTTP front for the CP-SAT timetable service.

Private by design: there is no top-level rewrite pointing at this service, so
it is reachable only through the Vercel service binding from the Next.js route
that owns authentication. The shared secret below is defence in depth, not the
primary control — it catches a misconfigured rewrite that accidentally exposes
the service, which is exactly the kind of mistake that would otherwise hand a
stranger the school's whole timetable.
"""

from __future__ import annotations

import hmac
import os
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from solver.payload import parse_problem
from solver.solve import optimise, prove

app = FastAPI(title="Timetable solver", docs_url=None, redoc_url=None)

#: How long a solve may run, in seconds.
#:
#: The ceiling is the platform's function timeout, not this service's
#: preference: Vercel's Hobby plan stops a function at 60s, and importing
#: ortools costs ~10s of that before any solving starts. 35s leaves room for
#: the import, a 450KB problem in, and a result out. Raise
#: SOLVER_MAX_BUDGET_S alongside the function's maxDuration on a plan with a
#: longer timeout — conflict extraction genuinely finds more with more time.
MAX_BUDGET_S = float(os.environ.get("SOLVER_MAX_BUDGET_S", "35"))


class SolveRequest(BaseModel):
    problem: dict[str, Any]
    budgetSeconds: float = Field(default=30.0, gt=0)
    #: lesson id -> [day, start], a week the browser already found.
    hint: dict[str, list[int]] | None = None


def _authorise(secret: str | None) -> None:
    expected = os.environ.get("SOLVER_SHARED_SECRET")
    if not expected:
        # Refuse rather than run open. A service that quietly accepts anything
        # when its secret is missing is worse than one that fails to deploy.
        raise HTTPException(status_code=503, detail="Solver secret not configured")
    if not secret or not hmac.compare_digest(secret, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
def health() -> dict[str, Any]:
    from ortools.sat.python import cp_model  # imported here to keep cold start honest

    return {"ok": True, "solver": "cp-sat", "ortools": cp_model.__name__}


@app.post("/prove")
def post_prove(
    body: SolveRequest,
    x_solver_secret: str | None = Header(default=None, alias="X-Solver-Secret"),
) -> dict[str, Any]:
    _authorise(x_solver_secret)
    problem = parse_problem(body.problem)
    result = prove(problem, budget_s=min(body.budgetSeconds, MAX_BUDGET_S))
    return result.to_dict()


@app.post("/optimise")
def post_optimise(
    body: SolveRequest,
    x_solver_secret: str | None = Header(default=None, alias="X-Solver-Secret"),
) -> dict[str, Any]:
    _authorise(x_solver_secret)
    problem = parse_problem(body.problem)
    hint = (
        {k: (int(v[0]), int(v[1])) for k, v in body.hint.items() if len(v) >= 2}
        if body.hint
        else None
    )
    result = optimise(
        problem, budget_s=min(body.budgetSeconds, MAX_BUDGET_S), hint=hint
    )
    return result.to_dict()
