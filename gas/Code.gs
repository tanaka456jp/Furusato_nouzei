/**
 * Spreadsheet-bound Apps Script Web App.
 * No personal identifiers, raw PDFs, or taxpayer income are written to Sheets.
 * setupBoundSpreadsheet is a one-time, explicitly invoked administrative action.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("ふるさと納税 限度額シミュレーター — GAS検証版")
    .addMetaTag("viewport","width=device-width, initial-scale=1, viewport-fit=cover");
}
function runFurusatoSimulation(input) {
  return FurusatoEngine.calculate(input);
}
function getFurusatoVersion() {
  return {version:FurusatoEngine.version, status:"REVIEW_ONLY"};
}
// Read-only health check for the isolated synthetic acceptance harness.
// Never return file IDs, document text, account identity or spreadsheet data.
function getFurusatoPrivateDiagnostics() {
  var result=Drive.Files.list({q:"trashed = false and name contains 'Furusato_OCR_TEMP_'",
    spaces:"drive",pageSize:100,fields:"files(name),nextPageToken"});
  return {version:FurusatoEngine.version,status:"REVIEW_ONLY",driveApi:"PASS",
    temporaryOcrFiles:(result.files||[]).length,hasMore:!!result.nextPageToken};
}
function setupBoundSpreadsheet() {
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Googleスプレッドシートに紐づくApps Scriptから実行してください");
  var name="税制マスタ_参照用";
  var rows=FurusatoEngine.statutoryRows();
  var sheet=ss.getSheetByName(name);
  if (sheet) {
    // A reference tab may already have been prepared via Google Drive.
    // It is never a calculation input or a target for destructive updates.
    return {status:"EXISTING_REFERENCE_SHEET",spreadsheetUrl:ss.getUrl(),
            sheetName:name,message:"既存の税制参照シートは変更していません"};
  }
  sheet=ss.insertSheet(name);
  sheet.getRange(1,1,rows.length,rows[0].length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,5).setBackground("#183c65").setFontColor("#ffffff").setFontWeight("bold");
  sheet.getRange(2,1,rows.length-1,5).setNumberFormat("#,##0");
  sheet.autoResizeColumns(1,5);
  sheet.getRange(rows.length+2,1).setValue("参照専用。正式な税制更新はソースレビューと独立した試験に合格してから実施します。");
  sheet.getRange(rows.length+3,1).setValue("https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm");
  sheet.protect().setDescription("税制マスタは編集せず、監査用に参照");
  return {status:"CREATED",spreadsheetUrl:ss.getUrl(),sheetName:name,rows:rows.length};
}
function onOpen() {
  var ui=SpreadsheetApp.getUi();
  ui.createMenu("ふるさと納税・GAS検証版")
    .addItem("税制参照シートを初期作成", "setupBoundSpreadsheet")
    .addToUi();
}
