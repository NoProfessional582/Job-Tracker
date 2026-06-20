import os
import uuid
import sqlite3
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from flask import Flask, request, jsonify, send_from_directory, g

app = Flask(__name__, static_folder='static', static_url_path='')

DATABASE_DIR = os.path.join(os.path.dirname(__file__), 'db')
DATABASE_PATH = os.path.join(DATABASE_DIR, 'database.sqlite')
UPLOADS_DIR = os.path.join(os.path.dirname(__file__), 'uploads')

# Ensure database and uploads directories exist
os.makedirs(DATABASE_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)

# --- SQLite Connection Helpers ---
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE_PATH)
        db.row_factory = sqlite3.Row  # Access columns by name
        db.execute("PRAGMA foreign_keys = ON;")
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def db_query(query, args=(), one=False):
    cur = get_db().execute(query, args)
    rv = cur.fetchall()
    cur.close()
    return (rv[0] if rv else None) if one else rv

def db_execute(query, args=()):
    db = get_db()
    cur = db.execute(query, args)
    db.commit()
    last_id = cur.lastrowid
    cur.close()
    return last_id

# Convert sqlite Row objects to standard python dictionaries
def row_to_dict(row):
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}

def rows_to_list(rows):
    return [row_to_dict(r) for r in rows]

