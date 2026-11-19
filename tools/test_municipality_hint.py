"""Synthetic-only recipient-address municipality candidate safety checks."""
import unittest
from municipality_hint import (DESIGNATED_CITIES, encode_municipality_name,
                               municipality_from_address, recipient_municipality_hint)


def words_for(address, *, include_anchor=True, include_recipient_label=True):
    words = [(32, 95, 44, 101, "G01")] if include_anchor else []
    if include_recipient_label:
        words.append((36, 121, 70, 127, "住所又は居所"))
    words.append((89, 119, 240, 127, address))
    words.extend([
        (37, 764, 70, 770, "住所(居所)"),
        (89, 764, 220, 770, "東京都千代田区永田町1丁目"),
    ])
    return words


class MunicipalityCandidateTests(unittest.TestCase):
    def test_20_designated_city_master_complete(self):
        self.assertEqual(len(DESIGNATED_CITIES), 20)
        self.assertIn("京都市", DESIGNATED_CITIES)

    def test_recipient_city_and_ward(self):
        for address, name, category in (
            ("京都府京都市伏見区架空町12", "京都市", "DESIGNATED"),
            ("大阪府大阪市北区架空町12", "大阪市", "DESIGNATED"),
            ("埼玉県さいたま市浦和区架空町12", "さいたま市", "DESIGNATED"),
            ("東京都港区架空町12", "港区", "STANDARD"),
            ("長野県北佐久郡軽井沢町架空地", "北佐久郡軽井沢町", "STANDARD"),
            ("京都府宇治市架空町12", "宇治市", "STANDARD"),
            ("愛知県名古屋市中区架空町12", "名古屋市", "SPECIAL"),
        ):
            with self.subTest(address=address[:6]):
                self.assertEqual(recipient_municipality_hint(words_for(address)),
                                 {"name": name, "class": category})

    def test_no_employer_fallback_or_nonlocal_source(self):
        self.assertIsNone(recipient_municipality_hint(words_for(
            "番号123456", include_anchor=False)))
        self.assertIsNone(recipient_municipality_hint(words_for(
            "京都府京都市", include_recipient_label=False)))
        self.assertIsNone(recipient_municipality_hint(words_for("不明")))
        self.assertIsNone(recipient_municipality_hint([]))
        self.assertIsNone(municipality_from_address("架空会社 京都府京都市伏見区"))
        self.assertIsNone(municipality_from_address("東京都"))
        # A long personal address must not be serialized; only the locality.
        hint = recipient_municipality_hint(words_for("京都府宇治市架空町12番34号"))
        self.assertEqual(encode_municipality_name(hint["name"]), "5B876CBB5E02")
        self.assertNotIn("架空町", str(hint))

    def test_ambiguous_address_does_not_pick_first(self):
        words = words_for("京都府京都市伏見区")
        words.append((245, 119, 320, 127, "大阪府大阪市北区"))
        self.assertIsNone(recipient_municipality_hint(words))

    def test_encodes_bmp_japanese_only(self):
        for bad in ("", "a", "京都市1", "A"*30, "\U0001F600"):
            with self.assertRaises(ValueError):
                encode_municipality_name(bad)


if __name__ == "__main__":
    unittest.main(verbosity=2)
