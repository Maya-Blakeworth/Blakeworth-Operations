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
    rowData[COL.DEADLINE     - 1],  // F: Deadline
    rowData[COL.ASSIGNMENT   - 1],  // G: Assignment
    'Completed',                     // H: Status
    today,                           // I: Date Completed
  ];

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    archiveSheet.appendRow(archiveRow);
    sheet.deleteRow(rowNum);
  } finally {
    lock.releaseLock();
  }

  logStatusUpdate(taskId, 'Completed', 'Marked done by Dallas', 'Dallas');

  const subject = '✅ Done: ' + property + ' — ' + taskTitle;
  const body    = 'Dallas marked "' + taskTitle + '" (' + property + ') as done on ' + today + '.\n\n'
                + 'Row moved to Archive.';
  notifyMaya(subject, body);
  sendSms('✅ Done: ' + property + ' — ' + taskTitle);

  return { ok: true };
}

/** Dallas marks a task In Progress. */
function handleInProgress(taskId) {
  const { sheet, rowNum, rowData } = findTask(taskId);
  if (!rowNum) return { error: 'Task not found: ' + taskId };

  const taskTitle = rowData[COL.TASK     - 1];
  const property  = rowData[COL.PROPERTY - 1];

  sheet.getRange(rowNum, COL.STATUS).setValue('In Progress');
  appendNote(sheet, rowNum, 'Dallas', 'Started working on this.');
  logStatusUpdate(taskId, 'In Progress', 'Dallas started this task', 'Dallas');

  const subject = '⚡ In Progress: ' + property + ' — ' + taskTitle;
  const body    = 'Dallas has started working on "' + taskTitle + '" (' + property + ').\n\n'
                + 'Status updated to In Progress in your tracker.';
  notifyMaya(subject, body);
  sendSms('⚡ Dallas started: ' + property + ' — ' + taskTitle);

  return { ok: true };
}

/** Dallas opens "Leave a Note" modal and sends a message. */
function handleLetsTalk(taskId, note) {
  if (!note) return { error: 'Note text is required' };
  const { sheet, rowNum, rowData } = findTask(taskId);
  if (!rowNum) return { error: 'Task not found: ' + taskId };

  const taskTitle = rowData[COL.TASK     - 1];
  const property  = rowData[COL.PROPERTY - 1];

  appendNote(sheet, rowNum, 'Dallas', note);
  logStatusUpdate(taskId, '', note, 'Dallas');

  const subject = '📝 Note from Dallas: ' + property + ' — ' + taskTitle;
  const body    = 'Dallas left a note on "' + taskTitle + '" (' + property + '):\n\n'
                + '"' + note + '"\n\n'
                + 'Check your tracker for details.';
  notifyMaya(subject, body);

  const smsPreview = note.length > 100 ? note.substring(0, 97) + '...' : note;
  sendSms('📝 Dallas on ' + property + ': "' + smsPreview + '"');

  return { ok: true };
}

