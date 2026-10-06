"""Local proxy smoke test. Never prints credentials or customer data."""
import base64
import hashlib
import hmac
import http.client
import json
import os
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
with open(os.path.join(ROOT, "vedit-auth.json"), encoding="utf-8-sig") as stream:
    config = json.load(stream)
assert config["allowed_emails"] == ["*"]
secret = config["session_secret"].encode()


def cookie(email):
    body = base64.urlsafe_b64encode(json.dumps({"e": email, "x": int(time.time()) + 120}, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = base64.urlsafe_b64encode(hmac.new(secret, body.encode(), hashlib.sha256).digest()).decode().rstrip("=")
    return "vedit_session=" + body + "." + sig


def request(port, path, session=None, extra=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    headers = {"Cookie": session} if session else {}
    headers.update(extra or {})
    conn.request("GET", path, headers=headers)
    response = conn.getresponse()
    result = response.status, response.read()
    conn.close()
    return result


assert request(8765, "/api/projects")[0] == 401
assert request(8766, "/api/projects")[0] == 401
for email in ("isolation-a@example.invalid", "isolation-b@example.invalid"):
    status, data = request(8766, "/api/account", cookie(email), {"X-Vedit-Tenant": config["legacy_owner_hash"], "X-Vedit-Signature": "spoof"})
    assert status == 200
    assert json.loads(data)["id"] == hashlib.sha256(email.encode()).hexdigest()
    assert json.loads(data)["free"] is True
    status, data = request(8766, "/api/projects", cookie(email))
    assert status == 200, "Project API failed: " + data.decode()[:400]
    assert json.loads(data) == [], "Test account unexpectedly has projects"
    # Exercise the browser route; Cloudflare rejects Python's default User-Agent.
    public = urllib.request.Request("https://vedit.1879.co.kr/api/account", headers={
        "Cookie": cookie(email),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36"})
    with urllib.request.urlopen(public, timeout=20) as response:
        assert json.load(response)["id"] == hashlib.sha256(email.encode()).hexdigest()
print("PASS: anonymous denied; two isolated accounts; forged identity stripped; wildcard enabled.")
