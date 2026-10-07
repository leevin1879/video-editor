"""Expire only explicitly temporary files; never sweep ordinary user media."""
import os
import time

SUFFIX = '.vedit-expiry'
LIFETIME = 24 * 60 * 60


def mark_temporary(path, now=None):
    with open(os.fspath(path) + SUFFIX, 'w', encoding='ascii') as stream:
        stream.write(str((time.time() if now is None else now) + LIFETIME))


def cleanup_temporary(workspace, busy=False, now=None):
    if busy:
        return 0
    root = os.path.realpath(workspace)
    current = time.time() if now is None else now
    removed = 0
    for base, _, files in os.walk(root, followlinks=False):
        for name in files:
            if not name.endswith(SUFFIX):
                continue
            marker = os.path.join(base, name)
            target = marker[:-len(SUFFIX)]
            try:
                # A symlink must never allow a marker to delete outside this workspace.
                if os.path.commonpath([root, os.path.realpath(target)]) != root:
                    continue
                with open(marker, encoding='ascii') as stream:
                    expiry = float(stream.read(64))
                if expiry > current:
                    continue
                if os.path.isfile(target):
                    os.remove(target)
                    removed += 1
                os.remove(marker)
            except (OSError, ValueError):
                continue
    return removed
