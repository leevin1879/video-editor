import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from youtube_publish import CHUNK, SCOPE, YouTube, metadata


class YouTubeTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.config = self.root / 'oauth.json'
        self.config.write_text(json.dumps({'client_id':'test.apps.googleusercontent.com',
            'client_secret':'test-secret', 'redirect_uri':'http://127.0.0.1:8765/api/youtube/callback'}))
        self.env = patch.dict(os.environ, {'VEDIT_YOUTUBE_CONFIG':str(self.config)}, clear=False)
        self.env.start()
        self.calls = []
        self.responses = []
        def transport(method, url, headers=None, data=None):
            self.calls.append((method, url, headers, data))
            if not self.responses:
                raise AssertionError('Unexpected network request')
            return self.responses.pop(0)
        self.yt = YouTube(self.root,self.root/'workspace',False,transport=transport)
        self.meta = {'title':'Test video','description':'Description','made_for_kids':False,
                     'size':CHUNK+5,'request_id':'unique-request-12345'}

    def tearDown(self):
        self.env.stop()
        self.folder.cleanup()

    def token(self, tenant='a', expires=None):
        self.yt.save(tenant, {'access_token':'access-secret','refresh_token':'refresh-secret',
                 'expires':expires or time.time()+3600,'channel':{'id':'channel-a','title':'My channel'}})

    def begin(self):
        self.token()
        self.responses.append((200,{'Location':'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=secret'},b''))
        return self.yt.begin_upload('a',self.meta)['id']

    def test_metadata_private_by_default_and_explicit_kids(self):
        self.assertEqual(metadata(self.meta)['status']['privacyStatus'],'private')
        for update in ({'made_for_kids':None},{'privacy':'other'},{'title':'<bad>'},{'description':'한'*2000}):
            with self.assertRaises(ValueError):metadata({**self.meta,**update})

    def test_encrypted_tokens_are_tenant_isolated(self):
        self.token()
        self.assertIsNone(self.yt.load('b'))
        folder,_=self.yt._vault()
        self.assertNotIn(b'refresh-secret',self.yt._path(folder,'a').read_bytes())
        self.assertEqual(self.yt.load('a')['channel']['title'],'My channel')

    def test_oauth_cookie_tenant_pkce_and_replay(self):
        url,cookie=self.yt.connect('a')
        query=parse_qs(urlsplit(url).query)
        state=query['state'][0]
        self.assertEqual(query['code_challenge_method'],['S256'])
        for tenant,browser in [('b',cookie),('a','wrong')]:
            with self.assertRaises(ValueError):self.yt.callback(tenant,{'state':state,'code':'code'},browser)
        self.assertFalse(self.calls)
        self.responses.extend([(200,{},json.dumps({'access_token':'access','refresh_token':'refresh','scope':SCOPE}).encode()),
            (200,{},json.dumps({'items':[{'id':'channel','snippet':{'title':'Selected channel'}}]}).encode())])
        self.yt.callback('a',{'state':state,'code':'code'},cookie)
        self.assertIn(b'code_verifier=',self.calls[0][3])
        self.assertEqual(self.yt.status('a')['channel']['title'],'Selected channel')
        with self.assertRaises(ValueError):self.yt.callback('a',{'state':state,'code':'code'},cookie)

    def test_oauth_cancel_expiry_and_missing_scopes(self):
        url,cookie=self.yt.connect('a');state=parse_qs(urlsplit(url).query)['state'][0]
        self.yt.states[state]['expires']=0
        with self.assertRaises(ValueError):self.yt.callback('a',{'state':state,'code':'x'},cookie)
        url,cookie=self.yt.connect('a');state=parse_qs(urlsplit(url).query)['state'][0]
        with self.assertRaises(ValueError):self.yt.callback('a',{'state':state,'error':'access_denied'},cookie)
        url,cookie=self.yt.connect('a');state=parse_qs(urlsplit(url).query)['state'][0]
        self.responses.append((200,{},json.dumps({'access_token':'a','refresh_token':'r','scope':'openid'}).encode()))
        with self.assertRaises(ValueError):self.yt.callback('a',{'state':state,'code':'x'},cookie)
        self.assertIsNone(self.yt.load('a'))

    def test_upload_chunks_resume_and_idempotency(self):
        sid=self.begin()
        self.assertEqual(self.yt.begin_upload('a',self.meta)['id'],sid)
        self.assertEqual(len(self.calls),1)
        posted=json.loads(self.calls[0][3]);self.assertEqual(posted['status']['privacyStatus'],'private')
        self.responses.append((308,{'Range':f'bytes=0-{CHUNK-1}'},b''))
        self.assertEqual(self.yt.chunk('a',sid,0,b'x'*CHUNK)['offset'],CHUNK)
        self.responses.append((308,{'Range':f'bytes=0-{CHUNK-1}'},b''))
        self.assertEqual(self.yt.upload_status('a',sid)['offset'],CHUNK)
        self.responses.append((201,{},json.dumps({'id':'video-12345','status':{'privacyStatus':'private'}}).encode()))
        result=self.yt.chunk('a',sid,CHUNK,b'final')
        self.assertEqual(result['status'],'done')
        self.assertEqual(self.calls[-1][2]['Content-Range'],f'bytes {CHUNK}-{CHUNK+4}/{CHUNK+5}')
        self.assertEqual(self.yt.chunk('a',sid,CHUNK,b'final'),result)

    def test_cross_tenant_upload_and_invalid_offsets_rejected(self):
        sid=self.begin()
        with self.assertRaises(ValueError):self.yt.session('b',sid)
        with self.assertRaises(ValueError):self.yt.chunk('b',sid,0,b'a')
        with self.assertRaises(ValueError):self.yt.chunk('a',sid,1,b'a')
        with self.assertRaises(ValueError):self.yt.chunk('a',sid,0,b'a')
        self.assertEqual(len(self.calls),1)

    def test_google_destination_must_be_exact_allowlist(self):
        self.token()
        self.responses.append((200,{'Location':'https://evil.example/upload'},b''))
        with self.assertRaises(ValueError):self.yt.begin_upload('a',self.meta)
        self.assertFalse(self.yt.sessions)

    def test_refresh_token_and_channel_switch(self):
        self.token(expires=1)
        self.responses.append((200,{},json.dumps({'access_token':'fresh','expires_in':3600}).encode()))
        self.assertEqual(self.yt.access_token('a'),'fresh')
        self.assertEqual(self.yt.load('a')['refresh_token'],'refresh-secret')
        sid=self.begin()
        token=self.yt.load('a');token['channel']['id']='different';self.yt.save('a',token)
        with self.assertRaises(ValueError):self.yt.chunk('a',sid,0,b'x'*CHUNK)

    def test_disconnect_and_cancel_are_isolated(self):
        sid=self.begin();self.token('b')
        self.yt.cancel('a',sid)
        with self.assertRaises(ValueError):self.yt.session('a',sid)
        self.yt.disconnect('a')
        self.assertIsNone(self.yt.load('a'))
        self.assertIsNotNone(self.yt.load('b'))

    def test_local_configuration_validates_redirect_and_never_overwrites(self):
        self.config.unlink()
        web={'client_id':'test.apps.googleusercontent.com','client_secret':'test-secret','redirect_uris':[]}
        with self.assertRaises(ValueError):self.yt.configure_local({'client':{'web':web}})
        web['redirect_uris']=['http://127.0.0.1:8765/api/youtube/callback']
        self.yt.configure_local({'client':{'web':web}})
        self.assertTrue(self.yt.status('a')['configured'])
        with self.assertRaises(ValueError):self.yt.configure_local({'client':{'web':web}})
        self.yt.multiuser=True
        with self.assertRaises(ValueError):self.yt.configure_local({'client':{'web':web}})


if __name__=='__main__':
    unittest.main()
