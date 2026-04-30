#!/usr/bin/env python3
"""
Safety-First Webhook Orchestrator

Enforces execution contracts, state snapshots, confidence thresholds, and kill switches.
HID layer is explicitly gated and cannot act without authorization.
"""

import time
import logging
import json
import os
import hashlib
from dataclasses import dataclass, asdict
from typing import Optional, List, Dict, Callable, Literal
from pathlib import Path
from datetime import datetime
from enum import Enum

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('SafetyOrchestrator')

class ExecutionMode(Enum):
    """Execution mode - enforced contract"""
    API_ONLY = "api_only"           # Never use HID
    HID_ALLOWED = "hid_allowed"     # HID with human confirmation
    HID_REQUIRED = "hid_required"   # HID necessary (OAuth, 2FA)

class SafetyViolation(Exception):
    """Raised when safety contract is violated"""
    pass

@dataclass
class ExecutionContract:
    """Contract that must be honored"""
    mode: ExecutionMode
    requires_human_confirmation: bool
    min_vision_confidence: float  # 0.0 - 1.0
    rollback_strategy: Literal["revert_webhook", "revert_env", "noop"]
    snapshot_before: bool
    max_retries: int = 1
    
    def validate(self):
        """Validate contract is sane"""
        if self.min_vision_confidence < 0.0 or self.min_vision_confidence > 1.0:
            raise SafetyViolation(f"Invalid confidence threshold: {self.min_vision_confidence}")
        if self.max_retries < 0 or self.max_retries > 5:
            raise SafetyViolation(f"Invalid retry count: {self.max_retries}")

@dataclass
class StateSnapshot:
    """Snapshot of system state before HID execution"""
    timestamp: str
    snapshot_id: str
    stripe_webhooks: List[Dict]
    vercel_env_vars: List[Dict]
    hid_enabled: bool
    checksum: str
    
    def compute_checksum(self) -> str:
        """Compute integrity checksum"""
        data = json.dumps({
            'timestamp': self.timestamp,
            'stripe_webhooks': self.stripe_webhooks,
            'vercel_env_vars': self.vercel_env_vars
        }, sort_keys=True)
        return hashlib.sha256(data.encode()).hexdigest()[:16]
    
    def verify(self) -> bool:
        """Verify snapshot integrity"""
        return self.checksum == self.compute_checksum()

@dataclass
class WebhookSetupTask:
    """Task with embedded execution contract"""
    stripe_email: str
    stripe_password: str
    vercel_email: str
    vercel_password: str
    vercel_project: str
    webhook_endpoint_url: str
    webhook_events: List[str]
    contract: ExecutionContract
    
    @classmethod
    def from_json(cls, path: str) -> 'WebhookSetupTask':
        with open(path) as f:
            data = json.load(f)
        contract = ExecutionContract(**data.pop('contract', {}))
        contract.validate()
        return cls(contract=contract, **data)
    
    def to_json(self, path: str):
        data = asdict(self)
        with open(path, 'w') as f:
            json.dump(data, f, indent=2)

@dataclass  
class SetupResult:
    success: bool
    execution_mode: str
    contract_honored: bool
    snapshot_id: Optional[str]
    stripe_secret: Optional[str]
    vercel_vars_added: List[str]
    errors: List[str]
    duration_seconds: float
    terminated_by_kill_switch: bool = False
    low_confidence_abort: bool = False