# --- Database Schema & Seed Initialization ---
def init_db():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    
    # 1. Create tables
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS statuses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL,
            sort_order INTEGER NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS organizations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER NOT NULL,
            status_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            posted_date TEXT,
            end_date TEXT,
            salary_range TEXT,
            other_compensation TEXT,
            description TEXT,
            required_experience TEXT,
            preferred_experience TEXT,
            target_url TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            snoozed_until DATETIME,
            remote INTEGER DEFAULT 0,
            location TEXT,
            FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY (status_id) REFERENCES statuses(id)
        );

        CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            email TEXT,
            phone TEXT,
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            contact_id INTEGER,
            originator_type TEXT CHECK(originator_type IN ('user', 'recruiter', 'other', 'none')),
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
            FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS event_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL,
            sort_order INTEGER NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS calendar_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            event_type_id INTEGER,
            start_time DATETIME NOT NULL,
            end_time DATETIME NOT NULL,
            timezone TEXT NOT NULL,
            description TEXT,
            is_tentative BOOLEAN DEFAULT 1,
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
            FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS file_attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            original_name TEXT NOT NULL,
            stored_name TEXT NOT NULL UNIQUE,
            uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS themes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            is_dark BOOLEAN NOT NULL,
            primary_color TEXT NOT NULL,
            secondary_color TEXT NOT NULL,
            background_color TEXT NOT NULL,
            card_background_color TEXT NOT NULL,
            text_color TEXT NOT NULL,
            border_color TEXT NOT NULL,
            is_custom BOOLEAN DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS acknowledged_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            last_activity_at TEXT NOT NULL,
            acknowledged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
        );
    """)

    # 1b. Schema migrations for existing databases
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(calendar_events)")
    columns = [col[1] for col in cursor.fetchall()]
    if 'event_type_id' not in columns:
        try:
            cursor.execute("ALTER TABLE calendar_events ADD COLUMN event_type_id INTEGER REFERENCES event_types(id) ON DELETE SET NULL")
            print("Migrated database: added event_type_id to calendar_events.")
        except Exception as e:
            print("Migration warning (event_type_id):", e)

    cursor.execute("PRAGMA table_info(jobs)")
    job_columns = [col[1] for col in cursor.fetchall()]
    if 'end_date' not in job_columns:
        try:
            cursor.execute("ALTER TABLE jobs ADD COLUMN end_date TEXT")
            print("Migrated database: added end_date to jobs.")
        except Exception as e:
            print("Migration warning (end_date):", e)

    if 'remote' not in job_columns:
        try:
            cursor.execute("ALTER TABLE jobs ADD COLUMN remote INTEGER DEFAULT 0")
            print("Migrated database: added remote to jobs.")
        except Exception as e:
            print("Migration warning (remote):", e)

    if 'location' not in job_columns:
        try:
            cursor.execute("ALTER TABLE jobs ADD COLUMN location TEXT")
            print("Migrated database: added location to jobs.")
        except Exception as e:
            print("Migration warning (location):", e)

    # Ensure acknowledged_notifications table exists for existing databases
    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS acknowledged_notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER NOT NULL,
                last_activity_at TEXT NOT NULL,
                acknowledged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
            )
        """)
    except Exception as e:
        print("Migration warning (acknowledged_notifications):", e)

    # 2. Seed Default Statuses
    cursor.execute("SELECT COUNT(*) FROM statuses")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO statuses (label, color, sort_order) VALUES ('Interested', '#38bdf8', 1)")
        cursor.execute("INSERT INTO statuses (label, color, sort_order) VALUES ('Applied', '#818cf8', 2)")
        cursor.execute("INSERT INTO statuses (label, color, sort_order) VALUES ('Screen', '#fb7185', 3)")
        cursor.execute("INSERT INTO statuses (label, color, sort_order) VALUES ('Interviewing', '#fbbf24', 4)")
        cursor.execute("INSERT INTO statuses (label, color, sort_order) VALUES ('Offer', '#34d399', 5)")
        print("Seeded default statuses.")

    # 2b. Seed Default Event Types
    cursor.execute("SELECT COUNT(*) FROM event_types")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO event_types (label, color, sort_order) VALUES ('Screening Call', '#a855f7', 1)")
        cursor.execute("INSERT INTO event_types (label, color, sort_order) VALUES ('Technical Interview', '#3b82f6', 2)")
        cursor.execute("INSERT INTO event_types (label, color, sort_order) VALUES ('Behavioral Interview', '#10b981', 3)")
        cursor.execute("INSERT INTO event_types (label, color, sort_order) VALUES ('Offer/Negotiation', '#f43f5e', 4)")
        cursor.execute("INSERT INTO event_types (label, color, sort_order) VALUES ('Other Event', '#6b7280', 5)")
        print("Seeded default event types.")

    # 2c. Backfill event_type_id for existing events
    cursor.execute("UPDATE calendar_events SET event_type_id = 1 WHERE event_type_id IS NULL")

    # 3. Seed Default Themes
    cursor.execute("SELECT COUNT(*) FROM themes")
    if cursor.fetchone()[0] == 0:
        cursor.execute("""
            INSERT INTO themes (name, is_dark, primary_color, secondary_color, background_color, card_background_color, text_color, border_color, is_custom)
            VALUES ('Default Dark', 1, '#6366f1', '#a855f7', '#0f172a', '#1e293b', '#f8fafc', '#334155', 0)
        """)
        cursor.execute("""
            INSERT INTO themes (name, is_dark, primary_color, secondary_color, background_color, card_background_color, text_color, border_color, is_custom)
            VALUES ('Default Light', 0, '#0078d4', '#00b7c3', '#f8fafc', '#ffffff', '#0f172a', '#e2e8f0', 0)
        """)
        print("Seeded default themes.")

    # Force update the Default Light theme with the new Windows-like colors if they are still using the old indigo/purple
    cursor.execute("""
        UPDATE themes 
        SET primary_color = '#0078d4', secondary_color = '#00b7c3' 
        WHERE name = 'Default Light' AND is_custom = 0 AND primary_color = '#4f46e5'
    """)

    # 4. Seed Default Settings
    cursor.execute("SELECT COUNT(*) FROM app_settings")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO app_settings (key, value) VALUES ('stale_threshold_days', '14')")
        cursor.execute("INSERT INTO app_settings (key, value) VALUES ('snooze_duration_days', '7')")
        cursor.execute("INSERT INTO app_settings (key, value) VALUES ('default_status_id', '1')")
        cursor.execute("INSERT INTO app_settings (key, value) VALUES ('calendar_start_hour', '7')")
        cursor.execute("INSERT INTO app_settings (key, value) VALUES ('calendar_end_hour', '19')")
        cursor.execute("INSERT INTO app_settings (key, value) VALUES ('calendar_first_day_of_week', '0')")
        cursor.execute("INSERT INTO app_settings (key, value) VALUES ('kanban_default_sort', 'last_activity')")
        cursor.execute("INSERT INTO app_settings (key, value) VALUES ('active_theme_id', '1')")
        cursor.execute("INSERT INTO app_settings (key, value) VALUES ('default_timezone', 'America/Los_Angeles')")
        print("Seeded default settings.")

    # Ensure default_timezone is set
    cursor.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_timezone', 'America/Los_Angeles')")

    # Migrate legacy timezone strings to IANA names
    legacy_tz_map = {
        'EST': 'America/New_York',
        'CST': 'America/Chicago',
        'MST': 'America/Denver',
        'PST': 'America/Los_Angeles',
        'GMT': 'Etc/GMT',
        'UTC': 'UTC'
    }
    cursor.execute("SELECT value FROM app_settings WHERE key = 'default_timezone'")
    row = cursor.fetchone()
    if row and row[0] in legacy_tz_map:
        new_tz = legacy_tz_map[row[0]]
        cursor.execute("UPDATE app_settings SET value = ? WHERE key = 'default_timezone'", (new_tz,))
        cursor.execute("UPDATE calendar_events SET timezone = ? WHERE timezone = ?", (new_tz, row[0]))

    conn.commit()
    conn.close()

