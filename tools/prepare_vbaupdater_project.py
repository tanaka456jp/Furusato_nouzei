"""Build an isolated VBAUpdater project from the already verified XLSM.

Never edits the source workbook or canonical VBA. The staging directory must
not already exist. VBAUpdater itself is an optional external developer tool.
"""
from __future__ import annotations

import argparse
from hashlib import sha256
import json
from pathlib import Path
import shutil
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
CANONICAL_VBA = ROOT / "vba" / "TaxLawUpdater.bas"


def checksum(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest().upper()


def prepare(workbook: Path, destination: Path) -> dict:
    workbook = Path(workbook).resolve(strict=True)
    destination = Path(destination).absolute()
    if workbook.suffix.lower() != ".xlsm":
        raise ValueError("VBAUpdater bridge accepts .xlsm workbooks only")
    if workbook.name != "Furusato_nouzei.xlsm":
        raise ValueError("Only the isolated Furusato_nouzei.xlsm is supported")
    if workbook.stat().st_size < 20_000:
        raise ValueError("Suspiciously small input workbook")
    with ZipFile(workbook) as archive:
        if archive.testzip() is not None or "xl/vbaProject.bin" not in archive.namelist():
            raise ValueError("XLSM is missing a valid VBA project")
    canonical = CANONICAL_VBA.read_text(encoding="utf-8-sig")
    if not canonical.startswith('Attribute VB_Name = "TaxLawUpdater"'):
        raise ValueError("Canonical VBA module declaration was not found")
    if destination.exists() or destination.is_symlink():
        raise FileExistsError("Refusing to replace an existing staging project")
    source_hash = checksum(workbook)
    vba_hash = checksum(CANONICAL_VBA)
    destination.mkdir(parents=True, exist_ok=False)
    src = destination / "source" / "standard"
    target = destination / "target"
    src.mkdir(parents=True)
    target.mkdir()
    source_copy = src / "TaxLawUpdater.bas"
    target_copy = target / "Furusato_nouzei.xlsm"
    shutil.copyfile(CANONICAL_VBA, source_copy)
    shutil.copyfile(workbook, target_copy)
    manifest = {
        "schemaVersion": "1.0",
        "projectName": "Furusato_nouzei_Inspection",
        "target": {
            "directory": "target",
            "file": "Furusato_nouzei.xlsm",
            "autoDetectWhenMissing": False,
        },
        "source": {"root": "source", "encoding": "utf-8"},
        "components": [{
            "type": "standard",
            "name": "TaxLawUpdater",
            "file": "standard/TaxLawUpdater.bas",
        }],
        "validation": {"compileAfterPush": False, "requireBackup": True},
    }
    (destination / "project.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if checksum(workbook) != source_hash or checksum(target_copy) != source_hash:
        raise RuntimeError("Original workbook / isolated copy checksum mismatch")
    if checksum(CANONICAL_VBA) != vba_hash or checksum(source_copy) != vba_hash:
        raise RuntimeError("Canonical VBA / isolated copy checksum mismatch")
    return {
        "schema": "furusato-vbaupdater-staging/v1",
        "status": "PREPARED_ONLY",
        "source_workbook_sha256": source_hash,
        "staged_workbook_sha256": checksum(target_copy),
        "canonical_vba_sha256": vba_hash,
        "staged_vba_sha256": checksum(source_copy),
        "project_name": manifest["projectName"],
        "warning": "Isolated synthetic-review copy only; not a client workbook or production release.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    report = prepare(args.workbook, args.destination)
    print("VBAUpdater isolated staging: " + report["status"])
