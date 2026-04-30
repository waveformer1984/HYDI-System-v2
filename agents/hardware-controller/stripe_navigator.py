#!/usr/bin/env python3
"""
Stripe Dashboard Navigator
Automates Stripe webhook setup via visual automation.
Uses USB HID for input and ScreenVision for feedback.
"""

import time
import logging
from typing import Optional, Dict
from dataclasses import dataclass

from usb_hid_controller import USBHIDController, KeyCode, Modifier
from screen_vision import ScreenVision

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('StripeNavigator')

@dataclass
class StripeCredentials:
    email: str
    password: str
    
@dataclass  
class WebhookConfig:
    endpoint_url: str
    events: list
    
class StripeNavigator:
    """
    Navigates Stripe Dashboard to configure webhooks.
    Uses visual feedback to verify each step.
    """
    
    # Stripe Dashboard URLs
    STRIPE_LOGIN_URL = "https://dashboard.stripe.com/login"
    STRIPE_WEBHOOKS_URL = "https://dashboard.stripe.com/webhooks"
    
    def __init__(self, hid_controller: USBHIDController, vision: ScreenVision):
        self.hid = hid_controller
        self.vision = vision
        self.current_page = 'unknown'
        
        # Navigation state
        self.state = {
            'logged_in': False,
            'on_webhooks_page': False,
            'webhook_created': False,
            'secret_copied': False
        }
    
    def navigate_to_login(self):
        """Navigate to Stripe login page"""
        logger.info("Navigating to Stripe login...")
        
        # Focus browser address bar
        self.hid.press_key_combo(KeyCode.L, modifiers=Modifier.LEFT_CTRL)
        time.sleep(0.2)
        
        # Type URL
        self.hid.type_string(self.STRIPE_LOGIN_URL)
        time.sleep(0.1)
        
        # Press enter
        self.hid.send_special_key(KeyCode.ENTER)
        
        # Wait for page to load
        time.sleep(3)
        
        # Verify we're on login page
        if self.vision.wait_for_text('Sign in to Stripe', timeout=10):
            logger.info("On Stripe login page")
            self.current_page = 'login'
            return True
        
        logger.error("Failed to reach Stripe login page")
        return False
    
    def login(self, credentials: StripeCredentials):
        """
        Log into Stripe Dashboard.
        
        Args:
            credentials: StripeCredentials with email and password
        """
        if self.current_page != 'login':
            if not self.navigate_to_login():
                return False
        
        logger.info("Logging into Stripe...")
        
        # Find and fill email field
        email_field = self.vision.find_input_field('Email')
        if email_field:
            # Click on email field
            self._click_at(email_field['center'])
            time.sleep(0.3)
            
            # Type email
            self.hid.type_string(credentials.email)
            time.sleep(0.2)
        
        # Tab to password or find password field
        self.hid.send_special_key(KeyCode.TAB)
        time.sleep(0.2)
        
        # Type password
        self.hid.type_string(credentials.password)
        time.sleep(0.2)
        
        # Press enter to submit
        self.hid.send_special_key(KeyCode.ENTER)
        time.sleep(3)
        
        # Verify login success
        if self.vision.wait_for_text('Dashboard', timeout=10):
            logger.info("Successfully logged in")
            self.state['logged_in'] = True
            self.current_page = 'dashboard'
            return True
        
        # Check for 2FA
        if self.vision.find_text('verification code'):
            logger.warning("2FA required - manual intervention needed")
            return self._handle_2fa()
        
        logger.error("Login failed")
        return False
    
    def _handle_2fa(self) -> bool:
        """Handle 2FA flow - requires manual input"""
        logger.info("Waiting for 2FA completion (manual input required)...")
        
        # Wait for user to complete 2FA
        for _ in range(60):  # Wait up to 60 seconds
            time.sleep(1)
            if self.vision.find_text('Dashboard'):
                logger.info("2FA completed")
                self.state['logged_in'] = True
                return True
        
        logger.error("2FA timeout")
        return False
    
    def navigate_to_webhooks(self):
        """Navigate to webhooks configuration page"""
        if not self.state['logged_in']:
            logger.error("Must be logged in first")
            return False
        
        logger.info("Navigating to webhooks page...")
        
        # Go to webhooks URL directly
        self.hid.press_key_combo(KeyCode.L, modifiers=Modifier.LEFT_CTRL)
        time.sleep(0.2)
        self.hid.type_string(self.STRIPE_WEBHOOKS_URL)
        time.sleep(0.1)
        self.hid.send_special_key(KeyCode.ENTER)
        
        # Wait for page load
        time.sleep(3)
        
        # Verify on webhooks page
        if self.vision.wait_for_text('Webhooks', timeout=10):
            logger.info("On webhooks page")
            self.current_page = 'webhooks'
            self.state['on_webhooks_page'] = True
            return True
        
        logger.error("Failed to reach webhooks page")
        return False
    
    def create_webhook_endpoint(self, config: WebhookConfig) -> Optional[str]:
        """
        Create a new webhook endpoint.
        
        Args:
            config: WebhookConfig with URL and events
            
        Returns:
            Signing secret if successful, None otherwise
        """
        if not self.state['on_webhooks_page']:
            if not self.navigate_to_webhooks():
                return None
        
        logger.info(f"Creating webhook endpoint: {config.endpoint_url}")
        
        # Click "Add endpoint" button
        add_button = self.vision.find_button('Add endpoint')
        if not add_button:
            # Try alternative text
            add_button = self.vision.find_button('Add')
        
        if add_button:
            self._click_at(add_button['center'])
            time.sleep(2)
        else:
            logger.error("Could not find 'Add endpoint' button")
            return None
        
        # Fill endpoint URL
        url_field = self.vision.find_input_field('Endpoint URL')
        if url_field:
            self._click_at(url_field['center'])
            time.sleep(0.3)
            self.hid.type_string(config.endpoint_url)
            time.sleep(0.2)
        else:
            # Try generic field detection
            self.hid.send_special_key(KeyCode.TAB)
            time.sleep(0.2)
            self.hid.type_string(config.endpoint_url)
        
        # Select events
        self._select_events(config.events)
        
        # Click "Add endpoint" to save
        time.sleep(0.5)
        save_button = self.vision.find_button('Add endpoint')
        if save_button:
            self._click_at(save_button['center'])
            time.sleep(3)
        
        # Verify webhook was created
        if self.vision.find_text(config.endpoint_url[:30]):
            logger.info("Webhook endpoint created")
            self.state['webhook_created'] = True
            
            # Extract and copy signing secret
            return self._extract_signing_secret()
        
        logger.error("Failed to create webhook endpoint")
        return None
    
    def _select_events(self, events: list):
        """Select webhook events from checklist"""
        logger.info(f"Selecting {len(events)} events...")
        
        for event in events:
            # Search for event or scroll to find it
            event_text = self._event_to_display_name(event)
            
            # Try to find and check the event
            event_elem = self.vision.find_text(event_text)
            if event_elem:
                # Click on checkbox (usually to the left of text)
                x, y = event_elem[0]['center']
                self._click_at((x - 30, y))  # Click checkbox
                time.sleep(0.2)
            else:
                logger.warning(f"Could not find event: {event}")
        
        logger.info("Event selection complete")
    
    def _event_to_display_name(self, event: str) -> str:
        """Convert event name to likely display text"""
        # Stripe typically shows human-readable names
        event_map = {
            'payment_intent.succeeded': 'payment_intent.succeeded',
            'payment_intent.payment_failed': 'payment_intent.payment_failed',
            'charge.refunded': 'charge.refunded',
            'checkout.session.completed': 'checkout.session.completed',
            'customer.subscription.created': 'customer.subscription.created',
            'customer.subscription.updated': 'customer.subscription.updated',
            'customer.subscription.deleted': 'customer.subscription.deleted',
        }
        return event_map.get(event, event)
    
    def _extract_signing_secret(self) -> Optional[str]:
        """Extract and copy the webhook signing secret"""
        logger.info("Extracting signing secret...")
        
        # Look for signing secret
        secret_elem = self.vision.find_text('whsec_')
        if secret_elem:
            # Click to reveal if needed
            self._click_at(secret_elem[0]['center'])
            time.sleep(0.5)
            
            # Try to copy
            self.hid.press_key_combo(KeyCode.C, modifiers=Modifier.LEFT_CTRL)
            time.sleep(0.2)
            
            # Secret is now in clipboard
            logger.info("Signing secret copied to clipboard")
            self.state['secret_copied'] = True
            
            # Return the visible secret (for logging/verification)
            return secret_elem[0]['text']
        
        # Try alternative: look for "Signing secret" label
        label = self.vision.find_text('Signing secret')
        if label:
            # Secret is usually below or to the right
            # Take a screenshot and OCR that region
            img = self.vision.capture()
            x, y, w, h = label[0]['box']
            secret_region = img[y:y+100, x:x+400]
            secret_text = self.vision.ocr_text(secret_region)
            
            for elem in secret_text:
                if elem['text'].startswith('whsec_'):
                    logger.info("Found signing secret via region OCR")
                    self.state['secret_copied'] = True
                    return elem['text']
        
        logger.error("Could not extract signing secret")
        return None
    
    def _click_at(self, position: tuple):
        """Click mouse at screen coordinates"""
        # Move mouse to position and click
        # Note: This requires the mouse controller to be properly positioned
        # For USB HID, we move relative to current position
        # This is simplified - real implementation needs absolute positioning
        x, y = position
        
        # Move mouse (simplified - assumes starting from known position)
        # In real implementation, track current mouse position
        self.hid.mouse_move(x, y)
        time.sleep(0.1)
        self.hid.mouse_click(0)  # Left click
        time.sleep(0.1)
    
    def run_full_setup(self, credentials: StripeCredentials, config: WebhookConfig) -> Optional[str]:
        """
        Run complete webhook setup workflow.
        
        Returns:
            Signing secret if successful
        """
        logger.info("Starting Stripe webhook setup...")
        
        # Step 1: Login
        if not self.navigate_to_login():
            return None
        
        if not self.login(credentials):
            return None
        
        # Step 2: Navigate to webhooks
        if not self.navigate_to_webhooks():
            return None
        
        # Step 3: Create webhook
        secret = self.create_webhook_endpoint(config)
        
        if secret:
            logger.info("Stripe webhook setup COMPLETE")
            logger.info(f"Endpoint: {config.endpoint_url}")
            logger.info(f"Secret: {secret[:10]}...")
        else:
            logger.error("Stripe webhook setup FAILED")
        
        return secret

if __name__ == '__main__':
    # Test navigator (in mock mode)
    from usb_hid_controller import USBHIDController
    from screen_vision import ScreenVision
    
    hid = USBHIDController(backend='mock')
    vision = ScreenVision(ocr_backend='tesseract')
    
    navigator = StripeNavigator(hid, vision)
    
    # Test with dummy credentials
    creds = StripeCredentials('test@example.com', 'password123')
    config = WebhookConfig(
        endpoint_url='https://heidi-chat-portal.vercel.app/api/webhooks/stripe',
        events=['payment_intent.succeeded', 'payment_intent.payment_failed']
    )
    
    # Note: This will fail in mock mode but shows the structure
    result = navigator.run_full_setup(creds, config)
    print(f"Result: {result}")
