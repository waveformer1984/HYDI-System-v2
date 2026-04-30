#!/usr/bin/env python3
"""
USB HID Controller Agent
Controls USB keyboard and mouse via Raspberry Pi Zero W (USB gadget mode)
or Arduino-based HID emulator.

Hardware Requirements:
- Raspberry Pi Zero W with USB OTG port
- OR Arduino Pro Micro (ATmega32U4) with HID firmware
- Target computer with USB ports

Setup (Raspberry Pi):
1. Enable USB gadget mode in /boot/config.txt: dtoverlay=dwc2
2. Enable modules: echo "dwc2" | sudo tee -a /etc/modules
3. Create HID gadget via configfs (see setup_usb_gadget.sh)
"""

import os
import time
import struct
from enum import IntEnum
from typing import Tuple, Optional
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('USB-HID')

class KeyCode(IntEnum):
    """USB HID Keycodes"""
    A = 0x04
    B = 0x05
    C = 0x06
    D = 0x07
    E = 0x08
    F = 0x09
    G = 0x0A
    H = 0x0B
    I = 0x0C
    J = 0x0D
    K = 0x0E
    L = 0x0F
    M = 0x10
    N = 0x11
    O = 0x12
    P = 0x13
    Q = 0x14
    R = 0x15
    S = 0x16
    T = 0x17
    U = 0x18
    V = 0x19
    W = 0x1A
    X = 0x1B
    Y = 0x1C
    Z = 0x1D
    _1 = 0x1E
    _2 = 0x1F
    _3 = 0x20
    _4 = 0x21
    _5 = 0x22
    _6 = 0x23
    _7 = 0x24
    _8 = 0x25
    _9 = 0x26
    _0 = 0x27
    ENTER = 0x28
    ESCAPE = 0x29
    BACKSPACE = 0x2A
    TAB = 0x2B
    SPACE = 0x2C
    MINUS = 0x2D
    EQUAL = 0x2E
    BRACKET_LEFT = 0x2F
    BRACKET_RIGHT = 0x30
    BACKSLASH = 0x31
    SEMICOLON = 0x33
    QUOTE = 0x34
    GRAVE = 0x35
    COMMA = 0x36
    PERIOD = 0x37
    SLASH = 0x38
    CAPS_LOCK = 0x39
    F1 = 0x3A
    F2 = 0x3B
    F3 = 0x3C
    F4 = 0x3D
    F5 = 0x3E
    F6 = 0x3F
    F7 = 0x40
    F8 = 0x41
    F9 = 0x42
    F10 = 0x43
    F11 = 0x44
    F12 = 0x45
    HOME = 0x4A
    PAGE_UP = 0x4B
    DELETE = 0x4C
    END = 0x4D
    PAGE_DOWN = 0x4E
    RIGHT = 0x4F
    LEFT = 0x50
    DOWN = 0x51
    UP = 0x52

class Modifier(IntEnum):
    """USB HID Modifiers"""
    NONE = 0x00
    LEFT_CTRL = 0x01
    LEFT_SHIFT = 0x02
    LEFT_ALT = 0x04
    LEFT_META = 0x08
    RIGHT_CTRL = 0x10
    RIGHT_SHIFT = 0x20
    RIGHT_ALT = 0x40
    RIGHT_META = 0x80

