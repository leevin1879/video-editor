"""Local-only command mailbox. MCP never receives file paths or raw media."""
import secrets
import threading
import time
import uuid


class PluginBridge:
    def __init__(self):
        self.lock = threading.Lock()
        self.token = None
        self.client = None
        self.seen = 0
        self.commands = {}

    def connect(self, client):
        with self.lock:
            if self.client and self.client != client and time.monotonic() - self.seen < 8:
                raise ValueError('Another editor tab is already connected')
            self.client = client
            self.token = secrets.token_urlsafe(32)
            self.commands.clear()
            self.seen = time.monotonic()
            return {'token': self.token}

    def authorize(self, token):
        return bool(self.token and secrets.compare_digest(str(token), self.token))

    def enqueue(self, action, arguments):
        with self.lock:
            if not self.client or time.monotonic() - self.seen > 8:
                raise ValueError('Open VEdit and enable ChatGPT connection first')
            now = time.monotonic()
            self.commands = {k: v for k, v in self.commands.items() if now - v['created'] < 300}
            if any(c['status'] in ('queued', 'running') for c in self.commands.values()):
                raise ValueError('A command is still pending; query its result before submitting another')
            ident = uuid.uuid4().hex
            self.commands[ident] = {'id': ident, 'action': action, 'arguments': arguments,
                                    'created': now, 'status': 'queued'}
            return {'command_id': ident, 'status': 'queued'}

    def poll(self, client):
        with self.lock:
            if client != self.client:
                raise ValueError('Editor is not connected')
            self.seen = time.monotonic()
            result = []
            for command in self.commands.values():
                if command['status'] == 'queued':
                    if self.seen - command['created'] > 30:
                        command.update(status='error', result={'error': 'Command expired before delivery'})
                    else:
                        command['status'] = 'running'
                        result.append({k: command[k] for k in ('id', 'action', 'arguments')})
            return {'commands': result}

    def complete(self, client, ident, result, error=False):
        with self.lock:
            command = self.commands.get(ident)
            if client != self.client or not command or command['status'] != 'running':
                raise ValueError('Unknown or completed command')
            command.update(status='error' if error else 'done', result=result)
            return {'ok': True}

    def result(self, ident):
        with self.lock:
            command = self.commands.get(ident)
            if not command:
                raise ValueError('Unknown command')
            return {'command_id': ident, 'status': command['status'], 'result': command.get('result')}

    def disconnect(self, client):
        with self.lock:
            if self.client != client:
                raise ValueError('Editor is not connected')
            self.client = self.token = None
            self.commands.clear()
            return {'ok': True}


BRIDGE = PluginBridge()
