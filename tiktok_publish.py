"""TikTok Web OAuth and Direct Post. Secrets stay in an encrypted tenant vault.

Server exports use a short-lived capability URL; device exports stream in chunks.
No arbitrary remote URL or filesystem path is accepted from the browser.
"""
import json
import math
import os
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.parse import urlencode, urlsplit
from youtube_publish import YouTube, request, decoded, MAX_SIZE

SCOPE = 'user.info.basic,video.publish'
CHUNK = 10_000_000
BASE = 'https://open.tiktokapis.com/v2/'


def is_upload_destination(url):
    """TikTok can return region-specific upload hosts; never accept user hosts."""
    try:
        p = urlsplit(url)
        return (p.scheme == 'https' and not p.username and not p.password
                and p.port in (None, 443)
                and re.fullmatch(r'(?:open-upload|upload)(?:[.-][a-z0-9]+)*\.tiktokapis\.com', p.hostname or '') is not None
                and p.path == '/video/' and not p.fragment)
    except (TypeError, ValueError):
        return False


def metadata(body, creator):
    if body.get('consent') is not True:
        raise ValueError('Confirm the TikTok music usage declaration before posting')
    title = str(body.get('title', ''))
    if len(title.encode('utf-16-le')) // 2 > 2200:
        raise ValueError('TikTok caption exceeds 2200 UTF-16 characters')
    privacy = body.get('privacy_level')
    if not privacy or privacy not in creator.get('privacy_level_options', []):
        raise ValueError('Select a TikTok privacy option from the current account')
    duration = body.get('duration')
    if type(duration) not in (float, int) or not math.isfinite(duration) or not 0 < duration <= creator.get('max_video_post_duration_sec', 0):
        raise ValueError('Video exceeds the TikTok account duration limit')
    result = {'title': title, 'privacy_level': privacy}
    for field in ('comment', 'duet', 'stitch'):
        value = body.get('allow_' + field, False)
        if type(value) is not bool or (value and creator.get(field + '_disabled', True)):
            raise ValueError('This TikTok interaction is unavailable: ' + field)
        result['disable_' + field] = not value
    for field in ('brand_content_toggle', 'brand_organic_toggle', 'is_aigc'):
        value = body.get(field, False)
        if type(value) is not bool:
            raise ValueError('Invalid TikTok disclosure')
        result[field] = value
    if body.get('commercial') and not (result['brand_content_toggle'] or result['brand_organic_toggle']):
        raise ValueError('Choose your brand or branded content')
    if result['brand_content_toggle'] and (privacy == 'SELF_ONLY' or body.get('branded_consent') is not True):
        raise ValueError('Branded content needs non-private visibility and policy consent')
    return result