class USBHIDController:
    """
    USB HID Controller for keyboard and mouse emulation.
    Supports both Linux USB gadget mode and serial-based (Arduino) backends.
    """
    
    def __init__(self, backend: str = 'auto'):
        """
        Initialize USB HID controller.
        
        Args:
            backend: 'gadget' (Linux USB gadget), 'serial' (Arduino), or 'auto'
        """
        self.backend = backend
        self.keyboard_fd: Optional[int] = None
        self.mouse_fd: Optional[int] = None
        self.serial_port: Optional[object] = None
        
        # Key character to HID code mapping
        self._char_to_hid = self._build_char_map()
        
        if backend == 'auto':
            self._detect_backend()
        
        self._init_backend()
    
    def _detect_backend(self):
        """Auto-detect available backend"""
        if os.path.exists('/dev/hidg0'):
            self.backend = 'gadget'
            logger.info("Detected Linux USB gadget backend")
        elif os.path.exists('/dev/ttyACM0') or os.path.exists('/dev/ttyUSB0'):
            self.backend = 'serial'
            logger.info("Detected Arduino serial backend")
        else:
            # Fallback to mock mode for testing
            self.backend = 'mock'
            logger.warning("No HID hardware detected, using mock mode")
    
    def _init_backend(self):
        """Initialize the selected backend"""
        if self.backend == 'gadget':
            try:
                self.keyboard_fd = os.open('/dev/hidg0', os.O_RDWR | os.O_NONBLOCK)
                self.mouse_fd = os.open('/dev/hidg1', os.O_RDWR | os.O_NONBLOCK) if os.path.exists('/dev/hidg1') else None
                logger.info("Opened USB gadget HID devices")
            except OSError as e:
                logger.error(f"Failed to open HID devices: {e}")
                raise
        
        elif self.backend == 'serial':
            import serial
            port = '/dev/ttyACM0' if os.path.exists('/dev/ttyACM0') else '/dev/ttyUSB0'
            self.serial_port = serial.Serial(port, 9600, timeout=1)
            logger.info(f"Opened serial port: {port}")
    
    def _build_char_map(self) -> dict:
        """Build character to HID keycode mapping"""
        mapping = {}
        
        # Lowercase letters
        for i, c in enumerate('abcdefghijklmnopqrstuvwxyz'):
            mapping[c] = (KeyCode.A + i, Modifier.NONE)
        
        # Uppercase letters (with shift)
        for i, c in enumerate('ABCDEFGHIJKLMNOPQRSTUVWXYZ'):
            mapping[c] = (KeyCode.A + i, Modifier.LEFT_SHIFT)
        
        # Numbers
        mapping['1'] = (KeyCode._1, Modifier.NONE)
        mapping['2'] = (KeyCode._2, Modifier.NONE)
        mapping['3'] = (KeyCode._3, Modifier.NONE)
        mapping['4'] = (KeyCode._4, Modifier.NONE)
        mapping['5'] = (KeyCode._5, Modifier.NONE)
        mapping['6'] = (KeyCode._6, Modifier.NONE)
        mapping['7'] = (KeyCode._7, Modifier.NONE)
        mapping['8'] = (KeyCode._8, Modifier.NONE)
        mapping['9'] = (KeyCode._9, Modifier.NONE)
        mapping['0'] = (KeyCode._0, Modifier.NONE)
        
        # Special characters (unshifted)
        mapping['\n'] = (KeyCode.ENTER, Modifier.NONE)
        mapping['\t'] = (KeyCode.TAB, Modifier.NONE)
        mapping[' '] = (KeyCode.SPACE, Modifier.NONE)
        mapping['-'] = (KeyCode.MINUS, Modifier.NONE)
        mapping['='] = (KeyCode.EQUAL, Modifier.NONE)
        mapping['['] = (KeyCode.BRACKET_LEFT, Modifier.NONE)
        mapping[']'] = (KeyCode.BRACKET_RIGHT, Modifier.NONE)
        mapping['\\'] = (KeyCode.BACKSLASH, Modifier.NONE)
        mapping[';'] = (KeyCode.SEMICOLON, Modifier.NONE)
        mapping["'"] = (KeyCode.QUOTE, Modifier.NONE)
        mapping['`'] = (KeyCode.GRAVE, Modifier.NONE)
        mapping[','] = (KeyCode.COMMA, Modifier.NONE)
        mapping['.'] = (KeyCode.PERIOD, Modifier.NONE)
        mapping['/'] = (KeyCode.SLASH, Modifier.NONE)
        
        # Special characters (with shift)
        mapping['!'] = (KeyCode._1, Modifier.LEFT_SHIFT)
        mapping['@'] = (KeyCode._2, Modifier.LEFT_SHIFT)
        mapping['#'] = (KeyCode._3, Modifier.LEFT_SHIFT)
        mapping['$'] = (KeyCode._4, Modifier.LEFT_SHIFT)
        mapping['%'] = (KeyCode._5, Modifier.LEFT_SHIFT)
        mapping['^'] = (KeyCode._6, Modifier.LEFT_SHIFT)
        mapping['&'] = (KeyCode._7, Modifier.LEFT_SHIFT)
        mapping['*'] = (KeyCode._8, Modifier.LEFT_SHIFT)
        mapping['('] = (KeyCode._9, Modifier.LEFT_SHIFT)
        mapping[')'] = (KeyCode._0, Modifier.LEFT_SHIFT)
        mapping['_'] = (KeyCode.MINUS, Modifier.LEFT_SHIFT)
        mapping['+'] = (KeyCode.EQUAL, Modifier.LEFT_SHIFT)
        mapping['{'] = (KeyCode.BRACKET_LEFT, Modifier.LEFT_SHIFT)
        mapping['}'] = (KeyCode.BRACKET_RIGHT, Modifier.LEFT_SHIFT)
        mapping['|'] = (KeyCode.BACKSLASH, Modifier.LEFT_SHIFT)
        mapping[':'] = (KeyCode.SEMICOLON, Modifier.LEFT_SHIFT)
        mapping['"'] = (KeyCode.QUOTE, Modifier.LEFT_SHIFT)
        mapping['~'] = (KeyCode.GRAVE, Modifier.LEFT_SHIFT)
        mapping['<'] = (KeyCode.COMMA, Modifier.LEFT_SHIFT)
        mapping['>'] = (KeyCode.PERIOD, Modifier.LEFT_SHIFT)
        mapping['?'] = (KeyCode.SLASH, Modifier.LEFT_SHIFT)
        
        return mapping
    
    def send_key(self, keycode: KeyCode, modifiers: int = 0, press_time: float = 0.05):
        """
        Send a single keypress.
        
        Args:
            keycode: HID keycode to send
            modifiers: Modifier bitmask
            press_time: Duration of keypress in seconds
        """
        report = bytes([modifiers, 0x00, keycode, 0x00, 0x00, 0x00, 0x00, 0x00])
        release = bytes([0x00] * 8)
        
        if self.backend == 'gadget':
            os.write(self.keyboard_fd, report)
            time.sleep(press_time)
            os.write(self.keyboard_fd, release)
        
        elif self.backend == 'serial':
            # Arduino HID protocol: [0x01, modifiers, keycode]
            self.serial_port.write(bytes([0x01, modifiers, keycode]))
            time.sleep(press_time)
            self.serial_port.write(bytes([0x01, 0x00, 0x00]))  # Release
        
        elif self.backend == 'mock':
            logger.debug(f"[MOCK] Key: {keycode:02x}, Mods: {modifiers:02x}")
    
    def type_string(self, text: str, delay: float = 0.01):
        """
        Type a string of characters.
        
        Args:
            text: String to type
            delay: Delay between characters
        """
        for char in text:
            if char in self._char_to_hid:
                keycode, modifier = self._char_to_hid[char]
                self.send_key(keycode, modifier)
                time.sleep(delay)
            else:
                logger.warning(f"Unknown character: {repr(char)}")
    
    def press_key_combo(self, *keys: KeyCode, modifiers: int = 0):
        """
        Press multiple keys simultaneously.
        
        Args:
            keys: Up to 6 keycodes to press
            modifiers: Modifier bitmask
        """
        report = [modifiers, 0x00] + [k.value for k in keys[:6]] + [0x00] * (6 - len(keys))
        report = bytes(report[:8])
        release = bytes([0x00] * 8)
        
        if self.backend == 'gadget':
            os.write(self.keyboard_fd, report)
            time.sleep(0.1)
            os.write(self.keyboard_fd, release)
        
        elif self.backend == 'serial':
            for i, key in enumerate(keys[:3]):
                self.serial_port.write(bytes([0x01, modifiers if i == 0 else 0, key]))
            time.sleep(0.1)
            self.serial_port.write(bytes([0x01, 0x00, 0x00]))
    
    def send_special_key(self, key: KeyCode, modifiers: int = 0):
        """Send a special key (arrows, function keys, etc.)"""
        self.send_key(key, modifiers)
    
    def mouse_move(self, x: int, y: int):
        """
        Move mouse relative to current position.
        
        Args:
            x: Horizontal movement (-127 to 127)
            y: Vertical movement (-127 to 127)
        """
        x = max(-127, min(127, x))
        y = max(-127, min(127, y))
        
        if self.backend == 'gadget' and self.mouse_fd:
            # USB HID mouse report: [buttons, x, y, wheel]
            report = bytes([0x00, x & 0xFF, y & 0xFF, 0x00])
            os.write(self.mouse_fd, report)
        
        elif self.backend == 'serial':
            # Mouse protocol: [0x02, x, y, buttons]
            self.serial_port.write(bytes([0x02, x & 0xFF, y & 0xFF, 0x00]))
    
    def mouse_click(self, button: int = 0):
        """
        Click mouse button.
        
        Args:
            button: 0=left, 1=right, 2=middle
        """
        buttons = [0x01, 0x02, 0x04][button]
        
        if self.backend == 'gadget' and self.mouse_fd:
            # Press
            os.write(self.mouse_fd, bytes([buttons, 0x00, 0x00, 0x00]))
            time.sleep(0.05)
            # Release
            os.write(self.mouse_fd, bytes([0x00, 0x00, 0x00, 0x00]))
        
        elif self.backend == 'serial':
            self.serial_port.write(bytes([0x02, 0x00, 0x00, buttons]))
            time.sleep(0.05)
            self.serial_port.write(bytes([0x02, 0x00, 0x00, 0x00]))
    
    def close(self):
        """Close HID connections"""
        if self.keyboard_fd:
            os.close(self.keyboard_fd)
        if self.mouse_fd:
            os.close(self.mouse_fd)
        if self.serial_port:
            self.serial_port.close()

