#!/usr/bin/env python3
"""Simple Alertmanager webhook receiver — logs alerts to file."""
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime

LOG_FILE = "/var/log/nucrm-alerts.jsonl"

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        alerts = body.get("alerts", [])
        for alert in alerts:
            entry = {
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "alertname": alert.get("labels", {}).get("alertname", "unknown"),
                "severity": alert.get("labels", {}).get("severity", "unknown"),
                "status": alert.get("status", "unknown"),
                "summary": alert.get("annotations", {}).get("summary", ""),
                "description": alert.get("annotations", {}).get("description", ""),
            }
            try:
                with open(LOG_FILE, "a") as f:
                    f.write(json.dumps(entry) + "\n")
            except Exception as e:
                print(f"Write error: {e}")
            print(f"[ALERT] {entry['status'].upper()} {entry['severity'].upper()} {entry['alertname']}: {entry['summary']}")
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def log_message(self, format, *args):
        pass  # suppress default logging

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 9095), Handler)
    print("Alert webhook receiver listening on :9095")
    server.serve_forever()
