#!/usr/bin/env python3
"""HYDI Trading Loop with Governance Gate Integration"""

import os
import sys
import time
from datetime import datetime
from supabase import create_client
from governance import HYDIGovernanceGate

def initialize_governance():
    try:
        supabase = create_client(
            url=os.environ.get("SUPABASE_URL", "https://akbnfovjdcobifeupvbn.supabase.co"),
            key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        )
        governance_gate = HYDIGovernanceGate(
            supabase_client=supabase,
            policy_id=os.environ.get("GOVERNANCE_POLICY_ID", "policy_001")
        )
        policy_status = governance_gate.get_policy_status()
        if "error" in policy_status or not policy_status.get("is_active"):
            print("? Governance policy not active!")
            return None
        print("=" * 70)
        print("? HYDI TRADING ENGINE INITIALIZED")
        print("=" * 70)
        print(f"Policy: {policy_status.get('id')}")
        print(f"Max Notional: ")
        print(f"Max Positions: {policy_status.get('max_positions', 'N/A')}")
        print(f"Fail-Closed: {policy_status.get('fail_closed', False)}")
        print("=" * 70 + "\n")
        return governance_gate
    except Exception as e:
        print(f"? Governance initialization failed: {e}")
        return None

def fetch_market_data():
    return {
        "spread_bps": 50,
        "oracle_delay_seconds": 1,
        "slippage_pct": 0.2,
        "heartbeat_seconds": 1,
        "oracle_staleness_seconds": 0,
        "btc_price": 45000,
        "eth_price": 2500
    }

def generate_trade_signal(market_data):
    if market_data.get("btc_price", 0) > 44000:
        return {
            "instrument": "BTC/USD",
            "notional_usd": 5000,
            "side": "buy",
            "order_type": "market",
            "total_positions": 1,
            "price": market_data.get("btc_price"),
            "timestamp": datetime.utcnow().isoformat()
        }
    return None

def gather_system_state():
    return {
        "failures_count": 0,
        "recent_rejections_5min": 0,
        "uptime_seconds": 3600,
        "memory_usage_mb": 150
    }

def gather_system_telemetry(market_data, api_state):
    return {
        "market_conditions": {
            "spread_bps": market_data.get("spread_bps", 0),
            "oracle_delay_seconds": market_data.get("oracle_delay_seconds", 0),
            "slippage_pct": market_data.get("slippage_pct", 0),
            "heartbeat_seconds": market_data.get("heartbeat_seconds", 0)
        },
        "api_failures_count": api_state.get("failures_count", 0),
        "latency_ms": 100,
        "recent_rejection_count": api_state.get("recent_rejections_5min", 0),
        "oracle_staleness_seconds": market_data.get("oracle_staleness_seconds", 0)
    }

def execute_trade_with_governance(governance_gate, trade_request, system_telemetry):
    approved, decision_id, reason = governance_gate.evaluate_trade_pre_execution(
        trade_request,
        system_telemetry
    )
    
    if not approved:
        print(f"? TRADE BLOCKED | {trade_request['instrument']} | Reason: {reason}")
        return (False, decision_id)
    
    try:
        print(f"? TRADE APPROVED & EXECUTING | {trade_request['instrument']} ")
        return (True, decision_id)
    except Exception as e:
        print(f"? EXECUTION FAILED | {str(e)}")
        return (False, decision_id)

def main_trading_loop(governance_gate):
    iteration = 0
    trades_executed = 0
    trades_blocked = 0
    
    print("?? Starting main trading loop...\n")
    
    while True:
        try:
            iteration += 1
            
            market_data = fetch_market_data()
            api_state = gather_system_state()
            trade_request = generate_trade_signal(market_data)
            
            if trade_request is None:
                if iteration % 100 == 0:
                    print(f"[ITERATION {iteration}] No trade signal | BTC: \")
                time.sleep(1)
                continue
            
            system_telemetry = gather_system_telemetry(market_data, api_state)
            success, decision_id = execute_trade_with_governance(governance_gate, trade_request, system_telemetry)
            
            if success:
                trades_executed += 1
            else:
                trades_blocked += 1
            
            if iteration % 50 == 0:
                try:
                    metrics = governance_gate.get_today_metrics()
                    print(f"\n?? GOVERNANCE METRICS | Evaluated: {metrics['decisions_evaluated']} | Approved: {metrics['decisions_approved']} | Rejected: {metrics['decisions_rejected']}")
                    print(f"?? TRADING STATS | Executed: {trades_executed} | Blocked: {trades_blocked}\n")
                except:
                    pass
            
            time.sleep(1)
        
        except KeyboardInterrupt:
            print("\n\n??  Shutting down...")
            print(f"?? Final | Executed: {trades_executed} | Blocked: {trades_blocked}")
            break
        except Exception as e:
            print(f"? Loop error: {e}")
            time.sleep(1)

if __name__ == "__main__":
    governance_gate = initialize_governance()
    if not governance_gate:
        print("? Cannot start trading without governance gate!")
        sys.exit(1)
    
    main_trading_loop(governance_gate)
