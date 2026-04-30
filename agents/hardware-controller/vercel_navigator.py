#!/usr/bin/env python3
"""
Vercel Dashboard Navigator
Automates Vercel environment variable configuration.
"""

import time
import logging
from typing import Optional, List, Dict
from dataclasses import dataclass

from usb_hid_controller import USBHIDController, KeyCode, Modifier
from screen_vision import ScreenVision

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('VercelNavigator')

@dataclass
class VercelCredentials:
    email: str
    password: str

@dataclass
class EnvVar:
    name: str
    value: str
    environment: str = 'production'  # production, preview, development

class VercelNavigator:
    """
    Navigates Vercel Dashboard to configure environment variables.
    """
    
    VERCEL_LOGIN_URL = "https://vercel.com/login"
    
    def __init__(self, hid_controller: USBHIDController, vision: ScreenVision):
        self.hid = hid_controller
        self.vision = vision
        self.current_page = 'unknown'
        self.project_name: Optional[str] = None
        
        self.state = {
            'logged_in': False,
            'project_selected': False,
            'on_settings_page': False,
            'env_vars_added': []
        }
    
    def navigate_to_login(self):
        """Navigate to Vercel login page"""
        logger.info("Navigating to Vercel login...")
        
        self.hid.press_key_combo(KeyCode.L, modifiers=Modifier.LEFT_CTRL)
        time.sleep(0.2)
        self.hid.type_string(self.VERCEL_LOGIN_URL)
        time.sleep(0.1)
        self.hid.send_special_key(KeyCode.ENTER)
        time.sleep(3)
        
        if self.vision.wait_for_text('Log in', timeout=10):
            logger.info("On Vercel login page")
            self.current_page = 'login'
            return True
        
        logger.error("Failed to reach Vercel login")
        return False
    
    def login(self, credentials: VercelCredentials):
        """Log into Vercel Dashboard"""
        if self.current_page != 'login':
            if not self.navigate_to_login():
                return False
        
        logger.info("Logging into Vercel...")
        
        # Vercel often uses GitHub/GitLab/Bitbucket OAuth
        # Check for "Continue with GitHub" or similar
        github_btn = self.vision.find_button('Continue with GitHub')
        if github_btn:
            logger.info("GitHub OAuth detected")
            self._click_at(github_btn['center'])
            time.sleep(3)
            # Handle GitHub login flow
            return self._handle_github_login(credentials)
        
        # Direct email/password login (less common)
        email_field = self.vision.find_input_field('Email')
        if email_field:
            self._click_at(email_field['center'])
            time.sleep(0.3)
            self.hid.type_string(credentials.email)
            time.sleep(0.2)
            
            self.hid.send_special_key(KeyCode.TAB)
            time.sleep(0.2)
            self.hid.type_string(credentials.password)
            time.sleep(0.2)
            
            self.hid.send_special_key(KeyCode.ENTER)
            time.sleep(3)
        
        # Verify login
        if self.vision.wait_for_text('Dashboard', timeout=10):
            logger.info("Logged into Vercel")
            self.state['logged_in'] = True
            self.current_page = 'dashboard'
            return True
        
        logger.error("Vercel login failed")
        return False
    
    def _handle_github_login(self, credentials: VercelCredentials) -> bool:
        """Handle GitHub OAuth flow"""
        # Look for GitHub login page
        if self.vision.wait_for_text('Sign in to GitHub', timeout=10):
            # Fill GitHub credentials
            self.hid.type_string(credentials.email)
            time.sleep(0.2)
            self.hid.send_special_key(KeyCode.TAB)
            time.sleep(0.2)
            self.hid.type_string(credentials.password)
            time.sleep(0.2)
            self.hid.send_special_key(KeyCode.ENTER)
            time.sleep(3)
            
            # Check for 2FA
            if self.vision.find_text('Authentication code'):
                logger.warning("GitHub 2FA required")
                return self._handle_2fa()
            
            # Check for authorize screen
            if self.vision.wait_for_text('Authorize Vercel', timeout=10):
                auth_btn = self.vision.find_button('Authorize')
                if auth_btn:
                    self._click_at(auth_btn['center'])
                    time.sleep(3)
        
        return self.vision.wait_for_text('Dashboard', timeout=10)
    
    def _handle_2fa(self) -> bool:
        """Handle 2FA - requires manual input"""
        logger.info("Waiting for 2FA (manual input required)...")
        for _ in range(60):
            time.sleep(1)
            if self.vision.find_text('Dashboard'):
                return True
        return False
    
    def select_project(self, project_name: str):
        """Select a specific project from dashboard"""
        if not self.state['logged_in']:
            logger.error("Must be logged in")
            return False
        
        logger.info(f"Selecting project: {project_name}")
        
        # Look for project on dashboard
        project_elem = self.vision.find_text(project_name)
        if project_elem:
            self._click_at(project_elem[0]['center'])
            time.sleep(2)
            
            if self.vision.wait_for_text(project_name, timeout=5):
                self.project_name = project_name
                self.state['project_selected'] = True
                logger.info("Project selected")
                return True
        
        # Try direct URL
        self.hid.press_key_combo(KeyCode.L, modifiers=Modifier.LEFT_CTRL)
        time.sleep(0.2)
        self.hid.type_string(f"https://vercel.com/dashboard/{project_name}/settings")
        time.sleep(0.1)
        self.hid.send_special_key(KeyCode.ENTER)
        time.sleep(3)
        
        if self.vision.wait_for_text('Settings', timeout=10):
            self.project_name = project_name
            self.state['project_selected'] = True
            return True
        
        logger.error(f"Could not select project: {project_name}")
        return False
    
    def navigate_to_env_vars(self):
        """Navigate to environment variables settings"""
        if not self.state['project_selected']:
            logger.error("Must select project first")
            return False
        
        logger.info("Navigating to Environment Variables...")
        
        # Look for Environment Variables link/tab
        env_tab = self.vision.find_text('Environment Variables')
        if env_tab:
            self._click_at(env_tab[0]['center'])
            time.sleep(2)
        else:
            # Try direct URL
            self.hid.press_key_combo(KeyCode.L, modifiers=Modifier.LEFT_CTRL)
            time.sleep(0.2)
            self.hid.type_string(f"https://vercel.com/dashboard/{self.project_name}/settings/environment-variables")
            time.sleep(0.1)
            self.hid.send_special_key(KeyCode.ENTER)
            time.sleep(3)
        
        if self.vision.wait_for_text('Environment Variables', timeout=10):
            logger.info("On Environment Variables page")
            self.state['on_settings_page'] = True
            self.current_page = 'env_vars'
            return True
        
        logger.error("Could not reach Environment Variables page")
        return False
    
    def add_environment_variable(self, env_var: EnvVar) -> bool:
        """
        Add a single environment variable.
        
        Args:
            env_var: EnvVar with name, value, and environment
            
        Returns:
            True if successful
        """
        if not self.state['on_settings_page']:
            if not self.navigate_to_env_vars():
                return False
        
        logger.info(f"Adding env var: {env_var.name}")
        
        # Click "Add" button
        add_btn = self.vision.find_button('Add')
        if not add_btn:
            add_btn = self.vision.find_button('+')
        
        if add_btn:
            self._click_at(add_btn['center'])
            time.sleep(1)
        else:
            logger.error("Could not find Add button")
            return False
        
        # Fill name field
        name_field = self.vision.find_input_field('Name')
        if name_field:
            self._click_at(name_field['center'])
            time.sleep(0.3)
            self.hid.type_string(env_var.name)
            time.sleep(0.2)
        
        # Fill value field
        value_field = self.vision.find_input_field('Value')
        if value_field:
            self.hid.send_special_key(KeyCode.TAB)
            time.sleep(0.2)
            self.hid.type_string(env_var.value)
            time.sleep(0.2)
        
        # Select environment (if not default)
        if env_var.environment != 'production':
            # Click environment dropdown
            env_dropdown = self.vision.find_text('Production')
            if env_dropdown:
                self._click_at(env_dropdown[0]['center'])
                time.sleep(0.5)
                
                # Select appropriate environment
                target_env = self.vision.find_text(env_var.environment.capitalize())
                if target_env:
                    self._click_at(target_env[0]['center'])
                    time.sleep(0.3)
        
        # Save
        save_btn = self.vision.find_button('Save')
        if not save_btn:
            save_btn = self.vision.find_button('Add')
        
        if save_btn:
            self._click_at(save_btn['center'])
            time.sleep(2)
            
            # Verify added
            if self.vision.find_text(env_var.name):
                logger.info(f"Env var {env_var.name} added successfully")
                self.state['env_vars_added'].append(env_var.name)
                return True
        
        logger.error(f"Failed to add env var: {env_var.name}")
        return False
    
    def add_multiple_env_vars(self, env_vars: List[EnvVar]) -> Dict[str, bool]:
        """
        Add multiple environment variables.
        
        Returns:
            Dict mapping var names to success status
        """
        results = {}
        
        for env_var in env_vars:
            results[env_var.name] = self.add_environment_variable(env_var)
            time.sleep(1)  # Brief pause between vars
        
        return results
    
    def trigger_redeploy(self):
        """Trigger a redeploy of the project"""
        if not self.state['project_selected']:
            logger.error("Must select project first")
            return False
        
        logger.info("Triggering redeploy...")
        
        # Navigate to deployments
        self.hid.press_key_combo(KeyCode.L, modifiers=Modifier.LEFT_CTRL)
        time.sleep(0.2)
        self.hid.type_string(f"https://vercel.com/dashboard/{self.project_name}/deployments")
        time.sleep(0.1)
        self.hid.send_special_key(KeyCode.ENTER)
        time.sleep(3)
        
        # Look for "Redeploy" button
        redeploy_btn = self.vision.find_button('Redeploy')
        if redeploy_btn:
            self._click_at(redeploy_btn['center'])
            time.sleep(2)
            
            # Confirm if prompted
            confirm_btn = self.vision.find_button('Redeploy anyway')
            if confirm_btn:
                self._click_at(confirm_btn['center'])
                time.sleep(3)
            
            logger.info("Redeploy triggered")
            return True
        
        logger.error("Could not find redeploy button")
        return False
    
    def _click_at(self, position: tuple):
        """Click at screen coordinates"""
        x, y = position
        self.hid.mouse_move(x, y)
        time.sleep(0.1)
        self.hid.mouse_click(0)
        time.sleep(0.1)
    
    def run_full_setup(self, credentials: VercelCredentials, project_name: str, 
                      env_vars: List[EnvVar]) -> bool:
        """
        Run complete Vercel env var setup workflow.
        
        Returns:
            True if all env vars added and redeploy triggered
        """
        logger.info(f"Starting Vercel setup for project: {project_name}")
        
        # Login
        if not self.navigate_to_login():
            return False
        if not self.login(credentials):
            return False
        
        # Select project
        if not self.select_project(project_name):
            return False
        
        # Add env vars
        results = self.add_multiple_env_vars(env_vars)
        
        success_count = sum(1 for v in results.values() if v)
        logger.info(f"Added {success_count}/{len(env_vars)} environment variables")
        
        # Redeploy
        if success_count > 0:
            if self.trigger_redeploy():
                logger.info("Vercel setup COMPLETE")
                return True
        
        logger.error("Vercel setup FAILED")
        return False

if __name__ == '__main__':
    from usb_hid_controller import USBHIDController
    from screen_vision import ScreenVision
    
    hid = USBHIDController(backend='mock')
    vision = ScreenVision(ocr_backend='tesseract')
    
    navigator = VercelNavigator(hid, vision)
    
    creds = VercelCredentials('test@example.com', 'password123')
    env_vars = [
        EnvVar('STRIPE_WEBHOOK_SECRET', 'whsec_test_123'),
        EnvVar('STRIPE_PUBLISHABLE_KEY', 'pk_test_123'),
        EnvVar('STRIPE_SECRET_KEY', 'sk_test_123')
    ]
    
    result = navigator.run_full_setup(creds, 'heidi-chat-portal', env_vars)
    print(f"Setup result: {result}")
