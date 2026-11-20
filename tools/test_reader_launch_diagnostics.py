"""Synthetic-only regression for sanitized EXE launch failures."""
import errno
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from smoke_batch_recalculate_exe import main


class ReaderLaunchTest(unittest.TestCase):
    def test_denial_does_not_expose_path(self):
        with TemporaryDirectory(prefix="synthetic_") as folder:
            exe=Path(folder)/"fake.exe"
            exe.write_bytes(b"MZ-not-real")
            private="C:/Users/PRIVATE_PERSON/private_document.pdf"
            err=PermissionError(errno.EACCES,"denied",private)
            with patch("smoke_batch_recalculate_exe.subprocess.run",side_effect=err):
                with self.assertRaises(SystemExit) as trapped:
                    main(exe)
            self.assertEqual(str(trapped.exception),"READER_EXE_LAUNCH_ACCESS_DENIED")
            self.assertNotIn(private,str(trapped.exception))

    def test_child_nonzero_stays_sanitized(self):
        with TemporaryDirectory(prefix="synthetic_") as folder:
            exe=Path(folder)/"fake.exe"
            exe.write_bytes(b"MZ-not-real")
            response=subprocess.CompletedProcess([],5,"","C:/private")
            with patch("smoke_batch_recalculate_exe.subprocess.run",return_value=response):
                with self.assertRaises(SystemExit) as trapped:
                    main(exe)
            self.assertEqual(str(trapped.exception),"READER_EXE_BATCH_RECALC_NONZERO_EXIT")

    def test_policy_probe_is_read_only(self):
        script=Path(__file__).with_name("probe_reader_launch_policy.ps1").read_text(encoding="utf-8")
        for forbidden in ("Unblock-File","Set-ExecutionPolicy","Set-Acl",
                          "Set-MpPreference","Add-MpPreference","Set-AuthenticodeSignature"):
            self.assertNotIn(forbidden,script)
        self.assertIn("private_paths_recorded=$false",script)
        self.assertIn("release_approved=$false",script)


if __name__=="__main__":
    unittest.main()
