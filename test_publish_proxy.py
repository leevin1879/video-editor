"""Publisher proxy boundaries: public pages/capabilities and narrowly scoped cookies."""
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
from email.message import Message
import unittest
from unittest.mock import patch


class ProxyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        cfg=Path(self.temp.name)/'auth.json'
        cfg.write_text(json.dumps({'session_secret':'test-secret','google_client_id':'test-id',
                                  'google_client_secret':'test-secret','public_url':'https://example.com'}))
        with patch.dict(os.environ,{'VEDIT_AUTH_CFG':str(cfg),'VEDIT_PORT':'8765'}):
            spec=importlib.util.spec_from_file_location('test_publish_proxy_module','deploy/vedit-authproxy.py')
            self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.sent={}
        test=self
        class Connection:
            def __init__(self,*args,**kwargs): pass
            def putrequest(self,method,path,**kwargs): test.sent['path']=path
            def putheader(self,k,v): test.sent[k]=v
            def endheaders(self): pass
            def send(self,data): pass
            def getresponse(self): return self
            status=200
            def getheaders(self): return []
            def read(self,*args): return b''
            def close(self): pass
        self.conn=patch.object(self.module.http.client,'HTTPConnection',Connection);self.conn.start()

    def tearDown(self):
        self.conn.stop();self.temp.cleanup()

    def run_request(self,path,authenticated=False,cookie='',method='GET'):
        p=self.module.Proxy.__new__(self.module.Proxy)
        p.command=method;p.path=path;p.headers=Message();p.headers['Cookie']=cookie
        p._authenticate=lambda:authenticated
        p._session_email=lambda:'test@example.com'
        p._deny=lambda *args:None
        p.send_response=lambda *args:None;p.send_header=lambda *args:None;p.end_headers=lambda:None
        p.rfile=io.BytesIO();p.wfile=io.BytesIO();p._handle()

    def test_capability_only_not_media_or_other_api(self):
        self.run_request('/api/tiktok/media/'+'a'*43+'.mp4')
        self.assertIn('path',self.sent)
        self.assertNotIn('X-Vedit-Tenant',self.sent)
        for path in ['/media/user.mp4','/api/tiktok/status','/api/tiktok/media/wrong.mp4','/exports/video.mp4']:
            self.sent.clear();self.run_request(path)
            self.assertFalse(self.sent,path)

    def test_only_exact_public_pages(self):
        for path in ['/about','/terms','/privacy']:
            self.sent.clear();self.run_request(path)
            self.assertEqual(self.sent.get('path'),path)
        self.sent.clear();self.run_request('/static/app.js')
        self.assertFalse(self.sent)

    def test_head_capability_allowed_but_no_other_head_bypass(self):
        self.run_request('/api/tiktok/media/'+'a'*43+'.mp4',method='HEAD')
        self.assertIn('path',self.sent)
        self.sent.clear();self.run_request('/exports/video.mp4',method='HEAD')
        self.assertFalse(self.sent)

    def test_only_matching_oauth_cookie_forwarded(self):
        cookie='vedit_session=never-forward; vedit_tiktok_state=tt-state; vedit_youtube_state=yt-state'
        self.run_request('/api/tiktok/callback?code=test',True,cookie)
        self.assertEqual(self.sent['Cookie'],'vedit_tiktok_state=tt-state')
        self.assertIn('X-Vedit-Signature',self.sent)
        self.sent.clear();self.run_request('/api/youtube/callback?code=test',True,cookie)
        self.assertEqual(self.sent['Cookie'],'vedit_youtube_state=yt-state')


if __name__=='__main__': unittest.main()
