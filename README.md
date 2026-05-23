# Blakeworth Operations Dashboard 

A weekly operations review dashboard for Blakeworth Management. Dallas reviews action items, approves decisions, and provides feedback on property management updates across all portfolios.

## 📊 Overview

This dashboard displays:
- **Last week's wins** — Completed items from the previous week
- **Open items by portfolio** — Organized by property/region
- **Status tracking** — Stuck, Pending, In Progress, New items
- **Dallas approvals** — Decision items requiring yes/no/hold responses
- **FYI updates** — Information items for awareness only

## 🚀 Quick Start

1. Open `dallas-todo-dashboard.html` in your browser
2. Review items organized by portfolio
3. For **blue-badge items**, provide your decision:
   - ✓ **Yes** — Approve
   - ⏸ **Hold** — Pause/revisit later
   - ✗ **No** — Decline
4. Add notes if needed
5. Leave final comments at the bottom if you have questions
6. All decisions auto-save to your browser

## 📁 How It Works

### Item Organization

Items are grouped by **portfolio**:
- **Guilford Apartments** — Baltimore property management
- **Woodrow Apartments (JHU)** — Johns Hopkins area portfolio
- **DC Properties** — Washington DC portfolio
- **Southlight / Lehigh** — Student rentals (Bethlehem/Lehigh)
- **Portfolio Management** — Cross-portfolio tasks

### Status Colors

Each item displays a status badge:
- 🔴 **Stuck** (Red) — Blocked/on hold, no progress this week
- 🟡 **Pending** (Yellow) — Waiting for next step, may need decision
- 🟠 **In Progress** (Orange) — Active work, moving forward
- 🔵 **New** (Blue) — Just added, needs attention

### Approval Items

Items marked with **blue badges** need your decision. Look for "Dallas approval" in the assignment.

**Examples:**
- ✓ DC $500 resident referral concession (needs your YES/NO/HOLD)

When you click Yes/No/Hold, that decision auto-saves. If you add a note, it saves too.

### Update Items (FYI)

All other items are for your awareness. No buttons—just review and understand what's happening.

**Examples:**
- Advantage Cleaning balance (already approved, awaiting PayPal link)
- Security fix at Woodrow (escalation for team meeting)
- Mailbox rekey (stuck waiting on Bernard)

If you have thoughts on any FYI item, use the **Your Comments** box at the bottom.

## 🎯 For Maya (Property Manager)

### Weekly Update Process

