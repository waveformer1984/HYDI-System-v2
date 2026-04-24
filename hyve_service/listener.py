import os
import time
import json
from datetime import datetime

# Configuration
EVENTS_DIR = os.path.join(os.path.dirname(__file__), 'events', 'incoming')
OUTPUTS_DIR = os.path.join(os.path.dirname(__file__), 'outputs')
REVENUE_READY_DIR = os.path.join(os.path.dirname(__file__), 'revenue_ready')
EVENT_NAME = 'hyve_opportunity_detected'
POLL_INTERVAL = 5  # seconds

def ensure_directories():
    """Ensure all necessary directories exist."""
    for directory in [EVENTS_DIR, OUTPUTS_DIR, REVENUE_READY_DIR]:
        os.makedirs(directory, exist_ok=True)

def listen_for_events():
    """Listen for hyve_opportunity_detected events and process them."""
    print(f"Listening for '{EVENT_NAME}' events in {EVENTS_DIR}")
    ensure_directories()
    
    while True:
        try:
            # Check for event files
            for filename in os.listdir(EVENTS_DIR):
                if filename == EVENT_NAME:
                    event_path = os.path.join(EVENTS_DIR, filename)
                    print(f"Detected event: {filename}")
                    
                    # Read event data (if any)
                    event_data = {}
                    try:
                        with open(event_path, 'r') as f:
                            content = f.read().strip()
                            if content:
                                # Try to parse as JSON, otherwise treat as plain text
                                try:
                                    event_data = json.loads(content)
                                except json.JSONDecodeError:
                                    event_data = {"message": content}
                    except Exception as e:
                        print(f"Error reading event file: {e}")
                        event_data = {"error": str(e)}
                    
                    # Generate output
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    output_filename = f"output_{timestamp}.json"
                    output_path = os.path.join(OUTPUTS_DIR, output_filename)
                    
                    output_data = {
                        "event": EVENT_NAME,
                        "timestamp": timestamp,
                        "event_data": event_data,
                        "status": "revenue_ready",
                        "generated_at": datetime.now().isoformat()
                    }
                    
                    with open(output_path, 'w') as f:
                        json.dump(output_data, f, indent=2)
                    
                    print(f"Generated output: {output_path}")
                    
                    # Mark as revenue-ready
                    ready_filename = f"{output_filename}.ready"
                    ready_path = os.path.join(REVENUE_READY_DIR, ready_filename)
                    with open(ready_path, 'w') as f:
                        f.write(f"Revenue-ready output generated from event {EVENT_NAME} at {timestamp}")
                    
                    print(f"Marked as revenue-ready: {ready_path}")
                    
                    # Remove the event file to avoid reprocessing
                    os.remove(event_path)
                    print(f"Processed and removed event file: {event_path}")
            
            time.sleep(POLL_INTERVAL)
            
        except KeyboardInterrupt:
            print("\nStopping event listener.")
            break
        except Exception as e:
            print(f"Error in event listener: {e}")
            time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    listen_for_events()