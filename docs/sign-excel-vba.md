# PC①でExcelのVBAを署名する（ローカル専用）

対象：正式配布用のテスト合格済み Furusato_nouzei.xlsm。今回実装したのは
Excel VBAプロジェクトの署名。PDF読取EXEは別のAuthentiCode署名が必要です。

## 初回の準備

PC①に以下を用意します。

1. Microsoft 365 Excel（PC①実機テストのOffice）。
2. Windows SDKのx86（32ビット）版 SignTool.exe。64-bit Windowsでも
   Office SIPでのExcelマクロ署名にはx86版の使用を推奨。
3. [Microsoft Office Subject Interface Packages（SIPs）](https://www.microsoft.com/en-us/download/details.aspx?id=56617)
   のx86版をMicrosoft公式サイトから取得。パッケージ内readme.txtに従い、
   msosip.dll・msosipx.dllをOSへ登録する（通常は管理者による初回準備）。
   署名スクリプトはインストール・管理者昇格・レジストリ変更を行いません。
4. コード署名用途（EKU 1.3.6.1.5.5.7.3.3）の証明書を、
   秘密鍵にアクセスできるCurrentUser\My証明書ストアで利用可能にする。
   正式配布用には信頼できる証明書チェーンと失効確認が必要。
   ハードウェアトークンやKSPは使用者認証を求める場合があります。

Microsoft：[Excel VBA署名の公式手順](https://support.microsoft.com/ja-jp/office/vba/digitally-sign-your-vba-macro-project)。
実例：[Office SIP＋SignToolによるマクロ署名](https://docs.digicert.com/ja/digicert-keylocker/code-signing/sign-with-third-party-signing-tools/windows-applications/sign-excel-macro-projects-with-signtool-using-ksp-library.html)。

## 署名前チェックと実行

署名前にソースブックのExcel/VBA更新・全テストを完了します。署名後にVBAを書き換えると
署名は無効になります。ソースファイルは上書きせず、別ファイルに署名します。

以下はPC①のPowerShellで実行する例です。証明書のサムプリント、入力・出力パスは
PC①で実際に用意した値に置き換えます。「#」の部分を含む架空サムプリントでは署名できません。

証明書の確認：
    Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.HasPrivateKey } |
       Select-Object Thumbprint, NotAfter

事前検査のみ（-Executeなし）：
    .\tools\sign_excel_vba_local.ps1 -SourceWorkbook "C:\Furusato\accepted\Furusato_nouzei.xlsm" -OutputWorkbook "C:\Furusato\private\Furusato_nouzei_signed.xlsm" -CertificateThumbprint "実在する40桁のSHA1サムプリント" -TimestampUrl "https://timestamp.digicert.com"

実際に署名する（-Executeを追加）：
    .\tools\sign_excel_vba_local.ps1 -SourceWorkbook "C:\Furusato\accepted\Furusato_nouzei.xlsm" -OutputWorkbook "C:\Furusato\private\Furusato_nouzei_signed.xlsm" -CertificateThumbprint "実在する40桁のSHA1サムプリント" -TimestampUrl "https://timestamp.digicert.com" -EvidencePath "C:\Furusato\private\vba_signing_local.json" -Execute

-SignToolX86 の省略時はWindows SDKの最新のx86版を検索します。
秘密鍵やPFXをGitHub、Actions、Artifacts、公開ログに保存しないこと。
公開CIでは-Executeが明示されても署名を拒否します。

正規署名では、HTTPSのRFC3161タイムスタンプを必須にします。
SignToolによる署名・検証後、マクロ実行を無効にしたExcelで開き直し
Workbook.VBASignedがTrueであることを確認できた場合のみ署名成功とします。
入力ブックを上書きせず、出力先が既に存在すれば拒否します。
失敗後の半端な署名出力は削除します。ローカル証拠は署名後のSHA256などだけを記録します。

ローカルテストで自己署名証明書を使う場合は
-AllowUntrustedTestCertificate を明示し、出力名を _TEST_ONLY.xlsm で終える必要があります。
このモードは証明書チェーンとSignTool信頼検証を省略するため、正式配布できません。

## 正式配布に関する注意

署名を付けても、それだけでユーザーのExcelでマクロが必ず実行できるわけではありません。
公開者が信頼されるには適切な証明書・利用者のセキュリティ設定が必要です。
マクロ全般を有効化するレジストリ設定や、利用者の同意なき信頼済みフォルダ作成は行いません。

署名後にXLSMのSHA-256は変更されます。正式配布用のZIPとPDF読取EXEを
組み合わせる際は署名後のバイトで改めて同一HEAD・署名・ZIP構成・SHA-256を照合します。
このスクリプト単独の成功は正式Releaseの承認ではありません。

この変更をGitHubへ登録するだけで、PC①に本物の商用署名証明書・Office SIP
・x86 SignToolが実在するとは断言できません。PC①の実環境で初めて署名実行が可能です。
