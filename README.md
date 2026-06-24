# 💼 Job Tracker

A job application tracking platform featuring a Kanban style Job Board dashboard, an Event Calendar, Activity logs, attachment management, and staleness notifications.

Built with a lightweight **Python Flask backend** and a high-fidelity **Vanilla HTML/CSS/JS Single Page Application (SPA)**. It runs entirely as a single process with **no build steps, no node_modules dependencies, and no complex configurations**.

---

### 🎯 Who is this for?
If you are actively applying for jobs and feeling overwhelmed by keeping track of dates, resumes, cover letters, recruiter contacts, and interview schedules in scattered notebooks or spreadsheets, this app is for you.

Use this tool to:
* **Organize applications visually**: View your applications on a clean digital board from "Applied" to "Interviewing" and "Offers".
* **Keep track of dates**: Never miss recruiter touchpoints, interview schedules, or deadlines with the built-in calendar.
* **Organize application details**: Store resumes, cover letters, and notes directly under each job entry.
* **Prepare for Interviews**: Manage company research and behavioral STAR stories in a dedicated vault.
* **Get follow-up alerts**: Automatically flag job applications that have been sitting idle for too long so you know when to follow up.

Coded with AI.

---
![Screenshot of Web App](/screenshot.png)
---

## 🚀 Key Features

* **🗂️ Kanban Job Board**:
  * **Simple Kanban Style Dashboard**: View applications categorized by status or organization.
  * **Advanced Filtering & Persistence**: Quickly sort, group, and filter by keywords, location, or status. The board saves your structural layout preferences directly to your database across sessions.
  * **Visual Accent colors**: Columns and cards dynamically match status configurations.

* **📊 Metrics Dashboard**:
  * **Live Analytics**: View an automated breakdown of your application conversion rates, active pipeline distribution, and overall progress natively inside the app.

* **✅ Actionable To-Do Checklist**:
  * **Task Management**: Dedicated action-item checklist for each job.
  * **Contextual Suggestions**: Automatically seeds new jobs with critical defaults (e.g., Customize resume, Message recruiter) and offers built-in suggestions for follow-ups (e.g., Send thank you email).

* **🧠 Interview Prep Vault**:
  * **Targeted Research**: Segmented workspaces for company research and questions to ask your interviewers.
  * **Discrete STAR Stories**: Build a personalized database of behavioral "STAR Stories" (Situation, Task, Action, Result) attached directly to the job you are prepping for.

* **📅 Interactive Split-View Calendar**:
  * **Month & Week views**: View recruiter touchpoints, interviews, and deadlines with color-coded pills.
  * **Overlapping Event Layout**: Shows side-by-side events in weekly columns with auto-truncated text.
  * **Tentative vs Confirmed Events**: Tentative events are outlined in dashed line while confirmed events have a solid outline.

* **🔔 Proactive Notifications**:
  * Audits job updates and flags opportunities that have gone inactive/stale for over 14 days (configurable).
  * Notification icon with dynamic count badge and dropdown. Allows individual dismissals, clears, snoozes, or clear-all.
  * Clear history logs to see a detailed audit path of past cleared notifications.

* **📂 Document & Timeline Logging**:
  * Note Originators distinguish between User, Contacts, or general updates.
  * Status updates automatically log transition notes (e.g. `Application status changed to Phone Screen`).
  * Attachments strictly limited to `.pdf` and `.docx`. Securely stored on disk as UUIDs and streamed dynamically.
  * Inline Note Editing directly in the update timeline feed.

* **⚙️ Administration Control Panel**:
  * **Column Manager**: Rename job status columns, change hex color codes, and shift columns up or down.
  * **Event Type Editor**: Customize event options for calendar scheduling; interview types, colors, and ordering.
  * **Parameters Configuration**: Customize calendar work hours, weekly start day, and stale job days thresholds.
  * **Visual Theme Builder**: Adapt custom color schemes, select Default Light, or Select Default Dark mode.

---

## 🛠️ Tech Stack & Directory Structure

* **Frontend**: Vanilla HTML5, Vanilla CSS3 (Custom properties, grid systems, CSS variables), Vanilla ES6 JavaScript.
* **Backend**: Python 3 (Flask, SQLite3, standard library utilities).

```text
Job Tracker/
├── db/                    # Local database files
│   └── .gitkeep
├── static/                # Single Page App frontend assets
│   ├── app.js             # State managers, REST calls, UI rendering
│   ├── index.html         # Document outline skeleton & dialogs
│   └── styles.css         # Styling system, themes, and animations
├── uploads/               # User uploaded attachment binaries
│   └── .gitkeep
├── app.py                 # Flask server, API endpoints, SQLite helpers
├── requirements.txt       # Python dependency list
├── .gitignore             # Git untracked files specification
├── run.bat                # Windows 1-click startup script
└── README.md              # Project documentation
```

---

## ⚡ Easy Setup & Run Instructions

Here is how to get the application running on your computer, even if you have no technical experience or programming tools installed.

### Step 1: Download the Files
1. Click the green **Code** button at the top of this GitHub page.
2. Select **Download ZIP**.
3. Locate the downloaded file on your computer and extract (unzip) its contents to a folder of your choice (e.g., your Desktop).

### Step 2: Install Python (The Engine)
This app requires Python to run. Installing it is very simple:
* **Windows**: Open the **Microsoft Store**, search for **Python 3.12** (or the latest version), and click **Get / Install**.
* **macOS**: Download and run the installer for the latest stable release from the official [Python website](https://www.python.org/downloads/).
* **Linux**: Install Python 3 and pip using your package manager (e.g., `sudo apt install python3 python3-pip`).

---

### Step 3: Run the Application

#### 💻 On Windows (Easiest)
1. Open your extracted folder (`Job-Tracker`).
2. Double-click the **`run.bat`** file.
3. A terminal window will open, automatically install the necessary components, and start the app. Keep this window open while using the app.

#### 🍎 On macOS / Linux (Terminal)
1. Open the **Terminal** app.
2. Navigate to the folder you extracted (e.g., `cd ~/Desktop/Job-Tracker`).
3. Run the following command to install the required library:
   ```bash
   pip install -r requirements.txt
   ```
4. Start the application:
   ```bash
   python app.py
   ```

---

### Step 4: Open Job Tracker in Your Browser
Once the app has started, open your web browser (Chrome, Edge, Safari, Firefox, etc.) and go to:
```
http://localhost:5000
```
*(You can close the app at any time by closing the terminal window).*

---

## 🛢️ Database Schema Integrity

The database is built on top of SQLite, enforcing strict foreign key constraints:
* **Organizations**: Unique company names resolved automatically.
* **Jobs**: Foreign-keyed to status columns and organizations. Deleting a job automatically cascades to delete note history, file attachments on disk, tasks, and calendar events.
* **Status Columns**: Deleting a status from settings automatically migrates affected jobs to the default status ID.

---

## 📄 License
This project is licensed under the MIT License. Feel free to copy, modify, and distribute it.
