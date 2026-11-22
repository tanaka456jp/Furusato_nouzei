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

    def test_exact_branch_dispatch_does_not_depend_on_mobile_boolean(self):
        # Manual dispatch on the selected development branch must queue PC1.
        self.assertIn('workflow_dispatch:', self.workflow)
        self.assertNotIn('inputs.excel', self.workflow)
        self.assertNotIn('      excel:\n', self.workflow.split('permissions:', 1)[0])
        self.assertIn(
            "github.event_name == 'workflow_dispatch' &&\n"
            "       github.ref == 'refs/heads/fix/excel-2026-salary-nta-20261107'",
            self.workflow)
        self.assertIn(
            "'${{ github.ref }}' -ceq 'refs/heads/fix/excel-2026-salary-nta-20261107'",
            self.workflow)
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

    def test_github_403_falls_back_to_explicit_local_pc1_ack(self):
        # A denied PR comment must neither be misreported as a sent
        # notification nor automatically pass the EXE release gate.
        self.assertIn("catch {", self.gate)
        self.assertIn("PC1_GITHUB_PR_COMMENT_REJECTED_USING_LOCAL_OPERATOR_DIALOG", self.gate)
        self.assertIn("[Environment]::UserInteractive", self.gate)
        self.assertIn("$currentSession -eq 0", self.gate)
        self.assertIn("PC1_OPERATOR_DIALOG_UNAVAILABLE_NO_EXE_EXECUTION_RELEASE_HOLD", self.gate)
        self.assertIn("[System.Windows.Forms.MessageBox]::Show", self.gate)
        self.assertIn("[System.Windows.Forms.MessageBoxDefaultButton]::Button2", self.gate)
        self.assertIn("$answer -ne [System.Windows.Forms.DialogResult]::Yes", self.gate)
        self.assertIn("PC1_OPERATOR_DECLINED_NO_EXE_EXECUTION_RELEASE_HOLD", self.gate)
        self.assertIn("Start-Sleep -Seconds 30", self.gate)
        self.assertIn("Assert-PRHead", self.gate)

    def test_token_scope(self):
        block = self.workflow.split("\n  excel:", 1)[1].split("\n  ready_to_use_review:", 1)[0]
        self.assertIn("      issues: write", block)
        self.assertIn("      pull-requests: read", block)
        self.assertIn("GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}", block)
        self.assertIn("pc1_reader_operator_gate.ps1", block)

if __name__ == "__main__":
    unittest.main(verbosity=2)
