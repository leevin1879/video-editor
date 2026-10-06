"""Per-request storage. Identity must be signed by the Google auth proxy."""
import contextvars
import hashlib
import hmac
import json
import os
import time
from collections.abc import MutableMapping

TENANT = contextvars.ContextVar("vedit_tenant", default=None)


def load_config(root):
    config = os.environ.get("VEDIT_AUTH_CFG", os.path.join(os.path.dirname(root), "vedit-auth.json"))
    with open(config, encoding="utf-8-sig") as stream:
        return json.load(stream)


def verified_tenant(headers, method, path, secret):
    tenant = headers.get("X-Vedit-Tenant", "")
    stamp = headers.get("X-Vedit-Time", "")
    signature = headers.get("X-Vedit-Signature", "")
    if len(tenant) != 64 or any(c not in "0123456789abcdef" for c in tenant):
        raise PermissionError("Google login required")
    try:
        if abs(time.time() - int(stamp)) > 60:
            raise ValueError()
    except ValueError:
        raise PermissionError("Expired identity") from None
    message = "\n".join((tenant, stamp, method, path)).encode()
    expected = hmac.new(secret, message, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise PermissionError("Invalid identity")
    return tenant


class TenantPath(os.PathLike):
    def __init__(self, workspace, folder, multiuser, legacy_owner=None):
        self.workspace, self.folder, self.multiuser = workspace, folder, multiuser
        self.legacy_owner = legacy_owner

    def __fspath__(self):
        if not self.multiuser:
            return os.path.join(self.workspace, self.folder)
        tenant = TENANT.get()
        if tenant is None:
            raise PermissionError("No user storage context")
        if tenant == self.legacy_owner:
            path = os.path.join(self.workspace, self.folder)
            os.makedirs(path, exist_ok=True)
            return path
        path = os.path.join(self.workspace, "users", tenant, self.folder)
        os.makedirs(path, exist_ok=True)
        return path


class TenantJobs(MutableMapping):
    def __init__(self):
        self.data = {}

    def _key(self, key):
        return (TENANT.get(), key)

    def __getitem__(self, key):
        return self.data[self._key(key)]

    def __setitem__(self, key, value):
        self.data[self._key(key)] = value

    def __delitem__(self, key):
        del self.data[self._key(key)]

    def __iter__(self):
        return iter([key for tenant, key in list(self.data) if tenant == TENANT.get()])

    def __len__(self):
        return sum(1 for _ in self)

    def active(self, tenant=None):
        return sum(1 for (owner, _), job in list(self.data.items())
                   if job.get("status") == "running" and (tenant is None or owner == tenant))
