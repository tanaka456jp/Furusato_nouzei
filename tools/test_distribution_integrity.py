"""Synthetic-only negative tests of Windows ZIP distribution integrity."""
import hashlib
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path

from verify_distribution_integrity import REQUIRED, SCHEMA, inspect_package


class DistributionIntegrityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.package = Path(self.tmp.name) / "review.zip"
        self.contents = {name: (b"MZ" + b"Z" * 15000
                               if name.endswith(".exe") else b"synthetic public test")
                         for name in REQUIRED}

    def write_package(self, contents):
        with zipfile.ZipFile(self.package, "w", zipfile.ZIP_DEFLATED) as out:
            for name, blob in contents.items():
                out.writestr(name, blob)

    def test_healthy_zip_never_authorizes_release(self):
        self.write_package(self.contents)
        sha = hashlib.sha256(self.package.read_bytes()).hexdigest()
        result = inspect_package(self.package, expected_sha256=sha)
        self.assertEqual(result["schema"], SCHEMA)
        self.assertEqual(result["release_decision"], "HOLD")
        self.assertEqual(result["authenticode"], "NOT_VERIFIED_BY_THIS_TOOL")
        self.assertEqual(set(result["member_sha256"]), REQUIRED)
        self.assertNotIn("synthetic public test", str(result))

    def test_missing_binary_or_added_python_source_is_rejected(self):
        for altered in ({k: v for k, v in self.contents.items() if not k.endswith(".exe")},
                        dict(self.contents, **{"withholding_reader.py": b"code"})):
            self.write_package(altered)
            with self.assertRaises(ValueError):
                inspect_package(self.package)

    def test_duplicate_and_traversal_entries_are_rejected(self):
        self.write_package(self.contents)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(self.package, "a") as out:
                out.writestr("README.txt", b"duplicate")
        with self.assertRaises(ValueError):
            inspect_package(self.package)
        self.write_package(dict(self.contents, **{"../bad.txt": b"invalid"}))
        with self.assertRaises(ValueError):
            inspect_package(self.package)

    def test_stale_or_fake_expected_checksum_is_rejected(self):
        self.write_package(self.contents)
        with self.assertRaisesRegex(ValueError, "PACKAGE_SHA256_MISMATCH"):
            inspect_package(self.package, expected_sha256="a" * 64)
        with self.assertRaisesRegex(ValueError, "INVALID_EXPECTED_SHA256"):
            inspect_package(self.package, expected_sha256="invalid")


if __name__ == "__main__":
    unittest.main(verbosity=2)
