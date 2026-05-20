"""
test_governance.py — 7-assertion test suite for the HydiGovernance system.

Run: python test_governance.py
Expected output: "All 7 tests passed."
Exit code 0 on pass, 1 on any failure.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from HydiGovernance import HydiGovernance, GovernanceConfig, TradeProposal
from HydiGovernanceHooks import evaluate_trade

_FAILURES: list = []


def check(condition: bool, name: str, detail: str = "") -> None:
    if condition:
        print(f"  PASS  [{name}]")
    else:
        msg = f"FAIL  [{name}]" + (f": {detail}" if detail else "")
        _FAILURES.append(msg)
        print(f"  {msg}")


def _fresh(extra_cfg: dict = {}) -> HydiGovernance:
    """Return a fresh governance instance so tests don't share state."""
    cfg = GovernanceConfig(
        max_notional_per_trade=5_000.0,
        max_open_positions=3,
        circuit_breaker_consecutive_failures=2,
        blacklisted_symbols=["GME", "DOGE"],
        **extra_cfg,
    )
    return HydiGovernance(cfg)


def test_1_valid_trade_approved() -> None:
    gov = _fresh()
    p = TradeProposal("AAPL", "buy", 10, 195.0, "strat1", "sess1", "test")
    d = gov.evaluate(p)
    check(d.approved, "1_valid_trade_approved", f"reason={d.reason}")


def test_2_notional_limit_blocks() -> None:
    gov = _fresh()
    # $45,000 notional — way over the $5,000 limit
    p = TradeProposal("MSFT", "buy", 100, 450.0, "strat1", "sess1")
    d = gov.evaluate(p)
    check(not d.approved, "2_notional_blocks", f"reason={d.reason}")
    check("Notional" in d.reason, "2b_reason_mentions_notional", f"reason={d.reason}")


def test_3_blacklist_blocks() -> None:
    gov = _fresh()
    p = TradeProposal("GME", "buy", 1, 20.0, "strat1", "sess1")
    d = gov.evaluate(p)
    check(not d.approved, "3_blacklist_blocks", f"reason={d.reason}")
    check("blacklisted" in d.reason.lower(), "3b_reason_mentions_blacklist", f"reason={d.reason}")


def test_4_circuit_breaker() -> None:
    gov = _fresh()  # circuit trips after 2 consecutive failures
    # Two blocked trades (blacklisted symbol triggers the failures)
    gov.evaluate(TradeProposal("GME", "buy", 1, 1.0, "s", "s"))  # blocked — failure 1
    gov.evaluate(TradeProposal("DOGE", "buy", 1, 1.0, "s", "s"))  # blocked — failure 2
    # Now a valid trade should be blocked by the circuit breaker
    d = gov.evaluate(TradeProposal("AAPL", "buy", 1, 100.0, "s", "s"))
    check(not d.approved, "4_circuit_breaker_trips", f"reason={d.reason}")
    check("Circuit breaker" in d.reason, "4b_reason_mentions_circuit_breaker", f"reason={d.reason}")


def test_5_kill_switch() -> None:
    gov = _fresh()
    gov.activate_kill_switch("unit test")
    d = gov.evaluate(TradeProposal("AAPL", "buy", 1, 100.0, "s", "s"))
    check(not d.approved, "5_kill_switch_blocks_all", f"reason={d.reason}")
    check("KILL SWITCH" in d.reason, "5b_reason_mentions_kill_switch", f"reason={d.reason}")


def test_6_chain_hashes_unique() -> None:
    gov = _fresh()
    d1 = gov.evaluate(TradeProposal("AAPL", "buy", 1, 100.0, "s", "s"))
    d2 = gov.evaluate(TradeProposal("GOOG", "buy", 1, 150.0, "s", "s"))
    check(bool(d1.chain_hash) and len(d1.chain_hash) == 64, "6_hash_is_sha256", f"len={len(d1.chain_hash)}")
    check(d1.chain_hash != d2.chain_hash, "6b_hashes_are_unique")


def test_7_hooks_format() -> None:
    # Approved trade
    result = evaluate_trade(
        '{"symbol":"TSLA","action":"buy","quantity":5,"price":200.0,"strategy_id":"test"}',
        session_id="test_sess",
    )
    check("TRADE APPROVED" in result, "7_hook_approved_format", f"got: {result}")

    # Blocked trade (high notional)
    result2 = evaluate_trade(
        '{"symbol":"NVDA","action":"buy","quantity":1000,"price":900.0,"strategy_id":"test"}',
        session_id="test_sess",
    )
    check("TRADE BLOCKED" in result2, "7b_hook_blocked_format", f"got: {result2}")


# -------------------------------------------------------------------- main

if __name__ == "__main__":
    print("Running HydiGovernance test suite...\n")

    test_1_valid_trade_approved()
    test_2_notional_limit_blocks()
    test_3_blacklist_blocks()
    test_4_circuit_breaker()
    test_5_kill_switch()
    test_6_chain_hashes_unique()
    test_7_hooks_format()

    print()
    total = 7 + 5  # 12 individual assertions across 7 tests
    if _FAILURES:
        print(f"FAILED: {len(_FAILURES)} assertion(s):")
        for f in _FAILURES:
            print(f"  {f}")
        sys.exit(1)
    else:
        print("All 7 tests passed.")
        sys.exit(0)