/** Dallas clicks "Remind Me" and picks a date. */
function handleRemindLater(taskId, note, remindDate) {
  if (!remindDate) return { error: 'remindDate is required' };
  const { sheet, rowNum, rowData } = findTask(taskId);
  if (!rowNum) return { error: 'Task not found: ' + taskId };

  const taskTitle = rowData[COL.TASK     - 1];
  const property  = rowData[COL.PROPERTY - 1];
  const dateObj   = new Date(remindDate);
  const dateLabel = Utilities.formatDate(
    dateObj, Session.getScriptTimeZone(), 'MMMM d, yyyy h:mm a z'
  );
  const endTime   = new Date(dateObj.getTime() + 30 * 60 * 1000); // 30-min event

  // Create Google Calendar event in Maya's calendar
  const calTitle   = '⏰ Follow up: ' + property + ' — ' + taskTitle;
  const calDetails = 'Dallas requested a follow-up on this task.\n\n'
                   + 'Task: '     + taskTitle + '\n'
                   + 'Property: ' + property
                   + (note ? '\n\nDallas\'s note: ' + note : '');

  const calOptions = { description: calDetails };
  if (BW_CFG.DALLAS_EMAIL) {
    calOptions.guests      = BW_CFG.DALLAS_EMAIL;
    calOptions.sendInvites = true;
  }

  const cal   = CalendarApp.getDefaultCalendar();
  const event = cal.createEvent(calTitle, dateObj, endTime, calOptions);

  // Append note to task thread
  const noteText = 'Reminder set for ' + dateLabel + (note ? '. Note: ' + note : '.');
  appendNote(sheet, rowNum, 'Dallas', noteText);
  logStatusUpdate(taskId, '', noteText, 'Dallas');

  const subject = '⏰ Reminder set: ' + property + ' — ' + taskTitle;
  const body    = 'Dallas set a follow-up reminder for "' + taskTitle + '" (' + property + ').\n\n'
                + 'Date: ' + dateLabel + '\n'
                + (note ? 'His note: "' + note + '"\n\n' : '\n')
                + 'A calendar event has been created in your Google Calendar.';
  notifyMaya(subject, body);
  sendSms('⏰ Dallas set reminder for ' + property + ': ' + dateLabel);

  return { ok: true, eventId: event.getId() };
}

/** Dallas adds a thread note from the notes panel (not the modal). */
function handleAddNote(taskId, note) {
  if (!note) return { error: 'Note text is required' };
  const { sheet, rowNum, rowData } = findTask(taskId);
  if (!rowNum) return { error: 'Task not found: ' + taskId };

  const taskTitle = rowData[COL.TASK     - 1];
  const property  = rowData[COL.PROPERTY - 1];

  appendNote(sheet, rowNum, 'Dallas', note);
  logStatusUpdate(taskId, '', note, 'Dallas');

  // Email Maya silently (no SMS for routine thread notes)
  const subject = '💬 Note from Dallas: ' + property + ' — ' + taskTitle;
  const body    = 'Dallas added a note to "' + taskTitle + '" (' + property + '):\n\n"' + note + '"';
  notifyMaya(subject, body);

  return { ok: true };
}

/** Dallas uses the Add Task panel to create a new task. */
function handleAddTask(newTask) {
  if (!newTask || !newTask.description) return { error: 'Task description is required' };

  const ss    = SpreadsheetApp.openById(BW_CFG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BW_CFG.ACTIVE_TASKS_TAB);
  if (!sheet) throw new Error('Active Tasks sheet not found');

  const today      = todayStr();
  const property   = (newTask.property   || 'General').trim();
  const task       = newTask.description.trim();
  const category   = (newTask.category   || 'Admin').trim();
  const assignment = (newTask.assignment || 'Maya').trim();
  const noteText   = (newTask.note       || '').trim();

  // If Dallas assigns to himself, use "Dallas To Do" status so it shows on his board
  const status = (assignment === 'Dallas') ? 'Dallas To Do' : 'In Progress';

  // Seed the notes column with Dallas's optional note
  const notesValue = noteText ? '[Dallas - ' + today + ']: ' + noteText : '';

  sheet.appendRow([
    today,       // A: Date Created
    property,    // B: Property
    task,        // C: Task / Issue
    notesValue,  // D: Notes
    category,    // E: Category
    '',          // F: Deadline
    assignment,  // G: Assignment
    false,       // H: Completed?
    status,      // I: Status
    '',          // J: Extra
  ]);

  const subject = '📋 New task from Dallas: ' + property + ' — ' + task;
  const body    = 'Dallas added a new task assigned to ' + assignment + ':\n\n'
                + 'Task: '     + task     + '\n'
                + 'Property: ' + property + '\n'
                + 'Category: ' + category
                + (noteText ? '\nNote: '  + noteText : '');
  notifyMaya(subject, body);

  // SMS only when assigning to someone else (Maya or a contractor)
  if (assignment !== 'Dallas') {
    sendSms('📋 New task from Dallas → ' + assignment + ': ' + property + ' — ' + task);
  }

  return { ok: true };
}


// ═══════════════════════════════════════════════════════════════
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
