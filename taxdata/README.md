# 税制マスタの公開・承認フロー

`catalog.tsv` はUTF-8の区切り「|」5列です。

```text
所得年|APPROVED または DRAFT|版番号|GitHub ReleasesのXLSX URL|SHA-256
```

- 2025年・2026年のURL空欄：納品済ブックの年度別マスタを使用。
- URLあり：レビューされたマスタ9枚を含む `.xlsx` パックをGitHub Releasesに公開すること。
- URLは `https://github.com/tanaka456jp/Furusato_nouzei/releases/download/` で始まるものだけを許可。
- SHA-256ハッシュが不一致、承認状態がDRAFT、対象年のテスト不合格なら既存年分のまま停止。
- 2027年分以降を承認するには新年分の独立期待値テスト（少なくとも3件）も追加し、公開後に初めてAPPROVEDにする。
- データの更新は所得税の所得年と住民税の課税年度を正確に対応させ、適用日と経過措置を検証する。
- リポジトリの編集権限を持つ者が単独でAPPROVEDにできる運用は避け、レビューと一次資料の根拠をPRに残す。
