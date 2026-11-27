#!/usr/bin/env python3
"""Simple Alertmanager webhook receiver — logs alerts to file."""
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime, timezone

LOG_FILE = "/var/log/nucrm-alerts.jsonl"
MAX_BODY_BYTES = 1024 * 1024

class Handler(BaseHTTPRequestHandler):
    def respond_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length"))
        except (TypeError, ValueError):
            self.respond_json(400, {"status": "error", "error": "invalid Content-Length"})
            return
        if length < 0 or length > MAX_BODY_BYTES:
            self.respond_json(413, {"status": "error", "error": "request body too large"})
            return

        raw = self.rfile.read(length)
        try:
            body = json.loads(raw) if raw else {}
        except (ValueError, UnicodeDecodeError):
            self.respond_json(400, {"status": "error", "error": "invalid JSON body"})
            return
        if not isinstance(body, dict):
            self.respond_json(400, {"status": "error", "error": "JSON body must be an object"})
            return
        alerts = body.get("alerts", [])
        if not isinstance(alerts, list):
            self.respond_json(400, {"status": "error", "error": "alerts must be an array"})
            return

        for alert in alerts:
            if not isinstance(alert, dict):
                continue
            labels = alert.get("labels")
            annotations = alert.get("annotations")
            if not isinstance(labels, dict):
                labels = {}
            if not isinstance(annotations, dict):
                annotations = {}
            entry = {
                "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "alertname": labels.get("alertname", "unknown"),
                "severity": labels.get("severity", "unknown"),
                "status": alert.get("status", "unknown"),
                "summary": annotations.get("summary", ""),
                "description": annotations.get("description", ""),
            }
            try:
                with open(LOG_FILE, "a") as f:
                    f.write(json.dumps(entry) + "\n")
            except Exception as e:
                print(f"Write error: {e}")
            print(f"[ALERT] {entry['status'].upper()} {entry['severity'].upper()} {entry['alertname']}: {entry['summary']}")
        self.respond_json(200, {"status": "ok"})

    def log_message(self, format, *args):
        pass  # suppress default logging

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 9095), Handler)
    print("Alert webhook receiver listening on :9095")
    server.serve_forever()
