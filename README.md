# 💼 Job Tracker

A job application tracking platform powered by python and a liteweight relational database, featuring a Kanban style Job Board dashboard, an Event Calendar, Activity logs, attachment management, and staleness notifications.

Built with a lightweight **Python Flask backend** and a high-fidelity **Vanilla HTML/CSS/JS Single Page Application (SPA)**. It runs entirely as a single process with **no build steps, no node_modules dependencies, and no complex configurations**.

Coded with AI.

---
![Screenshot of Web App](/screenshot.png)
---

## 🚀 Key Features

* **🗂️ Kanban Job Board**:
  * **Simple Kanban Style Dashboard**: View applications categorized by status or organization.
  * **Visual Accent colors**: Columns and cards dynamically match status configurations.
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
└── README.md              # Project documentation
```

---

## ⚡ Setup & Run Instructions

Follow these simple steps to run the project locally:

### 1. Prerequisites
Ensure you have Python 3.8 or higher installed on your machine.

### 2. Clone the Repository
Clone the project directory to your local environment:
```bash
git clone https://github.com/NoProfessional582/Job-Tracker
cd Job-Tracker
```

### 3. Install Dependencies
Install dependencies from `requirements.txt` (it only installs Flask):
```bash
pip install -r requirements.txt
```
*(Recommended: Use a virtual environment before running the pip install command)*
```bash
python -m venv .venv
# On Windows (Powershell)
.venv\Scripts\Activate.ps1
# On MacOS/Linux
source .venv/bin/activate
pip install -r requirements.txt
```

### 4. Run the Server
Start the Flask application process:
```bash
python app.py
```
This initializes the SQLite database schema inside the `db/` directory, populates default settings/statuses, and runs the web server.

### 5. Access the Web Application
Open your browser and navigate to:
```
http://localhost:5000
```

---

## 🛢️ Database Schema Integrity

The database is built on top of SQLite, enforcing strict foreign key constraints:
* **Organizations**: Unique company names resolved automatically.
* **Jobs**: Foreign-keyed to status columns and organizations. Deleting a job automatically cascades to delete note history, file attachments on disk, and calendar events.
* **Status Columns**: Deleting a status from settings automatically migrates affected jobs to the default status ID.

---

## 📄 License
This project is licensed under the MIT License. Feel free to copy, modify, and distribute it.
