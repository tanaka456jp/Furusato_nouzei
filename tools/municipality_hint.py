"""Conservative municipality *candidate* from the recipient's printed address.

Only the municipality name/class is exported, never the street address or
employer's location. A candidate is NOT proof of residence on 1 January of
the year after the selected income year. Excel requires explicit confirmation.
Only native-text PDF G01 address fields are eligible; OCR never auto-selects.
"""
import re

PREFECTURES = (
    "北海道", "東京都", "京都府", "大阪府",
    "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "神奈川県",
    "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
    "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "兵庫県",
    "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県",
    "山口県", "徳島県", "香川県", "愛媛県", "高知県",
    "福岡県", "佐賀県", "長崎県", "熊本県", "大分県",
    "宮崎県", "鹿児島県", "沖縄県",
)
DESIGNATED_CITIES = frozenset({
    "札幌市", "仙台市", "さいたま市", "千葉市", "横浜市", "川崎市",
    "相模原市", "新潟市", "静岡市", "浜松市", "名古屋市", "京都市",
    "大阪市", "堺市", "神戸市", "岡山市", "広島市", "北九州市",
    "福岡市", "熊本市",
})
# Nagoya has a special 7.7% local income tax rate in 2026: not the
# standard 8% designated-city calculation.
NONSTANDARD_CITIES = frozenset({"名古屋市"})
CHARS = r"[一-龯々ヶぁ-んァ-ン]"
CITY = re.compile(rf"({CHARS}{{1,16}}?市)")
TOWN = re.compile(rf"((?:{CHARS}{{1,12}}郡)?{CHARS}{{1,12}}?[区町村])")


def municipality_from_address(text):
    """Return name + tax-rate *class*, no address, or None if ambiguous."""
    compact = re.sub(r"[\s　]", "", text or "")
    candidates = []
    for pref in PREFECTURES:
        if not compact.startswith(pref):
            continue
        rest = compact[len(pref):]
        city = CITY.match(rest)
        if city:
            name = city.group(1)
        else:
            town = TOWN.match(rest)
            name = town.group(1) if town else None
        if name:
            if name in NONSTANDARD_CITIES:
                category = "SPECIAL"
            elif name in DESIGNATED_CITIES:
                category = "DESIGNATED"
            else:
                category = "STANDARD"
            candidates.append((name, category))
    if len(candidates) != 1:
        return None
    name, category = candidates[0]
    if len(name) > 16:
        return None
    return {"name": name, "class": category}


def recipient_municipality_hint(words):
    """Require upper-left NTA G01 + recipient-address label/geometry.

    Both the anchor and label must exist; employer address lower on the page,
    names, dependents and other printed dates cannot be misread as residence.
    """
    if not words:
        return None
    if not any(w[4] == "G01" and 0 <= w[0] <= 100
               and 65 <= w[1] <= 155 for w in words):
        return None
    labels = [w for w in words if "住所又は居所" in w[4]
              and 0 <= w[0] <= 110 and 75 <= w[1] <= 190]
    if len(labels) != 1:
        return None
    label = labels[0]
    y_center = (label[1] + label[3]) / 2
    # Limit to the *same line* and directly adjoining recipient column.
    tokens = [w for w in words if w is not label
              and label[2] + 2 <= w[0] <= 350
              and abs((w[1] + w[3]) / 2 - y_center) <= 9
              and "住所" not in w[4]]
    tokens.sort(key=lambda w: w[0])
    # Reject conflicting locality strings; never choose one arbitrarily.
    guesses = set()
    for token in tokens:
        candidate = municipality_from_address(token[4])
        if candidate:
            guesses.add((candidate["name"], candidate["class"]))
    # Some PDF text layers split prefecture and city into adjacent words.
    if not guesses:
        for i in range(len(tokens)):
            joined = tokens[i][4]
            for j in range(i + 1, min(i + 4, len(tokens))):
                if tokens[j][0] - tokens[j - 1][2] > 5:
                    break
                joined += tokens[j][4]
                candidate = municipality_from_address(joined)
                if candidate:
                    guesses.add((candidate["name"], candidate["class"]))
    if len(guesses) != 1:
        return None
    name, category = next(iter(guesses))
    return {"name": name, "class": category}


def encode_municipality_name(name):
    """ASCII-only bridge encoding; source address must never cross."""
    if not isinstance(name, str) or not 1 <= len(name) <= 16 or any(
        ord(c) > 0xFFFF or ord(c) < 0x3000 for c in name
    ):
        raise ValueError("INVALID_MUNICIPALITY_NAME")
    return "".join(f"{ord(ch):04X}" for ch in name)
