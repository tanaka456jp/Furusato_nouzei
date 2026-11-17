"""Local-only privacy-safe evidence manifest for the nine offline Excel gates.

Never uploads files, opens GitHub, emails, prints, changes screen modes, signs
binaries or approves a release. A human must verify the true evidence/identity;
a SHA-256 record is only an inventory entry, not proof of authenticity.
Keep ALL evidence and the manifest outside the public repository.
"""
import argparse
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path

from release_readiness import REQUIRED, REVIEWER_ROLES, SCHEMA, evaluate, parse_evidence_json

ROOT = Path(__file__).resolve().parents[1]
HEAD_RE = re.compile(r"[0-9a-f]{40}\Z")
MAX_EVIDENCE_BYTES = 256 * 1024 * 1024
MAX_MANIFEST_BYTES = 128 * 1024


def _safe_private_path(path):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("SYMLINK_EVIDENCE_PATH_REFUSED")
    real = path.resolve()
    if real == ROOT or ROOT in real.parents:
        raise ValueError("PUBLIC_REPO_PATH_REFUSED")
    return real


def _sha256(path):
    if not path.is_file() or path.is_symlink():
        raise ValueError("EVIDENCE_MISSING_OR_NOT_REGULAR_FILE")
    size = path.stat().st_size
    if not 0 < size <= MAX_EVIDENCE_BYTES:
        raise ValueError("INVALID_EVIDENCE_SIZE")
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    if path.stat().st_size != size:
        raise ValueError("EVIDENCE_CHANGED_DURING_HASH")
    return h.hexdigest()


def _read_manifest(path):
    path = _safe_private_path(path)
    if not path.is_file() or not 0 < path.stat().st_size <= MAX_MANIFEST_BYTES:
        raise ValueError("MANIFEST_MISSING_OR_OVERSIZED")
    try:
        manifest = parse_evidence_json(path.read_text(encoding="utf-8-sig"))
    except (UnicodeError, ValueError):
        raise ValueError("INVALID_PRIVATE_MANIFEST") from None
    if not isinstance(manifest, dict):
        raise ValueError("INVALID_PRIVATE_MANIFEST")
    if manifest.get("schema") != SCHEMA or not isinstance(manifest.get("checks"), dict):
        raise ValueError("UNSUPPORTED_PRIVATE_MANIFEST_SCHEMA")
    if not isinstance(manifest.get("head_sha"), str) or not HEAD_RE.fullmatch(manifest["head_sha"]):
        raise ValueError("INVALID_MANIFEST_HEAD")
    if set(manifest) != {"schema", "head_sha", "checks"}:
        raise ValueError("MANIFEST_EXTRA_FIELDS")
    # Also check existing records before preserving them.
    if any(key not in REQUIRED for key in manifest["checks"]):
        raise ValueError("UNKNOWN_GATE_KEY")
    return manifest


def create_local_manifest(path, head_sha):
    path = _safe_private_path(path)
    if not isinstance(head_sha, str) or not HEAD_RE.fullmatch(head_sha):
        raise ValueError("INVALID_HEAD_SHA")
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"schema": SCHEMA, "head_sha": head_sha, "checks": {}}
    data = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    # Exclusive creation: avoid truncating an existing private review.
    with path.open("xb") as f:
        f.write(data)
    return evaluate(head_sha, payload)


def record_local_evidence(manifest_path, gate, evidence_path, reviewer_role, *,
                          explicitly_reviewed=False):
    if not explicitly_reviewed:
        raise ValueError("EXPLICIT_HUMAN_REVIEW_NOT_CONFIRMED")
    if gate not in REQUIRED:
        raise ValueError("UNKNOWN_GATE_KEY")
    if reviewer_role not in REVIEWER_ROLES[gate]:
        raise ValueError("UNAUTHORIZED_REVIEWER_ROLE")
    manifest_path = _safe_private_path(manifest_path)
    evidence_path = _safe_private_path(evidence_path)
    if evidence_path == manifest_path:
        raise ValueError("SELF_REFERENTIAL_EVIDENCE")
    current = _read_manifest(manifest_path)
    if gate in current["checks"]:
        raise ValueError("GATE_ALREADY_RECORDED_USE_NEW_REVIEW")
    digest = _sha256(evidence_path)
    current["checks"][gate] = {
        "status": "REVIEWED", "sha256": digest,
        "reviewer_role": reviewer_role, "head_sha": current["head_sha"],
    }
    # Do not use untrusted evidence contents or filenames in the manifest.
    output = (json.dumps(current, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if len(output) > MAX_MANIFEST_BYTES:
        raise ValueError("MANIFEST_OVER_LIMIT")
    # Rewrite atomically only after full validation.
    fd, temp = tempfile.mkstemp(prefix=".furusato_review_", dir=manifest_path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(output)
        os.replace(temp, manifest_path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    return evaluate(current["head_sha"], current)


def check_local_manifest(path, head_sha):
    current = _read_manifest(path)
    # Mismatched SHA remains HOLD; no old evidence can approve new code.
    return evaluate(head_sha, current)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create")
    create.add_argument("--manifest", type=Path, required=True)
    create.add_argument("--head", required=True)
    record = sub.add_parser("record")
    record.add_argument("--manifest", type=Path, required=True)
    record.add_argument("--gate", required=True, choices=REQUIRED)
    record.add_argument("--evidence", type=Path, required=True)
    record.add_argument("--reviewer-role", required=True)
    record.add_argument("--explicitly-reviewed", action="store_true")
    check = sub.add_parser("check")
    check.add_argument("--manifest", type=Path, required=True)
    check.add_argument("--head", required=True)
    args = p.parse_args()
    try:
        if args.command == "create":
            result = create_local_manifest(args.manifest, args.head)
        elif args.command == "record":
            result = record_local_evidence(
                args.manifest, args.gate, args.evidence, args.reviewer_role,
                explicitly_reviewed=args.explicitly_reviewed)
        else:
            result = check_local_manifest(args.manifest, args.head)
    except (ValueError, OSError, FileExistsError) as exc:
        # Avoid traceback or user-supplied private path/file contents.
        print("LOCAL_EVIDENCE_REJECTED=" +
              (str(exc) if isinstance(exc, ValueError) else "LOCAL_IO_ERROR"))
        return 2
    print("LOCAL_EVIDENCE_RECORDED=" + str(
        sum(x == "REVIEW_RECORDED_NOT_INDEPENDENTLY_VERIFIED"
            for x in result["checks"].values())) +
          "/" + str(len(REQUIRED)) +
          " STAGE=" + result["review_stage"] +
          " RELEASE=" + result["release_decision"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
