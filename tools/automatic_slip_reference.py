"""Automatic *hypothetical* amount from one withholding slip, no user attestation.

Never converts a source slip to a VERIFIED contribution ceiling. This estimate
assumes one salary only, no independent income, unchanged annual employment
conditions, source national non-basic deductions carried unchanged, resident
basic deduction of JPY 430,000, and no resident-tax/filing tax credits.
For a preceding-year slip, the target tax year's salary table and national
basic are applied, but no future employment/family fact is asserted.
"""
from audit_salary_donation_limit import (
    BASIC, independent_nta_fifth_table_salary_income, independent_salary_ceiling,
    resident_income_levy_exemption_limit,
)
from batch_source_deductions import MortgageDeductionError, reconcile_mortgage_deductions

REQUIRED = ("salary_gross", "salary_reference", "deductions_reference",
            "social_insurance", "income_tax_withheld")
FATAL_WARNINGS = ("INVALID_", "CONFLICT_", "AMBIGUOUS_", "UNSUPPORTED_",
                  "YEAR_NOT_APPROVED")


def make_automatic_reference(extracted, target_year):
    """Return only a safe numeric hypothetical or a no-number HOLD code."""
    def hold(reason):
        return {"status": "HOLD", "reason": reason}
    if type(target_year) is not int or target_year not in BASIC:
        return hold("TARGET_YEAR_UNAPPROVED")
    source_year = extracted.get("year")
    if type(source_year) is not int or source_year not in BASIC:
        return hold("SOURCE_YEAR_UNAPPROVED")
    if source_year > target_year or target_year - source_year > 1:
        return hold("SOURCE_TARGET_UNAPPROVED")
    fields = extracted.get("fields") or {}
    if not isinstance(fields, dict):
        return hold("FIELDS_MISSING")
    if any(key not in fields or type(fields[key]) is not int
           for key in REQUIRED):
        return hold("REQUIRED_FIELDS_MISSING")
    warnings = extracted.get("warnings") or []
    if not isinstance(warnings, list) or any(
            not isinstance(w, str) for w in warnings):
        return hold("WARNINGS_INVALID")
    if any(w.startswith(FATAL_WARNINGS) for w in warnings):
        return hold("DOCUMENT_UNRELIABLE")
    if extracted.get("format") not in (
            "PDF_TEXT", "PDF_PAGE_SELECTED", "STRUCTURED_JSON",
            "STRUCTURED_TEXT", "TEXT_LABELS"):
        return hold("OCR_OR_UNSUPPORTED_SOURCE")
    gross = fields["salary_gross"]
    gross_source_income = fields["salary_reference"]
    gross_deductions = fields["deductions_reference"]
    social = fields["social_insurance"]
    if (not 0 <= gross <= 20_000_000
            or not 0 <= gross_source_income <= gross
            or not 0 <= gross_deductions <= 10**12
            or not 0 <= social <= gross_deductions
            or not 0 <= fields["income_tax_withheld"] <= gross):
        return hold("INVALID_INCOME_OR_DEDUCTIONS")
    source_basic = fields.get("basic_reference")
    if source_basic is None:
        source_basic = next((v for upper, v in BASIC[source_year]
                             if gross_source_income <= upper), None)
    if type(source_basic) is not int or source_basic < 0:
        return hold("BASIC_DEDUCTION_UNKNOWN")
    nonbasic = gross_deductions - source_basic
    if nonbasic < social:
        return hold("SOURCE_DEDUCTIONS_INCONSISTENT")
    mortgage_keys = ("mortgage_credit", "mortgage_possible_credit",
                     "mortgage_occupancy_year", "mortgage_claim_count")
    mortgage_present = any(fields.get(k) not in (None, 0) for k in mortgage_keys)
    # Source-year deductions are reconciled after salary projection so the
    # target-year basic/insurance rules cannot contaminate the source check.
    mortgage_deductions = None
    model = None
    model_locality = "UNCERTAIN"
    try:
        # Even when estimating a future year, keep source income-adjustment
        # as an explicit hypothesis and do not claim it was re-verified.
        adjustment = fields.get("income_adjustment", 0)
        if type(adjustment) is not int or adjustment < 0 or adjustment > 150_000:
            return hold("SALARY_ADJUSTMENT_UNSUPPORTED")
        projected_salary = (gross_source_income if target_year == source_year
                            else independent_nta_fifth_table_salary_income(
                                target_year, gross) - adjustment)
        if projected_salary < 0 or projected_salary > gross:
            return hold("PROJECTED_SALARY_INVALID")
        # A verified family count requires recomputation of LOCAL deductions,
        # never the source national nonbasic amount carried into local tax.
        family_details_entered = any(fields.get(k, 0) for k in (
            "under16_count", "dependent_general_count", "dependent_special_count",
            "dependent_elderly_count", "dependent_cohabiting_elderly_count",
            "under23_life_eligible_flag"))
        if mortgage_present or family_details_entered:
            try:
                mortgage_deductions = reconcile_mortgage_deductions(
                    fields, source_year, target_year, source_basic,
                    gross_source_income, projected_salary)
            except MortgageDeductionError as exc:
                return hold(str(exc))
        resident_deductions = (mortgage_deductions["target_resident"]
                               if mortgage_deductions is not None
                               else nonbasic + 430_000)
        personal_difference = (mortgage_deductions["personal_difference"]
                               if mortgage_deductions is not None else 50_000)
        if (projected_salary <= 450_000 or
                (mortgage_deductions is not None and
                 projected_salary <= resident_income_levy_exemption_limit(
                     mortgage_deductions["family_count"]))):
            # Confirmed family count can raise the resident income-levy
            # exemption above the universal single-taxpayer threshold.
            # The taxable base alone must never generate a false cap.
            amount = 0
        elif resident_deductions >= projected_salary:
            amount = 0
        else:
            # Use only the source recipient's G01 municipality *candidate*
            # as a model assumption, never as January 1 residency proof.
            hint = extracted.get("municipality_hint") or {}
            category = hint.get("class")
            if category == "STANDARD":
                places = ("standard",)
                model_locality = "STANDARD"
            elif category == "DESIGNATED":
                places = ("designated",)
                model_locality = "DESIGNATED"
            else:
                # Unknown / special ordinance: choose the smaller ordinary
                # scenario only; the actual statute may differ materially.
                places = ("standard", "designated")
            scenarios = [independent_salary_ceiling(
                year=target_year, salary_income=projected_salary,
                resident_deductions=resident_deductions,
                personal_difference=personal_difference, municipality=place,
            ) for place in places]
            # Keep the exact *chosen* model with the minimum reference.
            # Never mix the rate from one municipality with the levy of another.
            model = min(scenarios, key=lambda x: x["thousand_yen_reference"])
            amount = model["thousand_yen_reference"]
    except (TypeError, ValueError, KeyError):
        return hold("MODEL_OUTSIDE_SCOPE")
    # Default batch route is NO tax return + one-stop application. A
    # housing-credit slip must never silently receive the no-credit amount.
    filing_higher = None
    filing_limit = None
    if not mortgage_present and model is not None:
        # Compute the tax-return pathway independently, not by copying I.
        # A source-year income-tax match and reconciled target-year resident
        # deductions are required; otherwise only filing stays unconfirmed.
        from audit_withholding_reconciliation import reconcile
        from audit_salary_filing import independent_salary_filing_ceiling
        try:
            projected = (mortgage_deductions
                         if mortgage_deductions is not None
                         else reconcile_mortgage_deductions(
                             fields, source_year, target_year, source_basic,
                             gross_source_income, projected_salary))
            if (reconcile(source_year, fields).get("source_tax") == "MATCH"
                    and projected["target_resident"] == resident_deductions
                    and (extracted.get("municipality_hint") or {}).get("class")
                    in ("STANDARD", "DESIGNATED")):
                filing_limit = independent_salary_filing_ceiling(
                    year=target_year, salary_income=projected_salary,
                    national_deductions=projected["target_national"],
                    resident_deductions=projected["target_resident"],
                    municipality=places[0],
                    personal_difference=projected["personal_difference"]
                )["tax_return_thousand_yen_reference"]
                if filing_limit > amount:
                    filing_higher = filing_limit
        except (MortgageDeductionError, ValueError, TypeError, KeyError):
            filing_limit = None
    if mortgage_present:
        from batch_mortgage_one_stop import (
            MortgageBatchScopeError, compare_mortgage_modes)
        if model is None:
            return hold("MORTGAGE_NO_RESIDENT_TAX_CAP")
        try:
            comparison = compare_mortgage_modes(
                evidence=extracted, source_year=source_year,
                target_year=target_year, salary_income=projected_salary,
                national_deductions=mortgage_deductions["target_national"],
                resident_deductions=resident_deductions,
                national_basic=mortgage_deductions["target_basic"],
                municipality_class=(extracted.get("municipality_hint")
                                    or {}).get("class", "UNCERTAIN"))
        except MortgageBatchScopeError as exc:
            # Only immutable, reviewed reason codes can travel to the Excel
            # bridge; never carry document text or personal identifiers.
            distinctions = {
                "MORTGAGE_POSSIBLE_CREDIT_REQUIRED":
                    "MORTGAGE_POSSIBLE_AMOUNT_MISSING",
                "MORTGAGE_OCCUPANCY_OR_CLASS_UNVERIFIED":
                    "MORTGAGE_OCCUPANCY_CLASS_REVIEW",
                "MORTGAGE_NEXT_YEAR_NOT_VERIFIED":
                    "MORTGAGE_NEXT_YEAR_REVIEW",
                "MORTGAGE_MUNICIPALITY_RATE_UNVERIFIED":
                    "MORTGAGE_LOCAL_TAX_REVIEW",
            }
            return hold(distinctions.get(
                str(exc), "MORTGAGE_ONE_STOP_REQUIRES_INDIVIDUAL_REVIEW"))
        except (TypeError, ValueError):
            return hold("MORTGAGE_ONE_STOP_REQUIRES_INDIVIDUAL_REVIEW")
        amount = comparison["one_stop_limit"]
        filing_higher = comparison["filing_higher_limit"]
        filing_limit = comparison["filing_limit"]
        # The independent minimum after housing must use the corresponding
        # locality's *same* levy and rate trace.
        scenario_key = comparison["selected_municipality"]
        model = next(s for place, s in zip(places, scenarios)
                     if place == scenario_key)
    if type(amount) is not int or not 0 <= amount <= 10**9:
        return hold("ESTIMATE_INVALID")
    caveats = ["SALARY_ONLY_ASSUMED", "LOCAL_TAX_RESIDENCE_UNCONFIRMED",
               "NATIONAL_TO_LOCAL_DEDUCTIONS_ASSUMED",
               "NO_OTHER_CREDITS_ASSUMED", "NO_TAX_RETURN_ONE_STOP_ASSUMED"]
    locality = (extracted.get("municipality_hint") or {}).get("class")
    if locality in ("STANDARD", "DESIGNATED"):
        caveats.append("MUNICIPALITY_FROM_DOCUMENT_ASSUMED")
    else:
        caveats.append("MUNICIPALITY_RATE_UNCERTAIN")
    if source_year != target_year:
        caveats.append("PRIOR_YEAR_CONDITIONS_CARRIED_FORWARD")
    if "BLANK_SOCIAL_INSURANCE_REQUIRES_REVIEW" in warnings:
        # Reader must have observed an explicitly blank native G26 box and
        # inserted zero provisionally; never certify zero as the actual amount.
        caveats.append("BLANK_SOCIAL_INSURANCE_ASSUMED_ZERO")
    if mortgage_present:
        caveats.append("MORTGAGE_ONE_STOP_5PCT_MODEL_PROVISIONAL")
        if mortgage_deductions["mortgage_possible_unchanged"]:
            caveats.append("MORTGAGE_BALANCE_CHANGE_NOT_MODELLED")
        if mortgage_deductions["prior_year_under23_life_assumed"]:
            caveats.append("UNDER23_DEPENDENTS_ASSUMED_ELIGIBLE_NEXT_YEAR")
        if mortgage_deductions["prior_year_spouse_assumed"]:
            caveats.append("SPOUSE_ELIGIBILITY_ASSUMED_NEXT_YEAR")
        if mortgage_deductions["prior_year_adult_dependents_assumed"]:
            caveats.append("ADULT_DEPENDENT_ELIGIBILITY_ASSUMED_NEXT_YEAR")
        if mortgage_deductions["source_spouse_inferred_from_total"]:
            caveats.append("SOURCE_SPOUSE_DEDUCTION_INFERRED_FROM_TOTAL")
    if (mortgage_deductions is not None and
            mortgage_deductions["prior_year_adult_dependents_assumed"] and
            not mortgage_present):
        caveats.append("ADULT_DEPENDENT_ELIGIBILITY_ASSUMED_NEXT_YEAR")
    if any(fields.get(k, 0) for k in ("special_relative_count",
                                         "special_relative_deduction_reference",
                                         "spouse_income_reference")):
        caveats.append("FAMILY_DETAILS_UNVERIFIED")
    # Numeric-only, internally consistent calculation trace, no source text,
    # taxpayer identity, source address, or local document path.
    # Zero-income-levy cases have no marginal tax rate: zero explicitly.
    ratio_ppm = (int(model["special_ratio"] * 1_000_000)
                 if model is not None else 0)
    trace = {
        "R_SOURCE_YEAR": source_year,
        "R_SOURCE_BASIC": source_basic,
        "R_RESIDENT_DEDUCTIONS": resident_deductions,
        "R_RESIDENT_TAXABLE": (model["resident_taxable_income"]
                               if model is not None else 0),
        "R_RESIDENT_LEVY": (model["resident_income_levy"]
                           if model is not None else 0),
        "R_SPECIAL_RATIO_PPM": ratio_ppm,
        "R_SPECIAL_CAP": (int(model["special_20pct_cap"])
                          if model is not None else 0),
        "R_MODEL_LOCALITY": model_locality,
    }
    return {"status": "AUTO_REFERENCE", "limit": amount, "filing_higher_limit": filing_higher, "filing_limit": filing_limit, "mortgage_mode": mortgage_present, "target_year": target_year,
            "salary_income": projected_salary, "reason": ";".join(caveats),
            "report_trace": trace}
