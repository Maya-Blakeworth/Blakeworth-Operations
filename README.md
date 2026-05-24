# Blakeworth Command Center

A live operations dashboard for Blakeworth Management. Dallas reviews approvals, dictates responses, and stays current on property tasks; Maya manages the queue and gets notified when Dallas acts.

**Live URL:** https://maya-blakeworth.github.io/Blakeworth-Operations/
**Repo:** https://github.com/Maya-Blakeworth/Blakeworth-Operations

---

## What it does

The dashboard pulls tasks live from Maya's *Daily To-Do Tracker* Google Sheet via a Google Apps Script web app. Tasks are grouped by status (Stuck · Dallas Decision · Dallas To-Do · In Progress · FYI Only) or by portfolio (SLP · JHU · DC). Each card has a conversation thread (SMS-style bubbles, Maya on the right, Dallas on the left), a per-status action button set (Approve · Reject · Hold Off · Done · Ping · Remind Me · Archive · Got it), and an inline message box with a dictate-into-the-box mic. Every action writes back to the sheet and emails Maya.

Hold Off tasks are filtered at the data layer and never appear on the dashboard.

## Who uses it

| Person | Role |
|---|---|
| Maya Blakeworth | Operations Manager. Owns the queue, gets every notification. |
| Dallas | Owner. Reviews, decides, dictates, dismisses. |
| Marjorie | SLP property manager. Future user once an SLP-only view ships. |

Both Maya and Dallas see the same buttons; identity is set per browser (first-visit modal, stored in localStorage) and only changes who messages are attributed to.

## The two URLs

| Use | URL | What it serves |
|---|---|---|
| Desktop / direct visit | `/Blakeworth-Operations/` | `index.html` (currently the mobile design; desktop split planned) |
| Mobile / PWA | `/Blakeworth-Operations/mobile.html` | `mobile.html` (the mobile design) |
| Pay Now button | https://maya-blakeworth.github.io/maya-timelog/ | Maya's Time Tracker / monthly invoice page |

The PWA manifest's `start_url` points to `mobile.html`, so when Dallas or Maya install the dashboard to their iPhone home screen, tapping the icon opens the mobile design directly.

## File structure

```
Blakeworth-Operations/
├── index.html              # Live dashboard. Currently the mobile design.
├── mobile.html             # Same content as index.html — canonical mobile.
├── manifest.json           # PWA manifest. start_url = mobile.html.
├── icon-32.png             # Favicon.
├── icon-180.png            # iOS home-screen icon.
├── icon-192.png            # PWA icon.
├── icon-512.png            # PWA splash icon.
├── Apps-Script-1-archive-trigger.gs   # Reference copy of the archive trigger.
├── Apps-Script-2-webapp.gs            # Reference copy of the web-app backend.
└── README.md
```

`Apps-Script-1-archive-trigger.gs` and `Apps-Script-2-webapp.gs` are kept in the repo as the source of truth for what's deployed in Google Apps Script. They don't run from the repo — they're pasted into the Apps Script editor.

## How the Google Sheet connects to the dashboard

The dashboard never reads the sheet directly. It talks to a Google Apps Script web app deployed from Maya's account, which is the ONLY thing that touches the sheet.

```
Browser (index.html / mobile.html)
     │   fetch() POST { token, actor, action, taskId, note, ... }
     ▼
Apps Script Web App  (Apps-Script-2-webapp.gs)
     │   read / write
     ▼
Daily To-Do Tracker  (Google Sheet)
     │
     ▼
Maya's inbox  (every Dallas action triggers an HTML email)
```

The web app's URL and shared token are baked into the dashboard JS as `APPS_SCRIPT_URL` and `TOKEN`. Every POST includes the token; without it the script returns an error.

## How the Apps Script triggers work