# Initialize DB on load
init_db()

# --- HELPER: Get Setting ---
def get_setting_val(key, default):
    row = db_query("SELECT value FROM app_settings WHERE key = ?", (key,), one=True)
    return row['value'] if row else default

# --- TIMEZONE HELPERS ---
def convert_tz_datetime(dt_str, from_tz_name, to_tz_name):
    dt_str = dt_str.replace('T', ' ')
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            dt = datetime.strptime(dt_str, fmt)
            break
        except ValueError:
            continue
    else:
        dt = datetime.strptime(dt_str, "%Y-%m-%d")
        
    dt_from = dt.replace(tzinfo=ZoneInfo(from_tz_name))
    dt_to = dt_from.astimezone(ZoneInfo(to_tz_name))
    return dt_to.strftime("%Y-%m-%dT%H:%M:%S")

def shift_events_timezone(old_tz, new_tz):
    if old_tz == new_tz:
        return
    events = db_query("SELECT id, start_time, end_time FROM calendar_events")
    for evt in events:
        try:
            new_start = convert_tz_datetime(evt['start_time'], old_tz, new_tz)
            new_end = convert_tz_datetime(evt['end_time'], old_tz, new_tz)
            db_execute(
                """UPDATE calendar_events 
                   SET start_time = ?, end_time = ?, timezone = ?
                   WHERE id = ?""",
                (new_start, new_end, new_tz, evt['id'])
            )
        except Exception as e:
            print(f"Error shifting event {evt['id']} from {old_tz} to {new_tz}: {e}")

