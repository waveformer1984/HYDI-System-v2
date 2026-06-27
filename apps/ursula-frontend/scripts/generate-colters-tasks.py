#!/usr/bin/env python3
"""
Generate HYDI tasks for Colters Mobile PWA implementation
Based on ursula/specs/Colters_Mobile_PWA_SPEC.md
"""

import json
import subprocess
import sys
from pathlib import Path
from datetime import datetime

def run_hydi_task(title, description, priority="medium"):
    """Execute HYDI task creation"""
    cmd = [
        "python", "local_task_trigger.py", 
        title, 
        description
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, cwd="..")
        return {
            "title": title,
            "description": description,
            "priority": priority,
            "exit_code": result.returncode,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {
            "title": title,
            "description": description,
            "priority": priority,
            "exit_code": -1,
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }

def main():
    """Generate all Phase 1 tasks for Colters Mobile PWA"""
    
    tasks = [
        # Phase 1: Foundation (Weeks 1-2)
        {
            "title": "Colters Mobile: Create PWA Project Scaffold",
            "description": "Initialize Vite React TypeScript project in ursula/mobile/colters-pwa with TailwindCSS, PWA manifest, and service worker configuration according to Colters_Mobile_PWA_SPEC.md Section 3.1",
            "priority": "high"
        },
        {
            "title": "Colters Mobile: Implement Authentication System",
            "description": "Create login screen, token management, and role-based access control as specified in Colters_Mobile_PWA_SPEC.md Section 5.1. Support Admin, Production, Fulfillment, and Compliance roles",
            "priority": "high"
        },
        {
            "title": "Colters Mobile: Build Mobile Navigation Shell",
            "description": "Implement responsive layout with top status bar and bottom navigation (Home, Orders, Smoke, Cultures, Inventory, Compliance, Alerts) per Colters_Mobile_PWA_SPEC.md Section 6.1",
            "priority": "high"
        },
        {
            "title": "Colters Mobile: Create API Client Service",
            "description": "Implement API service layer connecting to Ursula endpoints (/api/mobile/dashboard/today, /orders, /smoke/batches, /logs/temp) as defined in Colters_Mobile_PWA_SPEC.md Section 4",
            "priority": "high"
        },
        {
            "title": "Colters Mobile: Implement Dashboard Component",
            "description": "Build today's dashboard with orders summary, active smoking batches, culture checks due, and alerts per Colters_Mobile_PWA_SPEC.md Section 6.2",
            "priority": "medium"
        },
        
        # Phase 2: Core MVP (Weeks 3-5)
        {
            "title": "Colters Mobile: Order Fulfillment Workflow",
            "description": "Implement complete order management flow - list, detail, status updates (preparing/ready/completed), and handoff notes per Colters_Mobile_PWA_SPEC.md Section 6.3",
            "priority": "medium"
        },
        {
            "title": "Colters Mobile: Smoking Batch Management",
            "description": "Build smoking operations interface - active batches, temperature logging, stage updates, and completion tracking per Colters_Mobile_PWA_SPEC.md Section 6.4",
            "priority": "medium"
        },
        {
            "title": "Colters Mobile: Culture Management Interface",
            "description": "Implement culture monitoring - active cultures, reading updates, check completion per Colters_Mobile_PWA_SPEC.md Section 6.5",
            "priority": "medium"
        },
        {
            "title": "Colters Mobile: Quick Inventory Management",
            "description": "Create inventory interface - low stock view, quantity updates, waste recording per Colters_Mobile_PWA_SPEC.md Section 6.6",
            "priority": "medium"
        },
        {
            "title": "Colters Mobile: Compliance Checklists",
            "description": "Build compliance interface - active checklists, reading logging, pass/fail tracking per Colters_Mobile_PWA_SPEC.md Section 6.7",
            "priority": "medium"
        },
        
        # Phase 3: Operational Depth (Weeks 5-7)
        {
            "title": "Colters Mobile: Offline Logging Queue",
            "description": "Implement offline-first architecture with action queue, sync on reconnect, and local storage per Colters_Mobile_PWA_SPEC.md Section 7",
            "priority": "low"
        },
        {
            "title": "Colters Mobile: Alerts System Integration",
            "description": "Build real-time alerts with notifications, filtering, and dismissal per Colters_Mobile_PWA_SPEC.md Section 6.8",
            "priority": "low"
        },
        {
            "title": "Colters Mobile: HYDI Event Monitoring",
            "description": "Implement mobile action logging to HYDI system for analytics and compliance tracking per Colters_Mobile_PWA_SPEC.md Section 8",
            "priority": "low"
        },
        {
            "title": "Colters Mobile: PWA Installation & Caching",
            "description": "Configure service worker for offline operation, install prompts, and background sync per Colters_Mobile_PWA_SPEC.md Section 7",
            "priority": "low"
        },
        {
            "title": "Colters Mobile: Performance Optimization",
            "description": "Implement lazy loading, image optimization, and bundle splitting to meet <3s load time per Colters_Mobile_PWA_SPEC.md Section 9",
            "priority": "low"
        }
    ]
    
    print("=== GENERATING COLTERS MOBILE PWA TASKS ===")
    print(f"Creating {len(tasks)} HYDI tasks...")
    
    results = []
    success_count = 0
    
    for task in tasks:
        print(f"\nCreating task: {task['title']}")
        result = run_hydi_task(task['title'], task['description'], task['priority'])
        results.append(result)
        
        if result['exit_code'] == 0:
            print(f"✅ SUCCESS: {result['stdout']}")
            success_count += 1
        else:
            print(f"❌ FAILED: {result.get('error', result.get('stderr', 'Unknown error'))}")
    
    # Save results
    results_file = Path(".hydi/colters-task-generation-results.json")
    results_file.parent.mkdir(exist_ok=True)
    
    with open(results_file, 'w') as f:
        json.dump({
            "generation_timestamp": datetime.now().isoformat(),
            "total_tasks": len(tasks),
            "successful_tasks": success_count,
            "success_rate": f"{success_count}/{len(tasks)}",
            "tasks": results
        }, f, indent=2)
    
    print(f"\n=== TASK GENERATION COMPLETE ===")
    print(f"Success rate: {success_count}/{len(tasks)} tasks created")
    print(f"Results saved to: {results_file}")
    
    if success_count == len(tasks):
        print("✅ ALL TASKS CREATED SUCCESSFULLY")
        return 0
    else:
        print("⚠️ SOME TASKS FAILED - CHECK RESULTS FILE")
        return 1

if __name__ == "__main__":
    sys.exit(main())
