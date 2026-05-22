/**
 * Blakeworth — Dallas Command Center Web App (Apps Script)
 * ─────────────────────────────────────────────────────────────
 * This script powers the live API behind the Dallas dashboard.
 * Deploy it as a Web App from your Daily To-Do Tracker sheet.
 *
 * QUICK SETUP (full guide in DEPLOYMENT-GUIDE.md):
 *   1. Open Daily To-Do Tracker → Extensions → Apps Script
 *   2. New file → name it "Apps-Script-2-webapp"
 *   3. Paste this entire file, save (Ctrl+S)
 *   4. Fill in DALLAS_EMAIL below (for calendar invites)
 *   5. Deploy → New deployment → Web App
 *        Execute as: Me | Access: Anyone
 *   6. Copy the Web App URL → paste into dallas-command-center.html
 *        const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_ID/exec';
 *
 * ENDPOINTS:
 *   GET  ?action=getTasks&token=bw2026dash   → JSON array of Dallas-visible tasks
 *   GET  ?action=ping&token=bw2026dash       → health check
 *   POST (JSON body)                         → task actions (see switch below)
 */

// ═══════════════════════════════════════════════════════════════
// CONFIG — fill these in before deploying
// ═══════════════════════════════════════════════════════════════
const BW_CFG = {
  SPREADSHEET_ID:      '14Sm-DZzAil0AyS430d3dWWcKiiUgq3SZxZ6vUqNSL-w',
  TOKEN:               'bw2026dash',

  MAYA_EMAIL:          'maya@blakeworth.com',
  DALLAS_EMAIL:        '',   // ← Dallas's email — enables calendar invites to him

  // QUO SMS (optional — email always works without this)
  // Fill in after you have your QUO API credentials.
  // The sendSms() function silently skips if these are blank.
  QUO_API_URL:         '',   // e.g. 'https://api.quo.app/v1/messages'
  QUO_API_KEY:         '',   // Your QUO API key
  QUO_FROM_NUMBER:     '',   // Your QUO business phone number
  QUO_TO_MAYA:         '',   // Maya's cell number (e.g. '+12025559876')

  // Sheet tab names — must match exactly (case-sensitive)
  ACTIVE_TASKS_TAB:    'Active Tasks',
  ARCHIVE_TAB:         'Archive',
  STATUS_UPDATES_TAB:  'StatusUpdates',
};

// Active Tasks column positions (1-indexed, A=1)
// Must match your actual sheet layout:
//   A=Date Created  B=Property  C=Task/Issue  D=Notes  E=Category
//   F=Deadline      G=Assignment H=Completed?  I=Status  J=Extra
const COL = {
  DATE_CREATED: 1,
  PROPERTY:     2,
  TASK:         3,
  NOTES:        4,
  CATEGORY:     5,
  DEADLINE:     6,
  ASSIGNMENT:   7,
  COMPLETED:    8,
  STATUS:       9,
  EXTRA:        10,
};
const NUM_COLS = 10;

// Statuses that appear on Dallas's dashboard
const DALLAS_STATUSES = [
  'Dallas Approval', 'Dallas Decision', 'Dallas To Do',
  'In Progress', 'Stuck', 'FYI',
];

// Category → portfolio code (for dashboard card coloring)
const CAT_PORTFOLIO = {
  'JHU': 'JHU',
  'SLP': 'SLP', 'Southlight': 'SLP',
  'DC': 'DC',   'Washington DC': 'DC',
  'Admin': 'Admin',
};


// ═══════════════════════════════════════════════════════════════
// HTTP ENTRY POINTS
// ═══════════════════════════════════════════════════════════════

