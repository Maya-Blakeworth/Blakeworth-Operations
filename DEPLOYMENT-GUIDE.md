# Blakeworth Dashboard — Deployment Guide

Everything you need to get the Dallas Command Center live.  
Estimated time: **30–45 minutes**, no coding required.

---

## What You're Setting Up

| Piece | What it does |
|---|---|
| **Google Apps Script Web App** | The "brain" — reads your tracker and handles Dallas's button clicks |
| **GitHub secret** | Stores the Apps Script URL so the daily refresh can call it |
| **GitHub Pages** | Hosts the live dashboard at your public URL |

---

## Step 1 — Deploy the Apps Script Web App

This script connects the dashboard to your Google Sheet.

### 1a. Open Apps Script in your Daily To-Do Tracker

1. Go to your **Daily To-Do Tracker** Google Sheet  
   (Sheet ID: `14Sm-DZzAil0AyS430d3dWWcKiiUgq3SZxZ6vUqNSL-w`)
2. Click **Extensions → Apps Script**

### 1b. Create the script file

1. In Apps Script, click the **+** next to "Files" → choose **Script**
2. Name it exactly: `Apps-Script-2-webapp` (no `.gs` needed — Apps Script adds it)
3. Delete any placeholder code in the new file
4. Open the file `Apps-Script-2-webapp.gs` from the GitHub repo  
   → Go to: `https://github.com/Maya-Blakeworth/Blakeworth-Operations/blob/main/Apps-Script-2-webapp.gs`  
   → Click **Raw**, then select all and copy
5. Paste it into the Apps Script editor
6. Press **Ctrl+S** (or Cmd+S on Mac) to save

### 1c. Fill in Dallas's email (optional but recommended)

Near the top of the file, find the `BW_CFG` block:

```javascript
DALLAS_EMAIL: '',   // ← Dallas's email — enables calendar invites to him
```

Replace `''` with Dallas's email address in quotes, e.g.:  
```javascript
DALLAS_EMAIL: 'dallas@blakeworth.com',
```

Save again after editing.

### 1d. Deploy as a Web App

1. Click **Deploy → New deployment**
2. Click the gear icon ⚙ next to "Type" → select **Web app**
3. Fill in the settings:
   - **Description**: `Blakeworth Command Center v1`
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
4. Click **Deploy**
5. Google will ask you to authorize — click **Authorize access** and follow the prompts
6. After authorization, you'll see a **Web app URL** that looks like:  
   `https://script.google.com/macros/s/AKfyc.../exec`
7. **Copy this URL** — you'll need it in Step 2 and Step 3

> ⚠️ Every time you edit the script, you must click **Deploy → Manage deployments → Edit (pencil icon) → New version → Deploy** to publish your changes.

---

## Step 2 — Add the Web App URL as a GitHub Secret

The daily Python refresh needs your Web App URL to pull live task updates.

1. Go to your GitHub repo:  
   `https://github.com/Maya-Blakeworth/Blakeworth-Operations`
2. Click **Settings** (top menu)
3. In the left sidebar, click **Secrets and variables → Actions**
4. Click **New repository secret**
5. Fill in:
   - **Name**: `APPS_SCRIPT_URL`
   - **Secret**: Paste the Web App URL you copied in Step 1d
6. Click **Add secret**

The daily GitHub Action will now use this URL automatically every morning.

---

## Step 3 — Add the Web App URL to the Dashboard HTML

The dashboard itself also needs the URL so Dallas's button clicks go to the right place.

1. In the GitHub repo, open `index.html`  
   → `https://github.com/Maya-Blakeworth/Blakeworth-Operations/blob/main/index.html`
2. Click the **pencil icon** (Edit this file)
3. Find this line near the top:
   ```javascript
   const APPS_SCRIPT_URL = '';
   ```
4. Replace it with your Web App URL:
   ```javascript
   const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_ID/exec';
   ```
5. Scroll down and click **Commit changes...**
6. Use commit message: `Add Apps Script Web App URL`
7. Click **Commit changes**

---

## Step 4 — Create the StatusUpdates Tab in Your Sheet

The daily refresh logs Dallas's actions here so the dashboard can show them.

1. Open your **Daily To-Do Tracker** Google Sheet
2. At the bottom, click the **+** to add a new sheet tab
3. Name it exactly: `StatusUpdates` (case-sensitive, no spaces)
4. Add these column headers in row 1:
   - A: `Timestamp`
   - B: `Task ID`
   - C: `Status`
   - D: `Note`
   - E: `By`

That's it — the script and Python refresh will fill in the rows automatically.

---

## Step 5 — Trigger the First Dashboard Refresh

The dashboard auto-refreshes every morning via GitHub Actions. To run it right now:

1. Go to your repo → click **Actions** (top menu)
2. Click **Daily Dashboard Refresh** in the left list
3. Click **Run workflow → Run workflow**
4. Wait ~60 seconds, then refresh your dashboard:  
   `https://maya-blakeworth.github.io/Blakeworth-Operations/`

You should see live tasks pulled from your tracker.

---

## Step 6 — Share the Dashboard with Dallas

Once everything is live, send Dallas:

```
Hi Dallas — here's your operations dashboard:
https://maya-blakeworth.github.io/Blakeworth-Operations/

It updates automatically every morning with your action items.
Use the buttons on each card to approve, add notes, or set reminders.
I'll get an email whenever you take an action.
```

No login required — the URL is all he needs.

---

## QUO SMS (Optional)

If you want text notifications when Dallas takes an action, fill in the QUO credentials in `Apps-Script-2-webapp.gs`:

```javascript
QUO_API_URL:     'https://api.quo.app/v1/messages',  // check your QUO docs
QUO_API_KEY:     'your-api-key',
QUO_FROM_NUMBER: '+1...',   // your QUO business number
QUO_TO_MAYA:     '+1...',   // your cell number
```

After editing, redeploy (Deploy → Manage deployments → Edit → New version → Deploy).

Email notifications always work even without QUO configured.

---

## Troubleshooting

**Dashboard shows "Loading tasks..." and doesn't update**  
→ Check that the GitHub Actions workflow ran successfully (Actions tab → Daily Dashboard Refresh)  
→ Make sure `APPS_SCRIPT_URL` secret is set correctly in GitHub

**Dallas clicks a button and nothing happens**  
→ Check that `APPS_SCRIPT_URL` in `index.html` matches your deployed Web App URL exactly  
→ In Apps Script: go to **Executions** to see if any errors are logged  

**"Authorization required" error in Apps Script**  
→ Open Apps Script, run any function manually (e.g., `getTasks`), and grant permissions when prompted  

**Tasks aren't showing on the dashboard**  
→ Make sure the task's Status column contains one of: `Dallas Approval`, `Dallas Decision`, `Dallas To Do`, `In Progress`, `Stuck`, or `FYI`  
→ Check that your sheet tab is named exactly `Active Tasks`

**Apps Script changes aren't taking effect**  
→ You must create a **New Version** in Deploy → Manage deployments each time you edit the script

---

## File Reference

| File | Purpose |
|---|---|
| `index.html` | The live dashboard Dallas sees |
| `scripts/generate_dashboard.py` | Pulls tasks from Apps Script and rebuilds the HTML |
| `.github/workflows/daily-refresh.yml` | Runs the Python script every morning at 7 AM ET |
| `Apps-Script-1-archive-trigger.gs` | Auto-archives completed tasks (already set up) |
| `Apps-Script-2-webapp.gs` | Powers the live API (the one you just deployed) |

---

*Last updated: May 2026*
