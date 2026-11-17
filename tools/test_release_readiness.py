"""Release checks must never approve solely from synthetic CI or metadata."""
import unittest
from release_readiness import REQUIRED, SCHEMA, PRODUCT_SCOPE, REVIEWER_ROLES, evaluate, parse_evidence_json

HEAD = "a" * 40


class ReleaseReadinessTest(unittest.TestCase):
    def test_pr_report_uses_actual_pr_head_not_ephemeral_merge_sha(self):
        from pathlib import Path
        workflow = (Path(__file__).resolve().parents[1] /
                    ".github/workflows/workbook.yml").read_text(encoding="utf-8")
        self.assertIn("github.event.pull_request.head.sha || github.sha", workflow)
        self.assertNotIn('--head "${GITHUB_SHA}"', workflow)

    def test_review_bundle_needs_all_quality_gates_to_succeed(self):
        from pathlib import Path
        workflow = (Path(__file__).resolve().parents[1] /
                    ".github/workflows/workbook.yml").read_text(encoding="utf-8")
        self.assertIn("  excel:\n    # Run expensive PC Excel COM only after lightweight safety gates have passed.\n    needs: [static, windows_compat, document_reader]", workflow)
        self.assertEqual(workflow.count("  ready_to_use_review:"), 1)
        section = workflow.split("  ready_to_use_review:", 1)[1]
        self.assertIn("needs: [static, windows_compat, excel, document_reader]",
                      section)
        self.assertNotIn("needs: [excel, document_reader]", section)
        self.assertNotIn("if: always()", section)
        self.assertIn("SYNTHETIC_CI_REVIEW_ONLY", section)
        self.assertIn("release_decision -ne 'HOLD'", section)

    def test_display_mode_observed_separately_from_dpi_virtualized_bounds(self):
        from pathlib import Path
        src = (Path(__file__).resolve().parents[1] /
               "tools/probe_display_layout.ps1").read_text(encoding="utf-8-sig")
        self.assertIn('EnumDisplaySettingsW', src)
        self.assertIn('$deviceMode.dmSize = [UInt16]',src)
        self.assertNotIn('$deviceMode.dmSize = [ushort]',src)
        self.assertIn('public static extern bool EnumDisplaySettings(', src)
        self.assertIn('$display.current_mode_pixels', src)
        self.assertIn('physical_resolution_verified = $false', src)
        self.assertIn('$display.display_mode_observed', src)
        self.assertIn('mode = $measured', src)
        self.assertIn("if ($display.display_mode_observed -and", src)
        self.assertNotIn('scenario_approved = $measured', src)


    def test_excel_offline_scope_excludes_live_gas_without_waiving_tax_and_signatures(self):
        self.assertEqual(PRODUCT_SCOPE, "EXCEL_STANDALONE_NO_GAS_RUNTIME")
        self.assertNotIn("live_google_gas_independent_acceptance", REQUIRED)
        self.assertEqual(len(REQUIRED), 9)
        result = evaluate(HEAD)
        self.assertEqual(result["product_scope"], PRODUCT_SCOPE)
        self.assertIn("MISSING_SIGNED_DISTRIBUTION_AND_SHA256", result["blockers"])
        old = evaluate(HEAD, {"schema": "furusato-release-readiness/v3",
                              "head_sha": HEAD, "checks": {
                                  "live_google_gas_independent_acceptance": {
                                      "status": "REVIEWED", "sha256": "f" * 64,
                                      "reviewer_role": "qa_operator", "head_sha": HEAD}}})
        self.assertIn("SCHEMA_MISSING_OR_UNSUPPORTED", old["blockers"])
        self.assertIn("UNKNOWN_CHECK_KEYS", old["blockers"])

    def test_resident_notice_is_never_a_required_gate(self):
        self.assertNotIn("real_tax_and_resident_notice_reconciliation",REQUIRED)
        self.assertIn("salary_only_independent_withholding_reconciliation",REQUIRED)
        self.assertIn("prior_year_projection_independent_resident_deductions",REQUIRED)
        self.assertIn("mortgage_filing_independent_tax_difference", REQUIRED)
        self.assertEqual(
            REVIEWER_ROLES["prior_year_projection_independent_resident_deductions"],
            ("tax_professional", "external_reviewer"),
        )
        self.assertEqual(SCHEMA, "furusato-release-readiness/v4")
        old_manifest={"schema":"furusato-release-readiness/v1",
                      "head_sha":HEAD,
                      "checks":{"real_tax_and_resident_notice_reconciliation":{
                          "status":"REVIEWED","sha256":"f"*64,
                          "reviewer_role":"tax_professional","head_sha":HEAD}}}
        old=evaluate(HEAD,old_manifest)
        self.assertEqual(old["release_decision"],"HOLD")
        self.assertIn("SCHEMA_MISSING_OR_UNSUPPORTED",old["blockers"])
        self.assertIn("UNKNOWN_CHECK_KEYS",old["blockers"])

    def test_older_evidence_manifest_does_not_bypass_projection_gate(self):
        old_checks = {
            key: {"status": "REVIEWED", "sha256": "f" * 64,
                  "reviewer_role": REVIEWER_ROLES[key][0], "head_sha": HEAD}
            for key in REQUIRED
            if key != "prior_year_projection_independent_resident_deductions"
        }
        report = evaluate(HEAD, {
            "schema": SCHEMA, "head_sha": HEAD, "checks": old_checks,
        })
        self.assertEqual(report["release_decision"], "HOLD")
        self.assertIn(
            "MISSING_PRIOR_YEAR_PROJECTION_INDEPENDENT_RESIDENT_DEDUCTIONS",
            report["blockers"],
        )

    def test_mortgage_filing_tax_review_is_mandatory_and_role_limited(self):
        self.assertEqual(
            REVIEWER_ROLES["mortgage_filing_independent_tax_difference"],
            ("tax_professional", "external_reviewer"),
        )
        old_checks = {
            key: {"status": "REVIEWED", "sha256": "f" * 64,
                  "reviewer_role": REVIEWER_ROLES[key][0], "head_sha": HEAD}
            for key in REQUIRED if key != "mortgage_filing_independent_tax_difference"
        }
        incomplete = evaluate(HEAD, {
            "schema": SCHEMA, "head_sha": HEAD, "checks": old_checks,
        })
        self.assertEqual(incomplete["release_decision"], "HOLD")
        self.assertIn(
            "MISSING_MORTGAGE_FILING_INDEPENDENT_TAX_DIFFERENCE",
            incomplete["blockers"],
        )
        recorded = dict(old_checks)
        recorded["mortgage_filing_independent_tax_difference"] = {
            "status": "REVIEWED", "sha256": "f" * 64,
            "reviewer_role": "qa_operator", "head_sha": HEAD,
        }
        unauthorized = evaluate(HEAD, {
            "schema": SCHEMA, "head_sha": HEAD, "checks": recorded,
        })
        self.assertEqual(
            unauthorized["checks"]["mortgage_filing_independent_tax_difference"],
            "INVALID",
        )
        self.assertEqual(unauthorized["release_decision"], "HOLD")
        old_format = evaluate(HEAD, {
            "schema": "furusato-release-readiness/v2",
            "head_sha": HEAD, "checks": recorded,
        })
        self.assertIn("SCHEMA_MISSING_OR_UNSUPPORTED", old_format["blockers"])
        self.assertEqual(old_format["release_decision"], "HOLD")

    def test_release_gate_documentation_matches_required_v4_excel_scope(self):
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        documentation = (root / "docs/release-readiness.md").read_text(encoding="utf-8-sig")
        self.assertIn("Excel単体版の正式受入に必要な9条件", documentation)
        self.assertIn("schema: furusato-release-readiness/v4", documentation)
        self.assertEqual(len(REQUIRED), 9)
        for key in REQUIRED:
            with self.subTest(check=key):
                self.assertIn("| `" + key + "` |", documentation)
        self.assertNotIn("正式受入までに必要な8条件", documentation)
        self.assertNotIn("上記8キー", documentation)
        self.assertNotIn("furusato-release-readiness/v2`", documentation)
        windows = (root / "docs/windows-acceptance.md").read_text(encoding="utf-8-sig")
        self.assertIn("住民税決定通知書は不要", windows)
        self.assertIn("住宅ローン控除", windows)

    def test_signed_distribution_requires_trusted_local_certificate_and_hash(self):
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        script = (root / "tools/verify_signed_release_local.ps1").read_text(
            encoding="utf-8-sig")
        for evidence in ("Get-LocalAuthenticodeSignature",
                         "ExpectedPackageSha256",
                         "ExpectedSignerThumbprint",
                         "READER_EXE_AUTHENTICODE_NOT_TRUSTED",
                         "SIGNER_CERTIFICATE_MISMATCH",
                         "REVIEW_ONLY_ZIP_CANNOT_BE_RELEASED",
                         "INDEPENDENT_PACKAGE_SHA256_MISMATCH",
                         "VBA_MACRO_SIGNATURE_NOT_DISCOVERED",
                         "OFFICE_VBA_SIGNATURE_NOT_RECOGNIZED",
                         "VBASigned",
                         "office_vba_signed_property = 'OFFICE_RECOGNIZED_SIGNED_PROJECT'",
                         "MACRO_WORKBOOK_VBA_PROJECT_MISSING_OR_INVALID",
                         "UNEXPECTED_RELEASE_PACKAGE_CONTENTS",
                         "OFFICE_SIP_CRYPTOGRAPHICALLY_VERIFIED",
                         "ExpectedReaderSigningState", "signature_gate = 'PASS'"):
            self.assertIn(evidence, script)
        self.assertNotIn("New-SelfSignedCertificate", script)
        self.assertNotIn("SignTool sign", script)
        self.assertNotIn("Set-AuthenticodeSignature", script)

    def test_physical_printer_local_acceptance_requires_real_printer_and_explicit_consent(self):
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        source = (root / "tools/verify_physical_printer_local.ps1").read_text(
            encoding="utf-8-sig")
        for token in (
            "SyntheticDataReviewed", "AllowOnePagePrint",
            "ExpectedDisplayedLimitYen", "ExpectedTaxYear",
            "UNAPPROVED_PRINT_TAX_YEAR", "PRINT_TAX_YEAR_MISMATCH",
            "FitToPagesWide = 1", "FitToPagesTall = 1",
            "expected_tax_year_verified = $true",
            "forced_a4_single_page_layout = $true",
            "EXPLICIT_SYNTHETIC_DATA_AND_PHYSICAL_PRINT_CONSENT_REQUIRED",
            "PHYSICAL_PRINT_REQUIRES_LOCAL_INTERACTIVE_OPERATOR",
            "CalculateFullRebuild()", "EXCEL_CALCULATION_NOT_COMPLETE",
            "PRINT_SCENARIO_CALCULATION_NOT_VERIFIED",
            "DISPLAYED_DONATION_LIMIT_MISMATCH",
            "PRINT_DETAILS_LIMIT_MISMATCH",
            "PHYSICAL_PRINT_NOT_RECONFIRMED_AFTER_PREVIEW",
            "PRINT_SCENARIO_CHANGED_AFTER_PREVIEW",
            "Read-Host", "expected_limit_yen_verified = $true",
            "REVIEWED_SYNTHETIC_WORKBOOK_HASH_MISMATCH",
            "Get-CimInstance -ClassName Win32_Printer",
            "PHYSICAL_PRINTER_NOT_VERIFIED",
            "Assert-ExplicitActivePrinter",
            "EXCEL_ACTIVE_PRINTER_DOES_NOT_MATCH_EXPLICIT_SELECTION",
            "AutomationSecurity = 3", "PrintPreview()",
            "PrintOut(1,1,1,$false)", "paper_physically_observed = $false",
            "paper_readability_reviewed = $false",
            "release_decision = 'HOLD'",
        ):
            with self.subTest(token=token):
                self.assertIn(token, source)
        self.assertNotIn("-notlike ('*'+$PrinterName+'*')", source)
        self.assertNotIn("Get-Printer | Select-Object -First 1", source)
        self.assertNotIn("PrintOut(1,0", source)
        docs = (root / "docs/release-acceptance-one-pass.md").read_text(encoding="utf-8-sig")
        self.assertIn("verify_physical_printer_local.ps1", docs)
        self.assertIn("AllowOnePagePrint", docs)
        self.assertIn("ExpectedDisplayedLimitYen", docs)
        self.assertIn("ExpectedTaxYear", docs)
        self.assertIn("PRINT-ONE-PAGE", docs)

    def test_evidence_json_duplicate_and_nonfinite_values_are_rejected(self):
        examples = (
            '{"head_sha":"a","head_sha":"b"}',
            '{"checks":{"ci_exact_commit":{"status":"REVIEWED","status":"APPROVED"}}}',
            '{"checks":{"ci_exact_commit":{},"ci_exact_commit":{}}}',
            '{"amount":NaN}',
            '{"amount":Infinity}',
            '{"amount":-Infinity}',
        )
        for sample in examples:
            with self.subTest(sample=sample):
                with self.assertRaisesRegex(ValueError, "RELEASE_EVIDENCE_JSON"):
                    parse_evidence_json(sample)
        self.assertEqual(parse_evidence_json('{"checks":{},"other":123}'),
                         {"checks": {}, "other": 123})

    def test_no_evidence_always_hold(self):
        report = evaluate(HEAD)
        self.assertEqual(report["release_decision"], "HOLD")
        self.assertEqual(set(report["checks"]), set(REQUIRED))
        self.assertTrue(all(v == "MISSING" for v in report["checks"].values()))

    def test_stale_evidence_and_private_fields_not_emitted(self):
        report = evaluate(HEAD, {
            "schema": SCHEMA, "head_sha": "b" * 40, "taxpayer_name": "CONFIDENTIAL",
            "checks": {"ci_exact_commit": {
                "status": "REVIEWED", "sha256": "f" * 64,
                "head_sha": "b" * 40, "reviewer_role": "qa_operator"}}})
        self.assertIn("EVIDENCE_SHA_NOT_CURRENT", report["blockers"])
        self.assertIn("MANIFEST_EXTRA_FIELDS", report["blockers"])
        self.assertNotIn("CONFIDENTIAL", repr(report))
        with self.assertRaises(ValueError):
            evaluate("not-a-commit")

    def test_tax_gate_cannot_be_signed_off_by_release_operator(self):
        entry = {"status": "REVIEWED", "sha256": "f" * 64,
                 "reviewer_role": "release_operator", "head_sha": HEAD}
        report = evaluate(HEAD, {"schema": SCHEMA, "head_sha": HEAD,
                                 "checks": {"salary_only_independent_withholding_reconciliation": entry}})
        self.assertEqual(report["checks"]["salary_only_independent_withholding_reconciliation"], "INVALID")
        self.assertIn("INVALID_SALARY_ONLY_INDEPENDENT_WITHHOLDING_RECONCILIATION", report["blockers"])
        self.assertEqual(report["release_decision"], "HOLD")

    def test_malformed_evidence_never_counts_as_reviewed(self):
        base = {"status": "REVIEWED", "sha256": "f" * 64,
                "reviewer_role": "tax_professional", "head_sha": HEAD}
        bad_cases = (
            {"status": "APPROVED"},
            {"sha256": "0" * 64},
            {"sha256": "F" * 64},
            {"sha256": "not-a-hash"},
            {"head_sha": "b" * 40},
            {"reviewer_role": "release_operator"},
            {"reviewer_role": ["tax_professional"]},
            {"taxpayer_name": "PRIVATE_DO_NOT_EMIT"},
        )
        gate = "salary_only_independent_withholding_reconciliation"
        for change in bad_cases:
            with self.subTest(change=repr(change)):
                evidence = dict(base, **change)
                report = evaluate(HEAD, {"schema": SCHEMA, "head_sha": HEAD,
                                         "checks": {gate: evidence}})
                self.assertEqual(report["checks"][gate], "INVALID")
                self.assertIn("INVALID_" + gate.upper(), report["blockers"])
                self.assertEqual(report["release_decision"], "HOLD")
                self.assertNotIn("PRIVATE_DO_NOT_EMIT", repr(report))

    def test_each_gate_accepts_only_its_authorized_role(self):
        self.assertEqual(set(REVIEWER_ROLES), set(REQUIRED))
        checks = {key: {"status": "REVIEWED", "sha256": "f" * 64,
                        "reviewer_role": REVIEWER_ROLES[key][0], "head_sha": HEAD}
                  for key in REQUIRED}
        report = evaluate(HEAD, {"schema": SCHEMA, "head_sha": HEAD, "checks": checks})
        self.assertEqual(report["blockers"], [])
        self.assertEqual(report["release_decision"], "HOLD")

    def test_all_recorded_evidence_still_not_release_authorization(self):
        checks = {key: {"status": "REVIEWED", "sha256": "f" * 64,
                        "reviewer_role": REVIEWER_ROLES[key][0], "head_sha": HEAD}
                  for key in REQUIRED}
        report = evaluate(HEAD, {
            "schema": SCHEMA, "head_sha": HEAD,
            "checks": checks})
        self.assertEqual(report["blockers"], [])
        self.assertEqual(report["review_stage"], "MANUAL_FINAL_AUDIT_REQUIRED")
        self.assertEqual(report["release_decision"], "HOLD")
        self.assertTrue(all("NOT_INDEPENDENTLY_VERIFIED" in x
                            for x in report["checks"].values()))

if __name__ == "__main__":
    unittest.main(verbosity=2)
