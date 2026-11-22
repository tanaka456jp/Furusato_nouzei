"""Offline, fail-closed CI contract tests for the pre-reader operator gate."""
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

class GateContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (ROOT / ".github/workflows/workbook.yml").read_text(encoding="utf-8")
        cls.gate = (ROOT / "tools/pc1_reader_operator_gate.ps1").read_text(encoding="utf-8-sig")
        cls.release = (ROOT / "tools/release_readiness.py").read_text(encoding="utf-8")

    def test_notice_strictly_before_exe(self):
        check = "- name: Apex One operator confirmation gate (reader EXE not started)"
        notice = "- name: Notify PC1 operator and require fresh pre-EXE readiness acknowledgment"
        execute = "- name: Complete Excel functional and tax update acceptance"
        self.assertEqual(self.workflow.count(notice), 1)
        self.assertLess(self.workflow.index(check), self.workflow.index(notice))
        self.assertLess(self.workflow.index(notice), self.workflow.index(execute))
        self.assertIn("Notify PC1 operator and require fresh pre-EXE readiness acknowledgment", self.release)

    def test_owner_freshness_head_and_timeout(self):
        for phrase in (
            "GITHUB_EVENT_NAME -cne 'workflow_dispatch'",
            "GITHUB_SHA -cne $SourceHead",
            "RUNNER_NAME -cne 'PC1-Furusato-Excel'",
            "GITHUB_ACTOR -cne $owner",
            "Assert-PRHead", "Post-Notice $message",
            "[long]$comment.id -gt $afterId",
            "$comment.user.login -ceq $owner",
            "$comment.author_association -ceq 'OWNER'",
            "([string]$comment.body).Trim() -ceq $command",
            "AddMinutes(10)", "Start-Sleep -Seconds 30",
            "PC1_OPERATOR_READY_TIMEOUT_NO_EXE_EXECUTION_RELEASE_HOLD",
        ):
            self.assertIn(phrase, self.gate)
        for unsafe in ("Set-MpPreference", "Unblock-File", "DisableRealtimeMonitoring"):
            self.assertNotIn(unsafe, self.gate)

    def test_token_scope(self):
        block = self.workflow.split("\n  excel:", 1)[1].split("\n  ready_to_use_review:", 1)[0]
        self.assertIn("      issues: write", block)
        self.assertIn("      pull-requests: read", block)
        self.assertIn("GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}", block)
        self.assertIn("pc1_reader_operator_gate.ps1", block)

if __name__ == "__main__":
    unittest.main(verbosity=2)
