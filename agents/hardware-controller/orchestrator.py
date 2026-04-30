#!/usr/bin/env python3
"""
Webhook Setup Orchestrator
Coordinates USB HID controller, screen vision, and dashboard navigators
to fully automate Stripe and Vercel webhook configuration.
"""

import time
import logging
import json
from dataclasses import dataclass, asdict
from typing import Optional, List, Dict, Callable
from pathlib import Path

from usb_hid_controller import USBHIDController
from screen_vision import ScreenVision
from stripe_navigator import StripeNavigator, StripeCredentials, WebhookConfig
from vercel_navigator import VercelNavigator, VercelCredentials, EnvVar

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('WebhookOrchestrator')

@dataclass
class WebhookSetupTask:
    """Task configuration for webhook setup"""
    stripe_email: str
    stripe_password: str
    vercel_email: str
    vercel_password: str
    vercel_project: str
    webhook_endpoint_url: str
    webhook_events: List[str]
    
    @classmethod
    def from_json(cls, path: str) -> 'WebhookSetupTask':
        with open(path) as f:
            data = json.load(f)
        return cls(**data)
    
    def to_json(self, path: str):
        with open(path, 'w') as f:
            json.dump(asdict(self), f, indent=2)

@dataclass
class SetupResult:
    """Result of webhook setup operation"""
    success: bool
    stripe_secret: Optional[str]
    vercel_vars_added: List[str]
    errors: List[str]
    duration_seconds: float

