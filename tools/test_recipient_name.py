"""Anonymous only: E03 name privacy and recipient binding regression."""
import unittest
from recipient_name import from_e03, encode, decode, validate_name, UNREADABLE

def synthetic(name="山田 太郎", header=True, label=True):
    out = [(282,108,320,114,"支払を受ける者")] if header else []
    if label:
        out.append((47,154,59,160,"氏名"))
    out += [(77,154,88,160,"E03"),(89,153,168,160,name),
            (334,154,358,160,"代表取締役"),
            (47,542,59,548,"氏名"),(89,542,160,548,"佐藤 花子")]
    return out

class NameTests(unittest.TestCase):
    def test_e03_anchored_not_dependents_or_employer(self):
        self.assertEqual(from_e03(synthetic()), "山田 太郎")
        self.assertEqual(from_e03(synthetic("JOHN SMITH")), "JOHN SMITH")
        self.assertIsNone(from_e03(synthetic(header=False)))
        self.assertIsNone(from_e03(synthetic(label=False)))
        self.assertIsNone(from_e03([w for w in synthetic() if w[4]!="E03"]))
    def test_split_surname_and_given_name_native_text_gap(self):
        words = synthetic()
        words[2] = (89,153,111,160,"山田")
        words.insert(3,(122,153,144,160,"太郎"))
        self.assertEqual(from_e03(words),"山田 太郎")

    def test_formula_and_address_injection_rejected(self):
        for s in ("=HYPERLINK(1)", "+cmd", "@HACK", "123456789",
                  "山田\n太郎", "山田\t太郎", "A1/B2", "", UNREADABLE):
            self.assertIsNone(validate_name(s))
    def test_hex_carries_no_plain_name(self):
        sample="山田 太郎"
        wire=encode(sample)
        self.assertEqual(decode(wire),sample)
        self.assertNotIn(sample,wire)
        for s in ("000A","D800","0040","0061"*41,"ffff","0000"):
            with self.assertRaises(ValueError): decode(s)
        self.assertIsNone(decode(""))

if __name__=="__main__":
    unittest.main(verbosity=2)