class TikTok(YouTube):
    vault_name = 'tiktok-private'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.grants = {}

    def config(self):
        path = Path(os.environ.get('VEDIT_TIKTOK_CONFIG', str(self.root.parent / 'vedit-tiktok.json')))
        data = json.loads(path.read_text(encoding='utf-8-sig')) if path.is_file() else {}
        redirect = os.environ.get('VEDIT_TIKTOK_REDIRECT_URI') or data.get('redirect_uri', '')
        if redirect:
            p = urlsplit(redirect)
            if p.scheme != 'https' or not p.hostname or p.username or p.password or p.path != '/api/tiktok/callback' or p.query or p.fragment:
                raise ValueError('TikTok Web requires an HTTPS URL ending in /api/tiktok/callback')
        return {'client_key': os.environ.get('VEDIT_TIKTOK_CLIENT_KEY') or data.get('client_key', ''),
                'client_secret': os.environ.get('VEDIT_TIKTOK_CLIENT_SECRET') or data.get('client_secret', ''),
                'redirect_uri': redirect, 'pull_enabled': data.get('pull_enabled') is True}

    def status(self, tenant):
        try:
            c = self.config()
            configured = bool(c['client_key'] and c['client_secret'] and c['redirect_uri'])
            token = self.load(tenant) if configured else None
            return {'configured': configured, 'connected': bool(token), 'redirect_uri': c['redirect_uri'],
                    'pull_enabled': c['pull_enabled'], 'account': token.get('account') if token else None}
        except (ValueError, ImportError):
            return {'configured': False, 'connected': False, 'setup_error': 'Check TikTok HTTPS configuration and requirements-youtube.txt'}

    def connect(self, tenant):
        c = self.config()
        if not all(c[k] for k in ('client_key', 'client_secret', 'redirect_uri')):
            raise ValueError('Configure TikTok app credentials and HTTPS callback first')
        state, browser = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        with self.lock:
            self.states = {k: v for k, v in self.states.items() if v['expires'] > time.time()}
            self.states[state] = {'tenant': tenant, 'browser': browser, 'expires': time.time() + 600}
        return 'https://www.tiktok.com/v2/auth/authorize/?' + urlencode({
            'client_key': c['client_key'], 'response_type': 'code', 'scope': SCOPE,
            'redirect_uri': c['redirect_uri'], 'state': state, 'disable_auto_auth': 1}), browser

    def _form(self, endpoint, fields):
        code, _, raw = self.http('POST', BASE + endpoint, {'Content-Type': 'application/x-www-form-urlencoded'}, urlencode(fields).encode())
        data = decoded(raw)
        if code != 200 or data.get('error'):
            raise ValueError('TikTok OAuth failed: ' + str(data.get('error', 'request_failed'))[:120])
        return data

    def _api(self, tenant, endpoint, body=None):
        code, _, raw = self.http('POST', BASE + endpoint, {'Authorization': 'Bearer ' + self.access_token(tenant),
            'Content-Type': 'application/json; charset=UTF-8'}, json.dumps(body or {}).encode())
        data = decoded(raw)
        error = data.get('error', {}).get('code', 'invalid_response')
        if code != 200 or error != 'ok':
            raise ValueError('TikTok: ' + str(error)[:120])
        return data.get('data', {})

    def callback(self, tenant, params, browser):
        with self.lock:
            saved = self.states.get(params.get('state', ''))
            if not saved or saved['expires'] < time.time() or saved['tenant'] != tenant or not browser or not secrets.compare_digest(saved['browser'], browser):
                raise ValueError('TikTok sign-in expired or does not match this browser')
            self.states.pop(params['state'])
        if params.get('error') or not params.get('code'):
            raise ValueError('TikTok permission was not granted')
        c = self.config()
        token = self._form('oauth/token/', {'client_key': c['client_key'], 'client_secret': c['client_secret'],
            'redirect_uri': c['redirect_uri'], 'code': params['code'], 'grant_type': 'authorization_code'})
        self._validate_token(token)
        token['expires'] = time.time() + int(token['expires_in'])
        # Basic identity is fetched before committing a connection to disk.
        code, _, raw = self.http('GET', BASE + 'user/info/?fields=open_id,display_name,avatar_url',
                                 {'Authorization': 'Bearer ' + token['access_token']})
        data = decoded(raw)
        user = data.get('data', {}).get('user', {})
        if code != 200 or data.get('error', {}).get('code') != 'ok' or user.get('open_id') != token['open_id']:
            raise ValueError('Could not verify the connected TikTok account')
        token['account'] = {'name': user.get('display_name', 'TikTok'), 'id': token['open_id']}
        self.save(tenant, token)

    @staticmethod
    def _validate_token(token):
        if not all(token.get(k) for k in ('access_token', 'refresh_token', 'open_id', 'expires_in')) or not set(SCOPE.split(',')).issubset(token.get('scope', '').split(',')):
            raise ValueError('Grant TikTok basic profile and video publishing permissions')

    def access_token(self, tenant):
        with self.lock:
            token = self.load(tenant)
            if not token:
                raise ValueError('Connect TikTok first')
            if token.get('expires', 0) < time.time() + 60:
                c = self.config()
                fresh = self._form('oauth/token/', {'client_key': c['client_key'], 'client_secret': c['client_secret'],
                    'grant_type': 'refresh_token', 'refresh_token': token['refresh_token']})
                self._validate_token(fresh)
                if fresh['open_id'] != token['open_id']:
                    raise ValueError('TikTok account changed during refresh')
                token.update(fresh)
                token['expires'] = time.time() + int(fresh['expires_in'])
                self.save(tenant, token)
            return token['access_token']

    def creator(self, tenant):
        return self._api(tenant, 'post/publish/creator_info/query/')

    def begin_upload(self, tenant, body, export_path=None):
        creator = self.creator(tenant)  # Recheck limits and interactions at submission.
        info = metadata(body, creator)
        size, rid = body.get('size'), body.get('request_id', '')
        if type(size) is not int or not 1 <= size <= MAX_SIZE or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', rid):
            raise ValueError('Invalid TikTok video size or request ID')
        fingerprint = json.dumps([info, size, str(export_path)], sort_keys=True)
        with self.lock:
            self.sessions = {k: v for k, v in self.sessions.items() if v['expires'] > time.time()}
            for sid, s in self.sessions.items():
                if s['tenant'] == tenant and s['request_id'] == rid:
                    if s['fingerprint'] != fingerprint:
                        raise ValueError('Request ID already used for another TikTok post')
                    return {'id': sid, 'chunk_size': s['chunk_size'], 'chunk_count': s['chunk_count'], 'source': s['source']}
            if any(s['tenant'] == tenant and not s.get('terminal') for s in self.sessions.values()):
                raise ValueError('A TikTok post is already active. Check its status first.')
            if sum(not s.get('terminal') for s in self.sessions.values()) >= 4:
                raise ValueError('TikTok posting queue is busy')
            count = max(1, size // CHUNK)
            chunk_size = min(CHUNK, size)
            source = {'source': 'FILE_UPLOAD', 'video_size': size, 'chunk_size': chunk_size, 'total_chunk_count': count}
            grant = None
            if export_path is not None:
                c = self.config()
                if not c['pull_enabled']:
                    raise ValueError('Verify the HTTPS media URL prefix in TikTok Developers before posting server exports')
                grant = secrets.token_urlsafe(32)
                self.grants[grant] = {'path': str(export_path), 'expires': time.time() + 3600, 'tenant': tenant}
                p = urlsplit(c['redirect_uri'])
                source = {'source': 'PULL_FROM_URL', 'video_url': f'{p.scheme}://{p.netloc}/api/tiktok/media/{grant}.mp4'}
            try:
                data = self._api(tenant, 'post/publish/video/init/', {'post_info': info, 'source_info': source})
            except Exception:
                if grant:
                    self.grants.pop(grant, None)
                raise
            publish_id = data.get('publish_id')
            url = data.get('upload_url', '')
            p = urlsplit(url)
            if not isinstance(publish_id, str) or not 1 <= len(publish_id) <= 64:
                raise ValueError('TikTok did not return a publish ID; check TikTok before retrying')
            if source['source'] == 'FILE_UPLOAD' and not is_upload_destination(url):
                # Host only: signed URL query parameters must never reach logs/UI.
                raise ValueError('TikTok returned an unsupported upload destination: ' + (p.hostname or 'missing host'))
            sid = secrets.token_hex(16)
            self.sessions[sid] = {'tenant': tenant, 'request_id': rid, 'fingerprint': fingerprint,
                'size': size, 'chunk_size': chunk_size, 'chunk_count': count, 'source': source['source'],
                'url': url, 'publish_id': publish_id, 'offset': 0, 'expires': time.time() + 86400,
                'upload_expires': time.time() + 3600, 'account': self.load(tenant)['open_id'], 'lock': threading.Lock()}
            return {'id': sid, 'chunk_size': chunk_size, 'chunk_count': count, 'source': source['source']}

    def media_path(self, key):
        with self.lock:
            self.grants = {k: v for k, v in self.grants.items() if v['expires'] > time.time()}
            grant = self.grants.get(key)
        return grant['path'] if grant else None

    def _owned(self, tenant, sid):
        s = self.session(tenant, sid)
        token = self.load(tenant)
        if not token or token['open_id'] != s['account']:
            raise ValueError('TikTok account changed')
        return s

    def chunk(self, tenant, sid, offset, data):
        s = self._owned(tenant, sid)
        with s['lock']:
            expected = s['size'] - offset if s['size'] - offset < s['chunk_size'] * 2 else s['chunk_size']
            if s['source'] != 'FILE_UPLOAD' or s['upload_expires'] < time.time() or offset != s['offset'] or len(data) != expected or not data:
                raise ValueError('Invalid or expired TikTok upload chunk')
            code, _, _ = self.http('PUT', s['url'], {'Content-Type': 'video/mp4',
                'Content-Range': f"bytes {offset}-{offset+len(data)-1}/{s['size']}"}, data)
            final = offset + len(data) == s['size']
            if code != (201 if final else 206):
                raise ValueError('TikTok upload interrupted; check post status before retrying')
            s['offset'] += len(data)
            return {'offset': s['offset'], 'status': 'processing' if final else 'uploading'}

    def upload_status(self, tenant, sid):
        s = self._owned(tenant, sid)
        data = self._api(tenant, 'post/publish/status/fetch/', {'publish_id': s['publish_id']})
        state = data.get('status')
        s['terminal'] = state in ('PUBLISH_COMPLETE', 'FAILED')
        return {'id': sid, 'status': state, 'fail_reason': data.get('fail_reason', ''),
                'post_ids': [str(i) for i in data.get('publicaly_available_post_id', [])], 'offset': data.get('uploaded_bytes', s['offset'])}

    def disconnect(self, tenant):
        token = self.load(tenant)
        if token:
            c = self.config()
            self._form('oauth/revoke/', {'client_key': c['client_key'], 'client_secret': c['client_secret'], 'token': self.access_token(tenant)})
        super().disconnect(tenant)
        with self.lock:
            self.grants = {k: v for k, v in self.grants.items() if v['tenant'] != tenant}
