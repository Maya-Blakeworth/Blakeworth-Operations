/**
 * Blakeworth — Dallas Command Center Web App (Apps Script)
 * ─────────────────────────────────────────────────────────────
 * v3.5 — adds Gemini voice memo extraction + improved prompt
 *
 * Deploy: paste this entire file into your Apps Script editor,
 * replacing all existing code in Apps-Script-2-webapp.gs.
 * Then Deploy → Manage deployments → pencil → New version → Deploy.
 */

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const BW_CFG = {
  SPREADSHEET_ID:      '14Sm-DZzAil0AyS430d3dWWcKiiUgq3SZxZ6vUqNSL-w',
  TOKEN:               'bw2026dash',

  MAYA_EMAIL:          'maya@blakeworth.com',
  DALLAS_EMAIL:        '',   // ← Dallas's email — enables calendar invites to him

  // QUO SMS (optional — email always works without this)
  QUO_API_URL:         '',
  QUO_API_KEY:         '',
  QUO_FROM_NUMBER:     '',
  QUO_TO_MAYA:         '',

  // Voice memo / Gemini AI extraction
  // GEMINI_API_KEY is no longer hardcoded. It is read at runtime from Script Properties
  // via geminiKey_(). To set it: Project Settings (gear) → Script Properties → Add property
  // with key 'GEMINI_API_KEY' and your current Gemini key as the value.
  GEMINI_MODEL:        'gemini-2.5-flash',

  // Sheet tab names — must match exactly (case-sensitive)
  ACTIVE_TASKS_TAB:    'Active Tasks',
  ARCHIVE_TAB:         'Archive',
  STATUS_UPDATES_TAB:  'StatusUpdates',
};

// Active Tasks column positions (1-indexed, A=1)
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

const DALLAS_STATUSES = [
  // EXACT values from Maya's sheet dropdown — case + punctuation matter
  'Dallas Decision', 'Dallas To-Do', 'In Progress', 'Stuck', 'FYI Only',
  // Legacy variants kept so older rows still render
  'Dallas Approval', 'Dallas To Do', 'FYI',
  'Pending', 'New', 'Urgent', 'Scheduled',
];
const HIDDEN_STATUSES = ['Hold off', 'Hold Off', 'Completed', 'Approved', 'Archived'];

const CAT_PORTFOLIO = {
  'JHU': 'JHU',
  'SLP': 'SLP', 'Southlight': 'SLP',
  'DC': 'DC',   'Washington DC': 'DC',
  'Admin': 'Admin',
};


// ═══════════════════════════════════════════════════════════════
// HTTP ENTRY POINTS
// ═══════════════════════════════════════════════════════════════

/**
 * Run this ONCE after pasting the patched code to grant all OAuth scopes.
 * Apps Script silently disables APIs (especially MailApp) when new ones
 * (like UrlFetchApp for Gemini) are added without re-granting permissions.
 *
 * Steps for Maya:
 *   1. Save the file (Ctrl+S)
 *   2. Function dropdown (top toolbar) → pick 'runOnceToGrantScopes'
 *   3. Click Run → permission dialog → Review permissions → Allow
 *   4. Check your inbox for a test email confirming MailApp works
 *   5. Then Deploy → Manage deployments → pencil → New version → Deploy
 */
function runOnceToGrantScopes() {
  try { SpreadsheetApp.openById(BW_CFG.SPREADSHEET_ID).getName(); } catch (e) { Logger.log('Sheet scope error: ' + e); }
  try { CalendarApp.getDefaultCalendar().getName(); } catch (e) { Logger.log('Calendar scope error: ' + e); }
  try { UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true }); } catch (e) { Logger.log('Fetch scope error: ' + e); }
  try {
    MailApp.sendEmail({
      to: BW_CFG.MAYA_EMAIL,
      subject: '\u2713 Blakeworth Apps Script \u2014 Scopes Granted',
      body: 'This test email confirms email notifications are working again.\n\nYou can delete this message.\n\n\u2014 Blakeworth Command Center'
    });
    Logger.log('Test email sent to ' + BW_CFG.MAYA_EMAIL);
  } catch (e) { Logger.log('Mail scope error: ' + e); }
  Logger.log('runOnceToGrantScopes complete. If you got the email, you are all set.');
}