# Example Arduino firmware sketch (for reference):
ARDUINO_FIRMWARE = '''
#include <Keyboard.h>
#include <Mouse.h>

void setup() {
  Serial.begin(9600);
  Keyboard.begin();
  Mouse.begin();
}

void loop() {
  if (Serial.available() >= 3) {
    byte cmd = Serial.read();
    byte param1 = Serial.read();
    byte param2 = Serial.read();
    
    if (cmd == 0x01) {  // Keyboard
      if (param1 == 0 && param2 == 0) {
        Keyboard.releaseAll();
      } else {
        if (param1 & 0x01) Keyboard.press(KEY_LEFT_CTRL);
        if (param1 & 0x02) Keyboard.press(KEY_LEFT_SHIFT);
        if (param1 & 0x04) Keyboard.press(KEY_LEFT_ALT);
        if (param1 & 0x08) Keyboard.press(KEY_LEFT_GUI);
        if (param2 != 0) Keyboard.press(param2);
        delay(50);
        Keyboard.releaseAll();
      }
    }
    else if (cmd == 0x02) {  // Mouse
      char x = (char)param1;
      char y = (char)param2;
      byte buttons = Serial.read();
      Mouse.move(x, y, 0);
      if (buttons & 0x01) Mouse.click(MOUSE_LEFT);
      if (buttons & 0x02) Mouse.click(MOUSE_RIGHT);
    }
  }
}
'''

if __name__ == '__main__':
    # Test the controller
    controller = USBHIDController(backend='mock')
    
    print("Testing USB HID Controller...")
    controller.type_string("Hello World! 123", delay=0.1)
    
    controller.send_special_key(KeyCode.ENTER)
    time.sleep(0.5)
    
    controller.press_key_combo(KeyCode.A, modifiers=Modifier.LEFT_CTRL)  # Ctrl+A
    time.sleep(0.5)
    
    controller.type_string("https://dashboard.stripe.com")
    controller.send_special_key(KeyCode.ENTER)
    
    controller.close()
    print("Test complete")
