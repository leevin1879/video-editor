"""Reverse proxy dat truoc VEdit (127.0.0.1:8765): dang nhap Google (neu da cau hinh) hoac Basic Auth du phong."""
import base64
import hashlib
import hmac
import http.client
import json
import os
import secrets
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
CFG_PATH = os.environ.get("VEDIT_AUTH_CFG", os.path.join(HERE, "vedit-auth.json"))
CFG = json.load(open(CFG_PATH, encoding="utf-8"))
if not CFG.get("session_secret"):
    CFG["session_secret"] = secrets.token_hex(32)
    json.dump(CFG, open(CFG_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

USER, PASSWORD = CFG.get("user", ""), CFG.get("password", "")
SECRET = CFG["session_secret"].encode()
G_ID, G_SECRET = CFG.get("google_client_id", "").strip(), CFG.get("google_client_secret", "").strip()
GOOGLE = bool(G_ID and G_SECRET)
PUBLIC_URL = CFG.get("public_url", "").rstrip("/")
ALLOWED = [e.strip().lower() for e in CFG.get("allowed_emails", [])]
SESSION_DAYS = 7
UP_HOST, UP_PORT = "127.0.0.1", int(os.environ.get("VEDIT_PORT", "8765"))
LISTEN_PORT = int(os.environ.get("VEDIT_PROXY_PORT", "8766"))
SECURE = "; Secure" if PUBLIC_URL.startswith("https://") else ""
HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers",
       "transfer-encoding", "upgrade", "host", "authorization", "cookie",
       "x-vedit-tenant", "x-vedit-time", "x-vedit-signature"}

fails = {}
lock = threading.Lock()


def b64(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def unb64(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign(obj):
    body = b64(json.dumps(obj, separators=(",", ":")).encode())
    return body + "." + b64(hmac.new(SECRET, body.encode(), hashlib.sha256).digest())


def unsign(val):
    try:
        body, sig = val.split(".", 1)
        good = b64(hmac.new(SECRET, body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, good):
            return None
        obj = json.loads(unb64(body))
        return obj if obj.get("x", 0) > time.time() else None
    except Exception:  # noqa: BLE001
        return None


def basic_ok(header):
    if not USER or not PASSWORD or not header or not header.lower().startswith("basic "):
        return False
    try:
        u, _, p = base64.b64decode(header[6:]).decode("utf-8").partition(":")
    except Exception:  # noqa: BLE001
        return False
    return hmac.compare_digest(u.encode(), USER.encode()) & hmac.compare_digest(p.encode(), PASSWORD.encode())


def safe_next(n):
    return n if n and n.startswith("/") and not n.startswith("//") and "\\" not in n else "/"


def post_form(url, data):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(), method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def get_json(url, token):
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


PAGE = ("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>VEdit</title><body style='font-family:system-ui;max-width:420px;margin:15vh auto;padding:0 16px'>"
        "<h2>{title}</h2><p>{msg}</p><p><a href='{href}'>{link}</a></p>")


class Proxy(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _client_ip(self):
        return self.headers.get("CF-Connecting-IP") or self.client_address[0]

    def _send(self, code, body=b"", ctype="text/plain; charset=utf-8", headers=(), cookies=()):
        self.send_response(code)
        for k, v in headers:
            self.send_header(k, v)
        for c in cookies:
            self.send_header("Set-Cookie", c)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
        self.close_connection = True

    def _deny(self, code, msg, headers=()):
        self._send(code, msg.encode(), headers=headers)

    def _page(self, code, title, msg, href="/_auth/login", link="Dang nhap lai", cookies=()):
        self._send(code, PAGE.format(title=title, msg=msg, href=href, link=link).encode(),
                   "text/html; charset=utf-8", cookies=cookies)

    def _redirect(self, loc, cookies=()):
        self._send(302, b"", headers=[("Location", loc)], cookies=cookies)

    def _cookie(self, name):
        c = SimpleCookie(self.headers.get("Cookie") or "")
        return c[name].value if name in c else None

    def _session_email(self):
        v = self._cookie("vedit_session")
        s = unsign(v) if v else None
        return s.get("e") if s else None

    def _login(self, q):
        state = secrets.token_urlsafe(16)
        nxt = safe_next(urllib.parse.parse_qs(q).get("next", ["/"])[0])
        ck = f"vedit_state={sign({'s': state, 'n': nxt, 'x': time.time() + 600})}; Path=/_auth; HttpOnly; SameSite=Lax; Max-Age=600{SECURE}"
        params = urllib.parse.urlencode({
            "client_id": G_ID, "redirect_uri": PUBLIC_URL + "/_auth/callback", "response_type": "code",
            "scope": "openid email", "state": state, "prompt": "select_account"})
        self._redirect("https://accounts.google.com/o/oauth2/v2/auth?" + params, [ck])

    def _callback(self, q):
        p = {k: v[0] for k, v in urllib.parse.parse_qs(q).items()}
        st = self._cookie("vedit_state")
        st = unsign(st) if st else None
        clear = f"vedit_state=; Path=/_auth; HttpOnly; SameSite=Lax; Max-Age=0{SECURE}"
        if p.get("error") or not st or not p.get("code") or not hmac.compare_digest(st["s"], p.get("state", "")):
            return self._page(400, "Dang nhap that bai", "Phien dang nhap khong hop le hoac da het han.", cookies=[clear])
        try:
            tok = post_form("https://oauth2.googleapis.com/token", {
                "code": p["code"], "client_id": G_ID, "client_secret": G_SECRET,
                "redirect_uri": PUBLIC_URL + "/_auth/callback", "grant_type": "authorization_code"})
            info = get_json("https://openidconnect.googleapis.com/v1/userinfo", tok["access_token"])
        except Exception as e:  # noqa: BLE001
            return self._page(502, "Loi ket noi Google", f"Khong xac minh duoc voi Google: {e}", cookies=[clear])
        email = (info.get("email") or "").lower()
        if not email or info.get("email_verified") is not True:
            return self._page(403, "Khong dang nhap duoc", "Tai khoan Google chua xac minh email.", cookies=[clear])
        if "*" not in ALLOWED and email not in ALLOWED:
            return self._page(403, "Khong co quyen truy cap", f"Tai khoan {email} khong nam trong danh sach duoc phep.",
                              href="/_auth/logout", link="Thu tai khoan khac", cookies=[clear])
        exp = int(time.time()) + SESSION_DAYS * 86400
        sess = f"vedit_session={sign({'e': email, 'x': exp})}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_DAYS * 86400}{SECURE}"
        self._redirect(safe_next(st.get("n")), [sess, clear])

    def _logout(self):
        self._redirect("/", [f"vedit_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{SECURE}"])

    def _authenticate(self):
        """Tra ve True neu duoc phep di tiep, False neu da tra loi xong."""
        if GOOGLE:
            parsed = urllib.parse.urlsplit(self.path)
            if parsed.path == "/_auth/login":
                self._login(parsed.query)
                return False
            if parsed.path == "/_auth/callback":
                self._callback(parsed.query)
                return False
            if parsed.path == "/_auth/logout":
                self._logout()
                return False
            if self._session_email():
                return True
            if self.command in ("GET", "HEAD") and "text/html" in (self.headers.get("Accept") or ""):
                self._redirect("/_auth/login?next=" + urllib.parse.quote(self.path))
            else:
                self._deny(401, "Can dang nhap Google. Hay tai lai trang.")
            return False

        ip = self._client_ip()
        with lock:
            n, until = fails.get(ip, (0, 0))
        if until > time.time():
            self._deny(429, "Qua nhieu lan nhap sai. Thu lai sau.")
            return False
        if not basic_ok(self.headers.get("Authorization")):
            if self.headers.get("Authorization"):
                with lock:
                    n += 1
                    fails[ip] = (n, time.time() + min(300, 2 ** min(n, 8)) if n >= 5 else 0)
                time.sleep(1)
            self._deny(401, "Can dang nhap", [("WWW-Authenticate", 'Basic realm="VEdit", charset="UTF-8"')])
            return False
        with lock:
            fails.pop(ip, None)
        return True

    def _handle(self):
        if not self._authenticate():
            return
        if UP_PORT == 8765 and not GOOGLE:
            return self._deny(503, "Vedit requires verified Google login.")
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
        if UP_PORT == 8765:
            email = self._session_email()
            tenant = hashlib.sha256(email.strip().lower().encode()).hexdigest()
            stamp = str(int(time.time()))
            message = "\n".join((tenant, stamp, self.command, self.path)).encode()
            headers["X-Vedit-Tenant"] = tenant
            headers["X-Vedit-Time"] = stamp
            headers["X-Vedit-Signature"] = hmac.new(SECRET, message, hashlib.sha256).hexdigest()
            if int(self.headers.get("Content-Length") or 0) > 500 * 1024 * 1024:
                return self._deny(413, "Moi file toi da 500 MB.")
        length = int(self.headers.get("Content-Length") or 0)
        try:
            conn = http.client.HTTPConnection(UP_HOST, UP_PORT, timeout=3600)
            conn.putrequest(self.command, self.path, skip_host=True, skip_accept_encoding=True)
            conn.putheader("Host", f"{UP_HOST}:{UP_PORT}")
            for k, v in headers.items():
                conn.putheader(k, v)
            conn.endheaders()
            remaining = length
            while remaining > 0:
                chunk = self.rfile.read(min(1 << 20, remaining))
                if not chunk:
                    break
                conn.send(chunk)
                remaining -= len(chunk)
            resp = conn.getresponse()
        except Exception as e:  # noqa: BLE001
            return self._deny(502, f"Khong ket noi duoc VEdit: {e}")

        self.send_response(resp.status)
        for k, v in resp.getheaders():
            if k.lower() not in HOP:
                self.send_header(k, v)
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            if self.command != "HEAD":
                while True:
                    chunk = resp.read(1 << 16)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            conn.close()
            self.close_connection = True

    do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = do_PATCH = _handle


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", LISTEN_PORT), Proxy)
    srv.daemon_threads = True
    mode = f"Google ({'moi tai khoan' if '*' in ALLOWED else len(ALLOWED)} email)" if GOOGLE else "Basic Auth"
    print(f"VEdit auth proxy [{mode}]: http://127.0.0.1:{LISTEN_PORT} -> {UP_HOST}:{UP_PORT}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