function doGet(e) {
  try {
    const params = e.parameter || {};
    if (params.token !== BW_CFG.TOKEN) return jsonErr('Unauthorized');

    const action = params.action || 'getTasks';
    if (action === 'getTasks') return jsonOk({ tasks: getTasks() });
    if (action === 'getWins')  return jsonOk({ wins: getRecentWins() });
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

    const { action, taskId, note, remindDate, newTask, actor, transcript } = body;
    const who = (actor || 'Dallas').trim();

    switch (action) {
      case 'approve':     return jsonOk(handleApprove(taskId, who));
      case 'done':        return jsonOk(handleDone(taskId, who));
      case 'inprogress':  return jsonOk(handleInProgress(taskId, who));
      case 'letstalk':    return jsonOk(handleLetsTalk(taskId, note, who));
      case 'remindlater': return jsonOk(handleRemindLater(taskId, note, remindDate, who));
      case 'addnote':     return jsonOk(handleAddNote(taskId, note, who));
      case 'addtask':     return jsonOk(handleAddTask(newTask, who));
      case 'fyi_ack':     return jsonOk(handleFyiAck(taskId, who));
      case 'reject':      return jsonOk(handleReject(taskId, note, who));
      case 'holdoff':     return jsonOk(handleHoldOff(taskId, who));
      case 'voice_memo':  return jsonOk(handleVoiceMemo(transcript, who));
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

function handleApprove(taskId, actor) {
  actor = actor || 'Dallas';
  const { sheet, rowNum, rowData } = findTask(taskId);
  if (!rowNum) return { error: 'Task not found: ' + taskId };

  const taskTitle = rowData[COL.TASK - 1];
  const property  = rowData[COL.PROPERTY - 1];
  const today     = todayStr();

  // Spec: Approve → status moves to In Progress so Maya can keep working it
  sheet.getRange(rowNum, COL.STATUS).setValue('In Progress');
  appendNote(sheet, rowNum, actor, '✓ Approved — moving to In Progress.');
  logStatusUpdate(taskId, 'In Progress', 'Approved by ' + actor + ' — moved to In Progress', actor);

  const subject = '✅ Approved: ' + property + ' — ' + taskTitle;
  const body    = actor + ' approved "' + taskTitle + '" (' + property + ') on ' + today + '.\n\nStatus moved to In Progress in your tracker.';
  notifyMaya(subject, body, actor, { property: property, taskTitle: taskTitle, actor: actor, action: 'Approved', taskId: taskId });
  sendSms('✅ Approved: ' + property + ' — ' + taskTitle);

  return { ok: true };
}

function handleDone(taskId, actor) {
  actor = actor || 'Dallas';
  const { sheet, rowNum, rowData } = findTask(taskId);
  if (!rowNum) return { error: 'Task not found: ' + taskId };

  const taskTitle = rowData[COL.TASK - 1];
  const property  = rowData[COL.PROPERTY - 1];
  const today     = todayStr();

  const ss = SpreadsheetApp.openById(BW_CFG.SPREADSHEET_ID);
  const archiveSheet = ss.getSheetByName(BW_CFG.ARCHIVE_TAB);
  if (!archiveSheet) throw new Error('Archive sheet not found');

  const archiveRow = [
    rowData[COL.DATE_CREATED - 1],
    rowData[COL.PROPERTY - 1],
    rowData[COL.TASK - 1],
    rowData[COL.NOTES - 1],
    rowData[COL.CATEGORY - 1],
    rowData[COL.DEADLINE - 1],
    rowData[COL.ASSIGNMENT - 1],
    'Completed',
    today,
  ];

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    archiveSheet.appendRow(archiveRow);
    sheet.deleteRow(rowNum);
  } finally {
    lock.releaseLock();
  }

  logStatusUpdate(taskId, 'Completed', 'Marked done by ' + actor, actor);

  const subject = '✅ Done: ' + property + ' — ' + taskTitle;
  const body    = actor + ' marked "' + taskTitle + '" (' + property + ') as done on ' + today + '.\n\nRow moved to Archive.';
  notifyMaya(subject, body, actor, { property: property, taskTitle: taskTitle, actor: actor, action: 'Done', taskId: taskId });
  sendSms('✅ Done: ' + property + ' — ' + taskTitle);

  return { ok: true };
}

function handleInProgress(taskId, actor) {
  actor = actor || 'Dallas';
  const { sheet, rowNum, rowData } = findTask(taskId);
  if (!rowNum) return { error: 'Task not found: ' + taskId };

  const taskTitle = rowData[COL.TASK - 1];
  const property  = rowData[COL.PROPERTY - 1];

  sheet.getRange(rowNum, COL.STATUS).setValue('In Progress');
  appendNote(sheet, rowNum, actor, 'Started working on this.');
  logStatusUpdate(taskId, 'In Progress', actor + ' started this task', actor);

  const subject = '⚡ In Progress: ' + property + ' — ' + taskTitle;
  const body    = actor + ' has started working on "' + taskTitle + '" (' + property + ').\n\nStatus updated to In Progress in your tracker.';
  notifyMaya(subject, body, actor, { property: property, taskTitle: taskTitle, actor: actor, action: 'In Progress', taskId: taskId });
  sendSms('⚡ ' + actor + ' started: ' + property + ' — ' + taskTitle);

  return { ok: true };
}

function handleLetsTalk(taskId, note, actor) {
  actor = actor || 'Dallas';
  if (!note) return { error: 'Note text is required' };
  const { sheet, rowNum, rowData } = findTask(taskId);
  if (!rowNum) return { error: 'Task not found: ' + taskId };

  const taskTitle = rowData[COL.TASK - 1];
  const property  = rowData[COL.PROPERTY - 1];

  appendNote(sheet, rowNum, actor, note);
  logStatusUpdate(taskId, '', note, actor);

  const subject = '📝 Note from Dallas: ' + property + ' — ' + taskTitle;
  const body    = 'Dallas left a note on "' + taskTitle + '" (' + property + '):\n\n"' + note + '"\n\nCheck your tracker for details.';
  notifyMaya(subject, body, actor);

  const smsPreview = note.length > 100 ? note.substring(0, 97) + '...' : note;
  sendSms('📝 Dallas on ' + property + ': "' + smsPreview + '"');

  return { ok: true };
}

function handleRemindLater(taskId, note, remindDate, actor) {
  actor = actor || 'Dallas';
  if (!remindDate) return { error: 'remindDate is required' };
  const { sheet, rowNum, rowData } = findTask(taskId);
  if (!rowNum) return { error: 'Task not found: ' + taskId };

  const taskTitle = rowData[COL.TASK - 1];
  const property  = rowData[COL.PROPERTY - 1];
  const dateObj   = new Date(remindDate);
  const dateLabel = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'MMMM d, yyyy h:mm a z');
  const endTime   = new Date(dateObj.getTime() + 30 * 60 * 1000);

  const calTitle   = '⏰ Follow up: ' + property + ' — ' + taskTitle;
  const calDetails = actor + ' requested a follow-up on this task.\n\nTask: ' + taskTitle + '\nProperty: ' + property + (note ? '\n\nNote from ' + actor + ': ' + note : '');

  const guests = computeReminderGuests(actor);
  const calOptions = { description: calDetails };
  if (guests.length > 0) {
    calOptions.guests = guests.join(',');
    calOptions.sendInvites = true;
  }

  const cal = CalendarApp.getDefaultCalendar();
  const event = cal.createEvent(calTitle, dateObj, endTime, calOptions);

  const noteText = 'Reminder set for ' + dateLabel + (note ? '. Note: ' + note : '.');
  appendNote(sheet, rowNum, actor, noteText);
  logStatusUpdate(taskId, '', noteText, actor);

  const subject = '⏰ Reminder set: ' + property + ' — ' + taskTitle;
  const body    = actor + ' set a follow-up reminder for "' + taskTitle + '" (' + property + ').\n\nDate: ' + dateLabel + '\n' + (note ? 'Note: "' + note + '"\n\n' : '\n') + 'A calendar event has been created.';
  notifyMaya(subject, body, actor, { property: property, taskTitle: taskTitle, actor: actor, action: 'Reminder Set', taskId: taskId, extra: 'Date: ' + dateLabel + (note ? ' · ' + note : '') });
  sendSms('⏰ ' + actor + ' set reminder for ' + property + ': ' + dateLabel);

  return { ok: true, eventId: event.getId() };
}

function computeReminderGuests(actor) {
  const a = String(actor || '').toLowerCase();
  const guests = [];
  if (a === 'dallas') {
    if (BW_CFG.MAYA_EMAIL) guests.push(BW_CFG.MAYA_EMAIL);
    if (BW_CFG.DALLAS_EMAIL) guests.push(BW_CFG.DALLAS_EMAIL);
  } else if (a === 'marjorie') {
    if (BW_CFG.MAYA_EMAIL) guests.push(BW_CFG.MAYA_EMAIL);
  }
  return guests;
}

function handleAddNote(taskId, note, actor) {
  actor = actor || 'Dallas';
  if (!note) return { error: 'Note text is required' };
  const { sheet, rowNum, rowData } = findTask(taskId);
  if (!rowNum) return { error: 'Task not found: ' + taskId };

  const taskTitle = rowData[COL.TASK - 1];
  const property  = rowData[COL.PROPERTY - 1];

  appendNote(sheet, rowNum, actor, note);
  logStatusUpdate(taskId, '', note, actor);

  const subject = '💬 Note from Dallas: ' + property + ' — ' + taskTitle;
  const body    = actor + ' added a note to "' + taskTitle + '" (' + property + '):\n\n"' + note + '"';
  notifyMaya(subject, body, actor, { property: property, taskTitle: taskTitle, actor: actor, action: 'Note Added', taskId: taskId, extra: note });

  return { ok: true };
}

function handleAddTask(newTask, actor) {
  actor = actor || 'Dallas';
  if (!newTask || !newTask.description) return { error: 'Task description is required' };

  const ss = SpreadsheetApp.openById(BW_CFG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BW_CFG.ACTIVE_TASKS_TAB);
  if (!sheet) throw new Error('Active Tasks sheet not found');

  const today = todayStr();
  const property = (newTask.property || 'General').trim();
  const task = newTask.description.trim();
  const category = (newTask.category || 'Admin').trim();
  const assignment = (newTask.assignment || 'Maya').trim();
  const noteText = (newTask.note || '').trim();

  // Default new tasks to 'New' per handoff spec. Maya promotes them manually.
  const status = 'New';
  const notesValue = noteText ? '[Dallas - ' + today + ']: ' + noteText : '';

  sheet.appendRow([today, property, task, notesValue, category, '', assignment, false, status, '']);

  const subject = '📋 New task from Dallas: ' + property + ' — ' + task;
  const body    = actor + ' added a new task assigned to ' + assignment + ':\n\nTask: ' + task + '\nProperty: ' + property + '\nCategory: ' + category + (noteText ? '\nNote: ' + noteText : '');
  notifyMaya(subject, body, actor, { property: property, taskTitle: task, actor: actor, action: 'New Task Created', taskId: '', extra: noteText });

  if (assignment !== 'Dallas') {
    sendSms('📋 New task from Dallas → ' + assignment + ': ' + property + ' — ' + task);
  }

  return { ok: true };
}

function handleFyiAck(taskId, actor) {
  actor = actor || 'Dallas';
  const { sheet, rowNum, rowData } = findTask(taskId);
  if (!rowNum) return { error: 'Task not found: ' + taskId };

  const taskTitle = rowData[COL.TASK - 1];
  const property  = rowData[COL.PROPERTY - 1];

  appendNote(sheet, rowNum, actor, 'Acknowledged.');
  logStatusUpdate(taskId, '', 'FYI acknowledged by ' + actor, actor);

  const subject = '👀 Seen by Dallas: ' + property + ' — ' + taskTitle;
  const body    = actor + ' saw your FYI on "' + taskTitle + '" (' + property + ') and dismissed it from his board.';
  notifyMaya(subject, body, actor, { property: property, taskTitle: taskTitle, actor: actor, action: 'FYI Acknowledged', taskId: taskId });

  return { ok: true };
}

/**
 * Dallas rejects a Dallas Decision task.
 * Spec: status stays as-is (Maya decides next step), auto-note logged, email to Maya.
 * Optionally accepts a reason note from Dallas.
 */
function handleReject(taskId, note, actor) {
  actor = actor || 'Dallas';
  const { sheet, rowNum, rowData } = findTask(taskId);
  if (!rowNum) return { error: 'Task not found: ' + taskId };

  const taskTitle = rowData[COL.TASK - 1];
  const property  = rowData[COL.PROPERTY - 1];

  const reasonSuffix = note ? ' — ' + note : '';
  appendNote(sheet, rowNum, actor, '✕ Rejected' + reasonSuffix);
  logStatusUpdate(taskId, '', 'Rejected by ' + actor + reasonSuffix, actor);

  const subject = '✕ Rejected: ' + property + ' — ' + taskTitle;
  const body    = actor + ' rejected "' + taskTitle + '" (' + property + ').' + (note ? '\n\nReason: ' + note : '') + '\n\nThe task is still on your dashboard — you decide next steps.';
  notifyMaya(subject, body, actor, { property: property, taskTitle: taskTitle, actor: actor, action: 'Rejected', taskId: taskId, extra: note || '' });
  sendSms('✕ ' + actor + ' rejected: ' + property + ' — ' + taskTitle);

  return { ok: true };
}

/**
 * Dallas puts a task on Hold Off (deprioritize).
 * Spec: status changes to "Hold Off" which is filtered from the dashboard at the data layer.
 * Task remains in the sheet so Maya can restore it later.
 */
function handleHoldOff(taskId, actor) {
  actor = actor || 'Dallas';
  const { sheet, rowNum, rowData } = findTask(taskId);
  if (!rowNum) return { error: 'Task not found: ' + taskId };

  const taskTitle = rowData[COL.TASK - 1];
  const property  = rowData[COL.PROPERTY - 1];

  sheet.getRange(rowNum, COL.STATUS).setValue('Hold off');  // matches sheet dropdown value exactly
  appendNote(sheet, rowNum, actor, '⏸ Hold Off — deprioritized, removed from dashboard.');
  logStatusUpdate(taskId, 'Hold Off', 'Hold Off by ' + actor, actor);

  const subject = '⏸ Hold Off: ' + property + ' — ' + taskTitle;
  const body    = actor + ' put "' + taskTitle + '" (' + property + ') on Hold Off.\n\nThe task is hidden from the dashboard. Change the Status column in your tracker to restore it when you want it back.';
  notifyMaya(subject, body, actor, { property: property, taskTitle: taskTitle, actor: actor, action: 'Hold Off', taskId: taskId });

  return { ok: true };
}


// ═══════════════════════════════════════════════════════════════
// VOICE MEMO — Gemini AI extraction + heuristic fallback
// ═══════════════════════════════════════════════════════════════

// Read the Gemini API key from Script Properties at runtime so we never
// commit the key to source. Set the property in the Apps Script editor:
//   Project Settings (gear icon) → Script Properties → Add property
//   Property: GEMINI_API_KEY    Value: <your current key>
function geminiKey_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
}