function doGet(e) {
  try {
    const params = e.parameter || {};
    if (params.token !== BW_CFG.TOKEN) return jsonErr('Unauthorized');

    const action = params.action || 'getTasks';
    if (action === 'getTasks') return jsonOk({ tasks: getTasks() });
    if (action === 'ping')     return jsonOk({ ok: true, ts: new Date().toISOString() });
    return jsonErr('Unknown GET action: ' + action);

  } catch (err) {
    Logger.log('doGet error: ' + err);
    return jsonErr(err.message);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (body.token !== BW_CFG.TOKEN) return jsonErr('Unauthorized');

    const { action, taskId, note, remindDate, newTask } = body;

    switch (action) {
      case 'approve':     return jsonOk(handleApprove(taskId));
      case 'done':        return jsonOk(handleDone(taskId));
      case 'inprogress':  return jsonOk(handleInProgress(taskId));
      case 'letstalk':    return jsonOk(handleLetsTalk(taskId, note));
      case 'remindlater': return jsonOk(handleRemindLater(taskId, note, remindDate));
      case 'addnote':     return jsonOk(handleAddNote(taskId, note));
      case 'addtask':     return jsonOk(handleAddTask(newTask));
      default:            return jsonErr('Unknown POST action: ' + action);
    }
  } catch (err) {
    Logger.log('doPost error: ' + err);
    return jsonErr(err.message);
  }
}


// ═══════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════

/** Dallas clicks ✓ Approve on a decision/approval card. */
function handleApprove(taskId) {
  const { sheet, rowNum, rowData } = findTask(taskId);
  if (!rowNum) return { error: 'Task not found: ' + taskId };

  const taskTitle = rowData[COL.TASK     - 1];
  const property  = rowData[COL.PROPERTY - 1];
  const today     = todayStr();

  // Update status in sheet
  sheet.getRange(rowNum, COL.STATUS).setValue('Approved');

  // Append a timestamped note to the thread
  appendNote(sheet, rowNum, 'Dallas', '✓ Approved.');

  // Log to StatusUpdates (picked up by daily Python refresh)
  logStatusUpdate(taskId, 'Approved', 'Approved by Dallas', 'Dallas');

  // Notify Maya
  const subject = '✅ Approved: ' + property + ' — ' + taskTitle;
  const body    = 'Dallas approved "' + taskTitle + '" (' + property + ') on ' + today + '.\n\n'
                + 'Status updated to Approved in your tracker.';
  notifyMaya(subject, body);
  sendSms('✅ Approved: ' + property + ' — ' + taskTitle);

  return { ok: true };
}

