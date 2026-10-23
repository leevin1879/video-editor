import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
from tiktok_publish import TikTok, metadata, CHUNK

CREATOR = {'creator_nickname': 'Creator', 'privacy_level_options': ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'],
           'max_video_post_duration_sec': 60, 'comment_disabled': False, 'duet_disabled': True, 'stitch_disabled': False}


class TikTokTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.cfg = self.root / 'tiktok.json'
        self.cfg.write_text(json.dumps({'client_key': 'key', 'client_secret': 'secret',
            'redirect_uri': 'https://example.com/api/tiktok/callback'}))
        self.env = patch.dict(os.environ, {'VEDIT_TIKTOK_CONFIG': str(self.cfg)})
        self.env.start()
        self.calls = []
        self.tt = TikTok(self.root, self.root / 'workspace', False, transport=self.http)
        self.tt.save('a', {'access_token': 'access-secret', 'refresh_token': 'refresh-secret', 'open_id': 'creator-a',
            'scope': 'user.info.basic,video.publish', 'expires_in': 86400, 'expires': time.time()+3600,
            'account': {'id': 'creator-a', 'name': 'Creator'}})
        self.body = {'size': CHUNK*2+123, 'request_id': 'unique-request-id-1234', 'title': 'Hello',
                     'privacy_level': 'SELF_ONLY', 'consent': True, 'duration': 15}
        self.state = 'PROCESSING_UPLOAD'
        self.destination = 'https://open-upload.tiktokapis.com/video/?secret=test'

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def http(self, method, url, headers=None, data=None):
        self.calls.append((method, url, headers, data))
        if url.endswith('creator_info/query/'):
            body = CREATOR
        elif url.endswith('video/init/'):
            body = {'publish_id': 'publish-1', 'upload_url': self.destination}
        elif url.endswith('status/fetch/'):
            body = {'status': self.state, 'uploaded_bytes': 0, 'publicaly_available_post_id': []}
        elif method == 'PUT':
            end = int(headers['Content-Range'].split('-')[1].split('/')[0])+1
            return (201 if end == self.body['size'] else 206), {}, b''
        elif url.endswith('oauth/token/'):
            return 200, {}, json.dumps({'access_token':'fresh-secret','refresh_token':'rotated-secret',
                'open_id':'creator-a','scope':'user.info.basic,video.publish','expires_in':86400}).encode()
        else:
            raise AssertionError(url)
        return 200, {}, json.dumps({'data': body, 'error': {'code': 'ok'}}).encode()

    def test_metadata_explicit_privacy_and_consent(self):
        for field, value in [('consent',False),('privacy_level',''),('duration',61),('allow_duet',True)]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                metadata({**self.body,field:value}, CREATOR)
        result=metadata(self.body,CREATOR)
        self.assertTrue(result['disable_comment'])
        self.assertTrue(result['disable_duet'])

    def test_utf16_caption_limit(self):
        with self.assertRaises(ValueError):
            metadata({**self.body,'title':'😀'*1101},CREATOR)

    def test_commercial_disclosure(self):
        with self.assertRaises(ValueError):
            metadata({**self.body,'commercial':True},CREATOR)
        with self.assertRaises(ValueError):
            metadata({**self.body,'brand_content_toggle':True,'branded_consent':True},CREATOR)
        self.assertTrue(metadata({**self.body,'brand_content_toggle':True,'branded_consent':True,
                                 'privacy_level':'PUBLIC_TO_EVERYONE'},CREATOR)['brand_content_toggle'])

    def test_https_callback_required(self):
        for url in ['http://127.0.0.1:8765/api/tiktok/callback','https://example.com/api/tiktok/callback?x=1']:
            with patch.dict(os.environ,{'VEDIT_TIKTOK_REDIRECT_URI':url}),self.assertRaises(ValueError):
                self.tt.config()

    def test_state_bound_to_browser_and_tenant(self):
        url,cookie=self.tt.connect('a')
        state=parse_qs(urlsplit(url).query)['state'][0]
        for tenant,browser in [('b',cookie),('a','wrong')]:
            with self.assertRaises(ValueError):
                self.tt.callback(tenant,{'state':state,'code':'test'},browser)
        self.assertFalse(any('oauth/token/' in c[1] for c in self.calls))

    def test_separate_encrypted_vault(self):
        path=next((self.root/'workspace'/'tiktok-private').glob('*.token'))
        self.assertNotIn(b'access-secret',path.read_bytes())
        self.assertFalse((self.root/'workspace'/'youtube-private').exists())
        self.assertIsNone(self.tt.load('b'))

    def test_refresh_rotates_token(self):
        token=self.tt.load('a');token['expires']=0;self.tt.save('a',token)
        self.assertEqual(self.tt.access_token('a'),'fresh-secret')
        self.assertEqual(self.tt.load('a')['refresh_token'],'rotated-secret')

    def test_chunks_merge_tail_and_status_not_published_early(self):
        s=self.tt.begin_upload('a',self.body)
        self.assertEqual(s['chunk_count'],2)
        init=next(json.loads(c[3]) for c in self.calls if c[1].endswith('video/init/'))
        self.assertEqual(init['source_info']['total_chunk_count'],2)
        self.tt.chunk('a',s['id'],0,b'x'*CHUNK)
        with self.assertRaises(ValueError):
            self.tt.chunk('a',s['id'],CHUNK,b'x'*CHUNK)
        result=self.tt.chunk('a',s['id'],CHUNK,b'x'*(CHUNK+123))
        self.assertEqual(result['status'],'processing')
        self.assertEqual(self.tt.upload_status('a',s['id'])['status'],'PROCESSING_UPLOAD')
        self.state='PUBLISH_COMPLETE'
        self.assertEqual(self.tt.upload_status('a',s['id'])['status'],'PUBLISH_COMPLETE')

    def test_idempotency_and_tenant_isolation(self):
        s=self.tt.begin_upload('a',self.body)
        self.assertEqual(s['id'],self.tt.begin_upload('a',self.body)['id'])
        with self.assertRaises(ValueError):
            self.tt.session('b',s['id'])
        with self.assertRaises(ValueError):
            self.tt.begin_upload('a',{**self.body,'title':'changed'})
        self.assertEqual(sum(c[1].endswith('video/init/') for c in self.calls),1)

    def test_no_arbitrary_upload_host(self):
        self.destination='https://evil.example/video/'
        with self.assertRaises(ValueError):
            self.tt.begin_upload('a',self.body)
        self.assertFalse(any(c[0]=='PUT' for c in self.calls))

    def test_regional_upload_destinations(self):
        from tiktok_publish import is_upload_destination
        for host in ['open-upload.tiktokapis.com', 'open-upload-sg.tiktokapis.com',
                     'open-upload-va.tiktokapis.com', 'upload.us.tiktokapis.com']:
            with self.subTest(host=host):
                self.assertTrue(is_upload_destination('https://' + host + '/video/?upload_token=test'))
        for url in ['https://upload.tiktokapis.com.evil.example/video/',
                    'https://evil.example/video/', 'http://open-upload.tiktokapis.com/video/',
                    'https://user@open-upload.tiktokapis.com/video/',
                    'https://upload.us.tiktokapis.com:8443/video/',
                    'https://evil-open-upload.tiktokapis.com/video/',
                    'https://upload.us.tiktokapis.com/video/#fragment']:
            with self.subTest(url=url):
                self.assertFalse(is_upload_destination(url))

    def test_pull_requires_verified_configuration_and_expires(self):
        export=self.root/'export.mp4';export.write_bytes(b'test')
        with self.assertRaises(ValueError):
            self.tt.begin_upload('a',self.body,export)
        cfg=json.loads(self.cfg.read_text());cfg['pull_enabled']=True;self.cfg.write_text(json.dumps(cfg))
        s=self.tt.begin_upload('a',self.body,export)
        self.assertEqual(s['source'],'PULL_FROM_URL')
        grant=next(iter(self.tt.grants))
        self.assertEqual(self.tt.media_path(grant),str(export))
        self.assertIsNone(self.tt.media_path('wrong'))
        self.tt.grants[grant]['expires']=0
        self.assertIsNone(self.tt.media_path(grant))


if __name__=='__main__':
    unittest.main()
