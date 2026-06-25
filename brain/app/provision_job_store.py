"""In-memory provision job store — PLAN-D Part 2.

POST /provision used to be welded to a single long SSE connection: a dropped or
stalled browser aborted the server-side generator mid-run (observed live 2026-06-24:
a curl SSE dropped during an idle `fund` step). This store decouples the run from the
connection — POST creates a job and kicks off a background task that drives the job's
state; the client polls GET /provision/status/{id}. The chain stays the source of
truth, so in-memory is fine: a brain restart drops jobs and the client falls back to
a fresh run / on-chain reality.

The reducer `apply()` mirrors the frontend `apply()` in useProvision.ts so the polled
record maps almost 1:1 onto the existing ProvisionState. Keys are camelCase to match
the frontend shape (agentId/serverWallet/txByStep) — this is a JSON API for the UI.
"""

import time
import uuid
from typing import Any

# Ordered step ids — MUST match PROVISION_STEPS in frontend useProvision.ts and the
# step ids emitted by _run_provision in provision_routes.py.
PROVISION_STEP_IDS = [
    "wallet_create", "fund", "records", "bind", "identity",
    "agent_uri", "ensip25", "reverse", "transfer",
]


class ProvisionJobStore:
    """Single-process, in-memory provision-job store. All ops are synchronous dict
    mutations with no awaits, so the FastAPI event loop never interleaves them — no
    lock needed (same model as PendingMintStore)."""

    def __init__(self) -> None:
        self._jobs: dict[str, dict[str, Any]] = {}

    def create(self, name: str, label: str) -> dict[str, Any]:
        now = time.time()
        job: dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "name": name,
            "label": label,
            "status": "running",  # running | complete | error
            "steps": {sid: "pending" for sid in PROVISION_STEP_IDS},
            "current": None,
            "message": None,
            "agentId": None,
            "serverWallet": None,
            "card": None,
            "txByStep": {},
            "error": None,
            "createdAt": now,
            "updatedAt": now,
        }
        self._jobs[job["id"]] = job
        return job

    def get(self, job_id: str) -> dict[str, Any] | None:
        return self._jobs.get(job_id)

    def apply(self, job_id: str, frame: dict[str, Any]) -> None:
        """Reduce one provision frame into the job record. Frame shapes are IDENTICAL
        to the old SSE frames (begin/step/error/complete) — keep this reducer in sync
        with useProvision.apply() so the UI behaves the same whether streamed or polled."""
        job = self._jobs.get(job_id)
        if job is None:
            return
        event = frame.get("event")

        if event == "begin":
            job["status"] = "running"

        elif event == "step":
            step = frame.get("step")
            status = frame.get("status")
            if step and status == "start":
                job["steps"][step] = "active"
                job["current"] = step
                job["message"] = frame.get("message")
            elif step and status == "done":
                job["steps"][step] = "done"
                if frame.get("tx"):
                    job["txByStep"][step] = frame["tx"]
                if frame.get("agentId"):
                    job["agentId"] = frame["agentId"]
                if frame.get("serverWallet"):
                    job["serverWallet"] = frame["serverWallet"]

        elif event == "error":
            job["status"] = "error"
            job["error"] = frame.get("message")
            step = frame.get("step")
            if step:
                job["steps"][step] = "error"

        elif event == "complete":
            job["status"] = "complete"
            job["current"] = None
            job["message"] = None
            if frame.get("agentId"):
                job["agentId"] = frame["agentId"]
            if frame.get("serverWallet"):
                job["serverWallet"] = frame["serverWallet"]
            if frame.get("card"):
                job["card"] = frame["card"]
            for sid in PROVISION_STEP_IDS:
                if job["steps"][sid] != "error":
                    job["steps"][sid] = "done"

        job["updatedAt"] = time.time()

    def prune(self, max_age_seconds: float = 3600.0) -> None:
        """Drop jobs whose last update is older than max_age (chain is the source of
        truth, so forgetting a finished/stale job is safe). Called opportunistically
        on new-job creation; no background timer needed."""
        cutoff = time.time() - max_age_seconds
        for jid in [jid for jid, j in self._jobs.items() if j["updatedAt"] < cutoff]:
            del self._jobs[jid]