/** Dallas ticks ✓ Done — archives the row and notifies Maya. */
function handleDone(taskId) {
  const { sheet, rowNum, rowData } = findTask(taskId);
  if (!rowNum) return { error: 'Task not found: ' + taskId };

  const taskTitle = rowData[COL.TASK     - 1];
  const property  = rowData[COL.PROPERTY - 1];
  const today     = todayStr();

  // Move row to Archive (same logic as Apps-Script-1-archive-trigger)
  const ss           = SpreadsheetApp.openById(BW_CFG.SPREADSHEET_ID);
  const archiveSheet = ss.getSheetByName(BW_CFG.ARCHIVE_TAB);
  if (!archiveSheet) throw new Error('Archive sheet not found');

  const archiveRow = [
    rowData[COL.DATE_CREATED - 1],  // A: Date Created
    rowData[COL.PROPERTY     - 1],  // B: Property
    rowData[COL.TASK         - 1],  // C: Task / Issue
    rowData[COL.NOTES        - 1],  // D: Notes
    rowData[COL.CATEGORY     - 1],  // E: Category
    rowData[COL.DEADLINE   �����c�FVFƖ�P�&�tFF�4���54�t��T�B�����s�76�v��V�@�t6���WFVBr�����7FGW0�F�F������FFR6���WFV@�Ӱ��6��7B��6����6�6W'f�6R�vWE67&�D��6�������6��v�D��6�����G'���&6��fU6�VWB�V�E&�r�&6��fU&�r���6�VWB�FV�WFU&�r�&�t�Vғ���f���ǒ����6��&V�V6T��6�����Р���u7FGW5WFFR�F6��B�t6���WFVBr�t�&�VBF��R'�F��2r�tF��2r����6��7B7V&�V7B�~)�RF��S�r�&�W'G��r(	Br�F6�F�F�S��6��7B&�G��tF��2�&�VB"r�F6�F�F�R�r"�r�&�W'G��r�2F��R��r�F�F��r�����p��u&�r��fVBF�&6��fR�s����F�g����7V&�V7B�&�G����6V�E6�2�~)�RF��S�r�&�W'G��r(	Br�F6�F�F�R����&WGW&�����G'VRӰ�Р��F��2�&�2F6���&�w&W72���gV�7F�����F�T��&�w&W72�F6��B���6��7B�6�VWB�&�t�V��&�tFF��f��EF6��F6��B����b�&�t�VҒ&WGW&��W'&�#�uF6���Bf�V�C�r�F6��BӰ��6��7BF6�F�F�R�&�tFF�4���D4��Ӱ�6��7B&�W'G��&�tFF�4���$�U%E��Ӱ��6�VWB�vWE&�vR�&�t�V��4���5DEU2��6WEf�VR�t��&�w&W72r���V�D��FR�6�VWB�&�t�V��tF��2r�u7F'FVBv�&���r��F��2�r�����u7FGW5WFFR�F6��B�t��&�w&W72r�tF��27F'FVBF��2F6�r�tF��2r����6��7B7V&�V7B�~)���&�w&W73�r�&�W'G��r(	Br�F6�F�F�S��6��7B&�G��tF��2�27F'FVBv�&���r��"r�F6�F�F�R�r"�r�&�W'G��r������p��u7FGW2WFFVBF���&�w&W72����W"G&6�W"�s����F�g����7V&�V7B�&�G����6V�E6�2�~)�F��27F'FVC�r�&�W'G��r(	Br�F6�F�F�R����&WGW&�����G'VRӰ�Р��F��2�V�2$�VfR��FR"��F��B6V�G2�W76vR���gV�7F�����F�T�WG5FƲ�F6��B���FR����b���FR�&WGW&��W'&�#�t��FRFW�B�2&WV�&VBrӰ�6��7B�6�VWB�&�t�V��&�tFF��f��EF6��F6��B����b�&�t�VҒ&WGW&��W'&�#�uF6���Bf�V�C�r�F6��BӰ��6��7BF6�F�F�R�&�tFF�4���D4��Ӱ�6��7B&�W'G��&�tFF�4���$�U%E��Ӱ��V�D��FR�6�VWB�&�t�V��tF��2r���FR�����u7FGW5WFFR�F6��B�rr���FR�tF��2r����6��7B7V&�V7B�	�9���FRg&��F��3�r�&�W'G��r(	Br�F6�F�F�S��6��7B&�G��tF��2�VgB��FR��"r�F6�F�F�R�r"�r�&�W'G��r������p��r"r���FR�r%����p��t6�V6���W"G&6�W"f�"FWF��2�s����F�g����7V&�V7B�&�G�����6��7B6�5&Wf�Wr���FR��V�wF�����FR�7V'7G&��r���r��r���r���FS��6V�E6�2�	�9�F��2��r�&�W'G��s�"r�6�5&Wf�Wr�r"r����&WGW&�����G'VRӰ�Р��F��26Ɩ6�2%&V֖�B�R"�B�6�2FFR���gV�7F�����F�U&V֖�D�FW"�F6��B���FR�&V֖�DFFR����b�&V֖�DFFR�&WGW&��W'&�#�w&V֖�DFFR�2&WV�&VBrӰ�6��7B�6�VWB�&�t�V��&�tFF��f��EF6��F6��B����b�&�t�VҒ&WGW&��W'&�#�uF6���Bf�V�C�r�F6��BӰ��6��7BF6�F�F�R�&�tFF�4���D4��Ӱ�6��7B&�W'G��&�tFF�4���$�U%E��Ӱ�6��7BFFT�&���WrFFR�&V֖�DFFR���6��7BFFT�&V��WF�ƗF�W2�f�&�DFFR��FFT�&��6W76����vWE67&�EF��U���R���t����B����������p����6��7BV�EF��R��WrFFR�FFT�&��vWEF��R���3�c�����3�֖�WfV�@����7&VFRv��v�R6�V�F"WfV�B����w26�V�F �6��7B6�F�F�R�~(�f����rW�r�&�W'G��r(	Br�F6�F�F�S��6��7B6�FWF��2�tF��2&WVW7FVBf����r�W��F��2F6������p��uF6��r�F6�F�F�R�u��p��u&�W'G��r�&�W'G������FR�u����F��5�w2��FS�r���FR�rr����6��7B6��F���2��FW67&�F���6�FWF��2Ӱ��b�%u�4dr�D��5�T����6��F���2�wVW7G2�%u�4dr�D��5�T��ð�6��F���2�6V�D��f�FW2�G'VS��Р�6��7B6��6�V�F$�vWDFVfV�D6�V�F"����6��7BWfV�B�6��7&VFTWfV�B�6�F�F�R�FFT�&��V�EF��R�6��F���2������V�B��FRF�F6�F�&V@�6��7B��FUFW�B�u&V֖�FW"6WBf�"r�FFT�&V�����FR�r���FS�r���FR�r�r���V�D��FR�6�VWB�&�t�V��tF��2r���FUFW�B�����u7FGW5WFFR�F6��B�rr���FUFW�B�tF��2r����6��7B7V&�V7B�~(�&V֖�FW"6WC�r�&�W'G��r(	Br�F6�F�F�S��6��7B&�G��tF��26WBf����r�W&V֖�FW"f�""r�F6�F�F�R�r"�r�&�W'G��r������p��tFFS�r�FFT�&V��u��p�����FR�t��2��FS�"r���FR�r%����r�u��r���t6�V�F"WfV�B�2&VV�7&VFVB����W"v��v�R6�V�F"�s����F�g����7V&�V7B�&�G����6V�E6�2�~(�F��26WB&V֖�FW"f�"r�&�W'G��s�r�FFT�&V���&WGW&�����G'VR�WfV�D�C�WfV�B�vWD�B��Ӱ�Р��F��2FG2F�&VB��FRg&��F�R��FW2�V����BF�R��F���gV�7F�����F�TFD��FR�F6��B���FR����b���FR�&WGW&��W'&�#�t��FRFW�B�2&WV�&VBrӰ�6��7B�6�VWB�&�t�V��&�tFF��f��EF6��F6��B����b�&�t�VҒ&WGW&��W'&�#�uF6���Bf�V�C�r�F6��BӰ��6��7BF6�F�F�R�&�tFF�4���D4��Ӱ�6��7B&�W'G��&�tFF�4���$�U%E��Ӱ��V�D��FR�6�VWB�&�t�V��tF��2r���FR�����u7FGW5WFFR�F6��B�rr���FR�tF��2r������V�����6��V�Fǒ���4�2f�"&�WF��RF�&VB��FW2��6��7B7V&�V7B�	�*���FRg&��F��3�r�&�W'G��r(	Br�F6�F�F�S��6��7B&�G��tF��2FFVB��FRF�"r�F6�F�F�R�r"�r�&�W'G��r������"r���FR�r"s����F�g����7V&�V7B�&�G�����&WGW&�����G'VRӰ�Р��F��2W6W2F�RFBF6��V�F�7&VFR�WrF6����gV�7F�����F�TFEF6���WuF6�����b��WuF6����WuF6��FW67&�F���&WGW&��W'&�#�uF6�FW67&�F����2&WV�&VBrӰ��6��7B72�7&VG6�VWD��V�'��B�%u�4dr�5$TE4�TUE��B���6��7B6�VWB�72�vWE6�VWD'���R�%u�4dr�5D�dU�D4�5�D"����b�6�VWB�F�&�r�WrW'&�"�t7F�fRF6�26�VWB��Bf�V�Br����6��7BF�F��F�F�7G"����6��7B&�W'G����WuF6��&�W'G���tvV�W&�r��G&�҂���6��7BF6���WuF6��FW67&�F����G&�҂���6��7B6FVv�'����WuF6��6FVv�'���tF֖�r��G&�҂���6��7B76�v��V�B���WuF6��76�v��V�B��t��r��G&�҂���6��7B��FUFW�B���WuF6����FR��rr��G&�҂�������bF��276�v�2F����6V�b�W6R$F��2F�F�"7FGW26��B6��w2����2&�&@�6��7B7FGW2��76�v��V�B���tF��2r��tF��2F�F�r�t��&�w&W72s�����6VVBF�R��FW26��V��v�F�F��2w2�F������FP�6��7B��FW5f�VR���FUFW�B�u�F��2�r�F�F��uӢr���FUFW�B�rs���6�VWB�V�E&�r���F�F�����FFR7&VFV@�&�W'G����#�&�W'G��F6����3�F6���77VP���FW5f�VR���C���FW0�6FVv�'����S�6FVv�'��rr���c�FVFƖ�P�76�v��V�B���s�76�v��V�@�f�6R�����6���WFVC�7FGW2�����7FGW0�rr�����W�G&�ғ���6��7B7V&�V7B�	�8��WrF6�g&��F��3�r�&�W'G��r(	Br�F6���6��7B&�G��tF��2FFVB�WrF6�76�v�VBF�r�76�v��V�B�s�����p��uF6��r�F6��u��p��u&�W'G��r�&�W'G��u��p��t6FVv�'��r�6FVv�'������FUFW�B�u����FS�r���FUFW�B�rr�����F�g����7V&�V7B�&�G�������4�2��ǒv�V�76�v��rF�6��V��RV�6R����"6��G&7F�"���b�76�v��V�B��tF��2r���6V�E6�2�	�8��WrF6�g&��F��2(i"r�76�v��V�B�s�r�&�W'G��r(	Br�F6����Р�&WGW&�����G'VRӰ�Р����)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y══════════════
// DATA HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Read Active Tasks and return only rows Dallas can see.
 * Returned format matches the mock tasks in dallas-command-center.html.
 */
function getTasks() {
  const ss    = SpreadsheetApp.openById(BW_CFG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BW_CFG.ACTIVE_TASKS_TAB);
  if (!sheet) return [];

  const allValues = sheet.getDataRange().getValues();
  if (allValues.length < 2) return [];

  // Find the header row (look for a cell containing 'Task' or 'Task / Issue')
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, allValues.length); i++) {
    const lower = allValues[i].map(c => String(c).trim().toLowerCase());
    if (lower.some(c => c === 'task' || c === 'task / issue')) {
      headerIdx = i;
      break;
    }
  }

  const headers   = allValues[headerIdx].map(c => String(c).trim());
  const idColIdx  = headers.findIndex(h => ['#', 'ID', 'Id', 'id'].includes(h));

  const tasks = [];

  for (let i = headerIdx + 1; i < allValues.length; i++) {
    const row = allValues[i];

    // Skip completely blank rows
    if (!row.some(c => String(c).trim())) continue;

    const get = colNum => String(row[colNum - 1] || '').trim();
    const status = get(COL.STATUS);

    // Only show Dallas-relevant statuses
    if (DALLAS_STATUSES.indexOf(status) === -1) continue;

    // Compute task ID — matches Python generator logic
    let taskId;
    if (idColIdx >= 0 && String(row[idColIdx]).trim()) {
      taskId = String(row[idColIdx]).trim();
    } else {
      taskId = 'row-' + (i + 1); // 1-indexed sheet row number
    }

    const category  = get(COL.CATEGORY);
    const portfolio = CAT_PORTFOLIO[category] || 'Admin';

    // dallasRole drives which action buttons appear on the card
    let dallasRole;
    if (status === 'Dallas Approval' || status === 'Dallas Decision') {
      dallasRole = 'approval';
    } else if (status === 'Dallas To Do' || status === 'In Progress' || status === 'Stuck') {
      dallasRole = 'own';
    } else {
      dallasRole = 'fyi';
    }

    tasks.push({
      id:          taskId,
      description: get(COL.TASK),
      property:    get(COL.PROPERTY),
      deadline:    get(COL.DEADLINE),
      notes:       get(COL.NOTES),
      status:      status,
      assignment:  get(COL.ASSIGNMENT),
      category:    category,
      portfolio:   portfolio,
      dallasRole:  dallasRole,
    });
  }

  return tasks;
}

/**
 * Find a task row by its ID (handles both 'row-N' and named IDs).
 * Returns { sheet, rowNum, rowData } — rowNum is null if not found.
 */
function findTask(taskId) {
  const ss    = SpreadsheetApp.openById(BW_CFG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BW_CFG.ACTIVE_TASKS_TAB);
  if (!sheet) throw new Error('Active Tasks sheet not found');

  // 'row-N' → direct lookup by row number
  if (taskId && String(taskId).startsWith('row-')) {
    const rowNum = parseInt(String(taskId).replace('row-', ''), 10);
    if (isNaN(rowNum) || rowNum < 2) return { sheet, rowNum: null, rowData: null };
    const rowData = sheet.getRange(rowNum, 1, 1, NUM_COLS).getValues()[0];
    return { sheet, rowNum, rowData };
  }

  // Named ID → scan for a column named #/ID/Id/id
  const allValues = sheet.getDataRange().getValues();
  const headers   = allValues[0].map(c => String(c).trim());
  const idColIdx  = headers.findIndex(h => ['#', 'ID', 'Id', 'id'].includes(h));

  if (idColIdx < 0) {
    Logger.log('findTask: no ID column found in Active Tasks headers');
    return { sheet, rowNum: null, rowData: null };
  }

  for (let i = 1; i < allValues.length; i++) {
    if (String(allValues[i][idColIdx]).trim() === String(taskId).trim()) {
      return { sheet, rowNum: i + 1, rowData: allValues[i] };
    }
  }

  return { sheet, rowNum: null, rowData: null };
}

/**
 * Append a timestamped note bubble to the task's Notes column (D).
 * Format: [Author - YYYY-MM-DD]: text
 */
function appendNote(sheet, rowNum, author, text) {
  const cell     = sheet.getRange(rowNum, COL.NOTES);
  const existing = String(cell.getValue() || '').trim();
  const entry    = '[' + author + ' - ' + todayStr() + ']: ' + text;
  cell.setValue(existing ? existing + '\n' + entry : entry);
}

/**
 * Append a row to StatusUpdates.
 * Columns: A=Timestamp | B=Task ID | C=Status | D=Note | E=By
 * The daily Python refresh reads this to overlay task status on the dashboard.
 */
function logStatusUpdate(taskId, status, note, by) {
  const ss    = SpreadsheetApp.openById(BW_CFG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BW_CFG.STATUS_UPDATES_TAB);
  if (!sheet) {
    Logger.log('StatusUpdates tab not found — create a sheet tab named "StatusUpdates"');
    return;
  }
  const ts = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'
  );
  sheet.appendRow([ts, taskId, status, note, by]);
}


// ═══════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════

/** Send an email to Maya. */
function notifyMaya(subject, bodyText) {
  try {
    MailApp.sendEmail({
      to:      BW_CFG.MAYA_EMAIL,
      subject: subject,
      body:    bodyText + '\n\n— Blakeworth Command Center',
    });
  } catch (e) {
    Logger.log('Email send error: ' + e);
  }
}

/**
 * Send an SMS to Maya via QUO.
 * Silently does nothing if QUO credentials are not configured.
 *
 * To enable: fill in QUO_API_URL, QUO_API_KEY, QUO_FROM_NUMBER, QUO_TO_MAYA
 * in the BW_CFG block at the top of this file.
 * Adjust the payload shape to match your QUO API docs if needed.
 */
function sendSms(message) {
  const c = BW_CFG;
  if (!c.QUO_API_URL || !c.QUO_API_KEY || !c.QUO_TO_MAYA) return;
  try {
    UrlFetchApp.fetch(c.QUO_API_URL, {
      method:             'POST',
      contentType:        'application/json',
      headers:            { 'Authorization': 'Bearer ' + c.QUO_API_KEY },
      payload:            JSON.stringify({
        from: c.QUO_FROM_NUMBER,
        to:   c.QUO_TO_MAYA,
        body: message,
      }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log('SMS send error: ' + e);
  }
}


// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function jsonOk(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonErr(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

function todayStr() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