function handleVoiceMemo(transcript, actor) {
  if (!transcript || !String(transcript).trim()) {
    return { error: 'Transcript is required' };
  }
  actor = actor || 'Dallas';

  if (geminiKey_()) {
    try {
      const extracted = extractWithGemini(transcript, actor);
      if (extracted && !extracted.error) {
        extracted.source = 'gemini';
        return extracted;
      }
    } catch (e) {
      Logger.log('Gemini extraction failed, falling back to heuristic: ' + e);
    }
  }

  const extracted = extractHeuristic(transcript, actor);
  extracted.source = 'heuristic';
  return extracted;
}

function extractWithGemini(transcript, actor) {
  // Full property list per portfolio — kept in sync with PROPERTIES_BY_PORTFOLIO in index.html.
  const PROPS_JHU = [
    "219 W 29TH ST","232 UNIVERSITY PKWY",
    "2920 SAINT PAUL ST, UNIT 1","2920 SAINT PAUL ST, UNIT 2","2920 SAINT PAUL ST, UNIT 3",
    "2920 SAINT PAUL ST, UNIT 4","2920 SAINT PAUL ST, UNIT 5","2920 SAINT PAUL ST, UNIT 6","2920 SAINT PAUL ST, UNIT 7",
    "300 E UNIVERSITY PKWY, UNIT 1","300 E UNIVERSITY PKWY, UNIT 2","300 E UNIVERSITY PKWY, UNIT 3","300 E UNIVERSITY PKWY, UNIT 4",
    "304 E UNIVERSITY PKWY",
    "3106 N CALVERT ST, UNIT 1","3106 N CALVERT ST, UNIT 2","3106 N CALVERT ST, UNIT 3","3106 N CALVERT ST, UNIT 4",
    "3119 N CALVERT ST, UNIT 1","3119 N CALVERT ST, UNIT 2",
    "328 E 33RD ST","3410 OAKENSHAW PL",
    "GUILFORD APARTMENTS, UNIT A1","GUILFORD APARTMENTS, UNIT A2","GUILFORD APARTMENTS, UNIT A3","GUILFORD APARTMENTS, UNIT A4",
    "GUILFORD APARTMENTS, UNIT A5","GUILFORD APARTMENTS, UNIT A6","GUILFORD APARTMENTS, UNIT A7",
    "GUILFORD APARTMENTS, UNIT B1","GUILFORD APARTMENTS, UNIT B2","GUILFORD APARTMENTS, UNIT B3","GUILFORD APARTMENTS, UNIT B4",
    "GUILFORD APARTMENTS, UNIT B5","GUILFORD APARTMENTS, UNIT B6","GUILFORD APARTMENTS, UNIT B7",
    "GUILFORD APARTMENTS, UNIT C1","GUILFORD APARTMENTS, UNIT C2","GUILFORD APARTMENTS, UNIT C3","GUILFORD APARTMENTS, UNIT C4",
    "GUILFORD APARTMENTS, UNIT C5","GUILFORD APARTMENTS, UNIT C6","GUILFORD APARTMENTS, UNIT C7",
    "GUILFORD APARTMENTS, UNIT G1","GUILFORD APARTMENTS, UNIT G2","GUILFORD APARTMENTS, UNIT G3",
    "WOODROW APARTMENTS, UNIT A1","WOODROW APARTMENTS, UNIT A2","WOODROW APARTMENTS, UNIT A3",
    "WOODROW APARTMENTS, UNIT A4","WOODROW APARTMENTS, UNIT A5","WOODROW APARTMENTS, UNIT A6",
    "WOODROW APARTMENTS, UNIT 1E","WOODROW APARTMENTS, UNIT 1W","WOODROW APARTMENTS, UNIT 2E","WOODROW APARTMENTS, UNIT 2W",
    "WOODROW APARTMENTS, UNIT 3E","WOODROW APARTMENTS, UNIT 3W","WOODROW APARTMENTS, UNIT 4E","WOODROW APARTMENTS, UNIT 4W",
    "WOODROW APARTMENTS, UNIT 5E","WOODROW APARTMENTS, UNIT 5W","WOODROW APARTMENTS, UNIT 6E","WOODROW APARTMENTS, UNIT 6W"
  ];
  const PROPS_SLP = [
    "316 E 5TH ST","422 PIERCE ST","424 PIERCE ST, UNIT 1","424 PIERCE ST, UNIT 2",
    "428 MONTCLAIR AVE","430 MONTCLAIR AVE","462 CARLTON AVE, UNIT 1","462 CARLTON AVE, UNIT 2",
    "505 THOMAS ST, UNIT 1","505 THOMAS ST, UNIT 2","505 THOMAS ST, UNIT 3","505 THOMAS ST, UNIT 4",
    "508 SELFRIDGE ST","510 E PACKER AVE","526 E 5TH ST","527 E PACKER AVE","528 E 5TH ST",
    "571 HILLSIDE AVE","610 PIERCE ST","612 PIERCE ST, UNIT 1","612 PIERCE ST, UNIT 2",
    "614 PIERCE ST","616 PIERCE ST","618 PIERCE ST","620 PIERCE ST",
    "621 PARKHILL ST","623 PARKHILL ST"
  ];
  const PROPS_DC = [
    "3538 PARK WORTH FLATS, UNIT 1","3538 PARK WORTH FLATS, UNIT 2","3538 PARK WORTH FLATS, UNIT 3",
    "3538 PARK WORTH FLATS, UNIT 4","3538 PARK WORTH FLATS, UNIT 5"
  ];

  const todayStr_ = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

  const prompt = [
    "You extract a property-management task from a voice transcript for Blakeworth Management.",
    "Speaker: " + actor + "  ·  Today: " + todayStr_,
    "",
    "Return ONLY valid JSON (no markdown, no preamble). Required fields:",
    "  task          — short action-oriented headline, max 10 words. Strip filler and reasoning.",
    "  notes         — supporting detail, deadlines, dollar amounts, names, context. Null if none.",
    "  portfolio     — one of: JHU · SLP · DC · null",
    "  property      — exact match from the property list below, or null.",
    "  assigned_to   — 'Maya' or 'Dallas' ONLY. Default Maya. Speaker is never the assignee unless transcript explicitly says 'I need to...'. Greetings like 'Hi Maya' are NOT assignment signals.",
    "  category      — Maintenance · Financial · Admin · Compliance · Vendor · Construction",
    "  deadline      — YYYY-MM-DD (resolve 'tomorrow', 'next Friday', 'by the 15th' against today) or null.",
    "",
    "PEOPLE DIRECTORY — use to infer portfolio when no property is mentioned:",
    "  JHU people:   Joe · Steve · Heather · Zak · Zach · Caleb · Bernard · Roberto · Carlos",
    "                (Zak and Zach are TWO DIFFERENT people — never merge.)",
    "  JHU company:  American Management  (variants: American Mgmt · Amer. Mgmt)",
    "  SLP people:   Marjorie (also Marj) · Kristina (also KC — SAME person, always spelled with a K) · Adrian · Ryan",
    "  SLP company:  Forefront  (variants: 4front · ForeFront · Fore Front)",
    "  DC people:    Ramonia (also Ramona) · Mike",
    "",
    "PORTFOLIO LIST (use to fuzzy-match property references like 'Geefurd' → Guilford):",
    "  JHU: " + PROPS_JHU.join(", "),
    "  SLP: " + PROPS_SLP.join(", "),
    "  DC:  " + PROPS_DC.join(", "),
    "",
    "SHORTHAND RULES (Dallas uses these constantly):",
    "  • A number alone ('508', '618', '3538') = the WHOLE property, never a unit.",
    "  • SLP properties are commonly referenced by just a street number.",
    "  • JHU uses letter+number unit codes: 'C5' = Guilford C5, '5W' = Woodrow 5W. No collisions.",
    "  • DC: any 'Unit 1'–'Unit 5' with no other property mentioned = 3538 PARK WORTH FLATS.",
    "  • '3538', 'Park Worth', 'Parkworth', 'PWF' all = 3538 PARK WORTH FLATS.",
    "",
    "GEOGRAPHY RULES (portfolio inference when no property/person mentioned):",
    "  • Maryland / Baltimore → JHU",
    "  • Bethlehem PA → SLP",
    "  • Washington DC → DC",
    "  • Virginia · France · Turkey · anywhere else → ignore (not in scope).",
    "",
    "CONTEXT PRIORITY (most → least specific):",
    "  1. Explicit property name",
    "  2. Person name → portfolio inference",
    "  3. Property management company → portfolio",
    "  4. Geography",
    "  5. Nothing matches → leave portfolio/property null. Do NOT guess.",
    "",
    "FUZZY MATCHING — Dallas does NOT correct voice transcription errors:",
    "  • Name variants: Marjorie/Marj, Ramonia/Ramona — match either way.",
    "  • Kristina/KC = same person. Zak ≠ Zach.",
    "  • Property misspellings: 'Geefurd' → Guilford. Match phonetically when needed.",
    "",
    "Voice transcript:",
    '"' + String(transcript).replace(/"/g, "'") + '"',
    "",
    "Example output shape:",
    '{"task":"Follow up with Bernard on mailbox rekey","notes":"Tenant in Guilford B3 lost keys; Bernard quoted $85 last week.","portfolio":"JHU","property":"GUILFORD APARTMENTS, UNIT B3","assigned_to":"Maya","category":"Vendor","deadline":null}'
  ].join("\n");

  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + BW_CFG.GEMINI_MODEL + ":generateContent?key=" + geminiKey_();

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
    }),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  if (status !== 200) {
    Logger.log("Gemini API error " + status + ": " + response.getContentText().substring(0, 500));
    return { error: "Gemini API returned " + status };
  }

  const data = JSON.parse(response.getContentText());
  const txt = data.candidates && data.candidates[0] && data.candidates[0].content
    && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
    && data.candidates[0].content.parts[0].text;
  if (!txt) {
    Logger.log("Gemini: no text in response");
    return { error: "No text in Gemini response" };
  }
  try {
    const cleaned = String(txt).replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    Logger.log("Gemini returned non-JSON: " + txt);
    return { error: "Gemini returned malformed JSON" };
  }
}

