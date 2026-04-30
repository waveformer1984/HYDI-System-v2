#!/usr/bin/env python3
"""
Screen Vision Module
Captures screen and performs OCR to understand UI state.
Uses mss for capture and pytesseract/paddleocr for text recognition.
"""

import cv2
import numpy as np
from PIL import Image
from typing import List, Tuple, Optional, Dict
import logging
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('ScreenVision')

class ScreenVision:
    """
    Screen capture and OCR for UI automation.
    Detects text, buttons, input fields, and UI elements.
    """
    
    def __init__(self, ocr_backend: str = 'auto'):
        """
        Initialize screen vision.
        
        Args:
            ocr_backend: 'tesseract', 'paddle', 'easyocr', or 'auto'
        """
        self.ocr_backend = ocr_backend
        self.ocr = None
        self.screen_width = 1920
        self.screen_height = 1080
        
        # Element templates (for template matching)
        self.templates = {}
        
        self._init_ocr()
        self._init_capture()
    
    def _init_ocr(self):
        """Initialize OCR engine"""
        if self.ocr_backend == 'auto':
            # Try backends in order of preference
            for backend in ['paddle', 'easyocr', 'tesseract']:
                try:
                    self._load_ocr_backend(backend)
                    logger.info(f"Loaded OCR backend: {backend}")
                    break
                except ImportError:
                    continue
        else:
            self._load_ocr_backend(self.ocr_backend)
    
    def _load_ocr_backend(self, backend: str):
        """Load specific OCR backend"""
        if backend == 'tesseract':
            import pytesseract
            self.ocr = pytesseract
            self.ocr_backend = 'tesseract'
        
        elif backend == 'paddle':
            from paddleocr import PaddleOCR
            self.ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False)
            self.ocr_backend = 'paddle'
        
        elif backend == 'easyocr':
            import easyocr
            self.ocr = easyocr.Reader(['en'])
            self.ocr_backend = 'easyocr'
    
    def _init_capture(self):
        """Initialize screen capture"""
        try:
            import mss
            self.sct = mss.mss()
            self.capture_method = 'mss'
            logger.info("Using mss for screen capture")
        except ImportError:
            try:
                import pyautogui
                self.capture_method = 'pyautogui'
                logger.info("Using pyautogui for screen capture")
            except ImportError:
                self.capture_method = 'none'
                logger.warning("No screen capture method available")
    
    def capture(self, region: Optional[Tuple[int, int, int, int]] = None) -> np.ndarray:
        """
        Capture screen region.
        
        Args:
            region: (x, y, width, height) or None for full screen
            
        Returns:
            BGR image as numpy array
        """
        if self.capture_method == 'mss':
            if region:
                monitor = {
                    "left": region[0],
                    "top": region[1],
                    "width": region[2],
                    "height": region[3]
                }
            else:
                monitor = self.sct.monitors[1]  # Primary monitor
            
            screenshot = self.sct.grab(monitor)
            img = np.array(screenshot)
            # Convert from BGRA to BGR
            img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
            return img
        
        elif self.capture_method == 'pyautogui':
            import pyautogui
            screenshot = pyautogui.screenshot(region=region)
            img = cv2.cvtColor(np.array(screenshot), cv2.COLOR_RGB2BGR)
            return img
        
        else:
            raise RuntimeError("No screen capture method available")
    
    def ocr_text(self, image: np.ndarray) -> List[Dict]:
        """
        Perform OCR on image.
        
        Returns:
            List of dicts with 'text', 'box', 'confidence'
        """
        results = []
        
        if self.ocr_backend == 'tesseract':
            data = self.ocr.image_to_data(
                Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)),
                output_type=self.ocr.Output.DICT
            )
            
            n_boxes = len(data['level'])
            for i in range(n_boxes):
                if int(data['conf'][i]) > 30:  # Confidence threshold
                    text = data['text'][i].strip()
                    if text:
                        x, y, w, h = data['left'][i], data['top'][i], data['width'][i], data['height'][i]
                        results.append({
                            'text': text,
                            'box': (x, y, w, h),
                            'confidence': data['conf'][i] / 100.0,
                            'center': (x + w//2, y + h//2)
                        })
        
        elif self.ocr_backend == 'paddle':
            result = self.ocr.ocr(image, cls=True)
            if result and result[0]:
                for line in result[0]:
                    box, (text, confidence) = line
                    x_coords = [p[0] for p in box]
                    y_coords = [p[1] for p in box]
                    x, y = min(x_coords), min(y_coords)
                    w, h = max(x_coords) - x, max(y_coords) - y
                    
                    results.append({
                        'text': text,
                        'box': (int(x), int(y), int(w), int(h)),
                        'confidence': confidence,
                        'center': (int(x + w//2), int(y + h//2))
                    })
        
        elif self.ocr_backend == 'easyocr':
            result = self.ocr.readtext(image)
            for (bbox, text, confidence) in result:
                x_coords = [p[0] for p in bbox]
                y_coords = [p[1] for p in bbox]
                x, y = min(x_coords), min(y_coords)
                w, h = max(x_coords) - x, max(y_coords) - y
                
                results.append({
                    'text': text,
                    'box': (int(x), int(y), int(w), int(h)),
                    'confidence': confidence,
                    'center': (int(x + w//2), int(y + h//2))
                })
        
        return results
    
    def find_text(self, target: str, image: Optional[np.ndarray] = None) -> List[Dict]:
        """
        Find specific text on screen.
        
        Args:
            target: Text to search for
            image: Pre-captured image or None to capture fresh
            
        Returns:
            List of matches with positions
        """
        if image is None:
            image = self.capture()
        
        all_text = self.ocr_text(image)
        matches = []
        
        target_lower = target.lower()
        for item in all_text:
            if target_lower in item['text'].lower():
                matches.append(item)
        
        return matches
    
    def find_button(self, label: str, image: Optional[np.ndarray] = None) -> Optional[Dict]:
        """
        Find a button with specific label.
        Uses heuristic: buttons are typically text with surrounding visual elements.
        
        Args:
            label: Button text to find
            image: Pre-captured image or None to capture fresh
            
        Returns:
            Button position or None
        """
        matches = self.find_text(label, image)
        
        # Return highest confidence match
        if matches:
            return max(matches, key=lambda x: x['confidence'])
        return None
    
    def find_input_field(self, placeholder: str, image: Optional[np.ndarray] = None) -> Optional[Dict]:
        """
        Find an input field by its placeholder/label.
        
        Args:
            placeholder: Placeholder text or label
            image: Pre-captured image or None to capture fresh
            
        Returns:
            Field position or None
        """
        matches = self.find_text(placeholder, image)
        
        # Look for the field itself (usually below or to the right of label)
        if matches:
            match = matches[0]
            # Heuristic: input field is often a rectangle near the text
            # Return position slightly below the label
            x, y, w, h = match['box']
            return {
                'box': (x, y + h + 10, w, 30),  # Estimated field position
                'center': (x + w//2, y + h + 25),
                'confidence': match['confidence']
            }
        return None
    
    def wait_for_text(self, target: str, timeout: float = 10.0, interval: float = 0.5) -> Optional[Dict]:
        """
        Wait for text to appear on screen.
        
        Args:
            target: Text to wait for
            timeout: Maximum wait time in seconds
            interval: Check interval in seconds
            
        Returns:
            Match position or None if timeout
        """
        start = time.time()
        while time.time() - start < timeout:
            matches = self.find_text(target)
            if matches:
                return matches[0]
            time.sleep(interval)
        return None
    
    def detect_ui_state(self, image: Optional[np.ndarray] = None) -> Dict:
        """
        Detect overall UI state by analyzing common elements.
        
        Returns:
            Dict with detected elements and state
        """
        if image is None:
            image = self.capture()
        
        all_text = self.ocr_text(image)
        texts = [t['text'].lower() for t in all_text]
        text_str = ' '.join(texts)
        
        state = {
            'page_type': 'unknown',
            'elements': {},
            'all_text': all_text
        }
        
        # Detect Stripe Dashboard pages
        if 'stripe' in text_str and 'dashboard' in text_str:
            state['page_type'] = 'stripe_dashboard'
            
            if 'developers' in text_str:
                state['page_type'] = 'stripe_developers'
            elif 'webhooks' in text_str:
                state['page_type'] = 'stripe_webhooks'
                # Look for webhook UI elements
                if any('add endpoint' in t for t in texts):
                    state['elements']['add_endpoint_button'] = True
                if any('endpoint url' in t for t in texts):
                    state['elements']['url_input'] = True
        
        # Detect Vercel Dashboard pages
        elif 'vercel' in text_str:
            state['page_type'] = 'vercel_dashboard'
            
            if 'environment variables' in text_str or 'env' in text_str:
                state['page_type'] = 'vercel_env_vars'
                if any('add' in t for t in texts):
                    state['elements']['add_var_button'] = True
        
        # Detect login pages
        if any(t in text_str for t in ['sign in', 'login', 'log in', 'password']):
            state['is_login_page'] = True
        
        return state
    
    def highlight_elements(self, image: np.ndarray, elements: List[Dict]) -> np.ndarray:
        """
        Draw boxes around detected elements (for debugging).
        
        Args:
            image: Source image
            elements: Elements to highlight
            
        Returns:
            Image with highlights
        """
        result = image.copy()
        for elem in elements:
            x, y, w, h = elem['box']
            cv2.rectangle(result, (x, y), (x+w, y+h), (0, 255, 0), 2)
            cv2.putText(result, elem['text'][:20], (x, y-5), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
        return result
    
    def save_debug_image(self, image: np.ndarray, elements: List[Dict], path: str):
        """Save annotated image for debugging"""
        highlighted = self.highlight_elements(image, elements)
        cv2.imwrite(path, highlighted)
        logger.info(f"Saved debug image: {path}")

if __name__ == '__main__':
    # Test the vision system
    vision = ScreenVision(ocr_backend='tesseract')
    
    print("Capturing screen...")
    img = vision.capture()
    print(f"Captured: {img.shape}")
    
    print("Performing OCR...")
    text_elements = vision.ocr_text(img)
    
    print(f"Found {len(text_elements)} text elements:")
    for elem in text_elements[:10]:
        print(f"  '{elem['text']}' at {elem['center']} (conf: {elem['confidence']:.2f})")
    
    print("Detecting UI state...")
    state = vision.detect_ui_state(img)
    print(f"State: {state['page_type']}")
    
    # Save debug image
    vision.save_debug_image(img, text_elements, '/tmp/screen_debug.png')
