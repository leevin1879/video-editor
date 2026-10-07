import os
import tempfile
import unittest
from pathlib import Path
from temporary_storage import mark_temporary, cleanup_temporary, LIFETIME, SUFFIX


class TemporaryStorageTests(unittest.TestCase):
    def test_only_expired_marked_media_is_removed_and_busy_jobs_are_protected(self):
        with tempfile.TemporaryDirectory() as root:
            normal = Path(root) / 'original.mp4'
            sample = Path(root) / 'users' / 'user-a' / 'media' / 'temporary.mp4'
            sample.parent.mkdir(parents=True)
            normal.write_bytes(b'original')
            sample.write_bytes(b'temporary')
            mark_temporary(sample, now=100)
            self.assertEqual(cleanup_temporary(root, now=101), 0)
            self.assertEqual(cleanup_temporary(root, busy=True, now=100+LIFETIME+1), 0)
            self.assertTrue(sample.exists())
            self.assertEqual(cleanup_temporary(root, now=100+LIFETIME+1), 1)
            self.assertTrue(normal.exists())
            self.assertFalse(sample.exists())
            self.assertFalse(Path(str(sample)+SUFFIX).exists())

    def test_marker_cannot_delete_outside_workspace(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside:
            target=Path(outside)/'keep.mp4'; target.write_bytes(b'keep')
            link=Path(root)/'link.mp4'
            try:
                os.symlink(target, link)
            except OSError:
                self.skipTest('Symlink privilege unavailable')
            mark_temporary(link, now=0)
            cleanup_temporary(root, now=LIFETIME+1)
            self.assertTrue(target.exists())


if __name__ == '__main__':
    unittest.main()