function extractHeuristic(transcript, actor) {
  const t = String(transcript).toLowerCase();

  let property = '';
  const knownStubs = ['guilford','woodrow','park worth','pierce','montclair','carlton','thomas','hillside','packer','parkhill','selfridge','university pkwy','saint paul','calvert','oakenshaw'];
  for (const stub of knownStubs) {
    if (t.indexOf(stub) >= 0) { property = stub.toUpperCase(); break; }
  }

  let category = 'Admin';
  if (/\b(repair|fix|broken|leak|hvac|plumb|boiler|appliance|maintenance|electric|paint|carpet|clean)\b/.test(t)) category = 'Maintenance';
  else if (/\b(quote|bid|invoice|pay|payment|tax|budget|cost|deposit|rent|financial)\b/.test(t)) category = 'Financial';
  else if (/\b(lease|tenant|move|sign|renew)\b/.test(t)) category = 'Admin';
  else if (/\b(inspect|comply|permit|license|filing|llc|insurance|legal|hud|dcha)\b/.test(t)) category = 'Compliance';
  else if (/\b(contractor|vendor|bernard|carlos)\b/.test(t)) category = 'Vendor';
  else if (/\b(build|construct|reno|remodel)\b/.test(t)) category = 'Construction';

  let assignment = 'Maya';
  if (/\b(tell|ask|have)\s+marjorie\b/i.test(transcript))      assignment = 'Marjorie';
  else if (/\b(tell|ask|have)\s+bernard\b/i.test(transcript))  assignment = 'Bernard';
  else if (/\b(tell|ask|have)\s+carlos\b/i.test(transcript))   assignment = 'Carlos';
  else if (/\b(tell|ask|have)\s+dallas\b/i.test(transcript))   assignment = 'Dallas';

  let deadline = '';
  const today = new Date(); today.setHours(0,0,0,0);
  if (/\btomorrow\b/i.test(transcript)) {
    today.setDate(today.getDate() + 1);
    deadline = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } else if (/\bnext week\b/i.test(transcript)) {
    today.setDate(today.getDate() + 7);
    deadline = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } else if (/\bend of week|by friday|this friday\b/i.test(transcript)) {
    const daysToFriday = (5 - today.getDay() + 7) % 7 || 7;
    today.setDate(today.getDate() + daysToFriday);
    deadline = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  let headline = String(transcript).trim();
  const firstSentence = headline.match(/^[^.!?]+[.!?]/);
  if (firstSentence) headline = firstSentence[0].trim().replace(/[.!?]$/,'');
  if (headline.length > 80) headline = headline.substring(0, 77).trim() + '...';

  let portfolio = '';
  if (/\bmarjorie|marj\b/i.test(transcript) && !property) portfolio = 'SLP';
  else if (/\bsteve\b/i.test(transcript) && !property)    portfolio = 'JHU';
  else if (/\bramonia\b/i.test(transcript) && !property)  portfolio = 'DC';

  return {
    task:        headline,
    notes:       transcript,
    portfolio:   portfolio,
    property:    property,
    assigned_to: assignment,
    category:    category,
    deadline:    deadline,
    description: headline,
    assignment:  assignment
  };
}


// ═══════════════════════════════════════════════════════════════
// DATA HELPERS
// ═══════════════════════════════════════════════════════════════

function getTasks() {
  const ss = SpreadsheetApp.openById(BW_CFG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BW_CFG.ACTIVE_TASKS_TAB);
  if (!sheet) return [];

  const allValues = sheet.getDataRange().getValues();
  if (allValues.length < 2) return [];

  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, allValues.length); i++) {
    const lower = allValues[i].map(c => String(c).trim().toLowerCase());
    if (lower.some(c => c === 'task' || c === 'task / issue')) {
      headerIdx = i;
      break;
    }
  }

  const headers = allValues[headerIdx].map(c => String(c).trim());
  const idColIdx = headers.findIndex(h => ['#', 'ID', 'Id', 'id'].includes(h));

  const tasks = [];
  for (let i = headerIdx + 1; i < allValues.length; i++) {
    const row = allValues[i];
    if (!row.some(c => String(c).trim())) continue;

    const get = colNum => String(row[colNum - 1] || '').trim();
    const status = get(COL.STATUS);
    if (DALLAS_STATUSES.indexOf(status) === -1) continue;

    let taskId;
    if (idColIdx >= 0 && String(row[idColIdx]).trim()) {
      taskId = String(row[idColIdx]).trim();
    } else {
      taskId = 'row-' + (i + 1);
    }

    const category = get(COL.CATEGORY);
    const portfolio = CAT_PORTFOLIO[category] || 'Admin';

    let dallasRole;
    if (status === 'Dallas Approval' || status === 'Dallas Decision') dallasRole = 'approval';
    else if (status === 'Dallas To Do' || status === 'In Progress' || status === 'Stuck') dallasRole = 'own';
    else dallasRole = 'fyi';

    tasks.push({
      id: taskId,
      description: get(COL.TASK),
      property: get(COL.PROPERTY),
      deadline: get(COL.DEADLINE),
      notes: get(COL.NOTES),
      status: status,
      assignment: get(COL.ASSIGNMENT),
      category: category,
      portfolio: portfolio,
      dallasRole: dallasRole,
    });
  }
  return tasks;
}

