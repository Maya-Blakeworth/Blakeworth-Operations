#!/usr/bin/env python3
"""
Blakeworth Daily Dashboard Generator
-------------------------------------
Reads your Google Sheet (Active Tasks + Archive + StatusUpdates) and
generates a fresh index.html every day at 1 PM Eastern via GitHub Actions.

You don't need to edit this file. All configuration is via environment
variables set as GitHub Secrets.
"""

import os
import json
import re
from datetime import datetime
from collections import defaultdict

import gspread
from google.oauth2.service_account import Credentials

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SPREADSHEET_ID = os.environ.get(
    "SPREADSHEET_ID",
    "14Sm-DZzAil0AyS430d3dWWcKiiUgq3SZxZ6vUqNSL-w",  # Maya's Daily To-Do Tracker
)
OPS_LOG_TAB        = "Active Tasks"
ARCHIVE_TAB        = "Archive"
STATUS_UPDATES_TAB = "StatusUpdates"

TEMPLATE_HTML = "scripts/dashboard-template.html"
INDEX_HTML    = "index.html"

CATEGORY_ORDER = [
    "Admin",
    "Maintenance",
    "Financial",
    "Construction",
    "Compliance",
    "Vendor",
]

STATUS_ORDER = [
    "Stuck",
    "Dallas Approval",
    "Dallas Decision",
    "Dallas To Do",
    "New",
    "In Progress",
    "Hold off",
    "FYI Only",
]

VALID_STATUSES = {
    "Stuck", "Dallas Approval", "Dallas Decision", "Dallas To Do",
    "New", "In Progress", "Hold off", "FYI Only",
}

STATUS_CLASS_MAP = {
    "Dallas Approval":  "status-approval",
    "Dallas Decision":  "status-approval",
    "Dallas To Do":     "status-dallas-todo",
    "New":              "status-new",
    "In Progress":      "status-in-progress",
    "Stuck":            "status-stuck",
    "Hold off":         "status-hold",
    "FYI Only":         "status-fyi",
    # Overlay statuses from StatusUpdates tab
    "Maya on it":       "status-in-progress",
    "Dallas on it":     "status-in-progress",
    "Approved":         "status-approval",
    "Rejected":         "status-stuck",
    "Done":             "status-fyi",
    "Note added":       "status-fyi",
    "Reminder set":     "status-fyi",
    "Meeting booked":   "status-in-progress",
}

CATEGORY_TO_MARKER = {
    "Admin":        "ADMIN",
    "Maintenance":  "MAINTENANCE",
    "Financial":    "FINANCIAL",
    "Construction": "CONSTRUCTION",
    "Compliance":   "COMPLIANCE",
    "Vendor":       "VENDOR",
}

