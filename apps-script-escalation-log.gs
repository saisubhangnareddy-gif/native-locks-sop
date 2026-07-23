/**
 * Native Locks POD Tool — escalation logger (Google Apps Script Web App).
 *
 * Deploy this bound to the Google Sheet that stores the escalation log,
 * then paste the /exec URL into index.html as LOG_WEBAPP_URL.
 *
 * AUTO columns (written by the portal — columns A..O, in this exact order):
 *   A Timestamp
 *   B Agent Name
 *   C Agent Email
 *   D Type              (Product / Non-Product)
 *   E Escalation Type   (Known / Unknown / Older SKU / Non-Product)
 *   F SKU
 *   G City
 *   H Issue Bucket
 *   I Description
 *   J Booking Date
 *   K Installation Date
 *   L Customer Request ID
 *   M Source Order ID
 *   N Lock Number
 *   O Slack Link
 *
 * MANUAL columns (yours — add them from column P onward). The portal NEVER writes
 * to these, so you can freely add/edit them. Suggested:
 *   P Revisit assigned (Yes/No)
 *   Q Replacement assigned (Yes/No)
 *   R Spare Part sent? (Yes/No)
 *   S Which spare part is sent?
 *   T Need Lock at Prems for RCA? (Yes/No)
 *   ...add more as needed.
 *
 * Behaviour:
 *   - New escalations are APPENDED at the BOTTOM (newest last, oldest on top).
 *   - Each POST writes only columns A..O of a NEW row, so your manual columns
 *     (P onward) on that row stay blank for you to fill, and manual edits on
 *     existing rows are never overwritten.
 *   - GET ?email=<agentEmail> returns that agent's rows as JSON (newest first)
 *     for the in-portal dashboard. GET with no email returns all rows.
 */

var SHEET_NAME = 'Escalations';

// The 15 auto column headers, in order (A..O).
var AUTO_HEADERS = [
  'Timestamp','Agent Name','Agent Email','Type','Escalation Type','SKU','City',
  'Issue Bucket','Description','Booking Date','Installation Date',
  'Customer Request ID','Source Order ID','Lock Number','Slack Link'
];

function _sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(AUTO_HEADERS); // writes only the auto headers; add your manual headers after column O
  }
  return sh;
}

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents || '{}');
    var row = [
      d.ts || new Date().toISOString(),
      d.agentName || '',
      d.agentEmail || '',
      d.type || '',
      d.escType || '',
      d.sku || '',
      d.city || '',
      d.bucket || '',
      d.desc || '',
      d.bookingDate || '',
      d.installDate || '',
      d.customerRequestId || '',
      d.sourceOrderId || '',
      d.lockNumber || '',
      d.permalink || ''
    ];
    // Append a NEW row at the bottom, writing ONLY columns A..O.
    // (appendRow writes exactly row.length cells, so manual columns P+ are untouched.)
    _sheet().appendRow(row);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  var sh = _sheet();
  var values = sh.getDataRange().getValues();
  var out = [];
  var wantEmail = ((e && e.parameter && e.parameter.email) || '').toLowerCase().trim();
  for (var i = 1; i < values.length; i++) { // skip header row
    var r = values[i];
    var email = String(r[2] || '').toLowerCase().trim();
    if (wantEmail && email !== wantEmail) continue;
    out.push({
      ts: r[0], agentName: r[1], agentEmail: r[2], type: r[3], escType: r[4],
      sku: r[5], city: r[6], bucket: r[7], desc: r[8],
      bookingDate: r[9], installDate: r[10], customerRequestId: r[11],
      sourceOrderId: r[12], lockNumber: r[13], permalink: r[14]
    });
  }
  out.reverse(); // newest first for the dashboard (sheet keeps newest at the bottom)
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}