function logStatusUpdate(taskId, status, note, by) {
  const ss = SpreadsheetApp.openById(BW_CFG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BW_CFG.STATUS_UPDATES_TAB);
  if (!sheet) {
    Logger.log('StatusUpdates tab not found');
    return;
  }
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([ts, taskId, status, note, by]);
}

/**
 * Recent Wins — last 6 completed tasks from the Archive tab.
 * Archive columns (per handleDone):
 *   A=Date Created  B=Property  C=Task/Issue  D=Notes  E=Category
 *   F=Deadline      G=Assignment  H=Status (Completed)  I=Date Completed
 *
 * Returns the most recent 6 rows as { property, date, text } for the wins grid.
 * "date" is the completion date (col I); "text" is the task title (col C).
 */
function getRecentWins() {
  const ss    = SpreadsheetApp.openById(BW_CFG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BW_CFG.ARCHIVE_TAB);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // Read full archive then take the last 6 non-empty rows
  const range = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  const rows  = range.filter(r => r.some(c => String(c).trim()));
  const last6 = rows.slice(-6).reverse(); // newest first

  const tz = Session.getScriptTimeZone();
  return last6.map(r => {
    const property = String(r[1] || '').trim() || 'Portfolio';
    const text     = String(r[2] || '').trim();
    const rawDate  = r[8]; // col I = Date Completed
    let dateLabel = '';
    if (rawDate) {
      if (rawDate instanceof Date) {
        dateLabel = Utilities.formatDate(rawDate, tz, 'MMM d');
      } else {
        // try to parse string date
        const d = new Date(rawDate);
        dateLabel = isNaN(d) ? String(rawDate) : Utilities.formatDate(d, tz, 'MMM d');
      }
    }
    return { property: property, date: dateLabel, text: text };
  });
}


