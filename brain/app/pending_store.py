"""In-memory pending mint-request store — Option C operator co-sign provisioning.

A user who picks a subname under steg.eth can't mint it: the wrapped parent is owned
by the operator's Ledger (NameWrapper.setSubnodeRecord needs the parent owner). When the
frontend enters its "awaiting operator mint" state it also records a *pending request*
here, so the operator isn't blind. The operator's `scripts/approve-mints.ts` CLI fetches
`GET /provision/pending`, mints each name on their Ledger, then marks it fulfilled.

The chain stays the source of truth — `useMintWatch` detects the mint on-chain and the
browser auto-streams `/provision` regardless of this queue — so the store is purely an
operator work-list. In-memory is therefore fine: after a brain restart any browser still
in the awaiting state re-POSTs its request, and a name that was already minted is a no-op
on the operator side (the mint script's eth_call pre-flight skips an existing name).
"""

import time
import uuid
from typing import Any, Literal

# ENS label: lowercase, 2–32 chars, no leading/trailing hyphen. Mirrors the
# frontend LABEL_RE in AgentLoginProvision.tsx so client + server agree.
import re

LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$")

RequestStatus = Literal["pending", "fulfilled"]


class InvalidLabelError(ValueError):
    """Raised when a requested label isn't a valid ENS-ish label."""


class PendingMintStore:
    """Operator work-queue of subname mints awaiting a Ledger co-sign.

    Single-process, in-memory. All ops are synchronous dict mutations with no awaits,
    so the FastAPI event loop never interleaves them — no lock needed.
    """

    def __init__(self, parent: str = "steg.eth") -> None:
        self._parent = parent
        self._requests: dict[str, dict[str, Any]] = {}

    @staticmethod
    def normalize_label(label: str) -> str:
        clean = label.strip().lower()
        if not LABEL_RE.match(clean):
            raise InvalidLabelError(
                "label must be lowercase letters, numbers, and hyphens (2–32 chars)"
            )
        return clean

    def name_for(self, label: str) -> str:
        return f"{self.normalize_label(label)}.{self._parent}"

    def request(self, label: str, email: str | None) -> dict[str, Any]:
        """Record a pending mint. Idempotent per name: if a pending request for the
        same name already exists, return it (the operator should see each name once)."""
        name = self.name_for(label)

        for existing in self._requests.values():
            if existing["name"] == name and existing["status"] == "pending":
                return existing

        req = {
            "id": str(uuid.uuid4()),
            "name": name,
            "label": self.normalize_label(label),
            "email": email,
            "status": "pending",
            "created_at": time.time(),
            "fulfilled_at": None,
        }
        self._requests[req["id"]] = req
        return req

    def pending(self) -> list[dict[str, Any]]:
        """Unfulfilled requests, oldest first (operator processes FIFO)."""
        out = [r for r in self._requests.values() if r["status"] == "pending"]
        out.sort(key=lambda r: r["created_at"])
        return out

    def all(self) -> list[dict[str, Any]]:
        return sorted(self._requests.values(), key=lambda r: r["created_at"])

    def fulfill(self, *, request_id: str | None = None, name: str | None = None) -> dict[str, Any] | None:
        """Mark fulfilled by id (operator CLI after broadcast) or by name (when
        /provision completes). Returns the updated record, or None if not found.
        Marking by name fulfills every pending request for that name."""
        if request_id is not None:
            req = self._requests.get(request_id)
            if req is None:
                return None
            self._mark(req)
            return req

        if name is not None:
            hit: dict[str, Any] | None = None
            for req in self._requests.values():
                if req["name"] == name and req["status"] == "pending":
                    self._mark(req)
                    hit = req
            return hit

        return None

    @staticmethod
    def _mark(req: dict[str, Any]) -> None:
        req["status"] = "fulfilled"
        req["fulfilled_at"] = time.time()
