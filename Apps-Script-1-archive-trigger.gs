/**
 * Blakeworth — Archive Trigger (UPDATED — includes NOTES column)
 * ─────────────────────────────────────────────────────────────
 * HOW TO INSTALL / UPDATE:
 *   1. Open your Daily To-Do Tracker Google Sheet
 *   2. Extensions → Apps Script
 *   3. Select all content in Code.gs and replace with this file
 *   4. Save (Ctrl+S)
 *   5. Run setupArchiveHeaders() once to add the NOTES column to Archive
 *   6. Done. The onEdit trigger fires automatically from now on.
 *
 * What it does:
 *   When you tick the "Completed?" checkbox in column H of Active Tasks,
 *   this script copies the full row to the Archive tab and deletes it
 *   from Active Tasks. It also records the Date Completed.
 *
 * Active Tasks columns (1-indexed):
 *   A=1 Date Created   B=2 Property   C=3 Task / Issue   D=4 Notes
 *   E=5 Category       F=6 Deadline   G=7 Assignment     H=8 Completed?
 *   I=9 Status         J=10 NOTES
 *
 * Archive columns:
 *   A=1 Date Created   B=2 Property   C=3 Task / Issue   D=4 Notes
 *   E=5 Category       F=6 Deadline   G=7 Assignment     H=8 Status
 *   I=9 Date Completed J=10 NOTES
 */

const ACTIVE_TASKS_SHEET = 'Active Tasks';
const ARCHIVE_SHEET      = 'Archive';
const COMPLETED_COL      = 8;   // H — Completed? checkbox
const HEADER_ROW         = 1;
const NUM_ACTIVE_COLS    = 10;  // A through J

function onEdit(e) {
  if (!e || !e.range) return;

  try {
    const sheet = e.range.getSheet();
    const range = e.range;

    // Only run on Active Tasks
    if (sheet.getName() !== ACTIVE_TASKS_SHEET) return;

    // Only run when column H (Completed?) is edited
    if (range.getColumn() !== COMPLETED_COL) return;

    // Only run when the checkbox is ticked TRUE
    const checked = (e.value === true) || (String(e.value).toUpperCase() === 'TRUE');
    if (!checked) return;

    const row = range.getRow();
    if (row <= HEADER_ROW) return;

    const archiveSheet = e.source.getSheetByName(ARCHIVE_SHEET);
    if (!archiveSheet) {
      Logger.log('Archive sheet not found');
      return;
    }

    // Read the full row (all 10 columns)
    const rowData = sheet.getRange(row, 1, 1, NUM_ACTIVE_COLS).getValues()[0];

    const dateCompleted = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'M/d/yyyy'
    );

    // Build archive row — skips Completed? checkbox (index 7), preserves everything else
    const archiveRow = [
      rowData[0], // A: Date Created
      rowData[1], // B: Property
      rowData[2], // C: Task / Issue
      rowData[3], // D: Notes
      rowData[4], // E: Category
      rowData[5], // F: Deadline
      rowData[6], // G: Assignment
      rowData[8], // H: Status (index 8 = col I in Active Tasks)
      dateCompleted, // I: Date Completed
      rowData[9], // J: NOTES (new column)
    ];

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      archiveSheet.appendRow(archiveRow);
      sheet.deleteRow(row);
      Logger.log('Archived: ' + rowData[2] + ' (Status: ' + rowData[8] + ')');
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    Logger.log('onEdit error: ' + err.toString());
  }
}

/**
 * Run this ONCE after pasting the updated script.
 * It checks your Archive tab headers and adds any missing ones.
 */
function setupArchiveHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const arch = ss.getSheetByName(ARCHIVE_SHEET);
  if (!arch) throw new Error('Archive sheet not found — make sure the tab is named exactly "Archive"');

  const headerRow = arch.getRange(1, 1, 1, 10).getValues()[0];
  Logger.log('Current Archive headers: ' + JSON.stringify(headerRow));

  if (!headerRow[7]) {
    arch.getRange(1, 8).setValue('Status');
    Logger.log('Added "Status" header to column H');
  }
  if (!headerRow[8]) {
    arch.getRange(1, 9).setValue('Date Completed');
    Logger.log('Added "Date Completed" header to column I');
  }
  if (!headerRow[9]) {
    arch.getRange(1, 10).setValue('NOTES');
    Logger.log('Added "NOTES" header to column J');
  }

  Logger.log('Setup complete. Archive headers are ready.');
  SpreadsheetApp.getUi().alert('Archive is ready! ✓\nAll columns including NOTES will now be carried over on archive.');
}
