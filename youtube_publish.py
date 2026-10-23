"""Tenant-isolated YouTube OAuth and resumable uploads. No video is stored here."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

SCOPE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly'
CHUNK = 8 * 1024 * 1024
MAX_SIZE = 500 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(method, url, headers=None, data=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        response = urllib.request.build_opener(NoRedirect).open(req, timeout=120)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.code, dict(response.headers), response.read()


def decoded(body):
    try:
        return json.loads(body)
    except (ValueError, UnicodeError):
        return {}


def api_error(body):
    error = decoded(body).get('error', {})
    if isinstance(error, str):
        return error
    return str(error.get('message', 'YouTube request failed'))[:400]


def metadata(body):
    title = str(body.get('title', '')).strip()
    description = str(body.get('description', ''))
    privacy = body.get('privacy', 'private')
    if not title or len(title) > 100 or '<' in title or '>' in title:
        raise ValueError('Title must contain 1–100 characters, without < or >')
    if len(description.encode('utf-8')) > 5000 or '<' in description or '>' in description:
        raise ValueError('Description must be at most 5000 UTF-8 bytes, without < or >')
    if privacy not in ('private', 'unlisted', 'public'):
        raise ValueError('Invalid privacy setting')
    if type(body.get('made_for_kids')) is not bool:
        raise ValueError('Select whether this video is made for kids')
    return {'snippet': {'title': title, 'description': description, 'categoryId': '22'},
            'status': {'privacyStatus': privacy, 'selfDeclaredMadeForKids': body['made_for_kids']}}


class YouTube:
    def __init__(self, root, workspace, multiuser, auth_config=None, transport=request):
        self.root, self.workspace, self.multiuser = Path(root), Path(workspace), multiuser
        self.auth_config, self.http = auth_config or {}, transport
        self.states, self.sessions, self.lock = {}, {}, threading.RLock()

    def config(self):
        path = Path(os.environ.get('VEDIT_YOUTUBE_CONFIG', str(self.root.parent / 'vedit-youtube.json')))
        config = json.loads(path.read_text(encoding='utf-8-sig')) if path.is_file() else {}
        redirect = os.environ.get('VEDIT_YOUTUBE_REDIRECT_URI') or config.get('redirect_uri')
        if not redirect:
            base = self.auth_config.get('public_url', '').rstrip('/') if self.multiuser else 'http://127.0.0.1:8765'
            redirect = base + '/api/youtube/callback'
        parts = urllib.parse.urlsplit(redirect)
        if parts.scheme != 'https' and not (parts.scheme == 'http' and parts.hostname in ('localhost', '127.0.0.1')):
            raise ValueError('YouTube redirect URI must use HTTPS or loopback HTTP')
        if parts.path != '/api/youtube/callback' or parts.query or parts.fragment:
            raise ValueError('YouTube redirect URI must end with /api/youtube/callback')
        return {'client_id': os.environ.get('VEDIT_YOUTUBE_CLIENT_ID') or config.get('client_id', ''),
                'client_secret': os.environ.get('VEDIT_YOUTUBE_CLIENT_SECRET') or config.get('client_secret', ''),
                'redirect_uri': redirect}

    def _vault(self):
        from cryptography.fernet import Fernet
        folder = self.workspace / getattr(self, 'vault_name', 'youtube-private')
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        key = folder / 'encryption.key'
        with self.lock:
            if not key.exists():
                descriptor = os.open(key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(descriptor, 'wb') as stream:
                    stream.write(Fernet.generate_key())
        return folder, Fernet(key.read_bytes())

    def _path(self, folder, tenant):
        return folder / (hashlib.sha256(str(tenant or 'local').encode()).hexdigest() + '.token')

    def load(self, tenant):
        folder, cipher = self._vault()
        path = self._path(folder, tenant)
        return json.loads(cipher.decrypt(path.read_bytes())) if path.exists() else None

    def save(self, tenant, token):
        folder, cipher = self._vault()
        path = self._path(folder, tenant)
        temp = path.with_suffix('.' + secrets.token_hex(8) + '.tmp')
        descriptor = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(cipher.encrypt(json.dumps(token).encode()))
        os.replace(temp, path)

    def status(self, tenant):
        c = self.config()
        configured = bool(c['client_id'] and c['client_secret'])
        try:
            from cryptography.fernet import Fernet  # noqa: F401
        except ImportError:
            return {'configured': False, 'connected': False, 'local_setup':not self.multiuser, 'redirect_uri': c['redirect_uri'],
                    'setup_error': 'Install requirements-youtube.txt in the server Python environment'}
        token = self.load(tenant) if configured else None
        return {'configured': configured, 'connected': bool(token), 'local_setup':not self.multiuser, 'redirect_uri': c['redirect_uri'],
                'channel': token.get('channel') if token else None}

    def configure_local(self, body):
        if self.multiuser:
            raise ValueError('Only the server administrator can configure production OAuth')
        client = body.get('client', {}).get('web', {})
        current = self.config()
        if current['client_id'] or current['client_secret']:
            raise ValueError('OAuth is already configured. Update the configuration file to change it.')
        client_id, secret = client.get('client_id', ''), client.get('client_secret', '')
        if not isinstance(client_id,str) or not client_id.endswith('.apps.googleusercontent.com') or len(client_id)>256 or not isinstance(secret,str) or not 8<=len(secret)<=256:
            raise ValueError('Select a Google OAuth Web application client JSON file')
        if current['redirect_uri'] not in client.get('redirect_uris', []):
            raise ValueError('Add this exact redirect URI in Google Cloud, then download the client JSON: '+current['redirect_uri'])
        path = Path(os.environ.get('VEDIT_YOUTUBE_CONFIG', str(self.root.parent/'vedit-youtube.json')))
        descriptor = os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(descriptor,'w',encoding='utf-8') as stream:
            json.dump({'client_id':client_id,'client_secret':secret,'redirect_uri':current['redirect_uri']},stream)
        return {'ok':True}

    def connect(self, tenant):
        c = self.config()
        if not c['client_id'] or not c['client_secret']:
            raise ValueError('Configure YouTube OAuth credentials first')
        state, browser, verifier = (secrets.token_urlsafe(32) for _ in range(3))
        with self.lock:
            self.states = {k: v for k, v in self.states.items() if v['expires'] > time.time()}
            self.states[state] = {'tenant': tenant, 'browser': browser, 'verifier': verifier,
                                  'expires': time.time() + 600}
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        query = urllib.parse.urlencode({'client_id': c['client_id'], 'redirect_uri': c['redirect_uri'],
                 'response_type': 'code', 'scope': SCOPE, 'state': state, 'access_type': 'offline',
                 'prompt': 'consent select_account', 'code_challenge': challenge, 'code_challenge_method': 'S256'})
        return 'https://accounts.google.com/o/oauth2/v2/auth?' + query, browser

    def _form(self, url, data):
        code, _, body = self.http('POST', url, {'Content-Type': 'application/x-www-form-urlencoded'},
                                 urllib.parse.urlencode(data).encode())
        if code != 200:
            raise ValueError(api_error(body))
        return decoded(body)

    def callback(self, tenant, params, browser):
        with self.lock:
            saved = self.states.get(params.get('state', ''))
            if not saved or saved['expires'] < time.time() or saved['tenant'] != tenant or not browser or not secrets.compare_digest(saved['browser'], browser):
                raise ValueError('YouTube sign-in expired or does not match this browser')
            self.states.pop(params['state'])
        if params.get('error') or not params.get('code'):
            raise ValueError('YouTube permission was not granted')
        c = self.config()
        token = self._form('https://oauth2.googleapis.com/token', {'client_id': c['client_id'],
            'client_secret': c['client_secret'], 'redirect_uri': c['redirect_uri'], 'code': params['code'],
            'code_verifier': saved['verifier'], 'grant_type': 'authorization_code'})
        if not token.get('refresh_token') or not token.get('access_token'):
            raise ValueError('Offline YouTube access was not granted. Connect again.')
        granted = set(token.get('scope', '').split())
        if not set(SCOPE.split()).issubset(granted):
            raise ValueError('Grant both YouTube upload and channel read permissions')
        status, _, body = self.http('GET', 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
                                   {'Authorization': 'Bearer ' + token['access_token']})
        channels = decoded(body).get('items', [])
        if status != 200:
            raise ValueError(api_error(body))
        if len(channels) != 1:
            raise ValueError('Select a Google/Brand account with exactly one YouTube channel')
        token['channel'] = {'id': channels[0]['id'], 'title': channels[0]['snippet']['title']}
        token['expires'] = time.time() + int(token.get('expires_in', 3600))
        self.save(tenant, token)

    def access_token(self, tenant):
        with self.lock:
            token = self.load(tenant)
            if not token:
                raise ValueError('Connect your YouTube channel first')
            if token.get('expires', 0) < time.time() + 60:
                c = self.config()
                fresh = self._form('https://oauth2.googleapis.com/token', {'client_id': c['client_id'],
                    'client_secret': c['client_secret'], 'refresh_token': token['refresh_token'], 'grant_type': 'refresh_token'})
                token.update(fresh)
                token['expires'] = time.time() + int(fresh.get('expires_in', 3600))
                self.save(tenant, token)
            return token['access_token']

    def disconnect(self, tenant):
        folder, _ = self._vault()
        with self.lock:
            self._path(folder, tenant).unlink(missing_ok=True)
            self.states = {k: v for k, v in self.states.items() if v['tenant'] != tenant}
            self.sessions = {k: v for k, v in self.sessions.items() if v['tenant'] != tenant}

    def begin_upload(self, tenant, data):
        meta = metadata(data)
        size = data.get('size')
        if type(size) is not int or not 1 <= size <= MAX_SIZE:
            raise ValueError('Video must be between 1 byte and 500 MB')
        request_id = data.get('request_id', '')
        if not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', request_id):
            raise ValueError('Invalid upload request ID')
        with self.lock:
            self.sessions = {k: v for k, v in self.sessions.items() if v['expires'] > time.time()}
            for sid, session in self.sessions.items():
                if session['tenant'] == tenant and session['request_id'] == request_id:
                    if session['size'] != size or session['metadata'] != meta:
                        raise ValueError('Upload request ID already used for another video')
                    return {'id': sid, 'chunk_size': CHUNK}
            if any(v['tenant'] == tenant and not v.get('done') for v in self.sessions.values()):
                raise ValueError('Another YouTube upload is active. Finish or cancel it first.')
            if sum(not s.get('done') for s in self.sessions.values()) >= 4:
                raise ValueError('YouTube upload queue is busy')
            if not self.load(tenant):
                raise ValueError('Connect your YouTube channel first')
            access = self.access_token(tenant)
            code, headers, body = self.http('POST', 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
                {'Authorization': 'Bearer ' + access, 'Content-Type': 'application/json; charset=UTF-8',
                 'X-Upload-Content-Length': str(size), 'X-Upload-Content-Type': 'video/mp4'}, json.dumps(meta).encode())
            location = next((v for k, v in headers.items() if k.lower() == 'location'), '')
            parsed = urllib.parse.urlsplit(location)
            if code not in (200, 201):
                raise ValueError(api_error(body))
            if parsed.scheme != 'https' or parsed.netloc != 'www.googleapis.com' or parsed.path != '/upload/youtube/v3/videos':
                raise ValueError('YouTube returned an invalid upload destination')
            sid = secrets.token_hex(16)
            self.sessions[sid] = {'tenant': tenant, 'url': location, 'size': size, 'offset': 0,
                'expires': time.time() + 86400, 'request_id': request_id, 'metadata': meta,
                'channel': self.load(tenant)['channel'], 'lock': threading.Lock()}
            return {'id': sid, 'chunk_size': CHUNK}

    def session(self, tenant, sid):
        with self.lock:
            session = self.sessions.get(sid)
        if not session or session['tenant'] != tenant or session['expires'] < time.time():
            raise ValueError('Upload expired or not found')
        return session

    def _response(self, session, code, headers, body):
        if code in (200, 201):
            result = decoded(body)
            video_id = result.get('id', '')
            if not re.fullmatch(r'[a-zA-Z0-9_-]{6,64}', video_id):
                raise ValueError('YouTube did not return a video ID')
            session['done'] = {'status': 'done', 'video_id': video_id,
                'url': 'https://www.youtube.com/watch?v=' + video_id,
                'privacy': result.get('status', {}).get('privacyStatus', session['metadata']['status']['privacyStatus']),
                'channel': session['channel']}
            return session['done']
        if code == 308:
            received = next((v for k, v in headers.items() if k.lower() == 'range'), '')
            match = re.fullmatch(r'bytes=0-(\d+)', received)
            offset = int(match.group(1)) + 1 if match else 0
            if offset > session['size']:
                raise ValueError('Invalid YouTube upload offset')
            session['offset'] = offset
            return {'status': 'uploading', 'offset': offset, 'size': session['size']}
        raise ValueError(api_error(body))

    def session_access(self, tenant, session):
        token = self.load(tenant)
        if not token or token.get('channel',{}).get('id') != session['channel']['id']:
            raise ValueError('YouTube channel changed. Cancel this upload and connect the intended channel.')
        return self.access_token(tenant)

    def chunk(self, tenant, sid, offset, data):
        session = self.session(tenant, sid)
        with session['lock']:
            if session.get('done'):
                return session['done']
            if offset != session['offset'] or not data or len(data) > CHUNK or offset + len(data) > session['size']:
                raise ValueError('Invalid upload chunk or offset')
            if offset + len(data) < session['size'] and len(data) % (256 * 1024):
                raise ValueError('Intermediate chunks must be multiples of 256 KB')
            code, headers, body = self.http('PUT', session['url'], {'Authorization': 'Bearer ' + self.session_access(tenant, session),
                 'Content-Type': 'video/mp4', 'Content-Range': f"bytes {offset}-{offset+len(data)-1}/{session['size']}"}, data)
            return self._response(session, code, headers, body)

    def upload_status(self, tenant, sid):
        session = self.session(tenant, sid)
        with session['lock']:
            if session.get('done'):
                return session['done']
            code, headers, body = self.http('PUT', session['url'], {'Authorization': 'Bearer ' + self.session_access(tenant, session),
                                          'Content-Range': f"bytes */{session['size']}"}, b'')
            return self._response(session, code, headers, body)

    def cancel(self, tenant, sid):
        session = self.session(tenant, sid)
        with session['lock']:
            if session.get('done'):
                return session['done']
            with self.lock:
                self.sessions.pop(sid, None)
        return {'status': 'cancelled'}
