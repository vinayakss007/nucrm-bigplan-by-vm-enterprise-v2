import http.client
import importlib.util
import json
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from http.server import HTTPServer
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("alert-webhook.py")
spec = importlib.util.spec_from_file_location("alert_webhook", MODULE_PATH)
alert_webhook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alert_webhook)


class AlertWebhookTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.log_dir = tempfile.TemporaryDirectory()
        cls.log_file = Path(cls.log_dir.name) / "alerts.jsonl"
        alert_webhook.LOG_FILE = str(cls.log_file)
        cls.server = HTTPServer(("127.0.0.1", 0), alert_webhook.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        cls.log_dir.cleanup()

    def setUp(self):
        self.log_file.write_text("")

    def post(self, body):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.putrequest("POST", "/")
        conn.putheader("Content-Length", str(len(body)))
        conn.endheaders()
        conn.send(body)
        response = conn.getresponse()
        payload = response.read()
        conn.close()
        return response.status, json.loads(payload)

    def logged_entries(self):
        return [json.loads(line) for line in self.log_file.read_text().splitlines()]

    def test_oversized_body_rejected_before_parsing(self):
        body = b'{"alerts":[]}' + b" " * alert_webhook.MAX_BODY_BYTES
        status, payload = self.post(body)
        self.assertEqual(status, 413)
        self.assertEqual(payload["error"], "request body too large")
        self.assertEqual(self.logged_entries(), [])

    def test_invalid_json_returns_400(self):
        status, payload = self.post(b"{not json")
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"], "invalid JSON body")
        self.assertEqual(self.logged_entries(), [])

    def test_non_object_json_returns_400(self):
        status, payload = self.post(b'[{"alerts":[]}]')
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"], "JSON body must be an object")
        self.assertEqual(self.logged_entries(), [])

    def test_alerts_not_array_returns_400(self):
        status, payload = self.post(b'{"alerts":{"bad":true}}')
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"], "alerts must be an array")

    def test_valid_payload_is_logged_with_utc_timestamp(self):
        body = json.dumps({
            "alerts": [{
                "status": "firing",
                "labels": {"alertname": "DiskFull", "severity": "critical"},
                "annotations": {"summary": "disk is full", "description": "node-1"},
            }]
        }).encode()
        status, payload = self.post(body)
        self.assertEqual(status, 200)
        self.assertEqual(payload, {"status": "ok"})

        entries = self.logged_entries()
        self.assertEqual(len(entries), 1)
        entry = entries[0]
        self.assertEqual(entry["alertname"], "DiskFull")
        self.assertEqual(entry["severity"], "critical")
        self.assertEqual(entry["status"], "firing")
        self.assertEqual(entry["summary"], "disk is full")
        self.assertEqual(entry["description"], "node-1")
        self.assertTrue(entry["timestamp"].endswith("Z"))
        parsed = datetime.fromisoformat(entry["timestamp"].replace("Z", "+00:00"))
        self.assertEqual(parsed.tzinfo, timezone.utc)

    def test_malformed_alert_entries_do_not_crash(self):
        status, _ = self.post(b'{"alerts":[null,{"labels":"oops","annotations":7}]}')
        self.assertEqual(status, 200)
        entries = self.logged_entries()
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["alertname"], "unknown")
        self.assertEqual(entries[0]["severity"], "unknown")
        self.assertEqual(entries[0]["summary"], "")

    def test_empty_body_returns_ok(self):
        status, payload = self.post(b"")
        self.assertEqual(status, 200)
        self.assertEqual(payload, {"status": "ok"})
        self.assertEqual(self.logged_entries(), [])


if __name__ == "__main__":
    unittest.main()
