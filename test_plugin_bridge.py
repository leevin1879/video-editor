import unittest
from unittest.mock import patch
from plugin_bridge import PluginBridge


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.bridge = PluginBridge()
        self.key = self.bridge.connect('editor-test')['token']

    def test_auth_rotation_disconnect(self):
        self.assertTrue(self.bridge.authorize(self.key))
        self.assertFalse(self.bridge.authorize('wrong'))
        self.bridge.connect('editor-test')
        self.assertFalse(self.bridge.authorize(self.key))
        self.bridge.disconnect('editor-test')
        self.assertFalse(self.bridge.authorize(self.key))

    def test_exactly_once_and_result(self):
        ident = self.bridge.enqueue('get_project', {})['command_id']
        with self.assertRaises(ValueError):
            self.bridge.enqueue('undo', {})
        self.assertEqual(len(self.bridge.poll('editor-test')['commands']), 1)
        self.assertEqual(self.bridge.poll('editor-test')['commands'], [])
        self.bridge.complete('editor-test', ident, {'name': 'test'})
        self.assertEqual(self.bridge.result(ident)['status'], 'done')
        with self.assertRaises(ValueError):
            self.bridge.complete('editor-test', ident, {})

    def test_wrong_tab_and_offline(self):
        with self.assertRaises(ValueError):
            self.bridge.connect('another-editor')
        with self.assertRaises(ValueError):
            self.bridge.poll('another-editor')
        with patch('plugin_bridge.time.monotonic', return_value=self.bridge.seen+9):
            with self.assertRaises(ValueError):
                self.bridge.enqueue('get_project', {})


if __name__ == '__main__':
    unittest.main()
