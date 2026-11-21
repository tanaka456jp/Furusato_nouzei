"""Generate a version-locked pre-signing README for offline Excel only."""
import argparse
import re
from pathlib import Path
from release_candidate_branding import verify_release_readme

def render(version, head):
    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("INVALID_VERSION")
    if not re.fullmatch(r"[0-9a-f]{40}", head):
        raise ValueError("INVALID_HEAD_SHA")
    data = (
        f"# ふるさと納税 寄附限度額試算 {version}\n\n"
        "対象：WindowsのExcel 365で使用するExcel/VBA版と付属するローカル源泉徴収票読取ソフト。\n"
        "対応所得年：2025年・2026年。給与所得以外、申告分離課税、税額控除、住宅ローン控除、\n"
        "前年票からの翌年見込みなどは適用条件と計算根拠を個別に確認してください。\n"
        "寄附限度額は試算結果であり、住民税所得割・非課税・各種税額控除・扶養等の確認が必要です。\n"
        "住民税決定通知書は給与所得のみで条件を独立確認できる場合には必須ではありません。\n"
        "想定外や未確認の条件は安全停止します。\n"
        "複数人一括一覧は源泉徴収票の給与所得のみが対象で、その他所得・申告分離課税は対象外です。\n"
        "源泉票にない前提が未確認なら参考額はHOLDとし、精緻計算は単独計算で行います。\n"
        "個別案件を共有・保存する前に、別人の情報が入った一括一覧を必ず消去してください。\n"
        "特定扶養親族・特定親族特別控除の明細上限は5人です。\n\n"
        "署名・出所：コード署名は任意です。未署名EXE・VBAを署名済みと表示しません。\n"
        "配布ZIPのSHA-256とソースHEADを配布者の独立した公式情報で確認してください。\n"
        "PCが未署名EXEを拒否する場合は安全設定を解除せず、手入力を利用してください。\n"
        "セキュリティ設定を一括無効化したり、未確認マクロを強制実行しないでください。\n"
        "本Excel版はGASの実デプロイを呼び出しません。税制更新には承認済みGitHubカタログを利用します。\n"
        f"ソースHEAD：{head}\n"
    )
    encoded = data.encode("utf-8")
    verify_release_readme(encoded, version, head)
    return encoded

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--version", required=True)
    ap.add_argument("--head", required=True)
    ap.add_argument("--output", type=Path, required=True)
    args=ap.parse_args()
    if args.output.exists():
        raise ValueError("REFUSE_OVERWRITE_README")
    args.output.write_bytes(render(args.version, args.head))
    print("EXCEL_CANDIDATE_README_CREATED_NOT_AUTHORIZED_FOR_RELEASE")

if __name__=="__main__":
    main()