class WebhookSetupOrchestrator:
    """
    Orchestrates the complete webhook setup workflow:
    1. Login to Stripe
    2. Create webhook endpoint
    3. Copy signing secret
    4. Login to Vercel
    5. Add env vars (including webhook secret)
    6. Trigger redeploy
    """
    
    def __init__(self, hid_backend: str = 'auto', ocr_backend: str = 'auto'):
        """
        Initialize orchestrator.
        
        Args:
            hid_backend: 'gadget', 'serial', 'mock', or 'auto'
            ocr_backend: 'tesseract', 'paddle', 'easyocr', or 'auto'
        """
        logger.info("Initializing Webhook Setup Orchestrator...")
        
        # Initialize hardware interfaces
        self.hid = USBHIDController(backend=hid_backend)
        self.vision = ScreenVision(ocr_backend=ocr_backend)
        
        # Initialize navigators
        self.stripe = StripeNavigator(self.hid, self.vision)
        self.vercel = VercelNavigator(self.hid, self.vision)
        
        # State tracking
        self.state = {
            'phase': 'idle',
            'stripe_secret': None,
            'env_vars_configured': False,
            'redeploy_triggered': False
        }
        
        # Safety interlocks
        self.safety_enabled = True
        self.pause_on_2fa = True
        self.max_retries = 3
        
        logger.info("Orchestrator ready")
    
    def run_setup(self, task: WebhookSetupTask, 
                  progress_callback: Optional[Callable] = None) -> SetupResult:
        """
        Run complete webhook setup workflow.
        
        Args:
            task: Configuration for the setup
            progress_callback: Called with (phase, status, details) updates
            
        Returns:
            SetupResult with success status and details
        """
        start_time = time.time()
        errors = []
        
        def update(phase: str, status: str, details: dict = None):
            """Update progress"""
            self.state['phase'] = phase
            logger.info(f"[{phase}] {status}")
            if progress_callback:
                progress_callback(phase, status, details or {})
        
        try:
            # Phase 1: Stripe Login
            update('stripe_login', 'Starting...')
            stripe_creds = StripeCredentials(
                email=task.stripe_email,
                password=task.stripe_password
            )
            
            if not self.stripe.navigate_to_login():
                errors.append("Failed to navigate to Stripe login")
                return self._build_result(False, errors, start_time)
            
            if not self.stripe.login(stripe_creds):
                errors.append("Failed to login to Stripe")
                return self._build_result(False, errors, start_time)
            
            update('stripe_login', 'Complete', {'logged_in': True})
            
            # Phase 2: Create Stripe Webhook
            update('stripe_webhook', 'Creating endpoint...')
            webhook_config = WebhookConfig(
                endpoint_url=task.webhook_endpoint_url,
                events=task.webhook_events
            )
            
            if not self.stripe.navigate_to_webhooks():
                errors.append("Failed to navigate to Stripe webhooks")
                return self._build_result(False, errors, start_time)
            
            secret = self.stripe.create_webhook_endpoint(webhook_config)
            if not secret:
                errors.append("Failed to create webhook endpoint")
                return self._build_result(False, errors, start_time)
            
            self.state['stripe_secret'] = secret
            update('stripe_webhook', 'Created', {
                'endpoint_url': task.webhook_endpoint_url,
                'secret_prefix': secret[:10] + '...'
            })
            
            # Phase 3: Vercel Login
            update('vercel_login', 'Starting...')
            vercel_creds = VercelCredentials(
                email=task.vercel_email,
                password=task.vercel_password
            )
            
            if not self.vercel.navigate_to_login():
                errors.append("Failed to navigate to Vercel login")
                return self._build_result(False, errors, start_time)
            
            if not self.vercel.login(vercel_creds):
                errors.append("Failed to login to Vercel")
                return self._build_result(False, errors, start_time)
            
            update('vercel_login', 'Complete', {'logged_in': True})
            
            # Phase 4: Configure Vercel Env Vars
            update('vercel_env', 'Configuring environment variables...')
            
            if not self.vercel.select_project(task.vercel_project):
                errors.append(f"Failed to select project: {task.vercel_project}")
                return self._build_result(False, errors, start_time)
            
            # Prepare env vars including the webhook secret
            env_vars = [
                EnvVar('STRIPE_WEBHOOK_SECRET', secret),
                EnvVar('STRIPE_PUBLISHABLE_KEY', 'pk_live_...'),  # Would be provided in task
                EnvVar('STRIPE_SECRET_KEY', 'sk_live_...'),  # Would be provided in task
            ]
            
            results = self.vercel.add_multiple_env_vars(env_vars)
            
            successful_vars = [name for name, success in results.items() if success]
            failed_vars = [name for name, success in results.items() if not success]
            
            if failed_vars:
                errors.append(f"Failed to add env vars: {failed_vars}")
            
            self.state['env_vars_configured'] = len(successful_vars) > 0
            update('vercel_env', 'Configured', {
                'successful': successful_vars,
                'failed': failed_vars
            })
            
            # Phase 5: Redeploy
            update('vercel_redeploy', 'Triggering redeploy...')
            if self.vercel.trigger_redeploy():
                self.state['redeploy_triggered'] = True
                update('vercel_redeploy', 'Triggered')
            else:
                errors.append("Failed to trigger redeploy")
            
            # Complete
            success = len(errors) == 0
            update('complete', 'Success' if success else 'Partial Success', {
                'stripe_secret_copied': bool(secret),
                'env_vars_added': len(successful_vars),
                'redeployed': self.state['redeploy_triggered']
            })
            
            return SetupResult(
                success=success,
                stripe_secret=secret,
                vercel_vars_added=successful_vars,
                errors=errors,
                duration_seconds=time.time() - start_time
            )
            
        except Exception as e:
            logger.exception("Setup failed with exception")
            errors.append(f"Exception: {str(e)}")
            return self._build_result(False, errors, start_time)
    
    def _build_result(self, success: bool, errors: List[str], start_time: float) -> SetupResult:
        """Build result object"""
        return SetupResult(
            success=success,
            stripe_secret=self.state.get('stripe_secret'),
            vercel_vars_added=[],
            errors=errors,
            duration_seconds=time.time() - start_time
        )
    
    def pause_for_manual(self, message: str) -> bool:
        """
        Pause execution for manual intervention.
        
        Args:
            message: Instructions for manual action
            
        Returns:
            True if should continue, False to abort
        """
        if not self.safety_enabled:
            return True
        
        logger.warning(f"MANUAL INTERVENTION REQUIRED: {message}")
        
        # Visual indicator (if display available)
        # Could flash screen, play sound, etc.
        
        # Wait for user input
        try:
            response = input("Continue? (y/n): ").lower().strip()
            return response in ('y', 'yes', 'continue')
        except EOFError:
            # Non-interactive mode - auto-continue after delay
            time.sleep(5)
            return True
    
    def save_state(self, path: str):
        """Save current state to file"""
        with open(path, 'w') as f:
            json.dump(self.state, f, indent=2)
        logger.info(f"State saved to {path}")
    
    def load_state(self, path: str):
        """Load state from file"""
        if Path(path).exists():
            with open(path) as f:
                self.state = json.load(f)
            logger.info(f"State loaded from {path}")
    
    def close(self):
        """Clean up resources"""
        self.hid.close()
        logger.info("Orchestrator shutdown complete")

