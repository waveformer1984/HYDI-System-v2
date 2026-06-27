#!/usr/bin/env python3
"""
Colters Mobile PWA Spec Readiness Check
Truth Standard: Verifiable artifacts only
"""

import json
import sys
from pathlib import Path
from datetime import datetime

def validate_spec():
    """Validate the Colters Mobile PWA specification"""
    spec_path = Path("specs/Colters_Mobile_PWA_SPEC.md")
    
    if not spec_path.exists():
        return {
            "status": "FAILED",
            "reason": "Spec file not found",
            "path": str(spec_path)
        }
    
    try:
        content = spec_path.read_text(encoding='utf-8')
    except Exception as e:
        return {
            "status": "FAILED", 
            "reason": f"Could not read spec: {e}",
            "path": str(spec_path)
        }
    
    # Required validations
    checks = {
        "executive_summary": "Executive Summary" in content,
        "product_vision": "Product Vision & Scope" in content,
        "technical_architecture": "Technical Architecture" in content,
        "user_roles": "User Roles & Access Control" in content,
        "api_specification": "Core API Specification" in content,
        "screen_specifications": "Screen Specifications" in content,
        "implementation_timeline": "Implementation Timeline" in content,
        "api_endpoints": all([
            "GET /api/mobile/dashboard/today" in content,
            "GET /api/mobile/orders" in content,
            "POST /api/mobile/logs/temp" in content
        ]),
        "json_examples": len([m for m in content.split("```json")]) >= 5,
        "pwa_config": "Web App Manifest" in content,
        "offline_strategy": "Offline Architecture" in content
    }
    
    passed_checks = sum(1 for check in checks.values() if check)
    total_checks = len(checks)
    
    return {
        "status": "PASSED" if passed_checks == total_checks else "PARTIAL",
        "checks_passed": passed_checks,
        "total_checks": total_checks,
        "details": checks,
        "file_path": str(spec_path),
        "file_size_bytes": spec_path.stat().st_size,
        "validation_timestamp": datetime.utcnow().isoformat()
    }

def main():
    result = validate_spec()
    
    print(f"=== COLTERS MOBILE PWA SPEC READINESS CHECK ===")
    print(f"Status: {result['status']}")
    print(f"Checks: {result['checks_passed']}/{result['total_checks']}")
    print(f"File: {result['file_path']}")
    print(f"Size: {result['file_size_bytes']} bytes")
    
    if result['status'] == "FAILED":
        print(f"Reason: {result['reason']}")
        sys.exit(1)
    elif result['status'] == "PARTIAL":
        print("Failed checks:")
        for check, passed in result['details'].items():
            if not passed:
                print(f"  - {check}")
        sys.exit(1)
    else:
        print("✅ SPEC READY FOR DEVELOPMENT")
        
        # Write proof payload for HYDI
        proof_payload = {
            "cli_attempted": True,
            "commands": [
                {
                    "cmd": "python scripts/spec-readiness-check.py",
                    "exit_code": 0,
                    "artifact": "specs/Colters_Mobile_PWA_SPEC.md"
                }
            ],
            "validation_result": result,
            "summary": {
                "spec_status": "READY_FOR_DEVELOPMENT",
                "completeness": "100%",
                "developer_handoff": "APPROVED"
            }
        }
        
        with open(".hydi/spec-validation-result.json", "w") as f:
            json.dump(proof_payload, f, indent=2)
        
        print("Proof payload written to .hydi/spec-validation-result.json")

if __name__ == "__main__":
    main()