# --- HELPER: Audit Stale Jobs ---
def get_stale_job_list():
    threshold_days = int(get_setting_val('stale_threshold_days', '14'))
    
    # Query to calculate last activity date (maximum of job updated_at, note creation, and calendar starts)
    sql = """
        SELECT 
            j.id, 
            j.title, 
            o.name as organization_name,
            s.label as status_label,
            s.color as status_color,
            j.snoozed_until,
            COALESCE(
                MAX(
                    j.updated_at,
                    COALESCE((SELECT MAX(created_at) FROM notes WHERE job_id = j.id), '1970-01-01 00:00:00'),
                    COALESCE((SELECT MAX(start_time) FROM calendar_events WHERE job_id = j.id), '1970-01-01 00:00:00')
                ),
                j.updated_at
            ) as last_activity
        FROM jobs j
        JOIN organizations o ON j.organization_id = o.id
        JOIN statuses s ON j.status_id = s.id
        WHERE (j.snoozed_until IS NULL OR j.snoozed_until < datetime('now'))
        GROUP BY j.id
    """
    jobs = rows_to_list(db_query(sql))
    
    # Query all active acknowledgements
    acks = rows_to_list(db_query("SELECT job_id, last_activity_at FROM acknowledged_notifications"))
    ack_set = {(a['job_id'], a['last_activity_at']) for a in acks}
    
    stale_jobs = []
    now = datetime.now()
    
    for job in jobs:
        # If this stale job and activity state has been acknowledged, ignore it
        if (job['id'], job['last_activity']) in ack_set:
            continue

        # SQLite DATETIME may contain milliseconds or timezone indicators, parse cleanly
        clean_date_str = job['last_activity'].split('.')[0] # Strip decimal seconds
        try:
            last_activity_date = datetime.strptime(clean_date_str, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            try:
                last_activity_date = datetime.strptime(clean_date_str, "%Y-%m-%d")
            except ValueError:
                # Fallback to now if parsing completely fails
                last_activity_date = now

        diff = now - last_activity_date
        if diff.days > threshold_days:
            stale_jobs.append(job)
            
    return stale_jobs

# --- FRONTEND ENTRY POINT ROUTE ---
@app.route('/')
def index():
    return app.send_static_file('index.html')

# --- API ENDPOINTS ---

# 1. Settings Endpoints
@app.get('/api/settings')
def get_settings():
    rows = db_query("SELECT key, value FROM app_settings")
    return jsonify({r['key']: r['value'] for r in rows})

@app.put('/api/settings')
def update_settings():
    data = request.json
    old_tz = get_setting_val('default_timezone', 'America/Los_Angeles')
    new_tz = data.get('default_timezone')
    
    for key, val in data.items():
        db_execute(
            """INSERT INTO app_settings (key, value) VALUES (?, ?) 
               ON CONFLICT(key) DO UPDATE SET value = ?""",
            (key, str(val), str(val))
        )
        
    if new_tz and new_tz != old_tz:
        shift_events_timezone(old_tz, new_tz)
        
    return jsonify({"message": "Settings updated"})

@app.get('/api/timezones')
def get_timezones():
    from zoneinfo import available_timezones
    now = datetime.now()
    tz_list = []
    
    for tz_name in available_timezones():
        # Skip legacy links or system paths
        if tz_name.startswith(('US/', 'SystemV/', 'Etc/', 'posix/', 'right/')):
            continue
        if '/' not in tz_name and tz_name not in ('GMT', 'UTC', 'CET', 'EET', 'MET', 'WET', 'EST', 'MST', 'HST'):
            continue
            
        try:
            tz = ZoneInfo(tz_name)
            offset = now.astimezone(tz).utcoffset()
            if offset is not None:
                offset_seconds = offset.total_seconds()
                offset_hours = int(offset_seconds // 3600)
                offset_minutes = int((offset_seconds % 3600) // 60)
                sign = '+' if offset_hours >= 0 else '-'
                offset_str = f"UTC{sign}{abs(offset_hours):02d}:{abs(offset_minutes):02d}"
                label = f"({offset_str}) {tz_name.replace('_', ' ')}"
                tz_list.append({
                    "name": tz_name,
                    "offset_seconds": offset_seconds,
                    "label": label
                })
        except Exception:
            continue
            
    # Sort primarily by offset, and secondarily by name
    tz_list.sort(key=lambda x: (x['offset_seconds'], x['name']))
    return jsonify(tz_list)

# 2. Themes Endpoints
@app.get('/api/themes')
def get_themes():
    return jsonify(rows_to_list(db_query("SELECT * FROM themes")))

@app.post('/api/themes')
def create_theme():
    data = request.json
    last_id = db_execute(
        """INSERT INTO themes (name, is_dark, primary_color, secondary_color, background_color, card_background_color, text_color, border_color, is_custom)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)""",
        (data['name'], 1 if data['is_dark'] else 0, data['primary_color'], data['secondary_color'], data['background_color'], data['card_background_color'], data['text_color'], data['border_color'])
    )
    return jsonify({"id": last_id, "name": data['name']}), 201

@app.put('/api/themes/<int:id>')
def update_theme(id):
    theme = db_query("SELECT is_custom FROM themes WHERE id = ?", (id,), one=True)
    if not theme:
        return jsonify({"error": "Theme not found"}), 404
    if not theme['is_custom']:
        return jsonify({"error": "Cannot modify built-in themes"}), 403
        
    data = request.json
    db_execute(
        """UPDATE themes 
           SET name = ?, is_dark = ?, primary_color = ?, secondary_color = ?, background_color = ?, card_background_color = ?, text_color = ?, border_color = ?
           WHERE id = ?""",
        (data['name'], 1 if data['is_dark'] else 0, data['primary_color'], data['secondary_color'], data['background_color'], data['card_background_color'], data['text_color'], data['border_color'], id)
    )
    return jsonify({"message": "Theme updated"})

@app.delete('/api/themes/<int:id>')
def delete_theme(id):
    theme = db_query("SELECT is_custom FROM themes WHERE id = ?", (id,), one=True)
    if not theme:
        return jsonify({"error": "Theme not found"}), 404
    if not theme['is_custom']:
        return jsonify({"error": "Cannot delete built-in themes"}), 403
        
    active_theme = get_setting_val('active_theme_id', '1')
    if str(active_theme) == str(id):
        db_execute("INSERT INTO app_settings (key, value) VALUES ('active_theme_id', '1') ON CONFLICT(key) DO UPDATE SET value = '1'")
        
    db_execute("DELETE FROM themes WHERE id = ?", (id,))
    return jsonify({"message": "Theme deleted"})

# 3. Statuses Endpoints
@app.get('/api/statuses')
def get_statuses():
    return jsonify(rows_to_list(db_query("SELECT * FROM statuses ORDER BY sort_order ASC")))

@app.post('/api/statuses')
def create_status():
    data = request.json
    last_id = db_execute(
        "INSERT INTO statuses (label, color, sort_order) VALUES (?, ?, ?)",
        (data['label'], data['color'], data['sort_order'])
    )
    return jsonify({"id": last_id, "label": data['label']}), 201

@app.put('/api/statuses/<int:id>')
def update_status(id):
    data = request.json
    db_execute(
        "UPDATE statuses SET label = ?, color = ?, sort_order = ? WHERE id = ?",
        (data['label'], data['color'], data['sort_order'], id)
    )
    return jsonify({"message": "Status updated"})

@app.delete('/api/statuses/<int:id>')
def delete_status(id):
    default_id = int(get_setting_val('default_status_id', '1'))
    if id == default_id:
        return jsonify({"error": "Cannot delete the default status category!"}), 400
        
    db_execute("UPDATE jobs SET status_id = ? WHERE status_id = ?", (default_id, id))
    db_execute("DELETE FROM statuses WHERE id = ?", (id,))
    return jsonify({"message": "Status deleted and jobs migrated"})

@app.put('/api/statuses/reorder')
def reorder_statuses():
    orders = request.json.get('orders', [])
    for item in orders:
        db_execute("UPDATE statuses SET sort_order = ? WHERE id = ?", (item['sort_order'], item['id']))
    return jsonify({"message": "Statuses reordered"})

# 3b. Event Types Endpoints
@app.get('/api/event_types')
def get_event_types():
    return jsonify(rows_to_list(db_query("SELECT * FROM event_types ORDER BY sort_order ASC")))

@app.post('/api/event_types')
def create_event_type():
    data = request.json
    last_id = db_execute(
        "INSERT INTO event_types (label, color, sort_order) VALUES (?, ?, ?)",
        (data['label'], data['color'], data['sort_order'])
    )
    return jsonify({"id": last_id, "label": data['label']}), 201

@app.put('/api/event_types/<int:id>')
def update_event_type(id):
    data = request.json
    db_execute(
        "UPDATE event_types SET label = ?, color = ?, sort_order = ? WHERE id = ?",
        (data['label'], data['color'], data['sort_order'], id)
    )
    return jsonify({"message": "Event type updated"})

@app.delete('/api/event_types/<int:id>')
def delete_event_type(id):
    # Find a fallback event type ID
    fallback = db_query("SELECT id FROM event_types WHERE id != ? ORDER BY sort_order ASC LIMIT 1", (id,), one=True)
    fallback_id = fallback['id'] if fallback else None
    
    # Update affected calendar events
    db_execute("UPDATE calendar_events SET event_type_id = ? WHERE event_type_id = ?", (fallback_id, id))
    
    # Delete the event type
    db_execute("DELETE FROM event_types WHERE id = ?", (id,))
    return jsonify({"message": "Event type deleted"})

@app.put('/api/event_types/reorder')
def reorder_event_types():
    orders = request.json.get('orders', [])
    for item in orders:
        db_execute("UPDATE event_types SET sort_order = ? WHERE id = ?", (item['sort_order'], item['id']))
    return jsonify({"message": "Event types reordered"})

# 4. Organizations Endpoints
@app.get('/api/organizations')
def get_organizations():
    return jsonify(rows_to_list(db_query("SELECT * FROM organizations ORDER BY name ASC")))

# 5. Jobs Endpoints
@app.get('/api/jobs')
def get_jobs():
    sql = """
        SELECT 
            j.*, 
            o.name as organization_name,
            s.label as status_label,
            s.color as status_color,
            s.sort_order as status_sort_order,
            COALESCE(
                MAX(
                    j.updated_at,
                    COALESCE((SELECT MAX(created_at) FROM notes WHERE job_id = j.id), '1970-01-01 00:00:00'),
                    COALESCE((SELECT MAX(start_time) FROM calendar_events WHERE job_id = j.id), '1970-01-01 00:00:00')
                ),
                j.updated_at
            ) as last_activity
        FROM jobs j
        JOIN organizations o ON j.organization_id = o.id
        JOIN statuses s ON j.status_id = s.id
        GROUP BY j.id
    """
    return jsonify(rows_to_list(db_query(sql)))

@app.get('/api/jobs/<int:id>')
def get_job_detail(id):
    job = db_query("""
        SELECT j.*, o.name as organization_name, s.label as status_label, s.color as status_color
        FROM jobs j
        JOIN organizations o ON j.organization_id = o.id
        JOIN statuses s ON j.status_id = s.id
        WHERE j.id = ?
    """, (id,), one=True)
    
    if not job:
        return jsonify({"error": "Job not found"}), 404
        
    notes = db_query("""
        SELECT n.*, c.name as contact_name
        FROM notes n
        LEFT JOIN contacts c ON n.contact_id = c.id
        WHERE n.job_id = ?
        ORDER BY n.created_at DESC
    """, (id,))
    
    contacts = db_query("SELECT * FROM contacts WHERE job_id = ?", (id,))
    events = db_query("""
        SELECT ce.*, et.label as event_type_label, et.color as event_type_color
        FROM calendar_events ce
        LEFT JOIN event_types et ON ce.event_type_id = et.id
        WHERE ce.job_id = ?
        ORDER BY ce.start_time ASC
    """, (id,))
    files = db_query("SELECT * FROM file_attachments WHERE job_id = ? ORDER BY uploaded_at DESC", (id,))
    
    res = row_to_dict(job)
    res['notes'] = rows_to_list(notes)
    res['contacts'] = rows_to_list(contacts)
    res['calendar_events'] = rows_to_list(events)
    res['files'] = rows_to_list(files)
    
    return jsonify(res)

@app.post('/api/jobs')
def create_job():
    data = request.json
    
    posted_date = data.get('posted_date')
    end_date = data.get('end_date')
    if posted_date and end_date and end_date <= posted_date:
        return jsonify({"error": "Safety Check: The End Date (closes date) must be after the Posted Date!"}), 400
    org_input = data['organization']
    
    # Resolve Organization
    if isinstance(org_input, int):
        org_id = org_input
    else:
        org_name = org_input.strip()
        org = db_query("SELECT id FROM organizations WHERE LOWER(name) = LOWER(?)", (org_name,), one=True)
        if org:
            org_id = org['id']
        else:
            org_id = db_execute("INSERT INTO organizations (name) VALUES (?)", (org_name,))
            
    status_id = data.get('status_id')
    if not status_id:
        status_id = int(get_setting_val('default_status_id', '1'))
        
    def clean_field(val):
        if val is None:
            return "None"
        val_str = str(val).strip()
        return "None" if not val_str else val_str

    salary_range = clean_field(data.get('salary_range'))
    other_compensation = clean_field(data.get('other_compensation'))
    description = clean_field(data.get('description'))
    required_experience = clean_field(data.get('required_experience'))
    preferred_experience = clean_field(data.get('preferred_experience'))
    location = clean_field(data.get('location'))
    remote = 1 if data.get('remote') else 0

    job_id = db_execute("""
         INSERT INTO jobs (
             organization_id, status_id, title, posted_date, end_date, salary_range, 
             other_compensation, description, required_experience, preferred_experience, target_url,
             remote, location
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     """, (
         org_id, status_id, data['title'], data.get('posted_date'), data.get('end_date'), salary_range,
         other_compensation, description, required_experience, preferred_experience, data.get('target_url'),
         remote, location
     ))
    
    return jsonify({"id": job_id, "title": data['title']}), 201

@app.put('/api/jobs/<int:id>')
def update_job(id):
    data = request.json
    org_input = data.get('organization')
    
    org_id = None
    if org_input:
        if isinstance(org_input, int):
            org_id = org_input
        else:
            org_name = org_input.strip()
            org = db_query("SELECT id FROM organizations WHERE LOWER(name) = LOWER(?)", (org_name,), one=True)
            if org:
                org_id = org['id']
            else:
                org_id = db_execute("INSERT INTO organizations (name) VALUES (?)", (org_name,))

    # Update columns dynamically based on what was provided in JSON
    # Get current values to fallback if not provided
    current = db_query("SELECT * FROM jobs WHERE id = ?", (id,), one=True)
    if not current:
        return jsonify({"error": "Job not found"}), 404

    posted_date = data.get('posted_date', current['posted_date'])
    end_date = data.get('end_date', current['end_date'])
    if posted_date and end_date and end_date <= posted_date:
        return jsonify({"error": "Safety Check: The End Date (closes date) must be after the Posted Date!"}), 400

    def clean_field_update(key, current_val):
        if key not in data:
            return current_val
        val = data[key]
        if val is None:
            return "None"
        val_str = str(val).strip()
        return "None" if not val_str else val_str

    salary_range = clean_field_update('salary_range', current['salary_range'])
    other_compensation = clean_field_update('other_compensation', current['other_compensation'])
    description = clean_field_update('description', current['description'])
    required_experience = clean_field_update('required_experience', current['required_experience'])
    preferred_experience = clean_field_update('preferred_experience', current['preferred_experience'])
    location = clean_field_update('location', current['location'])
    remote = 1 if data.get('remote') else 0 if 'remote' in data else current['remote']

    db_execute("""
         UPDATE jobs 
         SET 
             organization_id = COALESCE(?, organization_id),
             status_id = COALESCE(?, status_id),
             title = COALESCE(?, title),
             posted_date = ?,
             end_date = ?,
             salary_range = ?,
             other_compensation = ?,
             description = ?,
             required_experience = ?,
             preferred_experience = ?,
             target_url = ?,
             remote = ?,
             location = ?,
             updated_at = datetime('now')
         WHERE id = ?
     """, (
         org_id, data.get('status_id'), data.get('title'), data.get('posted_date'),
         data.get('end_date'), salary_range, other_compensation,
         description, required_experience, preferred_experience,
         data.get('target_url'), remote, location, id
     ))
    return jsonify({"message": "Job updated"})

@app.delete('/api/jobs/<int:id>')
def delete_job(id):
    # Remove files from local disk
    files = db_query("SELECT stored_name FROM file_attachments WHERE job_id = ?", (id,))
    for f in files:
        file_path = os.path.join(UPLOADS_DIR, f['stored_name'])
        if os.path.exists(file_path):
            os.remove(file_path)
            
    db_execute("DELETE FROM jobs WHERE id = ?", (id,))
    return jsonify({"message": "Job and files deleted"})

@app.post('/api/jobs/<int:id>/snooze')
def snooze_job(id):
    snooze_days = int(get_setting_val('snooze_duration_days', '7'))
    # Calculate snooze date limit
    db_execute(
        "UPDATE jobs SET snoozed_until = datetime('now', '+' || ? || ' days') WHERE id = ?",
        (snooze_days, id)
    )
    return jsonify({"message": f"Alerts snoozed for {snooze_days} days"})

# 6. Contacts Endpoints
@app.post('/api/jobs/<int:id>/contacts')
def add_contact(id):
    data = request.json
    contact_id = db_execute(
        "INSERT INTO contacts (job_id, name, email, phone) VALUES (?, ?, ?, ?)",
        (id, data['name'], data.get('email'), data.get('phone'))
    )
    # Add a system note
    db_execute(
        "INSERT INTO notes (job_id, originator_type, content) VALUES (?, 'none', ?)",
        (id, f"Added contact: {data['name']} ({data.get('email') or 'No email'}, {data.get('phone') or 'No phone'})")
    )
    return jsonify({"id": contact_id}), 201

# 7. Notes Endpoints
@app.post('/api/jobs/<int:id>/notes')
def add_note(id):
    data = request.json
    note_id = db_execute(
        "INSERT INTO notes (job_id, contact_id, originator_type, content) VALUES (?, ?, ?, ?)",
        (id, data.get('contact_id'), data.get('originator_type', 'none'), data['content'])
    )
    # Touch job's updated timestamp
    db_execute("UPDATE jobs SET updated_at = datetime('now') WHERE id = ?", (id,))
    return jsonify({"id": note_id}), 201

@app.put('/api/notes/<int:note_id>')
def update_note(note_id):
    data = request.json
    db_execute(
        "UPDATE notes SET content = ?, originator_type = ?, contact_id = ? WHERE id = ?",
        (data['content'], data.get('originator_type', 'none'), data.get('contact_id'), note_id)
    )
    note = db_query("SELECT job_id FROM notes WHERE id = ?", (note_id,), one=True)
    if note:
        db_execute("UPDATE jobs SET updated_at = datetime('now') WHERE id = ?", (note['job_id'],))
    return jsonify({"message": "Note updated"})

# 8. Calendar Endpoints
@app.get('/api/calendar')
def get_calendar():
    sql = """
        SELECT 
            ce.*, 
            j.title as job_title, 
            o.name as organization_name,
            et.label as event_type_label,
            et.color as event_type_color
        FROM calendar_events ce
        JOIN jobs j ON ce.job_id = j.id
        JOIN organizations o ON j.organization_id = o.id
        LEFT JOIN event_types et ON ce.event_type_id = et.id
        ORDER BY ce.start_time ASC
    """
    return jsonify(rows_to_list(db_query(sql)))

@app.post('/api/jobs/<int:id>/calendar')
def add_calendar_event(id):
    data = request.json
    default_tz = get_setting_val('default_timezone', 'America/Los_Angeles')
    event_tz = data.get('timezone', default_tz)
    
    start_time = data['start_time']
    end_time = data['end_time']
    if event_tz != default_tz:
        try:
            start_time = convert_tz_datetime(start_time, event_tz, default_tz)
            end_time = convert_tz_datetime(end_time, event_tz, default_tz)
        except Exception as e:
            return jsonify({"error": f"Timezone conversion failed: {e}"}), 400
            
    event_id = db_execute(
        """INSERT INTO calendar_events (job_id, event_type_id, start_time, end_time, timezone, description, is_tentative)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (id, data.get('event_type_id'), start_time, end_time, default_tz, data.get('description'), 1 if data.get('is_tentative') else 0)
    )
    db_execute(
        "INSERT INTO notes (job_id, originator_type, content) VALUES (?, 'none', ?)",
        (id, f"Scheduled window: {start_time} to {end_time} ({default_tz})")
    )
    return jsonify({"id": event_id}), 201

@app.put('/api/calendar/<int:event_id>')
def update_calendar_event(event_id):
    data = request.json
    default_tz = get_setting_val('default_timezone', 'America/Los_Angeles')
    event_tz = data.get('timezone', default_tz)
    
    start_time = data['start_time']
    end_time = data['end_time']
    if event_tz != default_tz:
        try:
            start_time = convert_tz_datetime(start_time, event_tz, default_tz)
            end_time = convert_tz_datetime(end_time, event_tz, default_tz)
        except Exception as e:
            return jsonify({"error": f"Timezone conversion failed: {e}"}), 400
            
    db_execute(
        """UPDATE calendar_events 
           SET event_type_id = ?, start_time = ?, end_time = ?, timezone = ?, description = ?, is_tentative = ?
           WHERE id = ?""",
        (data.get('event_type_id'), start_time, end_time, default_tz, data.get('description'), 1 if data.get('is_tentative') else 0, event_id)
    )
    event = db_query("SELECT job_id FROM calendar_events WHERE id = ?", (event_id,), one=True)
    if event:
        db_execute("UPDATE jobs SET updated_at = datetime('now') WHERE id = ?", (event['job_id'],))
    return jsonify({"message": "Event updated"})

# 9. File Upload & Download Endpoints
@app.post('/api/jobs/<int:id>/files')
def upload_file(id):
    if 'file' not in request.files:
        return jsonify({"error": "No file part in request"}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
        
    allowed_exts = ['.pdf', '.docx']
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in allowed_exts:
        return jsonify({"error": "Only .pdf and .docx files are allowed!"}), 400
        
    # Create UUID name for local storage masking
    stored_name = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(UPLOADS_DIR, stored_name)
    file.save(file_path)
    
    db_execute(
        "INSERT INTO file_attachments (job_id, original_name, stored_name) VALUES (?, ?, ?)",
        (id, file.filename, stored_name)
    )
    
    db_execute(
        "INSERT INTO notes (job_id, originator_type, content) VALUES (?, 'none', ?)",
        (id, f"Attached file: {file.filename}")
    )
    
    return jsonify({"message": "File uploaded", "original_name": file.filename}), 201

@app.get('/api/files/download/<stored_name>')
def download_file(stored_name):
    record = db_query("SELECT original_name FROM file_attachments WHERE stored_name = ?", (stored_name,), one=True)
    if not record:
        return jsonify({"error": "Attachment record not found"}), 404
        
    file_path = os.path.join(UPLOADS_DIR, stored_name)
    if not os.path.exists(file_path):
        return jsonify({"error": "Physical file not found"}), 404
        
    # Serve file from directory, assigning stored original name during browser transit
    return send_from_directory(
        UPLOADS_DIR, 
        stored_name, 
        as_attachment=True, 
        download_name=record['original_name']
    )

# 10. Alerts Endpoint
@app.get('/api/alerts')
def get_alerts():
    return jsonify(get_stale_job_list())

@app.post('/api/alerts/acknowledge')
def acknowledge_alert():
    data = request.json
    job_id = data['job_id']
    last_activity = data['last_activity']
    
    db_execute(
        "INSERT INTO acknowledged_notifications (job_id, last_activity_at) VALUES (?, ?)",
        (job_id, last_activity)
    )
    return jsonify({"message": "Alert acknowledged"})

@app.post('/api/alerts/acknowledge_all')
def acknowledge_all_alerts():
    data = request.json
    alerts = data.get('alerts', [])
    for alert in alerts:
        db_execute(
            "INSERT INTO acknowledged_notifications (job_id, last_activity_at) VALUES (?, ?)",
            (alert['job_id'], alert['last_activity'])
        )
    return jsonify({"message": "All alerts acknowledged"})

@app.get('/api/alerts/history')
def get_alerts_history():
    sql = """
        SELECT 
            an.id,
            an.job_id,
            an.last_activity_at,
            an.acknowledged_at,
            j.title as job_title,
            o.name as organization_name
        FROM acknowledged_notifications an
        JOIN jobs j ON an.job_id = j.id
        JOIN organizations o ON j.organization_id = o.id
        ORDER BY an.acknowledged_at DESC
    """
    return jsonify(rows_to_list(db_query(sql)))

if __name__ == '__main__':
    # Running locally
    app.run(host='127.0.0.1', port=5000, debug=False)
