"""
HydiGovernance — Deterministic, fail-closed risk governance engine.

Every financial action Hydi proposes passes through this gate before execution.
The gate is fail-closed: any evaluation error blocks the trade.

Audit trail: SHA-256 hash chain appended to HYDI_Vault/GovernanceLedger/decisions.jsonl
Each entry links to the previous entry's hash, forming a tamper-evident chain.
"""
import hashlib
import json
import datetime
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

_LEDGER_DIR = Path(__file__).resolve().parent.parent / "HYDI_Vault" / "GovernanceLedger"


@dataclass
class TradeProposal:
    symbol: str        # Ticker / asset symbol (e.g. "AAPL", "BTC-USD")
    action: str        # "buy" | "sell" | "close"
    quantity: float    # Number of units
    price: float       # Limit or estimated execution price (USD)
    strategy_id: str   # Which strategy is proposing this
    session_id: str    # Cognitive loop session that generated the proposal
    rationale: str = ""

    @property
    def notional(self) -> float:
        return abs(self.quantity * self.price)


@dataclass
class GovernanceDecision:
    approved: bool
    reason: str
    proposal: TradeProposal
    timestamp: str = field(default_factory=lambda: datetime.datetime.utcnow().isoformat())
    chain_hash: str = ""


@dataclass
class GovernanceConfig:
    max_notional_per_trade: float = 10_000.0           # USD cap per single trade
    max_daily_drawdown_pct: float = 5.0                 # % of portfolio — placeholder
    max_open_positions: int = 10                        # Total approved trades today
    circuit_breaker_consecutive_failures: int = 3       # Blocked trades before circuit trips
    blacklisted_symbols: list = field(default_factory=list)
    kill_switch: bool = False                           # Hard stop — blocks everything


class HydiGovernance:
    def __init__(self, config: Optional[GovernanceConfig] = None):
        self.config = config or GovernanceConfig()
        _LEDGER_DIR.mkdir(parents=True, exist_ok=True)
        self._ledger_path = _LEDGER_DIR / "decisions.jsonl"
        self._consecutive_failures: int = 0
        self._approved_today: int = 0
        self._prev_hash: str = "GENESIS"

    # ---------------------------------------------------------------- public

    def evaluate(self, proposal: TradeProposal) -> GovernanceDecision:
        """
        Gate a trade proposal. Fail-closed — any exception blocks the trade.
        Appends the decision to the immutable ledger and returns it.
        """
        try:
            blocked, reason = self._check_constraints(proposal)
            decision = GovernanceDecision(
                approved=not blocked,
                reason=reason if blocked else "All constraints passed",
                proposal=proposal,
            )
        except Exception as e:
            decision = GovernanceDecision(
                approved=False,
                reason=f"Governance evaluation error (fail-closed): {e}",
                proposal=proposal,
            )

        decision.chain_hash = self._hash_and_advance(decision)
        self._append_ledger(decision)

        if decision.approved:
            self._consecutive_failures = 0
            self._approved_today += 1
        else:
            self._consecutive_failures += 1

        return decision

    def activate_kill_switch(self, reason: str = "Manual activation") -> None:
        self.config.kill_switch = True
        with open(self._ledger_path, "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "timestamp": datetime.datetime.utcnow().isoformat(),
                "event": "KILL_SWITCH_ACTIVATED",
                "reason": reason,
            }) + "\n")

    def reset_circuit_breaker(self) -> None:
        self._consecutive_failures = 0

    def get_ledger(self) -> list:
        if not self._ledger_path.exists():
            return []
        entries = []
        with open(self._ledger_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
        return entries

    # ---------------------------------------------------------------- private

    def _check_constraints(self, p: TradeProposal) -> tuple:
        """Returns (is_blocked: bool, reason: str). First failing check wins."""
        if self.config.kill_switch:
            return True, "KILL SWITCH active — all trading halted"

        if p.symbol.upper() in [s.upper() for s in self.config.blacklisted_symbols]:
            return True, f"Symbol {p.symbol.upper()} is blacklisted"

        if p.notional > self.config.max_notional_per_trade:
            return True, (
                f"Notional ${p.notional:,.2f} exceeds limit "
                f"${self.config.max_notional_per_trade:,.2f}"
            )

        if self._approved_today >= self.config.max_open_positions:
            return True, (
                f"Max open positions ({self.config.max_open_positions}) reached today"
            )

        if self._consecutive_failures >= self.config.circuit_breaker_consecutive_failures:
            return True, (
                f"Circuit breaker tripped after "
                f"{self._consecutive_failures} consecutive blocked trades"
            )

        return False, ""

    def _hash_and_advance(self, decision: GovernanceDecision) -> str:
        payload = json.dumps({
            "approved": decision.approved,
            "reason": decision.reason,
            "symbol": decision.proposal.symbol,
            "notional": round(decision.proposal.notional, 4),
            "timestamp": decision.timestamp,
            "prev": self._prev_hash,
        }, sort_keys=True)
        new_hash = hashlib.sha256(payload.encode()).hexdigest()
        self._prev_hash = new_hash
        return new_hash

    def _append_ledger(self, decision: GovernanceDecision) -> None:
        entry = {
            "timestamp": decision.timestamp,
            "approved": decision.approved,
            "reason": decision.reason,
            "symbol": decision.proposal.symbol,
            "action": decision.proposal.action,
            "notional_usd": round(decision.proposal.notional, 2),
            "strategy_id": decision.proposal.strategy_id,
            "session_id": decision.proposal.session_id,
            "chain_hash": decision.chain_hash,
        }
        with open(self._ledger_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