// ═══════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════

function notifyMaya(subject, bodyText, actor, ctx) {
  if (actor && String(actor).toLowerCase() === 'maya') {
    Logger.log('notifyMaya skipped - actor is Maya');
    return;
  }
  try {
    const opts = {
      to: BW_CFG.MAYA_EMAIL,
      subject: subject,
      body: bodyText + '\n\n- Blakeworth Command Center',
    };
    if (ctx) opts.htmlBody = buildEmailHtml(ctx);
    MailApp.sendEmail(opts);
  } catch (e) {
    Logger.log('Email send error: ' + e);
  }
}

/**
 * Styled HTML email body for Maya's notifications.
 */
function buildEmailHtml(ctx) {
  const DASH_URL = 'https://maya-blakeworth.github.io/Blakeworth-Operations/';
  const LOG_URL  = 'https://docs.google.com/spreadsheets/d/' + BW_CFG.SPREADSHEET_ID;
  const a = String(ctx.action || '').toLowerCase();
  let sBg = '#EFE5D8', sFg = '#5A4634';
  if (a.indexOf('approv') >= 0 || a.indexOf('done') >= 0) { sBg = '#D4EDDA'; sFg = '#2C8E4A'; }
  else if (a.indexOf('hold') >= 0 || a.indexOf('stuck') >= 0 || a.indexOf('reject') >= 0) { sBg = '#FDDCDB'; sFg = '#B83A33'; }
  else if (a.indexOf('pend') >= 0 || a.indexOf('remind') >= 0) { sBg = '#FFF4D6'; sFg = '#B57500'; }
  else if (a.indexOf('note') >= 0 || a.indexOf('ping') >= 0) { sBg = '#DEE9F5'; sFg = '#1E6BB8'; }
  const E = escapeHtml_;
  const propEsc = E(ctx.property || '');
  const taskEsc = E(ctx.taskTitle || '');
  const actEsc  = E(ctx.actor || '');
  const actnEsc = E(ctx.action || '');
  const idEsc   = E(String(ctx.taskId || ''));
  const extraHtml = ctx.extra ? '<br><br>' + E(ctx.extra) : '';

  return '<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#F5F1E8;padding:24px 16px;color:#1E140C;margin:0;">'
    + '<div style="max-width:560px;margin:0 auto;">'
    + '<div style="background:#FFFFFF;border:1px solid #E5D9BF;border-radius:14px;padding:22px 24px;margin-bottom:12px;">'
    + '<div style="font-size:11px;color:#8A7559;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;font-weight:600;">PROPERTY &middot; TASK #ROW-' + idEsc + '</div>'
    + '<h1 style="font-size:24px;font-weight:700;color:#1E140C;margin:0 0 14px 0;line-height:1.2;">' + propEsc + '</h1>'
    + '<span style="display:inline-block;padding:5px 14px;border-radius:16px;font-size:13px;font-weight:600;margin-right:6px;background:#FCE7DA;color:#B8552E;">' + actEsc + '</span>'
    + '<span style="display:inline-block;padding:5px 14px;border-radius:16px;font-size:13px;font-weight:600;background:' + sBg + ';color:' + sFg + ';">' + actnEsc + '</span>'
    + '</div>'
    + '<div style="background:#FFFFFF;border:1px solid #E5D9BF;border-radius:14px;padding:18px 24px;margin-bottom:12px;">'
    + '<div style="font-size:11px;color:#8A7559;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;font-weight:600;">THE TASK</div>'
    + '<div style="font-size:15px;line-height:1.5;color:#1E140C;">' + taskEsc + '</div>'
    + '</div>'
    + '<div style="background:#FFF8DC;border:1px solid #F0D78E;border-radius:14px;padding:18px 22px;margin-top:12px;">'
    + '<div style="font-size:11px;color:#8B6500;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;font-weight:600;">WHAT ' + actEsc.toUpperCase() + ' DID</div>'
    + '<div style="color:#5C4A14;font-size:14px;line-height:1.55;">' + actEsc + ' marked this as <span style="background:#FFFFFF;padding:2px 10px;border-radius:6px;font-weight:600;">&quot;' + actnEsc + '&quot;</span>' + extraHtml + '</div>'
    + '</div>'
    + '<div style="margin-top:20px;padding-top:16px;border-top:1px solid #E5D9BF;font-size:13px;text-align:center;">'
    + '<a href="' + DASH_URL + '" style="color:#2E6DA8;text-decoration:none;margin-right:24px;font-weight:600;">&rarr; Dashboard</a>'
    + '<a href="' + LOG_URL + '" style="color:#2E6DA8;text-decoration:none;font-weight:600;">&rarr; Operations Log</a>'
    + '</div></div></body></html>';
}