**Every Monday:**
1. Pull latest items from your Daily To-Do Tracker (Google Sheets)
2. Update the dashboard data (see [Data Structure](#data-structure) below)
3. Commit & push to GitHub
4. Dallas gets fresh dashboard

**Dallas reviews → You check his decisions → Continue managing tasks**

### Updating the Dashboard

The dashboard reads from a data object in the HTML file. To update:

1. Open `dallas-todo-dashboard.html` in a text editor
2. Find the line: `const data = {` (around line 440)
3. Update the `wins` and `openItems` objects with your tracker data
4. Save and commit to GitHub

**Data Structure Example:**

```javascript
const data = {
    wins: {
        "Guilford Apartments": [
            { description: "BGE billing resolved — account consolidated" }
        ]
    },
    openItems: {
        "Guilford Apartments": [
            {
                id: 1,
                description: "Ceiling tile repair — waiting on Bernard",
                status: "Stuck",
                deadline: "2026-04-23",
                assignment: "Maya/Bernard"
            },
            {
                id: 2,
                description: "Approve $500 referral concession",
                status: "Pending",
                deadline: "2026-05-12",
                assignment: "Dallas approval",
                isDallasApproval: true
            }
        ]
    }
}
```

### Status Guide

Use these statuses in your tracker:

| Status | Meaning | Example |
|--------|---------|---------|
| **Stuck** | Blocked, waiting on external party, on hold | Ceiling tile (no word from Bernard for 2 weeks) |
| **Pending** | Waiting for next step, may need decision | Dallas approval pending, quote pending from vendor |
| **In Progress** | Active work, moving forward | Leasing pipeline work, payment processing |
| **New** | Just added, needs attention | URGENT security fix, new vendor inquiry |

### Assignment Field

When adding items, use **one of these** in the assignment field for Dallas items:

- `"Dallas approval"` — Dallas needs to decide (yes/no/hold)
- `"Dallas decision"` — Dallas needs to decide (yes/no/hold)
- `"Dallas"` — Information for Dallas (FYI, no buttons)
- `"Maya/Dallas"` — Shared responsibility
- `"Maya/Bernard/Dallas"` — Multiple people involved

## 🎨 Features

### Dark Mode
Toggle dark mode in the top right (🌙 button). Your preference saves automatically.

### Auto-Save
All decisions, notes, and comments save to your browser automatically. No submit button needed.

### Responsive Design
Works on desktop, tablet, and mobile.

## 📝 Data Structure

### Complete Item Object

```javascript
{
    id: 1,                              // Unique number
    description: "What needs to be done",
    status: "Pending",                  // Stuck, Pending, In Progress, New
    deadline: "2026-05-12",             // Optional date
    assignment: "Maya/Bernard",         // Who's involved
    isDallasApproval: false,            // true only if Dallas needs to approve
    isUpdate: false                     // true if FYI update
}
```

### Wins Object

```javascript
"Portfolio Name": [
    { description: "What was completed" },
    { description: "Another win" }
]
```

## 🔧 Setup & Deployment

### For Maya (First Time Setup)

1. **Create a GitHub repository**
   - Go to [github.com/new](https://github.com/new)
   - Name it: `blakeworth-operations`
   - Add a description: "Weekly operations dashboard for Blakeworth Management"
   - Click "Create repository"

2. **Upload files**
   - Upload `dallas-todo-dashboard.html`
   - Create and upload this `README.md`

3. **Enable GitHub Pages**
   - Go to repository Settings → Pages
   - Source: main branch
   - Save

4. **Get your URL**
   - Your dashboard is now at: `https://yourusername.github.io/blakeworth-operations/dallas-todo-dashboard.html`
   - Share this link with Dallas

### For Dallas (First Time)

1. Bookmark the dashboard URL
2. Check it every Monday morning
3. Review items, make decisions, add notes
4. Done—all auto-saves

## 📊 Status Legend

**Wins Section (Top)**
- ✨ Green border, white badges
- Shows completed items from last update

**Item Cards**
- 🔴 Red text = Stuck (blocked/on hold)
- 🟡 Yellow badge = Pending
- 🟠 Orange badge = In Progress
- 🔵 Blue badge = New (or approval needed)

**Approval Buttons**
- ✓ **Yes** (green)
- ⏸ **Hold** (orange/yellow)
- ✗ **No** (red)

## 🤝 Workflow Example

**Monday Morning:**
1. Maya updates tracker with weekend wins and current open items
2. Maya updates dashboard HTML with new data
3. Maya commits & pushes to GitHub
4. Dallas opens dashboard link
5. Dallas sees: Last week's wins + This week's open items
6. Dallas approves/declines/holds on blue-badge items
7. Dallas adds comments if needed
8. Dallas's decisions auto-save
9. Maya checks dashboard to see Dallas's approvals
10. Maya continues managing based on Dallas's decisions

## ❓ FAQ

**Q: How do I see Dallas's decisions?**
A: Open the dashboard yourself and look at the blue-badge items. If Dallas has clicked Yes/No/Hold, the button will be highlighted. His notes appear in the text field.

**Q: What if Dallas's decisions disappear?**
A: They're saved in his browser. If he clears browser data or uses a new device, they're gone. As a backup, have him screenshot the decision summary or you can ask him to resend his decisions.

**Q: Can I add items throughout the week?**
A: Yes. Update the data object in the HTML file, commit & push, and the dashboard refreshes for Dallas.

**Q: How often should I update?**
A: Recommended: Monday morning with wins from the weekend and open items for the week. Optional Friday update if significant changes occur.

**Q: Can I automate this?**
A: Yes. You can set up a script to auto-pull from Google Sheets every Monday. See [DASHBOARD-SETUP.md](DASHBOARD-SETUP.md) for automation options.

## 📞 Support

If something isn't working:
1. Check that `dallas-todo-dashboard.html` is in the repo
2. Confirm GitHub Pages is enabled (Settings → Pages)
3. Try a hard refresh (Ctrl+Shift+R or Cmd+Shift+R)
4. Check that the data object is valid JSON (no syntax errors)

## 📄 Files in This Repo

- `dallas-todo-dashboard.html` — The dashboard (open this in browser)
- `README.md` — This file
- `DASHBOARD-SETUP.md` — Advanced setup and automation guide (optional)

## 🎯 Next Steps

1. **For Maya:** Update the data object with your current tracker items
2. **For Dallas:** Bookmark the dashboard link
3. **First Monday:** Maya updates, Dallas reviews, cycle begins

---

**Last Updated:** May 12, 2026  
**Dashboard Version:** 1.0  
**Status:** Active
