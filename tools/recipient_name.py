"""Strict native-PDF E03 recipient name for the local-only per-page overview.

Names never appear in console/logs, GitHub artifacts or TSV plaintext.
TSV name field is fixed-width uppercase UTF16 codepoint hex (ASCII).
The single-case reader never opts into names.
"""
import re
import unicodedata
MAX_CHARS = 40
UNREADABLE = "氏名未判読"

def validate_name(value):
    if not isinstance(value, str):
        return None
    value = re.sub(r"[ \u3000]+", " ", unicodedata.normalize("NFC", value)).strip()
    if not 1 <= len(value) <= MAX_CHARS or value.startswith("-") or value in (
            "氏名", "支払を受ける者", "支払者", UNREADABLE):
        return None
    def allowed(ch):
        cp = ord(ch)
        return (0x3400 <= cp <= 0x9FFF or cp in (0x3005, 0x3006, 0x30FB, 0x00B7)
                or 0x3040 <= cp <= 0x30FF
                or 0x41 <= cp <= 0x5A or 0x61 <= cp <= 0x7A
                or 0xC0 <= cp <= 0x24F or ch in (" ", "-"))
    return value if all(allowed(ch) for ch in value) and any(
        ch.isalpha() for ch in value) else None

def from_e03(words):
    # Distinguish the recipient's E03 from dependent's lower-down 氏名
    # and the employer representative's E05.
    if not words or not any("支払を受ける者" in w[4] and w[1] < 190
                            for w in words):
        return None
    marks = [w for w in words if w[4] == "E03" and 55 <= w[0] <= 160
             and 100 <= w[1] <= 220]
    if len(marks) != 1:
        return None
    anchor = marks[0]
    cy = (anchor[1] + anchor[3]) / 2
    if not any(w[4] == "氏名" and w[2] <= anchor[0]
               and abs((w[1] + w[3]) / 2 - cy) <= 5 for w in words):
        return None
    row = sorted([w for w in words
                  if anchor[2] + 1 <= w[0] < min(320, anchor[2] + 230)
                  and abs((w[1] + w[3]) / 2 - cy) <= 7
                  and w[4] not in ("氏名", "E03")], key=lambda w: w[0])
    if not 1 <= len(row) <= 8:
        return None
    chars, right = [], anchor[2]
    for w in row:
        if chars and w[0] - right > 6:
            chars.append(" ")
        chars.append(w[4])
        right = w[2]
    return validate_name("".join(chars))

def encode(value):
    name = validate_name(value)
    if not name or any(ord(c) > 0xFFFF for c in name):
        raise ValueError("INVALID_RECIPIENT_NAME")
    return "".join(f"{ord(c):04X}" for c in name)

def decode(value):
    if value == "":
        return None
    if (not isinstance(value, str) or not 1 <= len(value) <= MAX_CHARS * 4
            or len(value) % 4 or not re.fullmatch("[0-9A-F]+", value)):
        raise ValueError("INVALID_NAME_HEX")
    name = "".join(chr(int(value[i:i + 4], 16))
                   for i in range(0, len(value), 4))
    if name != validate_name(name):
        raise ValueError("INVALID_NAME_CONTENT")
    return name