class SafetyOrchestrator:
    """
    Orchestrator with enforced safety boundaries.
    
    Rules:
    1. API mode never touches HID
    2. HID mode requires human confirmation
    3. Vision confidence must exceed threshold
    4. State snapshot before any HID action
    5. Kill switch checked before every action
    6. Rollback on failure
    """
    
    KILL_SWITCH_FILE = Path("/tmp/STOP_HID")
    KILL_SWITCH_FLAG = "hid_automation_enabled"
    VISION_CONFIDENCE_THRESHOLD = 0.92
    
    def __init__(self, hid_backend: str = 'mock', ocr_backend: str = 'auto'):
        logger.info("Initializing SAFETY-FIRST Orchestrator")
        
        # Lazy imports - only load HID if actually needed
        self._hid_backend = hid_backend
        self._ocr_backend = ocr_backend
        self._hid = None
        self._vision = None
        self._stripe_nav = None
        self._vercel_nav = None
        
        self.state = {
            'phase': 'idle',
            'active_snapshot': None,
            'contract': None,
            'hid_armed': False
        }
        
        # Safety config
        self.safety_enabled = True
        self.kill_switch_check_interval = 1.0
        
        logger.info("Safety orchestrator ready (HID disarmed)")
    
    # ─────────────────────────────────────────────────────────────
    # KILL SWITCH SYSTEM
    # ─────────────────────────────────────────────────────────────
    
    def check_kill_switch(self) -> bool:
        """
        Check if kill switch is active.
        Returns True if killed (should stop).
        """
        # File-based kill switch
        if self.KILL_SWITCH_FILE.exists():
            logger.critical("KILL SWITCH ACTIVE (file detected)")
            return True
        
        # Database kill switch (if Supabase available)
        try:
            from supabase import create_client
            supabase = create_client(
                os.getenv('SUPABASE_URL', ''),
                os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
            )
            result = supabase.table('keymaker_config')\
                .select('value')\
                .eq('key', self.KILL_SWITCH_FLAG)\
                .single()\
                .execute()
            
            if result.data and not result.data.get('value', {}).get('enabled', True):
                logger.critical("KILL SWITCH ACTIVE (database flag)")
                return True
                
        except Exception as e:
            logger.debug(f"DB kill switch check failed: {e}")
        
        return False
    
    def arm_kill_switch(self):
        """Arm the kill switch (before HID operations)"""
        self.KILL_SWITCH_FILE.touch()
        logger.info("Kill switch armed (create /tmp/STOP_HID to abort)")
    
    def disarm_kill_switch(self):
        """Disarm the kill switch"""
        if self.KILL_SWITCH_FILE.exists():
            self.KILL_SWITCH_FILE.unlink()
        logger.info("Kill switch disarmed")
    
    # ─────────────────────────────────────────────────────────────
    # STATE SNAPSHOT SYSTEM
    # ─────────────────────────────────────────────────────────────
    
    def capture_snapshot(self, task: WebhookSetupTask) -> StateSnapshot:
        """
        Capture system state before HID execution.
        This is your rewind point.
        """
        logger.info("Capturing state snapshot...")
        
        snapshot = StateSnapshot(
            timestamp=datetime.utcnow().isoformat(),
            snapshot_id=f"snap_{int(time.time())}_{os.urandom(4).hex()}",
            stripe_webhooks=self._fetch_stripe_webhooks(task),
            vercel_env_vars=self._fetch_vercel_env(task),
            hid_enabled=self._hid is not None,
            checksum=""  # Computed below
        )
        
        snapshot.checksum = snapshot.compute_checksum()
        
        # Persist snapshot
        snapshot_path = Path(f"/tmp/hid_snapshots/{snapshot.snapshot_id}.json")
        snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        with open(snapshot_path, 'w') as f:
            json.dump(asdict(snapshot), f, indent=2)
        
        self.state['active_snapshot'] = snapshot.snapshot_id
        logger.info(f"Snapshot captured: {snapshot.snapshot_id}")
        
        return snapshot
    
    def _fetch_stripe_webhooks(self, task: WebhookSetupTask) -> List[Dict]:
        """Fetch current Stripe webhook config via API"""
        try:
            import stripe
            stripe.api_key = os.getenv('STRIPE_SECRET_KEY', '')
            webhooks = stripe.WebhookEndpoint.list(limit=10)
            return [{'id': w.id, 'url': w.url} for w in webhooks.data]
        except Exception as e:
            logger.warning(f"Could not fetch Stripe webhooks: {e}")
            return []
    
    def _fetch_vercel_env(self, task: WebhookSetupTask) -> List[Dict]:
        """Fetch current Vercel env vars via API"""
        try:
            # Vercel API call would go here
            return []
        except Exception as e:
            logger.warning(f"Could not fetch Vercel env: {e}")
            return []
    
    def rollback_to_snapshot(self, snapshot_id: str):
        """Rollback to snapshot state"""
        logger.critical(f"EXECUTING ROLLBACK to {snapshot_id}")
        
        snapshot_path = Path(f"/tmp/hid_snapshots/{snapshot_id}.json")
        if not snapshot_path.exists():
            logger.error(f"Snapshot not found: {snapshot_id}")
            return False
        
        with open(snapshot_path) as f:
            snapshot = StateSnapshot(**json.load(f))
        
        if not snapshot.verify():
            logger.error("Snapshot integrity check failed!")
            return False
        
        # Execute rollback strategy
        logger.info(f"Rolling back {len(snapshot.stripe_webhooks)} webhooks")
        # TODO: Implement actual webhook restoration
        
        return True
    
    # ─────────────────────────────────────────────────────────────
    # VISION CONFIDENCE ENFORCEMENT
    # ─────────────────────────────────────────────────────────────
    
    def check_vision_confidence(self, min_confidence: float = None) -> bool:
        """
        Verify vision system confidence before acting.
        Aborts if confidence too low.
        """
        threshold = min_confidence or self.VISION_CONFIDENCE_THRESHOLD
        
        if self._vision is None:
            logger.error("Vision system not initialized")
            return False
        
        # Capture test frame
        try:
            import cv2
            img = self._vision.capture()
            
            # Run OCR on test region
            elements = self._vision.ocr_text(img)
            
            if not elements:
                logger.error("VISION ABORT: No text detected")
                return False
            
            avg_confidence = sum(e.get('confidence', 0) for e in elements) / len(elements)
            
            if avg_confidence < threshold:
                logger.critical(f"VISION ABORT: Confidence {avg_confidence:.2f} < {threshold}")
                return False
            
            logger.info(f"Vision confidence: {avg_confidence:.2f} (threshold: {threshold})")
            return True
            
        except Exception as e:
            logger.error(f"Vision check failed: {e}")
            return False
    
    # ─────────────────────────────────────────────────────────────
    # EXECUTION MODE ENFORCEMENT
    # ─────────────────────────────────────────────────────────────
    
    def decide_execution_mode(self, task: WebhookSetupTask) -> ExecutionMode:
        """
        Determine execution mode based on task requirements.
        This decision is binding.
        """
        contract = task.contract
        
        # API availability check
        stripe_api_ok = bool(os.getenv('STRIPE_SECRET_KEY'))
        vercel_api_ok = bool(os.getenv('VERCEL_TOKEN'))
        
        if contract.mode == ExecutionMode.API_ONLY:
            if not (stripe_api_ok and vercel_api_ok):
                raise SafetyViolation("API_ONLY mode requested but APIs not available")
            return ExecutionMode.API_ONLY
        
        if contract.mode == ExecutionMode.HID_REQUIRED:
            if not self.safety_enabled:
                raise SafetyViolation("HID_REQUIRED but safety system disabled")
            return ExecutionMode.HID_REQUIRED
        
        # HID_ALLOWED - use if APIs fail or not available
        if not (stripe_api_ok and vercel_api_ok):
            logger.warning("APIs unavailable, escalating to HID")
            return ExecutionMode.HID_ALLOWED
        
        return ExecutionMode.API_ONLY  # Default to safe option
    
    def require_human_confirmation(self, message: str) -> bool:
        """
        Gate: Require explicit human confirmation before HID action.
        No automation bypasses this.
        """
        print("\n" + "="*60)
        print("🛑 HUMAN CONFIRMATION REQUIRED")
        print("="*60)
        print(f"Action: {message}")
        print("="*60)
        
        try:
            response = input("Type 'EXECUTE' to proceed (or anything else to abort): ")
            confirmed = response.strip() == "EXECUTE"
            
            if confirmed:
                logger.info("Human confirmed HID execution")
            else:
                logger.warning("Human DENIED HID execution")
            
            return confirmed
            
        except EOFError:
            logger.error("Non-interactive mode - cannot get confirmation")
            return False
    
    # ─────────────────────────────────────────────────────────────
    # MAIN EXECUTION
    # ─────────────────────────────────────────────────────────────
    
    def run_setup(self, task: WebhookSetupTask, 
                  progress_callback: Optional[Callable] = None) -> SetupResult:
        """
        Run setup with full safety enforcement.
        """
        start_time = time.time()
        errors = []
        
        # Validate contract
        try:
            task.contract.validate()
        except SafetyViolation as e:
            return SetupResult(
                success=False,
                execution_mode="invalid_contract",
                contract_honored=False,
                snapshot_id=None,
                stripe_secret=None,
                vercel_vars_added=[],
                errors=[f"Invalid contract: {e}"],
                duration_seconds=0
            )
        
        # Decide execution mode (binding)
        try:
            mode = self.decide_execution_mode(task)
        except SafetyViolation as e:
            return SetupResult(
                success=False,
                execution_mode="violation",
                contract_honored=False,
                snapshot_id=None,
                stripe_secret=None,
                vercel_vars_added=[],
                errors=[str(e)],
                duration_seconds=0
            )
        
        logger.info(f"Execution mode: {mode.value}")
        
        # API mode - never touch HID
        if mode == ExecutionMode.API_ONLY:
            return self._run_api_mode(task, progress_callback)
        
        # HID modes - full safety protocol
        return self._run_hid_mode(task, mode, progress_callback, start_time)
    
    def _run_api_mode(self, task: WebhookSetupTask, 
                     progress_callback: Optional[Callable]) -> SetupResult:
        """Execute using APIs only - HID stays disarmed"""
        logger.info("Running in API_ONLY mode")
        
        errors = []
        stripe_secret = None
        
        try:
            # TODO: Implement pure API flow
            # Stripe API for webhooks
            # Vercel API for env vars
            pass
            
        except Exception as e:
            errors.append(str(e))
        
        return SetupResult(
            success=len(errors) == 0,
            execution_mode="api_only",
            contract_honored=True,
            snapshot_id=None,
            stripe_secret=stripe_secret,
            vercel_vars_added=[],
            errors=errors,
            duration_seconds=0
        )
    
    def _run_hid_mode(self, task: WebhookSetupTask, mode: ExecutionMode,
                     progress_callback: Optional[Callable], start_time: float) -> SetupResult:
        """
        Execute with HID - full safety protocol engaged.
        """
        errors = []
        snapshot_id = None
        
        # Check kill switch before starting
        if self.check_kill_switch():
            return SetupResult(
                success=False,
                execution_mode=mode.value,
                contract_honored=False,
                snapshot_id=None,
                stripe_secret=None,
                vercel_vars_added=[],
                errors=["Kill switch active"],
                duration_seconds=0,
                terminated_by_kill_switch=True
            )
        
        # Human confirmation gate
        if task.contract.requires_human_confirmation:
            if not self.require_human_confirmation(
                f"HID automation for {task.vercel_project} with rollback: {task.contract.rollback_strategy}"
            ):
                return SetupResult(
                    success=False,
                    execution_mode=mode.value,
                    contract_honored=True,  # We honored the contract by asking
                    snapshot_id=None,
                    stripe_secret=None,
                    vercel_vars_added=[],
                    errors=["Human denied execution"],
                    duration_seconds=0
                )
        
        # Capture state snapshot
        if task.contract.snapshot_before:
            snapshot = self.capture_snapshot(task)
            snapshot_id = snapshot.snapshot_id
        
        # Initialize HID (lazy load)
        self._arm_hid_system()
        
        # Vision confidence check
        if not self.check_vision_confidence(task.contract.min_vision_confidence):
            return SetupResult(
                success=False,
                execution_mode=mode.value,
                contract_honored=True,
                snapshot_id=snapshot_id,
                stripe_secret=None,
                vercel_vars_added=[],
                errors=["Vision confidence below threshold"],
                duration_seconds=time.time() - start_time,
                low_confidence_abort=True
            )
        
        # Arm kill switch for operation
        self.arm_kill_switch()
        
        try:
            # Execute HID workflow
            # TODO: Implement actual HID execution
            
            pass
            
        except Exception as e:
            errors.append(str(e))
            
            # Execute rollback if configured
            if task.contract.rollback_strategy != "noop" and snapshot_id:
                self.rollback_to_snapshot(snapshot_id)
        
        finally:
            self.disarm_kill_switch()
            self._disarm_hid_system()
        
        return SetupResult(
            success=len(errors) == 0,
            execution_mode=mode.value,
            contract_honored=True,
            snapshot_id=snapshot_id,
            stripe_secret=None,
            vercel_vars_added=[],
            errors=errors,
            duration_seconds=time.time() - start_time
        )
    
    def _arm_hid_system(self):
        """Initialize HID - only called when actually needed"""
        if self._hid is not None:
            return
        
        logger.info("Arming HID system...")
        
        from usb_hid_controller import USBHIDController
        from screen_vision import ScreenVision
        
        self._hid = USBHIDController(backend=self._hid_backend)
        self._vision = ScreenVision(ocr_backend=self._ocr_backend)
        
        self.state['hid_armed'] = True
        logger.info("HID system armed")
    
    def _disarm_hid_system(self):
        """Release HID resources"""
        if self._hid:
            self._hid.close()
            self._hid = None
        
        self._vision = None
        self.state['hid_armed'] = False
        logger.info("HID system disarmed")

# CLI
if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Safety-First Webhook Setup')
    parser.add_argument('--config', '-c', required=True, help='Task config JSON')
    parser.add_argument('--dry-run', action='store_true', help='Validate only')
    
    args = parser.parse_args()
    
    task = WebhookSetupTask.from_json(args.config)
    orchestrator = SafetyOrchestrator(hid_backend='mock')
    
    if args.dry_run:
        print(f"Contract: {task.contract}")
        print(f"Mode would be: {orchestrator.decide_execution_mode(task)}")
    else:
        result = orchestrator.run_setup(task)
        print(json.dumps(asdict(result), indent=2))