MARKERS = {
    "QUICK_WINS":   ("<!-- QUICK_WINS_START -->",   "<!-- QUICK_WINS_END -->"),
    "ADMIN":        ("<!-- ADMIN_START -->",         "<!-- ADMIN_END -->"),
    "MAINTENANCE":  ("<!-- MAINTENANCE_START -->",   "<!-- MAINTENANCE_END -->"),
    "FINANCIAL":    ("<!-- FINANCIAL_START -->",     "<!-- FINANCIAL_END -->"),
    "CONSTRUCTION": ("<!-- CONSTRUCTION_START -->",  "<!-- CONSTRUCTION_END -->"),
    "COMPLIANCE":   ("<!-- COMPLIANCE_START -->",    "<!-- COMPLIANCE_END -->"),
    "VENDOR":       ("<!-- VENDOR_START -->",        "<!-- VENDOR_END -->"),
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
URL_PATTERN = re.compile(r'(https?://[^\s<>"]+)')
DOC_URL_PATTERNS = [
    re.compile(r'(https://docs\.google\.com/(?:document|spreadsheets|presentation)/[^\s<>"]+)'),
    re.compile(r'(https://drive\.google\.com/(?:file|drive/folders)/[^\s<>"]+)'),
]

def html_escape(text):
    if not text:
        return ""
    return (str(text)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;"))

def linkify(text):
    """Wrap raw URLs in clickable links. Always call AFTER html_escape."""
    if not text:
        return text
    return URL_PATTERN.sub(
        r'<a href="\1" target="_blank" rel="noopener" '
        r'style="color:#7dd3fc;text-decoration:underline">\1</a>',
        text
    )

def extract_doc_links(text):
    if not text:
        return []
    out = []
    for pat in DOC_URL_PATTERNS:
        out.extend(pat.findall(text))
    return out

def authenticate():
    creds_json = os.environ.get("GOOGLE_CREDENTIALS")
    if not creds_json:
        raise ValueError("GOOGLE_CREDENTIALS env var not set. Add it as a GitHub Secret.")
    creds_dict = json.loads(creds_json)
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
    ]
    creds = Credentials.from_service_account_info(creds_dict, scopes=scopes)
    return gspread.authorize(creds)

def find_header_row(rows, header_hints=("Task / Issue", "Task", "Property")):
    for idx, row in enumerate(rows):
        for hint in header_hints:
            if hint in row:
                return idx, row
    return -1, None

def row_to_dict(headers, row):
    return {h: (row[i] if i < len(row) else "") for i, h in enumerate(headers)}

def get_task_id(row_dict, header_row_idx, row_idx):
    for key in ("#", "ID", "Id", "id"):
        if key in row_dict and str(row_dict[key]).strip():
            return str(row_dict[key]).strip()
    return f"row-{header_row_idx + row_idx + 2}"

# ---------------------------------------------------------------------------
# Sheet fetchers
# ---------------------------------------------------------------------------
def fetch_active_tasks(client):
    sheet = client.open_by_key(SPREADSHEET_ID)
    ws = sheet.worksheet(OPS_LOG_TAB)
    all_values = ws.get_all_values()

    header_idx, headers = find_header_row(all_values)
    if not headers:
        print(f"  WARNING: header row not found in '{OPS_LOG_TAB}'")
        return defaultdict(lambda: defaultdict(list))

    grouped = defaultdict(lambda: defaultdict(list))
    for offset, row in enumerate(all_values[header_idx + 1:]):
        if not any(row):
            continue
        rd = row_to_dict(headers, row)
        task = rd.get("Task / Issue", "").strip() or rd.get("Task", "").strip()
        if not task:
            continue
        status = rd.get("Status", "").strip()
        if status not in VALID_STATUSES:
            continue
        category = rd.get("Category", "").strip() or "Admin"
        grouped[category][status].append({
            "id":       get_task_id(rd, header_idx, offset),
            "property": rd.get("Property", "").strip(),
            "task":     task,
            "notes":    rd.get("Notes", "").strip(),
            "assigned": rd.get("Assignment", "").strip(),
            "deadline": rd.get("Deadline", "").strip(),
            "category": category,
            "status":   status,
        })
    return grouped

def fetch_archive(client, limit=9):
    sheet = client.open_by_key(SPREADSHEET_ID)
    try:
        ws = sheet.worksheet(ARCHIVE_TAB)
    except Exception:
        print(f"  WARNING: '{ARCHIVE_TAB}' tab not found")
        return []
    all_values = ws.get_all_values()
    header_idx, headers = find_header_row(all_values)
    if not headers:
        return []
    items = []
    for row in reversed(all_values[header_idx + 1:]):
        if not any(row):
            continue
        rd = row_to_dict(headers, row)
        task = rd.get("Task / Issue", "").strip() or rd.get("Task", "").strip()
        if not task:
            continue
        items.append({
            "property": rd.get("Property", "").strip(),
            "task":     task,
            "status":   rd.get("Status", "").strip() or "Done",
        })
        if len(items) >= limit:
            break
    return items

def fetch_status_updates(client):
    sheet = client.open_by_key(SPREADSHEET_ID)
    try:
        ws = sheet.worksheet(STATUS_UPDATES_TAB)
    except Exception:
        print(f"  INFO: '{STATUS_UPDATES_TAB}' tab not found yet — skipping overlay")
        return {}
    rows = ws.get_all_values()
    if len(rows) < 2:
        return {}
    headers = [h.strip().lower() for h in rows[0]]
    def col(name, default):
        return headers.index(name) if name in headers else default
    i_ts, i_id, i_st, i_note, i_by = (
        col("timestamp", 0), col("id", 1), col("status", 2),
        col("note", 3),      col("by", 4),
    )
    latest = {}
    for row in rows[1:]:
        if len(row) <= i_id or not row[i_id].strip():
            continue
        item_id = row[i_id].strip()
        ts = row[i_ts] if i_ts < len(row) else ""
        existing = latest.get(item_id)
        if existing and existing.get("at", "") >= ts:
            continue
        latest[item_id] = {
            "status": (row[i_st]   if i_st   < len(row) else "").strip(),
            "note":   (row[i_note] if i_note < len(row) else "").strip(),
            "by":     (row[i_by]   if i_by   < len(row) else "").strip(),
            "at":     ts,
        }
    return latest

# ---------------------------------------------------------------------------
# HTML builders
# ---------------------------------------------------------------------------
def build_task_item(task, latest_update):
    item_id      = task["id"]
    property_val = html_escape(task.get("property", ""))
    task_text    = html_escape(task.get("task", ""))
    notes_raw    = task.get("notes", "")
    notes_text   = linkify(html_escape(notes_raw))
    deadline     = html_escape(task.get("deadline", ""))
    status       = task.get("status", "")
    raw_status   = status

    overlay_note = ""
    overlay_by   = ""
    if latest_update:
        ov_status = latest_update.get("status", "")
        if ov_status and ov_status != status:
            status = ov_status
        overlay_note = linkify(html_escape(latest_update.get("note", "")))
        overlay_by   = html_escape(latest_update.get("by", ""))

    status_class = STATUS_CLASS_MAP.get(status, "status-fyi")

    doc_buttons_html = ""
    for url in extract_doc_links(notes_raw):
        doc_buttons_html += (
            f'<a href="{html_escape(url)}" target="_blank" rel="noopener" '
            f'class="doc-attachment-btn">📎 Open document</a>'
        )

    p = []
    p.append(f'<div class="task-item" data-id="{html_escape(item_id)}" data-raw-status="{html_escape(raw_status)}">')
    p.append( '  <div class="task-row">')
    p.append( '    <div class="task-info">')
    p.append( '      <button class="task-expand-btn" aria-label="Expand task">▼</button>')
    p.append(f'      <div class="task-title">{task_text}</div>')
    if property_val:
        p.append(f'      <div class="task-property">{property_val}</div>')
    if deadline:
        p.append(f'      <div class="task-deadline">Due {deadline}</div>')
    p.append( '    </div>')
    p.append( '    <div class="task-status">')
    p.append(f'      <span class="task-status-badge {status_class}">{html_escape(status)}</span>')
    p.append( '    </div>')
    p.append( '  </div>')

    p.append( '  <div class="task-expanded" hidden>')
    if notes_text:
        p.append(f'    <div class="task-description">{notes_text}</div>')
    if doc_buttons_html:
        p.append(f'    <div class="task-docs">{doc_buttons_html}</div>')
    if overlay_note:
        p.append(f'    <div class="task-overlay-note">Latest from {overlay_by or "team"}: {overlay_note}</div>')

    p.append( '    <div class="task-actions">')
    p.append( '      <div class="task-buttons">')

    if raw_status in ("Dallas Approval", "Dallas Decision", "Dallas To Do"):
        p.append('        <button class="btn-action btn-approve">✓ Approve</button>')
        p.append('        <button class="btn-action btn-hold-off">⏸ Hold Off</button>')
        p.append('        <button class="btn-action btn-reject">✗ Reject</button>')
    elif raw_status == "Stuck":
        p.append('        <button class="btn-action btn-lets-talk">📅 Let\'s Talk</button>')
    elif raw_status == "In Progress":
        p.append('        <button class="btn-action btn-remind">🔔 Remind Me</button>')

    p.append( '        <label class="done-label">')
    p.append(f'          <input type="checkbox" class="task-checkbox" id="cb-{html_escape(item_id)}">')
    p.append( '          <span class="done-text">✓ Done</span>')
    p.append( '        </label>')
    p.append( '      </div>')

    note_placeholder = "Leave a quick note for the record..."
    saved_note = html_escape(latest_update.get("note", "") if latest_update else "")
    p.append(f'      <textarea class="task-note-input" placeholder="{note_placeholder}">{saved_note}</textarea>')
    p.append( '      <button class="btn-save-note">Save Note</button>')
    p.append( '    </div>')
    p.append( '  </div>')
    p.append( '</div>')
    return "\n".join(p)

def build_quick_wins(archive_items):
    if not archive_items:
        return '<div class="empty-state">No recent completions yet</div>'
    out = []
    for it in archive_items:
        task_text    = (it.get("task", "") or "").strip()
        property_text = (it.get("property", "") or "").strip()
        prefix = f"{property_text}: " if property_text else ""
        text = html_escape(prefix + task_text)
        if len(text) > 110:
            text = text[:107] + "..."
        out.append(
            f'<div class="win-item">'
            f'<span class="win-check">✓</span>'
            f'<span class="win-text">{text}</span>'
            f'</div>'
        )
    return "\n".join(out)

def inject_into_template(template_html, ops_grouped, archive_items, status_overlay):
    now = datetime.now().strftime("%B %d, %Y")
    html = template_html.replace("<!-- LAST_UPDATED -->", now)

    for category, marker_key in CATEGORY_TO_MARKER.items():
        content = ""
        if category in ops_grouped:
            for status in STATUS_ORDER:
                for task in ops_grouped[category].get(status, []):
                    overlay = status_overlay.get(task["id"])
                    content += build_task_item(task, overlay) + "\n\n"
            for status, tasks in ops_grouped[category].items():
                if status not in STATUS_ORDER:
                    for task in tasks:
                        overlay = status_overlay.get(task["id"])
                        content += build_task_item(task, overlay) + "\n\n"
        if not content.strip():
            content = '<div class="empty-state">No items in this category</div>'

        start, end = MARKERS[marker_key]
        pattern = re.escape(start) + r".*?" + re.escape(end)
        replacement = f"{start}\n{content}\n{end}"
        if re.search(pattern, html, re.DOTALL):
            html = re.sub(pattern, replacement, html, flags=re.DOTALL)
        else:
            print(f"  WARNING: markers for {marker_key} not found in template")

    wins = build_quick_wins(archive_items)
    start, end = MARKERS["QUICK_WINS"]
    pattern = re.escape(start) + r".*?" + re.escape(end)
    replacement = f"{start}\n{wins}\n{end}"
    if re.search(pattern, html, re.DOTALL):
        html = re.sub(pattern, replacement, html, flags=re.DOTALL)

    return html

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("Blakeworth Dashboard Generator")
    print("=" * 50)

    print("Authenticating with Google Sheets...")
    client = authenticate()

    print(f"Reading '{OPS_LOG_TAB}'...")
    ops_grouped = fetch_active_tasks(client)
    total = sum(sum(len(v) for v in s.values()) for s in ops_grouped.values())
    print(f"  {total} active tasks found")

    print(f"Reading '{ARCHIVE_TAB}'...")
    archive_items = fetch_archive(client, limit=9)
    print(f"  {len(archive_items)} recent completions")

    print(f"Reading '{STATUS_UPDATES_TAB}'...")
    status_overlay = fetch_status_updates(client)
    print(f"  {len(status_overlay)} status overlay entries")

    print(f"Reading template from '{TEMPLATE_HTML}'...")
    with open(TEMPLATE_HTML, "r", encoding="utf-8") as f:
        template_html = f.read()

    print("Generating index.html...")
    new_html = inject_into_template(template_html, ops_grouped, archive_items, status_overlay)

    print(f"Writing '{INDEX_HTML}'...")
    with open(INDEX_HTML, "w", encoding="utf-8") as f:
        f.write(new_html)

    print("=" * 50)
    print(f"Done! Dashboard refreshed at {datetime.now().strftime('%Y-%m-%d %H:%M')}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        traceback.print_exc()
        raise
