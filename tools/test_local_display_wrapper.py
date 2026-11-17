"""Local screenshot wrapper must remain explicit, isolated and CI-disabled."""
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
class LocalDisplayWrapperContract(unittest.TestCase):
    def test_local_capture_opt_in_and_source_hash(self):
        source=(ROOT/"tools/probe_display_layout_local.ps1").read_text(encoding="utf-8")
        for token in (
            "SyntheticDataReviewed",
            "LOCAL_DISPLAY_REVIEW_REQUIRES_INTERACTIVE_OPERATOR",
            "EXPLICIT_ANONYMOUS_SYNTHETIC_WORKBOOK_REVIEW_REQUIRED",
            "$env:CI", "$env:GITHUB_ACTIONS", "[Environment]::UserInteractive",
            "probe_display_layout.ps1",
            "Get-FileHash", "SHA256",
            "PRIVATE_DISPLAY_STAGING_SHA256_MISMATCH",
            "PRIVATE_DISPLAY_SOURCE_CHANGED_DURING_CAPTURE",
            "RUNNER_TEMP",
            "LOCAL_SYNTHETIC_EXCEL_DISPLAY_OBSERVED_SOURCE_BINDING_REQUIRED_RELEASE_HOLD",
            "LOCAL_DISPLAY_CAPTURE_UNVERIFIED_",
        ):
            with self.subTest(token=token):
                self.assertIn(token, source)
        for forbidden in ("ChangeDisplaySettings", "SetDisplayConfig", "PrintOut("):
            self.assertNotIn(forbidden, source)

    def test_existing_collector_still_disables_macros(self):
        original=(ROOT/"tools/probe_display_layout.ps1").read_text(encoding="utf-8")
        self.assertIn("AutomationSecurity = 3",original)
        self.assertIn("Workbooks.Open($source,0,$true)",original)
        self.assertIn("physical_resolution_verified = $false",original)
        self.assertIn("source_head = $SourceHead",original)

if __name__=="__main__":
    unittest.main(verbosity=2)