function escapeHtml_(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function notifyDallas(subject, bodyText, actor) {
  if (!BW_CFG.DALLAS_EMAIL) { Logger.log('notifyDallas skipped - DALLAS_EMAIL not configured'); return; }
  if (actor && actor.toLowerCase() === 'dallas') { Logger.log('notifyDallas skipped - actor is Dallas'); return; }
  try {
    MailApp.sendEmail({ to: BW_CFG.DALLAS_EMAIL, subject: subject, body: bodyText + '\n\n- Blakeworth Command Center' });
  } catch (e) { Logger.log('notifyDallas send error: ' + e); }
}

function sendSms(message) {
  const c = BW_CFG;
  if (!c.QUO_API_URL || !c.QUO_API_KEY || !c.QUO_TO_MAYA) return;
  try {
    UrlFetchApp.fetch(c.QUO_API_URL, {
      method: 'POST', contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + c.QUO_API_KEY },
      payload: JSON.stringify({ from: c.QUO_FROM_NUMBER, to: c.QUO_TO_MAYA, body: message }),
      muteHttpExceptions: true,
    });
  } catch (e) { Logger.log('SMS send error: ' + e); }
}


// UTILITIES

function jsonOk(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function jsonErr(msg) {
  return ContentService.createTextOutput(JSON.stringify({ error: msg })).setMimeType(ContentService.MimeType.JSON);
}

function todayStr() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function findTask(taskId) {
  const ss = SpreadsheetApp.openById(BW_CFG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BW_CFG.ACTIVE_TASKS_TAB);
  if (!sheet) return { sheet: null, rowNum: 0, rowData: null };
  const values = sheet.getDataRange().getValues();
  const rowNum = parseInt(taskId, 10);
  if (!rowNum || rowNum < 2 || rowNum > values.length) {
    return { sheet, rowNum: 0, rowData: null };
  }
  return { sheet, rowNum, rowData: values[rowNum - 1] };
}

function appendNote(sheet, rowNum, author, text) {
  const today = todayStr();
  const cell = sheet.getRange(rowNum, COL.NOTES);
  const existing = String(cell.getValue() || '');
  const newLine = '[' + author + ' - ' + today + ']: ' + text;
  cell.setValue(existing ? existing + '\n' + newLine : newLine);
}