# CLI Interface
if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Webhook Setup Automation Agent')
    parser.add_argument('--config', '-c', help='Path to task config JSON')
    parser.add_argument('--mock', action='store_true', help='Use mock mode (no real hardware)')
    parser.add_argument('--save-state', '-s', help='Save state to file')
    parser.add_argument('--load-state', '-l', help='Load state from file')
    
    args = parser.parse_args()
    
    # Create orchestrator
    backend = 'mock' if args.mock else 'auto'
    orchestrator = WebhookSetupOrchestrator(hid_backend=backend, ocr_backend='tesseract')
    
    if args.load_state:
        orchestrator.load_state(args.load_state)
    
    # Load task or create example
    if args.config:
        task = WebhookSetupTask.from_json(args.config)
    else:
        # Example task
        task = WebhookSetupTask(
            stripe_email='your-email@example.com',
            stripe_password='your-password',
            vercel_email='your-email@example.com',
            vercel_password='your-password',
            vercel_project='heidi-chat-portal',
            webhook_endpoint_url='https://heidi-chat-portal.vercel.app/api/webhooks/stripe',
            webhook_events=[
                'payment_intent.succeeded',
                'payment_intent.payment_failed',
                'charge.refunded'
            ]
        )
        logger.info("Using example task - edit or provide --config")
    
    # Progress callback
    def on_progress(phase, status, details):
        print(f"\n>>> [{phase}] {status}")
        for key, val in details.items():
            print(f"    {key}: {val}")
    
    # Run setup
    print("=" * 50)
    print("WEBHOOK SETUP AUTOMATION")
    print("=" * 50)
    print(f"Stripe Email: {task.stripe_email}")
    print(f"Vercel Project: {task.vercel_project}")
    print(f"Webhook URL: {task.webhook_endpoint_url}")
    print("=" * 50)
    
    if not args.mock:
        confirm = input("\nThis will control your mouse and keyboard. Continue? (yes/no): ")
        if confirm.lower() != 'yes':
            print("Aborted.")
            orchestrator.close()
            exit(0)
    
    result = orchestrator.run_setup(task, progress_callback=on_progress)
    
    # Print results
    print("\n" + "=" * 50)
    print("SETUP RESULT")
    print("=" * 50)
    print(f"Success: {result.success}")
    print(f"Duration: {result.duration_seconds:.1f}s")
    print(f"Stripe Secret: {'*' * 20 if result.stripe_secret else 'N/A'}")
    print(f"Env Vars Added: {', '.join(result.vercel_vars_added) or 'None'}")
    if result.errors:
        print(f"\nErrors ({len(result.errors)}):")
        for err in result.errors:
            print(f"  - {err}")
    print("=" * 50)
    
    if args.save_state:
        orchestrator.save_state(args.save_state)
    
    orchestrator.close()
