"""
HydiGovernanceHooks — Bridge between HydiCognitiveLoop and HydiGovernance.

When Hydi uses the 'trade_execute' tool, the call is routed here.
This module translates the tool_input JSON into a TradeProposal,
sends it through the governance gate, and returns a plain-text observation.

Tool input schema (JSON string):
{
  "symbol":      "AAPL",
  "action":      "buy" | "sell" | "close",
  "quantity":    10,
  "price":       195.50,
  "strategy_id": "momentum_breakout",
  "rationale":   "RSI crossed 70, volume confirms"   <- optional
}

Returns one of:
  "TRADE APPROVED | BUY 10 AAPL @ $195.50 (notional: $1,955.00) | hash: abc123..."
  "TRADE BLOCKED  | BUY 10 AAPL @ $195.50 | Reason: Notional $1,955 exceeds limit..."
"""
import json
import os
import sys
from typing import Optional

# Allow running from different working directories
sys.path.insert(0, os.path.dirname(__file__))
from HydiGovernance import HydiGovernance, GovernanceConfig, TradeProposal

# Process-scoped singleton — one governance instance per server process
_governance: Optional[HydiGovernance] = None


def get_governance(config: Optional[GovernanceConfig] = None) -> HydiGovernance:
    global _governance
    if _governance is None:
        _governance = HydiGovernance(config)
    return _governance


def evaluate_trade(tool_input: str, session_id: str = "unknown") -> str:
    """
    Entry point called by HydiCognitiveLoop._act() for the 'trade_execute' tool.
    Always returns a string — never raises.
    """
    # Parse input
    try:
        params = json.loads(tool_input)
    except json.JSONDecodeError as e:
        return (
            f"Error: trade_execute requires valid JSON. "
            f"Example: {{\"symbol\":\"AAPL\",\"action\":\"buy\",\"quantity\":10,"
            f"\"price\":195.0,\"strategy_id\":\"my_strat\"}}. Parse error: {e}"
        )

    required = {"symbol", "action", "quantity", "price", "strategy_id"}
    missing = required - set(params.keys())
    if missing:
        return f"Error: missing required fields: {', '.join(sorted(missing))}"

    # Validate types
    try:
        proposal = TradeProposal(
            symbol=str(params["symbol"]).strip().upper(),
            action=str(params["action"]).strip().lower(),
            quantity=float(params["quantity"]),
            price=float(params["price"]),
            strategy_id=str(params["strategy_id"]),
            session_id=session_id,
            rationale=str(params.get("rationale", "")),
        )
    except (ValueError, TypeError) as e:
        return f"Error: invalid parameter types — {e}"

    if proposal.action not in ("buy", "sell", "close"):
        return (
            f"Error: action must be 'buy', 'sell', or 'close'. Got: '{proposal.action}'"
        )

    if proposal.quantity <= 0:
        return "Error: quantity must be positive"

    if proposal.price <= 0:
        return "Error: price must be positive"

    # Gate through governance
    gov = get_governance()
    decision = gov.evaluate(proposal)

    label = "TRADE APPROVED" if decision.approved else "TRADE BLOCKED "
    core = (
        f"{proposal.action.upper()} {proposal.quantity} {proposal.symbol} "
        f"@ ${proposal.price:.2f} (notional: ${proposal.notional:,.2f})"
    )
    detail = "All constraints passed" if decision.approved else f"Reason: {decision.reason}"
    chain = f"chain: {decision.chain_hash[:16]}..."

    return f"{label} | {core} | {detail} | {chain}"
