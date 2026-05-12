# Blakeworth Dashboard — GitHub Deployment Checklist

## ✅ Files Ready to Upload

- [x] `dallas-todo-dashboard.html` — Main dashboard (production-ready)
- [x] `README.md` — GitHub repository documentation
- [x] `DASHBOARD-SETUP.md` — Advanced setup guide (optional)

## 🚀 Deployment Steps

### Step 1: Create GitHub Repository
1. Go to [github.com/new](https://github.com/new)
2. **Repository name:** `blakeworth-operations`
3. **Description:** Weekly operations dashboard for Blakeworth Management
4. **Public** (so Dallas can access via link)
5. Click "Create repository"

### Step 2: Upload Files
1. Click "Add file" → "Upload files"
2. Upload all three files:
   - `dallas-todo-dashboard.html`
   - `README.md`
   - `DASHBOARD-SETUP.md`
3. Commit with message: "Initial dashboard setup"

### Step 3: Enable GitHub Pages
1. Go to repository **Settings**
2. Scroll to **Pages** section
3. **Source:** Select "main" branch
4. **Folder:** Select "/ (root)"
5. Click **Save**
6. Wait 1-2 minutes for GitHub to deploy

### Step 4: Get Your Live URL
After GitHub Pages is enabled, you'll see:
```
Your site is published at: https://yourusername.github.io/blakeworth-operations/
```

Your dashboard URL is:
```
https://yourusername.github.io/blakeworth-operations/dallas-todo-dashboard.html
```

### Step 5: Share with Dallas
Send Dallas this link. He should:
- Bookmark it
- Check it every Monday morning
- Review items, make decisions, add notes
- All auto-saves to his browser

## 📅 Weekly Update Process (Going Forward)

**Every Monday morning:**

1. **Pull latest data from your Google Sheets tracker**
   - Wins from weekend (completed items)
   - Open items for the week
   - Status for each (Stuck, Pending, In Progress, New)

2. **Update the dashboard HTML**
   - Open `dallas-todo-dashboard.html` in a text editor
   - Find line ~440: `const data = {`
   - Update the `wins` and `openItems` objects
   - Save the file

3. **Commit & push to GitHub**
   ```bash
   git add dallas-todo-dashboard.html
   git commit -m "Weekly update - May 12, 2026"
   git push origin main
   ```
   
   Or use GitHub web interface:
   - Click on `dallas-todo-dashboard.html`
   - Click pencil icon (Edit)
   - Make changes
   - Scroll down, enter commit message
   - Click "Commit changes"

4. **Dallas sees fresh data**
   - Dashboard auto-refreshes when he opens the link
   - He reviews items
   - Makes decisions on blue-badge items
   - Adds notes if needed
   - All auto-saves

5. **You check his decisions**
   - Open the dashboard yourself anytime
   - See which items he approved/declined/held
   - Read his notes in the comment fields
   - Continue managing tasks accordingly

## 🎯 Dashboard Features Summary

**For Dallas:**
- ✨ Last week's wins (green section)
- 📋 Open items by portfolio
- 🔴 Stuck items (red text)
- 🟡 Pending items (yellow)
- 🟠 In Progress (orange)
- 🔵 New items (blue) or approval needed
- ✓/⏸/✗ Buttons for approval items only
- 💬 Comment box for any questions
- 🌙 Dark mode toggle

**For You:**
- Organized by portfolio (Guilford, Woodrow, DC, Southlight, etc.)
- Status tracking (Stuck, Pending, In Progress, New)
- Identification of Dallas approval items
- Auto-save of all decisions
- Easy weekly updates via HTML edit

## 📊 Data Structure Reference

When updating the dashboard, use this structure:

```javascript
const data = {
    wins: {
        "Portfolio Name": [
            { description: "Item 1 that was completed" },
            { description: "Item 2 that was completed" }
        ]
    },
    openItems: {
        "Portfolio Name": [
            {
                id: 1,
                description: "What needs to be done",
                status: "Pending",  // Stuck, Pending, In Progress, New
                deadline: "2026-05-20",
                assignment: "Maya/Bernard",
                isDallasApproval: false  // true only if needs Dallas approval
            },
            {
                id: 2,
                description: "Dallas needs to decide on this",
                status: "New",
                deadline: "2026-05-12",
                assignment: "Dallas approval",
                isDallasApproval: true  // Shows Yes/No/Hold buttons
            }
        ]
    }
}
```

## 🔑 Key Rules for Dallas Approval Items

**In your tracker assignment column, write:**
- `"Dallas approval"` → Shows Yes/No/Hold buttons
- `"Dallas decision"` → Shows Yes/No/Hold buttons
- `"Dallas"` → FYI only, no buttons
- `"Maya/Dallas"` → FYI, shared responsibility, no buttons

**Status matters too:**
- If `status: "In progress"` → Dallas already approved, just showing progress
- If `status: "New"` → Dallas needs to decide
- If `status: "Pending"` → Usually FYI, but could be approval pending

## 🌐 Your Live Dashboard

**Once deployed, everyone accesses via:**
```
https://yourusername.github.io/blakeworth-operations/dallas-todo-dashboard.html
```

**No login needed. No email syncing. No complex setup.**
Just open the link, review, decide, comment. Done.

## 💡 Tips & Tricks

- **Dark mode:** Click 🌙 button, preference saves automatically
- **Auto-save:** All decisions auto-save to browser (no submit button)
- **Comments:** Dallas can leave general comments at the bottom for any FYI items
- **Mobile friendly:** Works on phone, tablet, desktop
- **Weekly rhythm:** Update every Monday, Dallas reviews same day

## 🆘 Troubleshooting

| Problem | Solution |
|---------|----------|
| Dashboard won't load | Hard refresh (Ctrl+Shift+R) or check GitHub Pages is enabled |
| Data not updating | Make sure you saved the HTML file and pushed to GitHub |
| Colors look wrong | Try a different browser or hard refresh |
| Dallas's decisions disappeared | They're saved in his browser—if he clears data, they're gone. Screenshot them as backup. |

## 📞 Future Enhancements (Optional)

Once this is working smoothly, you could:
- **Automate data pulls** from Google Sheets (advanced)
- **Add email notifications** when Dallas makes decisions
- **Track decision history** over time
- **Create reports** on approval patterns

For now, the manual weekly update takes 5 minutes and keeps everything simple.

## ✨ You're All Set!

Everything is ready to go live. Once you push to GitHub:
1. GitHub Pages handles hosting (free)
2. Dallas gets a clean, simple dashboard
3. Weekly updates take 5 minutes
4. No email back-and-forth needed
5. All decisions auto-save
6. You see his feedback instantly

**Questions before pushing?** Let me know and we can adjust anything.

Otherwise: **Ready to deploy! 🚀**

---

**Created:** May 12, 2026  
**Status:** Ready for GitHub deployment  
**Version:** 1.0