**Archive trigger** (`Apps-Script-1-archive-trigger.gs`) — bound to the spreadsheet. When the *Completed?* checkbox in column H of *Active Tasks* is ticked, the row moves to the *Archive* tab and the completion date is stamped. Recent Wins auto-pulls the last 6 completed rows from Archive.

**Web app** (`Apps-Script-2-webapp.gs`) — handles every dashboard action. Routes by `action` param:
- `getTasks` — returns Dallas-visible rows (filters out *Hold off*)
- `getWins` — returns the 6 most recent archived completions
- `approve` / `reject` / `holdoff` — set status, log to conversation thread, email Maya
- `done` — mark complete, append note, archive
- `ping` — appends a fixed "Need an update on this." bubble, emails Maya
- `addnote` — append free-form note from the message box
- `gotit` / `fyi_ack` — dismiss FYI cards
- `remind` — schedule a Google Calendar reminder
- `addtask` — create a new task from the Write modal
- `voice_memo` — send transcript to Gemini for extraction, return structured fields for review

Schema in *Active Tasks*: A Date Created · B Property · C Task/Issue · D Notes · E Category · F Deadline · G Assignment · H Completed? · I Status · J NOTES. Statuses Dallas sees: Dallas Approval · Dallas Decision · Dallas To-Do · In Progress · Stuck · FYI Only · New. *Hold off* is filtered out.

## Deploying changes

The repo is served as static GitHub Pages from `main`. Every commit to `main` triggers a Pages rebuild (1–3 min).

**For HTML / manifest / icon changes:**
1. Open the file in the repo
2. Click the three-dot menu → **Delete file** → commit
3. **Add file** → **Upload files** → drag the new version from your local `FOR-GITHUB/` folder → commit directly to `main`
4. Wait 1–2 min, hard-refresh the live URL (Ctrl + Shift + R)

The GitHub web editor (CodeMirror 6) is **not** safe for files larger than ~50 KB — don't try to paste a full `index.html` in the editor. Always delete-then-upload.

**For Apps Script changes:**
1. Open the Apps Script editor bound to the Daily To-Do Tracker
2. Ctrl + A → paste the updated `.gs` file → Ctrl + S
3. **Deploy → Manage deployments → pencil → New version → Deploy** (do **not** click "New deployment" — that creates a new URL and breaks the dashboard)

## Known issues / open questions

- **Voice memo AI extraction** is wired to Gemini but needs work: it doesn't summarize, field mapping is unreliable, assignee/property often blank. Fixes documented in `Blakeworth-VoiceMemo-AI-Spec.docx`. Do not enable for Dallas until the fixes ship.
- **Quo SMS** API key is set up but SMS notifications aren't reaching Maya. All notifications run through email for now.
- **Email notification regression** — flagged in the handoff doc; needs verification with a test action.
- **Desktop layout** — currently `index.html` serves the mobile design at the desktop URL. A dedicated desktop layout is planned.
- **Gemini API key** is currently hardcoded in `Apps-Script-2-webapp.gs`. Should be moved to Script Properties for safety.

## Project history

The dashboard went through three major phases:

1. **v1** (May 12, 2026) — simple `dallas-todo-dashboard.html` with hardcoded data and a weekly Monday-4am scheduled refresh from Google Sheets.
2. **v3** (May 22, 2026) — first deployable rebuild: portfolio tabs, identity switcher, SMS-style bubbles, 4 color themes, dark/light mode. Deployed via GitHub API in chunks.
3. **v4** (May 23–24, 2026) — full rebuild from the FINAL mock spec: Dallas Decision status, Reject + Hold Off handlers, getWins endpoint, sheet-aligned status names, Maya pink bubbles, JHU Deep Wine + SLP twitter blue + DC purple, 3-col action boxes always, status-aware button matrix. This is what's live now.

All design decisions are locked in `Blakeworth-CommandCenter-FINAL-Handoff.docx`. Deviations require Maya's written approval.

---

*Last updated: May 24, 2026 · Maya Blakeworth*
