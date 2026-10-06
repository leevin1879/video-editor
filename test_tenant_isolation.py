"""Integration checks use temporary data and never production credentials."""
import hashlib
import hmac
import http.client
import json
import os
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor

os.environ["VEDIT_MULTIUSER"] = "0"
import server
from tenant_storage import TENANT, TenantPath, TenantJobs


class IsolationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        server.MULTIUSER = True
        server.AUTH_SECRET = b"integration-test-only"
        cls.owner = hashlib.sha256(b"owner@example.test").hexdigest()
        cls.other = hashlib.sha256(b"other@example.test").hexdigest()
        for attr in ("MEDIA", "THUMBS", "EXPORTS", "PROJECTS", "TMP"):
            setattr(server, attr, TenantPath(cls.temp.name, attr.lower(), True, cls.owner))
        server.JOBS = TenantJobs()
        cls.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.temp.cleanup()

    def request(self, tenant, path, method="GET", body=None, invalid=False):
        stamp = str(int(time.time()))
        headers = {}
        if tenant:
            msg = "\n".join((tenant, stamp, method, path)).encode()
            headers = {"X-Vedit-Tenant": tenant, "X-Vedit-Time": stamp,
                       "X-Vedit-Signature": hmac.new(server.AUTH_SECRET, msg, hashlib.sha256).hexdigest()}
            if invalid:
                headers["X-Vedit-Signature"] = "forged"
        conn = http.client.HTTPConnection("127.0.0.1", self.http.server_port, timeout=5)
        conn.request(method, path, json.dumps(body) if body is not None else None, headers)
        response = conn.getresponse()
        result = response.status, response.read()
        conn.close()
        return result

    def test_projects_and_browser_identity(self):
        for tenant, name in ((self.owner, "owner-project"), (self.other, "other-project")):
            self.assertEqual(self.request(tenant, "/api/projects", "POST", {"project": {"name": name}})[0], 200)
            status, data = self.request(tenant, "/api/projects")
            self.assertEqual(status, 200)
            self.assertEqual([p["name"] for p in json.loads(data)], [name])
            self.assertEqual(json.loads(self.request(tenant, "/api/account")[1])["id"], tenant)
        self.assertEqual(self.request(self.other, "/api/projects/owner-project")[0], 404)

    def test_media_exports_thumbnails_traversal(self):
        token = TENANT.set(self.owner)
        try:
            for folder in (server.MEDIA, server.THUMBS, server.EXPORTS):
                with open(os.path.join(folder, "private.mp4"), "wb") as stream:
                    stream.write(b"private-owner-data")
        finally:
            TENANT.reset(token)
        for prefix in ("media", "thumbs", "exports"):
            self.assertEqual(self.request(self.owner, f"/{prefix}/private.mp4")[0], 200)
            self.assertEqual(self.request(self.other, f"/{prefix}/private.mp4")[0], 404)
            self.assertEqual(self.request(self.other, f"/{prefix}/..%2f..%2f..%2f{prefix}%2fprivate.mp4")[0], 403)

    def test_jobs_worker_context_and_cancellation(self):
        token = TENANT.set(self.owner)
        done = threading.Event()
        captured = []
        try:
            def worker(job_id):
                captured.append((TENANT.get(), os.fspath(server.MEDIA)))
                server.JOBS[job_id]["status"] = "done"
                done.set()
            server.start_job("abc123", {"status": "running"}, worker, ("abc123",))
        finally:
            TENANT.reset(token)
        self.assertTrue(done.wait(3))
        self.assertEqual(captured[0][0], self.owner)
        self.assertEqual(self.request(self.owner, "/api/export/abc123")[0], 200)
        self.assertEqual(self.request(self.other, "/api/export/abc123")[0], 404)
        self.request(self.other, "/api/export/abc123/cancel", "POST", {})
        token = TENANT.set(self.owner)
        try:
            self.assertFalse(server.JOBS["abc123"].get("cancelled", False))
        finally:
            TENANT.reset(token)

    def test_unauthenticated_forged_expired_and_concurrent(self):
        self.assertEqual(self.request(None, "/api/projects")[0], 401)
        self.assertEqual(self.request(self.other, "/api/projects", invalid=True)[0], 401)
        with ThreadPoolExecutor(max_workers=8) as pool:
            tenants = [self.owner, self.other] * 20
            results = list(pool.map(lambda tenant: json.loads(self.request(tenant, "/api/account")[1])["id"], tenants))
        self.assertEqual(results, tenants)

    def test_job_capacity(self):
        token = TENANT.set(self.other)
        try:
            server.JOBS["capacity1"] = {"status": "running"}
            server.JOBS["capacity2"] = {"status": "running"}
            with self.assertRaises(ValueError):
                server.start_job("capacity3", {"status": "running"}, lambda: None, ())
        finally:
            del server.JOBS["capacity1"]
            del server.JOBS["capacity2"]
            TENANT.reset(token)


if __name__ == "__main__":
    unittest.main()
