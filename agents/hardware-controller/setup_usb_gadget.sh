#!/bin/bash
# Raspberry Pi Zero W USB Gadget Setup
# Enables USB HID keyboard and mouse emulation

set -e

echo "=== USB HID Gadget Setup for Raspberry Pi Zero W ==="

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root: sudo ./setup_usb_gadget.sh"
    exit 1
fi

# Enable dwc2 overlay
echo "Enabling USB gadget mode..."
if ! grep -q "dtoverlay=dwc2" /boot/config.txt; then
    echo "dtoverlay=dwc2" >> /boot/config.txt
    echo "Added dtoverlay=dwc2 to /boot/config.txt"
fi

# Enable dwc2 module
if ! grep -q "dwc2" /etc/modules; then
    echo "dwc2" >> /etc/modules
    echo "Added dwc2 to /etc/modules"
fi

# Enable libcomposite
if ! grep -q "libcomposite" /etc/modules; then
    echo "libcomposite" >> /etc/modules
    echo "Added libcomposite to /etc/modules"
fi

# Install required packages
echo "Installing required packages..."
apt-get update
apt-get install -y python3-pip python3-opencv tesseract-ocr libtesseract-dev
pip3 install pyautogui pytesseract mss pillow

# Create USB gadget configuration
echo "Creating USB gadget..."

GADGET_DIR="/sys/kernel/config/usb_gadget/hid_gadget"

# Remove existing gadget if present
if [ -d "$GADGET_DIR" ]; then
    echo "Removing existing gadget..."
    # Unbind if active
    if [ -L "$GADGET_DIR/UDC" ]; then
        echo "" > "$GADGET_DIR/UDC"
    fi
    rm -rf "$GADGET_DIR"
fi

# Create gadget structure
mkdir -p "$GADGET_DIR"
cd "$GADGET_DIR"

# Device descriptors
echo 0x1d6b > idVendor  # Linux Foundation
echo 0x0104 > idProduct # Multifunction Composite Gadget
echo 0x0100 > bcdDevice  # v1.0.0
echo 0x0200 > bcdUSB    # USB 2.0

# Strings
mkdir -p strings/0x409
echo "1234567890" > strings/0x409/serialnumber
echo "ProtoForge" > strings/0x409/manufacturer
echo "HID Automation Device" > strings/0x409/product

# Configuration
mkdir -p configs/c.1/strings/0x409
echo "HID Keyboard + Mouse" > configs/c.1/strings/0x409/configuration
echo 250 > configs/c.1/MaxPower

# Keyboard function
mkdir -p functions/hid.usb0
echo 1 > functions/hid.usb0/protocol
echo 1 > functions/hid.usb0/subclass
echo 8 > functions/hid.usb0/report_length
# Keyboard report descriptor
# Usage Page (Generic Desktop), Usage (Keyboard), Collection (Application)
# Report Size (8), Report Count (1), Usage Page (Key Codes)
echo -ne '\x05\x01\x09\x06\xa1\x01\x05\x07\x19\xe0\x29\xe7\x15\x00\x25\x01\x75\x01\x95\x08\x81\x02\x95\x01\x75\x08\x81\x01\x95\x05\x75\x01\x05\x08\x19\x01\x29\x05\x91\x02\x95\x01\x75\x03\x91\x01\x95\x06\x75\x08\x15\x00\x25\x65\x05\x07\x19\x00\x29\x65\x81\x00\xc0' > functions/hid.usb0/report_desc

ln -s functions/hid.usb0 configs/c.1/

# Mouse function
mkdir -p functions/hid.usb1
echo 2 > functions/hid.usb1/protocol
echo 1 > functions/hid.usb1/subclass
echo 4 > functions/hid.usb1/report_length
# Mouse report descriptor
# Usage Page (Generic Desktop), Usage (Mouse), Collection (Application)
echo -ne '\x05\x01\x09\x02\xa1\x01\x09\x01\xa1\x00\x05\x09\x19\x01\x29\x03\x15\x00\x25\x01\x95\x03\x75\x01\x81\x02\x95\x01\x75\x05\x81\x01\x05\x01\x09\x30\x09\x31\x15\x81\x25\x7f\x75\x08\x95\x02\x81\x06\xc0\xc0' > functions/hid.usb1/report_desc

ln -s functions/hid.usb1 configs/c.1/

# Bind to UDC (USB Device Controller)
UDC_NAME=$(ls /sys/class/udc/)
echo "$UDC_NAME" > UDC

echo "USB gadget configured"

# Create device nodes
echo "Creating device nodes..."
chmod 666 /dev/hidg0 2>/dev/null || true
chmod 666 /dev/hidg1 2>/dev/null || true

# Add udev rule for permanent permissions
cat > /etc/udev/rules.d/50-hid-gadget.rules << 'EOF'
SUBSYSTEM=="usb", ATTR{idVendor}=="1d6b", ATTR{idProduct}=="0104", MODE="0666"
KERNEL=="hidg[0-9]*", MODE="0666"
EOF

udevadm control --reload-rules

echo ""
echo "=== Setup Complete ==="
echo "USB HID gadget is active at /dev/hidg0 (keyboard) and /dev/hidg1 (mouse)"
echo ""
echo "To test:"
echo "  python3 -c \"import usb_hid_controller; c = usb_hid_controller.USBHIDController(); c.type_string('Hello')\""
echo ""
echo "Reboot required for permanent configuration changes."
echo "Run: sudo reboot"
