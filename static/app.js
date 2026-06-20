// --- Global State Variables ---
let activeTab = 'kanban'; // 'kanban', 'calendar', 'settings'
let kanbanViewMode = 'pipeline'; // 'pipeline', 'organization'
let calendarViewMode = 'month'; // 'month', 'week'
let filterStatuses = []; // Hidden status IDs
let filterLocation = '';
let filterRemoteOnly = false;
let boardSortPref = 'last_activity';
let currentCalendarDate = new Date();

let jobs = [];
let organizations = [];
let statuses = [];
let themes = [];
let settings = {};
let timezones = [];
let staleJobs = [];
let systemNotifications = []; // App-level tip/warning notices shown in the notification dropdown
let globalEvents = [];
let eventTypes = [];
let editingEventTypeId = null;
let editingEventType = { label: '', color: '' };

let selectedJobId = null;
let isEditMode = false;
let expandedDayStr = null; // Calendar month overflow day date string
let jobIdToDelete = null;

function parseAndFormatSalary(val) {
  if (!val) return '';
  const trimmed = val.trim();
  if (!trimmed) return '';

  // Helper to parse a single number string (e.g. "120k", "120,000.00", "$120", "120k+")
  function parseSingleNumber(str) {
    if (!str) return null;
    let cleanStr = str.replace(/[$\s,]/g, ''); // Remove $, commas, spaces
    cleanStr = cleanStr.replace(/\+$/, '');     // Remove trailing '+' signs (e.g. 120k+)
    
    let multiplier = 1;
    if (cleanStr.toLowerCase().endsWith('k')) {
      multiplier = 1000;
      cleanStr = cleanStr.slice(0, -1);
    }
    const parsed = parseFloat(cleanStr);
    return isNaN(parsed) ? null : Math.round(parsed * multiplier);
  }

  // Split input string on range separators: "-", "to", "until", "through", "and"
  const parts = trimmed.split(/\s+(?:to|until|through|and|-)\s+|\s*-\s*/i);

  if (parts.length === 2) {
    const num1 = parseSingleNumber(parts[0]);
    const num2 = parseSingleNumber(parts[1]);
    if (num1 !== null && num2 !== null) {
      return `$${num1.toLocaleString()} - $${num2.toLocaleString()}`;
    }
  } else if (parts.length === 1) {
    // Check if the single string itself contains a hyphen without surrounding spaces (e.g. "120k-150k")
    const subParts = trimmed.split('-');
    if (subParts.length === 2) {
      const num1 = parseSingleNumber(subParts[0]);
      const num2 = parseSingleNumber(subParts[1]);
      if (num1 !== null && num2 !== null) {
        return `$${num1.toLocaleString()} - $${num2.toLocaleString()}`;
      }
    }

    // Try parsing as a single number
    const num = parseSingleNumber(trimmed);
    if (num !== null) {
      return `$${num.toLocaleString()}`;
    }
  }

  // Fallback to original input text if it's non-numeric (e.g. "Competitive", "DOE")
  return trimmed;
}

// Format date string (YYYY-MM-DD) locally to prevent timezone shift issues
function formatLocalDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    // Note: months are 0-indexed in Date constructor
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Parse naive datetime string into a local Date representing that wall-clock time
function parseTzNaive(dtStr) {
  if (!dtStr) return new Date();
  const parts = dtStr.replace('T', ' ').split(' ');
  const dateParts = parts[0].split('-');
  const timeParts = parts[1] ? parts[1].split(':') : [0, 0, 0];
  
  return new Date(
    parseInt(dateParts[0], 10),
    parseInt(dateParts[1], 10) - 1,
    parseInt(dateParts[2], 10),
    parseInt(timeParts[0] || 0, 10),
    parseInt(timeParts[1] || 0, 10),
    parseInt(timeParts[2] || 0, 10)
  );
}

// Get Date representing now in the user's default timezone
function getNowInDefaultTz() {
  const defaultTz = settings.default_timezone || 'America/Los_Angeles';
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: defaultTz,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(new Date());
    const partVal = (type) => parts.find(p => p.type === type).value;
    return new Date(
      parseInt(partVal('year'), 10),
      parseInt(partVal('month'), 10) - 1,
      parseInt(partVal('day'), 10),
      parseInt(partVal('hour'), 10),
      parseInt(partVal('minute'), 10),
      parseInt(partVal('second'), 10)
    );
  } catch (err) {
    console.error('Failed to get formatted date for timezone:', defaultTz, err);
    return new Date();
  }
}

// Format event datetime using parseTzNaive
function formatEventDateTime(dtStr) {
  const d = parseTzNaive(dtStr);
  const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${dateStr} at ${timeStr}`;
}

// --- Themed Toast & Confirm Dialog Helpers ---

/**
 * Show a non-blocking themed toast notification.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} duration  ms before auto-dismiss (0 = permanent)
 */
function showToast(message, type = 'info', duration = 4500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const colors = {
    success: { bg: 'rgba(16,185,129,0.15)', border: '#10b981', text: '#6ee7b7' },
    error:   { bg: 'rgba(239,68,68,0.15)',  border: '#ef4444', text: '#fca5a5' },
    warning: { bg: 'rgba(251,191,36,0.15)', border: '#fbbf24', text: '#fde68a' },
    info:    { bg: 'rgba(99,102,241,0.15)', border: '#6366f1', text: '#c7d2fe' }
  };
  const c = colors[type] || colors.info;

  const toast = document.createElement('div');
  toast.style.cssText = `
    display: flex; align-items: flex-start; gap: 10px;
    background: ${c.bg}; border: 1px solid ${c.border}; color: ${c.text};
    backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    border-radius: 10px; padding: 12px 16px; max-width: 340px; min-width: 240px;
    font-family: var(--font-body); font-size: 13px; line-height: 1.5;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    pointer-events: all; cursor: pointer;
    opacity: 0; transform: translateY(8px);
    transition: opacity 0.25s ease, transform 0.25s ease;
  `;
  toast.innerHTML = `<span style="font-size:16px;flex-shrink:0;margin-top:1px">${icons[type]}</span><span style="flex:1">${escapeHTML(message)}</span><span style="margin-left:8px;opacity:0.6;font-size:16px;line-height:1;flex-shrink:0">×</span>`;
  toast.onclick = () => dismissToast(toast);
  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  if (duration > 0) {
    setTimeout(() => dismissToast(toast), duration);
  }
}

function dismissToast(toast) {
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(8px)';
  setTimeout(() => toast.remove(), 280);
}

/**
 * Show a themed confirmation dialog. Returns a Promise<boolean>.
 * @param {string} title
 * @param {string} body
 * @param {string} confirmText
 * @param {boolean} isDanger   - red confirm button (default true)
 */
function showConfirmDialog(title, body, confirmText = 'Confirm', isDanger = true) {
  return new Promise((resolve) => {
    const modal    = document.getElementById('app-confirm-modal');
    const titleEl  = document.getElementById('app-confirm-title');
    const bodyEl   = document.getElementById('app-confirm-body');
    const okBtn    = document.getElementById('app-confirm-ok');
    const cancelBtn = document.getElementById('app-confirm-cancel');

    titleEl.innerHTML = escapeHTML(title);
    titleEl.style.color = isDanger ? '#f87171' : 'var(--theme-primary)';
    bodyEl.textContent = body;
    okBtn.textContent  = confirmText;
    okBtn.className    = `btn ${isDanger ? 'btn-danger' : 'btn-primary'}`;

    modal.classList.add('active');

    const cleanup = (result) => {
      modal.classList.remove('active');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    };
    const onOk     = () => cleanup(true);
    const onCancel = () => cleanup(false);

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// --- Core API Helpers ---
async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Server error');
    }
    return await res.json();
  } catch (error) {
    console.error(`API Fetch Error (${url}):`, error);
    throw error;
  }
}

// Fetch all dashboard data concurrently
async function fetchDashboardData() {
  try {
    const [statusesData, orgsData, jobsData, themesData, settingsData, alertsData, eventTypesData, timezonesData] = await Promise.all([
      apiFetch('/api/statuses'),
      apiFetch('/api/organizations'),
      apiFetch('/api/jobs'),
      apiFetch('/api/themes'),
      apiFetch('/api/settings'),
      apiFetch('/api/alerts'),
      apiFetch('/api/event_types'),
      apiFetch('/api/timezones')
    ]);

    statuses = statusesData;
    organizations = orgsData;
    jobs = jobsData;
    themes = themesData;
    settings = settingsData;
    staleJobs = alertsData;
    eventTypes = eventTypesData;
    timezones = timezonesData;

    const boardSortSelect = document.getElementById('board-sort-select');
    if (boardSortSelect && !boardSortSelect.dataset.userChanged) {
      boardSortPref = settings.kanban_default_sort || 'last_activity';
      boardSortSelect.value = boardSortPref;
    }

    applyActiveTheme();
    renderAlertsBanner();
    applyUserName(settings.user_name || '');
    refreshUI();
  } catch (err) {
    console.error('Failed to load dashboard data:', err);
  }
}

/**
 * Updates the browser tab title, sidebar brand, and (when on the Job Board)
 * the main page h1 to reflect the stored user name.
 * If name is empty, resets to generic defaults and shows a one-time nudge toast
 * AND injects a persistent notice into the notifications dropdown.
 */
const NAME_NUDGE_ID = 'sys-name-nudge';
let _userNameNudgeSent = false;
function applyUserName(name) {
  const trimmed = (name || '').trim();
  const brandEl = document.getElementById('brand-title');
  const titleEl = document.getElementById('view-title');

  if (trimmed) {
    const possessive = `${trimmed}'s`;
    document.title = `${possessive} Job Tracker`;
    if (brandEl) brandEl.textContent = `${possessive} Job Tracker`;
    // Only update the h1 when currently showing the Job Board panel
    if (titleEl && document.getElementById('panel-kanban')?.classList.contains('active')) {
      titleEl.textContent = `${possessive} Job Board`;
    }
    // Remove the nudge notice if the name is now set
    systemNotifications = systemNotifications.filter(n => n.id !== NAME_NUDGE_ID);
    renderNotifications();
  } else {
    document.title = 'Job Tracker';
    if (brandEl) brandEl.textContent = 'Job Tracker';
    if (titleEl && document.getElementById('panel-kanban')?.classList.contains('active')) {
      titleEl.textContent = 'Job Board';
    }
    // Add the nudge notice to the notification dropdown (only once)
    const alreadyQueued = systemNotifications.some(n => n.id === NAME_NUDGE_ID);
    if (!alreadyQueued) {
      systemNotifications.push({
        id: NAME_NUDGE_ID,
        icon: '💡',
        title: 'Personalise your app',
        body: 'Enter your name in Settings to customise the app title and board headings.',
        actionLabel: 'Go to Settings',
        actionFn: `goToSettingsFromNotification('${NAME_NUDGE_ID}')`
      });
    }
    renderNotifications();
    if (!_userNameNudgeSent) {
      _userNameNudgeSent = true;
      setTimeout(() => showToast('💡 Tip: Enter your name in Settings to personalise the app title!', 'info', 7000), 1200);
    }
  }
}

// Apply theme variables dynamically to the document root
function applyActiveTheme() {
  if (themes.length > 0 && settings.active_theme_id) {
    const theme = themes.find(t => String(t.id) === String(settings.active_theme_id));
    if (theme) {
      const root = document.documentElement;
      root.style.setProperty('--theme-primary', theme.primary_color);
      root.style.setProperty('--theme-secondary', theme.secondary_color);
      root.style.setProperty('--theme-background', theme.background_color);
      root.style.setProperty('--theme-card-bg', theme.is_dark 
        ? 'rgba(30, 41, 59, 0.7)' 
        : 'rgba(255, 255, 255, 0.75)'
      );
      root.style.setProperty('--theme-text', theme.text_color);
      root.style.setProperty('--theme-text-muted', theme.is_dark ? '#94a3b8' : '#64748b');
      root.style.setProperty('--theme-border', theme.border_color);
      root.style.setProperty('--theme-shadow', theme.is_dark 
        ? 'rgba(0, 0, 0, 0.5)' 
        : 'rgba(99, 102, 241, 0.08)'
      );
      root.style.setProperty('--theme-glass-bg', theme.is_dark
        ? 'rgba(15, 23, 42, 0.45)'
        : 'rgba(248, 250, 252, 0.45)'
      );
      root.style.setProperty('--card-border-hover', theme.primary_color);
      root.style.setProperty('--theme-calendar-invert', theme.is_dark ? '1' : '0');
      document.documentElement.style.colorScheme = theme.is_dark ? 'dark' : 'light';
      document.documentElement.classList.toggle('dark-mode', !!theme.is_dark);
    }
  }
}

// Render Notifications Badge & Dropdown List
function renderNotifications() {
  const badge = document.getElementById('notification-badge');
  const list = document.getElementById('notification-list');
  
  if (!badge || !list) return;

  const totalCount = staleJobs.length + systemNotifications.length;

  if (totalCount > 0) {
    badge.textContent = totalCount;
    badge.style.display = 'flex';

    // System notices rendered first, styled differently
    const sysHTML = systemNotifications.map(sn => `
      <div class="notification-item" id="sys-noti-${sn.id}" style="border-left: 3px solid var(--theme-primary); background: rgba(99,102,241,0.06);">
        <div class="notification-item-text">
          <strong style="color: var(--theme-primary);">${escapeHTML(sn.icon || '💡')} ${escapeHTML(sn.title)}</strong>
          <div style="font-size: 11px; color: var(--theme-text-muted); margin-top: 3px; line-height: 1.4;">${escapeHTML(sn.body)}</div>
        </div>
        <div class="notification-item-actions">
          ${sn.actionLabel ? `<button class="btn btn-primary btn-sm" style="padding: 2px 8px; font-size: 10px; line-height: 1;" onclick="${sn.actionFn}">${escapeHTML(sn.actionLabel)}</button>` : ''}
          <button class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 10px; line-height: 1;" onclick="dismissSystemNotification('${sn.id}')">Dismiss</button>
        </div>
      </div>
    `).join('');

    const staleHTML = staleJobs.map(sj => `
      <div class="notification-item" id="noti-item-${sj.id}">
        <div class="notification-item-text">
          <strong>${escapeHTML(sj.organization_name)}</strong> &mdash; ${escapeHTML(sj.title)}
          <div style="font-size: 10px; color: var(--theme-text-muted); margin-top: 2px;">Inactive for >${settings.stale_threshold_days || '14'} days</div>
        </div>
        <div class="notification-item-actions">
          <button class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 10px; line-height: 1;" onclick="openJobDetailModal(${sj.id})">Details</button>
          <button class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 10px; line-height: 1;" onclick="snoozeAlertFromNotifications(${sj.id})">Snooze</button>
          <button class="btn btn-primary btn-sm" style="padding: 2px 6px; font-size: 10px; line-height: 1;" onclick="acknowledgeAlertFromNotifications(${sj.id}, '${sj.last_activity}')">Clear</button>
        </div>
      </div>
    `).join('');

    list.innerHTML = sysHTML + staleHTML;
  } else {
    badge.style.display = 'none';
    list.innerHTML = `
      <div style="padding: 24px 16px; text-align: center; color: var(--theme-text-muted); font-size: 12px;">
        No active alerts. All caught up! 🎉
      </div>
    `;
  }
}

// Dismiss a system-level notification by id
window.dismissSystemNotification = (id) => {
  systemNotifications = systemNotifications.filter(n => n.id !== id);
  renderNotifications();
};

// Navigate to Settings panel and dismiss the notice
window.goToSettingsFromNotification = (id) => {
  dismissSystemNotification(id);
  document.getElementById('nav-settings')?.click();
};

// Backwards compatibility alias for dashboard swaps
function renderAlertsBanner() {
  renderNotifications();
}

// Individual alert handlers
window.snoozeAlertFromNotifications = async (jobId) => {
  try {
    await apiFetch(`/api/jobs/${jobId}/snooze`, { method: 'POST' });
    await fetchDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.acknowledgeAlertFromNotifications = async (jobId, lastActivity) => {
  try {
    await apiFetch('/api/alerts/acknowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, last_activity: lastActivity })
    });
    await fetchDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// Bulk clear active alerts
window.acknowledgeAllNotifications = async () => {
  if (staleJobs.length === 0) return;
  const alertsPayload = staleJobs.map(sj => ({
    job_id: sj.id,
    last_activity: sj.last_activity
  }));
  
  try {
    await apiFetch('/api/alerts/acknowledge_all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alerts: alertsPayload })
    });
    await fetchDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// History Log Modal Controllers
window.openNotificationHistoryModal = async () => {
  const modal = document.getElementById('notification-history-modal');
  const list = document.getElementById('notification-history-list');
  if (!modal || !list) return;

  list.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--theme-text-muted);">Loading history...</div>';
  modal.classList.add('active');
  
  try {
    const history = await apiFetch('/api/alerts/history');
    if (history.length === 0) {
      list.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--theme-text-muted); font-size: 13px;">No notification history recorded yet.</div>';
    } else {
      list.innerHTML = history.map(h => {
        const ackDate = new Date(h.acknowledged_at).toLocaleString();
        return `
          <div style="background: rgba(0,0,0,0.1); padding: 12px 16px; border-radius: var(--radius-sm); border: 1px solid var(--theme-border); display: flex; flex-direction: column; gap: 4px; text-align: left;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px;">
              <strong style="font-size: 13px; color: var(--theme-primary);">${escapeHTML(h.organization_name)}</strong>
              <span style="font-size: 11px; color: var(--theme-text-muted);">${ackDate}</span>
            </div>
            <div style="font-size: 12px; color: var(--theme-text);">
              Stale alert cleared for <strong>${escapeHTML(h.job_title)}</strong>
            </div>
            <div style="font-size: 10px; color: var(--theme-text-muted);">
              Activity state date: ${new Date(h.last_activity_at).toLocaleDateString()}
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    list.innerHTML = `<div style="text-align: center; padding: 24px; color: #f43f5e;">Error: ${err.message}</div>`;
  }
};

window.closeNotificationHistoryModal = () => {
  const modal = document.getElementById('notification-history-modal');
  if (modal) modal.classList.remove('active');
};

// --- App Shell Tab Swapping ---
const tabs = [
  { id: 'kanban', navId: 'nav-kanban', panelId: 'panel-kanban' },
  { id: 'calendar', navId: 'nav-calendar', panelId: 'panel-calendar' },
  { id: 'settings', navId: 'nav-settings', panelId: 'panel-settings' }
];

tabs.forEach(tab => {
  document.getElementById(tab.navId).addEventListener('click', () => {
    activeTab = tab.id;
    
    // Toggle active classes
    tabs.forEach(t => {
      document.getElementById(t.navId).classList.toggle('active', t.id === tab.id);
      document.getElementById(t.panelId).classList.toggle('active', t.id === tab.id);
    });

    // Update Header titles
    const title = document.getElementById('view-title');
    const subtitle = document.getElementById('view-subtitle');
    const btnAdd = document.getElementById('btn-add-job-trigger');

    if (activeTab === 'kanban') {
      const userName = (settings.user_name || '').trim();
      title.textContent = userName ? `${userName}'s Job Board` : 'Job Board';
      subtitle.textContent = 'Manage your job search pipeline';
      btnAdd.style.display = 'inline-flex';
    } else if (activeTab === 'calendar') {
      title.textContent = 'Events Calendar';
      subtitle.textContent = 'Plan and track hiring related events';
      btnAdd.style.display = 'none';
    } else if (activeTab === 'settings') {
      title.textContent = 'Admin & Settings';
      subtitle.textContent = 'Customize theme appearance, statuses, and options';
      btnAdd.style.display = 'none';
    }

    renderAlertsBanner();
    refreshUI();
  });
});

// Brand click home button navigation redirect
const brandElement = document.querySelector('.brand');
if (brandElement) {
  brandElement.addEventListener('click', () => {
    const kanbanNavBtn = document.getElementById('nav-kanban');
    if (kanbanNavBtn) {
      kanbanNavBtn.click();
    }
  });
}

// Refresh view details
function refreshUI() {
  if (activeTab === 'kanban') {
    renderKanbanFilters();
    renderKanbanBoard();
  } else if (activeTab === 'calendar') {
    renderCalendar();
  } else if (activeTab === 'settings') {
    renderSettings();
  }
}

// --- 1. Kanban Board Views Renderer ---
function renderKanbanFilters() {
  const container = document.getElementById('filter-checkboxes-container');
  container.innerHTML = '';

  statuses.forEach(st => {
    const isHidden = filterStatuses.includes(st.id);
    const label = document.createElement('label');
    label.className = 'filter-checkbox';
    label.style.opacity = isHidden ? '0.5' : '1';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = !isHidden;
    check.style.width = 'auto';
    check.style.marginRight = '4px';
    check.style.cursor = 'pointer';
    check.onchange = () => {
      if (isHidden) {
        filterStatuses = filterStatuses.filter(id => id !== st.id);
      } else {
        filterStatuses.push(st.id);
      }
      renderKanbanFilters();
      renderKanbanBoard();
    };

    const dot = document.createElement('span');
    dot.style.display = 'inline-block';
    dot.style.width = '8px';
    dot.style.height = '8px';
    dot.style.borderRadius = '50%';
    dot.style.backgroundColor = st.color;
    dot.style.marginRight = '6px';

    const text = document.createTextNode(st.label);

    label.appendChild(check);
    label.appendChild(dot);
    label.appendChild(text);
    container.appendChild(label);
  });
}

function getSortedJobs(jobList) {
  const sortPref = boardSortPref;
  return [...jobList].sort((a, b) => {
    if (sortPref === 'last_activity') {
      return new Date(b.last_activity) - new Date(a.last_activity);
    } else if (sortPref === 'date_added') {
      return new Date(b.created_at) - new Date(a.created_at);
    } else if (sortPref === 'salary') {
      const valA = parseInt(a.salary_range ? a.salary_range.replace(/[^0-9]/g, '') : '0', 10);
      const valB = parseInt(b.salary_range ? b.salary_range.replace(/[^0-9]/g, '') : '0', 10);
      return valB - valA;
    } else if (sortPref === 'location') {
      const locA = (a.location && a.location.trim() !== '' && a.location !== 'None') ? a.location.toLowerCase() : 'zzz';
      const locB = (b.location && b.location.trim() !== '' && b.location !== 'None') ? b.location.toLowerCase() : 'zzz';
      return locA.localeCompare(locB);
    } else if (sortPref === 'remote_first') {
      if (a.remote !== b.remote) {
        return (b.remote || 0) - (a.remote || 0);
      }
      return new Date(b.last_activity) - new Date(a.last_activity);
    }
    return 0;
  });
}

function renderJobCardHTML(job) {
  const isStale = staleJobs.some(sj => sj.id === job.id);
  const hasSalary = job.salary_range && job.salary_range.trim() !== '';
  const postDate = job.posted_date ? formatLocalDate(job.posted_date) : 'Unknown';
  const endDate = job.end_date ? formatLocalDate(job.end_date) : null;
  const actDate = new Date(job.last_activity).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  return `
    <div class="job-card" onclick="openJobDetailModal(${job.id})" style="--card-border-hover: ${job.status_color}">
      <div class="job-card-accent" style="background-color: ${job.status_color}"></div>
      
      ${isStale ? `
        <div class="badge-stale" style="display: inline-flex; align-items: center; gap: 4px; width: fit-content; margin-bottom: 4px;">
          <span>⚠️</span>
          <span>STALE - Inactive</span>
        </div>
      ` : ''}

      <div class="job-card-title">${escapeHTML(job.title)}</div>
      <div class="job-card-org">${escapeHTML(job.organization_name)}</div>
      
      ${(job.remote || (job.location && job.location.trim() !== '' && job.location !== 'None')) ? `
        <div class="job-card-org" style="font-size: 11px; color: var(--theme-text-muted); margin-top: 2px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          ${job.remote ? `<span style="background: rgba(99, 102, 241, 0.2); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.4); padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;">☁️ Remote</span>` : ''}
          ${(job.location && job.location.trim() !== '' && job.location !== 'None') ? `<span>📍 ${escapeHTML(job.location)}</span>` : ''}
        </div>
      ` : ''}
      
      ${hasSalary ? `
        <div class="job-card-org" style="font-size: 12px; color: var(--theme-text-muted); margin-top: 2px;">
          <span style="color: #10b981; margin-right: 4px;">💵</span>
          <span>${escapeHTML(job.salary_range)}</span>
        </div>
      ` : ''}

      ${endDate ? `
        <div class="job-card-org" style="font-size: 11px; color: #fb7185; margin-top: 2px;">
          <span style="margin-right: 4px;">⏳</span>
          <span>Closes: ${endDate}</span>
        </div>
      ` : ''}

      <div class="job-card-footer">
        ${(job.requisition_id && job.requisition_id !== 'None') ? `
          <div style="display: flex; align-items: center; gap: 4px;">
            <span>🆔</span>
            <span>Req ID: ${escapeHTML(job.requisition_id)}</span>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function renderKanbanBoard() {
  const container = document.getElementById('kanban-container');
  container.innerHTML = '';

  let visibleJobs = jobs.filter(job => !filterStatuses.includes(job.status_id));

  // Filter by Remote
  if (filterRemoteOnly) {
    visibleJobs = visibleJobs.filter(job => job.remote === 1);
  }

  // Filter by Location
  if (filterLocation) {
    visibleJobs = visibleJobs.filter(job => job.location && job.location.toLowerCase().includes(filterLocation));
  }

  if (kanbanViewMode === 'pipeline') {
    // 1. Pipeline Status Columns
    statuses.forEach(status => {
      const colJobs = visibleJobs.filter(j => j.status_id === status.id);
      const sortedJobs = getSortedJobs(colJobs);

      const colDiv = document.createElement('div');
      colDiv.className = 'kanban-column';
      
      let cardsHTML = sortedJobs.map(job => renderJobCardHTML(job)).join('');
      if (sortedJobs.length === 0) {
        cardsHTML = `
          <div style="color: var(--theme-text-muted); font-size: 12px; text-align: center; padding: 24px 0; border: 1px dashed var(--theme-border); border-radius: var(--radius-md);">
            No applications
          </div>
        `;
      }

      colDiv.innerHTML = `
        <div class="column-header">
          <div class="column-title">
            <span class="column-dot" style="background-color: ${status.color}"></span>
            <span>${status.label}</span>
          </div>
          <span class="column-count">${colJobs.length}</span>
        </div>
        <div class="card-list">
          ${cardsHTML}
        </div>
      `;
      container.appendChild(colDiv);
    });
  } else {
    // 2. Organization grouped Columns
    const companies = [...new Set(visibleJobs.map(j => j.organization_name))].sort();

    if (companies.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 48px; color: var(--theme-text-muted); width: 100%;">
          No jobs or companies found. Add an application first!
        </div>
      `;
      return;
    }

    companies.forEach(company => {
      const colJobs = visibleJobs.filter(j => j.organization_name === company);
      // Sort inside company columns by status hierarchy order value
      const sortedJobs = [...colJobs].sort((a, b) => {
        if (a.status_sort_order !== b.status_sort_order) {
          return a.status_sort_order - b.status_sort_order;
        }
        return new Date(b.last_activity) - new Date(a.last_activity);
      });

      const colDiv = document.createElement('div');
      colDiv.className = 'kanban-column';

      const cardsHTML = sortedJobs.map(job => renderJobCardHTML(job)).join('');

      colDiv.innerHTML = `
        <div class="column-header">
          <div class="column-title">
            <span style="margin-right: 4px; color: var(--theme-primary)">🏢</span>
            <span>${escapeHTML(company)}</span>
          </div>
          <span class="column-count">${colJobs.length}</span>
        </div>
        <div class="card-list">
          ${cardsHTML}
        </div>
      `;
      container.appendChild(colDiv);
    });
  }
}

// Bind Kanban Controls
document.getElementById('btn-view-pipeline').addEventListener('click', () => {
  kanbanViewMode = 'pipeline';
  document.getElementById('btn-view-pipeline').classList.add('active');
  document.getElementById('btn-view-org').classList.remove('active');
  renderKanbanBoard();
});

document.getElementById('btn-view-org').addEventListener('click', () => {
  kanbanViewMode = 'organization';
  document.getElementById('btn-view-pipeline').classList.remove('active');
  document.getElementById('btn-view-org').classList.add('active');
  renderKanbanBoard();
});


// --- 2. Calendar Module Views Renderer ---
function getMonthDaysGrid(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const firstDaySetting = parseInt(settings.calendar_first_day_of_week || '0', 10);
  const startOffset = (firstDay - firstDaySetting + 7) % 7;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells = [];
  
  // Prev month filler
  for (let i = startOffset - 1; i >= 0; i--) {
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    cells.push({
      date: new Date(prevYear, prevMonth, daysInPrevMonth - i),
      isCurrentMonth: false,
      num: daysInPrevMonth - i
    });
  }

  // Current month
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({
      date: new Date(year, month, i),
      isCurrentMonth: true,
      num: i
    });
  }

  // Next month filler
  const remaining = 42 - cells.length;
  for (let i = 1; i <= remaining; i++) {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    cells.push({
      date: new Date(nextYear, nextMonth, i),
      isCurrentMonth: false,
      num: i
    });
  }

  return cells;
}

// Inquire resolved inside calendar
window.triggerCalendarJobInquire = (jobId) => {
  openJobDetailModal(jobId);
  setTimeout(() => {
    // Select originator and fill note content
    const select = document.getElementById('note-originator-select');
    if (select) select.value = 'user';
    
    const textarea = document.getElementById('note-content-input');
    if (textarea) {
      textarea.value = 'Sent follow-up email to recruiter inquiring about status.';
      textarea.focus();
    }
  }, 300);
};

// Render Month Grid
async function renderMonthGrid() {
  const root = document.getElementById('calendar-grid-root');
  
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  
  const cells = getMonthDaysGrid(year, month);
  const firstDaySetting = parseInt(settings.calendar_first_day_of_week || '0', 10);
  
  const weekdays = firstDaySetting === 0 
    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const todayStr = getNowInDefaultTz().toDateString();

  // Fetch calendar events list
  let calEvents = [];
  try {
    calEvents = await apiFetch('/api/calendar');
    globalEvents = calEvents;
  } catch (err) {
    console.error(err);
  }

  let html = `
    <div class="month-view-wrapper">
      <div class="month-grid">
        ${weekdays.map(day => `<div class="day-header">${day}</div>`).join('')}
      </div>
      <div class="month-grid">
  `;

  cells.forEach((cell, idx) => {
    const cellDateStr = cell.date.toDateString();
    const isToday = cellDateStr === todayStr;
    const dayEvents = calEvents.filter(e => parseTzNaive(e.start_time).toDateString() === cellDateStr);

    const maxVisible = 3;
    const visibleEvents = dayEvents.slice(0, maxVisible);
    const overflowCount = dayEvents.length - maxVisible;

    html += `
      <div class="day-box ${!cell.isCurrentMonth ? 'outside' : ''} ${isToday ? 'today' : ''}" style="position: relative;">
        <div class="day-number">${cell.num}</div>
        <div style="display: flex; flex-direction: column; gap: 2px; margin-top: 4px; overflow: hidden;">
          ${visibleEvents.map(evt => {
            const time = parseTzNaive(evt.start_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
            const color = evt.event_type_color || 'var(--theme-primary)';
            const tooltip = `Org: ${evt.organization_name}\nJob: ${evt.job_title}\nType: ${evt.event_type_label || 'Event'}\nDesc: ${evt.description || ''}`;
            return `
              <div 
                class="event-pill ${evt.is_tentative ? 'tentative' : ''}"
                style="background-color: ${color}"
                onclick="openJobDetailModal(${evt.job_id})"
                title="${escapeHTML(tooltip)}"
              >
                ${time} ${escapeHTML(evt.organization_name)} - ${escapeHTML(evt.event_type_label || 'Event')}
              </div>
            `;
          }).join('')}

          ${overflowCount > 0 ? `
            <div class="day-overflow-arrow" onclick="toggleCalendarPopover(event, '${cellDateStr}')">
              + ${overflowCount} more events
            </div>
          ` : ''}
        </div>

        <!-- Expanded Popover list -->
        ${expandedDayStr === cellDateStr ? `
          <div style="position: absolute; top: 100%; left: 50%; transform: translateX(-50%); z-index: 50; width: 200px; background: var(--theme-card-bg); border: 1px solid var(--theme-border); border-radius: var(--radius-md); padding: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.5); backdrop-filter: blur(20px);">
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--theme-border); padding-bottom: 4px; margin-bottom: 6px; font-size: 11px; font-weight: bold;">
              <span>All Events</span>
              <span style="cursor: pointer;" onclick="toggleCalendarPopover(event, null)">×</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              ${dayEvents.map(evt => {
                const time = parseTzNaive(evt.start_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                const color = evt.event_type_color || 'var(--theme-primary)';
                return `
                  <div 
                    class="event-pill ${evt.is_tentative ? 'tentative' : ''}"
                    style="background-color: ${color}; white-space: normal;"
                    onclick="openJobDetailModal(${evt.job_id})"
                  >
                    <strong>${time}</strong> - ${escapeHTML(evt.organization_name)}: ${escapeHTML(evt.event_type_label || 'Event')}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;
  root.innerHTML = html;
}

// Toggle overflow popover list
window.toggleCalendarPopover = (e, dateStr) => {
  e.stopPropagation();
  expandedDayStr = dateStr;
  renderMonthGrid();
};

// Render Week Grid
async function renderWeekGrid() {
  const root = document.getElementById('calendar-grid-root');
  
  const startOfWeek = new Date(currentCalendarDate);
  const dayOfWeek = startOfWeek.getDay();
  const firstDaySetting = parseInt(settings.calendar_first_day_of_week || '0', 10);
  const diff = (dayOfWeek - firstDaySetting + 7) % 7;
  startOfWeek.setDate(startOfWeek.getDate() - diff);

  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + i);
    weekDays.push(date);
  }

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const todayStr = getNowInDefaultTz().toDateString();

  let calEvents = [];
  try {
    calEvents = await apiFetch('/api/calendar');
    globalEvents = calEvents;
  } catch (err) {
    console.error(err);
  }

  let html = `
    <div class="week-grid-container">
      
      <!-- Sticky Header Row -->
      <div class="week-header-row">
        <div class="week-time-header"></div>
        <div class="week-days-headers">
          ${weekDays.map(day => {
            const isToday = day.toDateString() === todayStr;
            return `
              <div class="week-day-header ${isToday ? 'today' : ''}">
                <div class="week-day-name">${day.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                <div class="week-day-date">${day.getDate()}</div>
              </div>
            `;
          }).join('')}
        </div>
        <div class="week-header-scrollbar-spacer"></div>
      </div>

      <!-- Scrollable Body Row -->
      <div id="week-scroll-container" class="week-body-row">
        
        <!-- Time scale column -->
        <div class="week-time-col">
          ${hours.map(hour => {
            const label = hour === 0 ? '12 AM' : hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
            return `<div class="week-time-slot">${label}</div>`;
          }).join('')}
        </div>

        <!-- Days columns -->
        <div class="week-days-grid">
          ${weekDays.map(day => {
            const dateStr = day.toDateString();
            const isToday = dateStr === todayStr;
            const dayEventsRaw = calEvents.filter(e => parseTzNaive(e.start_time).toDateString() === dateStr);

            // Compute overlapping layout properties
            const dayEvents = [];
            if (dayEventsRaw.length > 0) {
              const evts = dayEventsRaw.map(e => ({
                ...e,
                _start: parseTzNaive(e.start_time),
                _end: parseTzNaive(e.end_time),
                _col: 0,
                _overlap: false
              }));
              
              evts.sort((a, b) => a._start - b._start);

              const groups = [];
              evts.forEach(evt => {
                let placedGroup = null;
                for (let group of groups) {
                  const overlapsAny = group.some(ge => {
                    return evt._start < ge._end && ge._start < evt._end;
                  });
                  if (overlapsAny) {
                    placedGroup = group;
                    break;
                  }
                }
                if (placedGroup) {
                  placedGroup.push(evt);
                } else {
                  groups.push([evt]);
                }
              });

              groups.forEach(group => {
                if (group.length === 1) {
                  const evt = group[0];
                  evt._col = 0;
                  evt._maxCols = 1;
                  evt._overlap = false;
                  dayEvents.push(evt);
                } else {
                  const columns = [];
                  group.forEach(evt => {
                    evt._overlap = true;
                    let colIdx = 0;
                    while (true) {
                      if (!columns[colIdx]) {
                        columns[colIdx] = [];
                      }
                      const overlapsInCol = columns[colIdx].some(ce => {
                        return evt._start < ce._end && ce._start < evt._end;
                      });
                      if (!overlapsInCol) {
                        columns[colIdx].push(evt);
                        evt._col = colIdx;
                        break;
                      }
                      colIdx++;
                    }
                  });
                  const maxCols = columns.length;
                  group.forEach(evt => {
                    evt._maxCols = maxCols;
                    dayEvents.push(evt);
                  });
                }
              });
            }

            return `
              <div class="week-day-col ${isToday ? 'today' : ''}">
                <div class="week-slots-container">
                  ${hours.map(() => `
                    <div class="week-slot"></div>
                    <div class="week-slot"></div>
                  `).join('')}

                  <!-- Absolute positioned events cards -->
                  ${dayEvents.map(evt => {
                    const start = evt._start;
                    const end = evt._end;
                    
                    const startMinutes = start.getHours() * 60 + start.getMinutes();
                    const endMinutes = end.getHours() * 60 + end.getMinutes();
                    const duration = Math.max(30, endMinutes - startMinutes);

                    const topPos = startMinutes;
                    const heightVal = duration;
                    
                    const timeText = `${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
                    const color = evt.event_type_color || 'var(--theme-primary)';

                    const displayLabel = `${evt.organization_name} - ${evt.event_type_label || 'Event'}`;
                    const labelLimit = evt._overlap ? 15 : 25;
                    const displayLabelShort = displayLabel.length > labelLimit ? displayLabel.substring(0, labelLimit) + '...' : displayLabel;
                    const tooltipText = `Org: ${evt.organization_name}\nJob: ${evt.job_title}\nType: ${evt.event_type_label || 'Event'}\nTime: ${timeText}\nNote: ${evt.description || ''}`;

                    const layoutStyle = evt._overlap 
                      ? `left: calc(${(evt._col * 100) / evt._maxCols}% + 2px); width: calc(${100 / evt._maxCols}% - 4px); right: auto;`
                      : '';

                    return `
                      <div 
                        class="week-event-card ${evt.is_tentative ? 'tentative' : ''}"
                        style="top: ${topPos}px; height: ${heightVal}px; background-color: ${color}; display: flex; flex-direction: column; justify-content: center; ${layoutStyle}"
                        onclick="openJobDetailModal(${evt.job_id})"
                        title="${escapeHTML(tooltipText)}"
                      >
                        <div style="font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; text-align: center; padding: 0 4px;">
                          ${escapeHTML(displayLabelShort)}
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>

      </div>
    </div>
  `;
  root.innerHTML = html;

  // Auto-scroll weekly container to start hour
  const scrollContainer = document.getElementById('week-scroll-container');
  if (scrollContainer) {
    const startHour = parseInt(settings.calendar_start_hour || '7', 10);
    scrollContainer.scrollTop = startHour * 60; // 60px per hour
  }
}

// Render Calendar
function renderCalendar() {
  const title = document.getElementById('calendar-header-title');
  if (calendarViewMode === 'month') {
    title.textContent = currentCalendarDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    renderMonthGrid();
  } else {
    // Week Title
    const start = new Date(currentCalendarDate);
    const diff = (start.getDay() - parseInt(settings.calendar_first_day_of_week || '0', 10) + 7) % 7;
    start.setDate(start.getDate() - diff);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    const startMonth = start.toLocaleDateString(undefined, { month: 'short' });
    const endMonth = end.toLocaleDateString(undefined, { month: 'short' });
    const startYear = start.getFullYear();
    const endYear = end.getFullYear();

    let rangeText = "";
    if (startYear !== endYear) {
      rangeText = `${startMonth} ${start.getDate()}, ${startYear} - ${endMonth} ${end.getDate()}, ${endYear}`;
    } else if (startMonth !== endMonth) {
      rangeText = `${startMonth} ${start.getDate()} - ${endMonth} ${end.getDate()}, ${startYear}`;
    } else {
      rangeText = `${startMonth} ${start.getDate()} - ${end.getDate()}, ${startYear}`;
    }
    title.textContent = rangeText;
    
    renderWeekGrid();
  }
}

// Bind Calendar controls navigation
document.getElementById('btn-cal-month').addEventListener('click', () => {
  calendarViewMode = 'month';
  document.getElementById('btn-cal-month').classList.add('active');
  document.getElementById('btn-cal-week').classList.remove('active');
  renderCalendar();
});

document.getElementById('btn-cal-week').addEventListener('click', () => {
  calendarViewMode = 'week';
  document.getElementById('btn-cal-month').classList.remove('active');
  document.getElementById('btn-cal-week').classList.add('active');
  renderCalendar();
});

document.getElementById('cal-btn-prev').addEventListener('click', () => {
  if (calendarViewMode === 'month') {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
  } else {
    currentCalendarDate.setDate(currentCalendarDate.getDate() - 7);
  }
  expandedDayStr = null;
  renderCalendar();
});

document.getElementById('cal-btn-next').addEventListener('click', () => {
  if (calendarViewMode === 'month') {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
  } else {
    currentCalendarDate.setDate(currentCalendarDate.getDate() + 7);
  }
  expandedDayStr = null;
  renderCalendar();
});

document.getElementById('cal-btn-today').addEventListener('click', () => {
  currentCalendarDate = getNowInDefaultTz();
  expandedDayStr = null;
  renderCalendar();
});


// --- 3. Settings Views Renderer ---
function renderSettings() {
  // 1. Theme Chips Customizer
  const themeContainer = document.getElementById('theme-chips-container');
  themeContainer.innerHTML = '';
  
  themes.forEach(t => {
    const isActive = String(t.id) === String(settings.active_theme_id);
    const chip = document.createElement('div');
    chip.className = `theme-chip ${isActive ? 'active' : ''}`;
    chip.style.background = t.is_dark ? '#1e293b' : '#ffffff';
    chip.style.color = t.is_dark ? '#f8fafc' : '#0f172a';
    chip.style.border = isActive ? `2px solid ${t.primary_color}` : '2px solid rgba(0,0,0,0.1)';
    chip.onclick = () => handleThemeSelect(t.id);

    chip.innerHTML = `
      <div style="font-weight: 600; font-size: 13px; display: flex; width: 100%;">
        <span>${escapeHTML(t.name)}</span>
        ${t.is_custom === 1 ? `
          <button onclick="handleThemeDelete(event, ${t.id})" style="background: transparent; border: none; color: #ef4444; cursor: pointer; margin-left: auto;">×</button>
        ` : ''}
      </div>
      <div class="theme-preview-palette">
        <div class="theme-preview-color" style="background-color: ${t.primary_color}"></div>
        <div class="theme-preview-color" style="background-color: ${t.secondary_color}"></div>
        <div class="theme-preview-color" style="background-color: ${t.background_color}"></div>
      </div>
    `;
    themeContainer.appendChild(chip);
  });

  // 2. Status editor Columns
  const statusContainer = document.getElementById('status-edit-list-container');
  statusContainer.innerHTML = '';
  
  statuses.forEach((st, idx) => {
    const isEditing = editingStatusId === st.id;
    const row = document.createElement('div');
    row.className = 'status-edit-row';

    row.innerHTML = `
      <div style="display: flex; gap: 4px;">
        <button type="button" class="calendar-nav-btn" style="width: 24px; height: 24px; opacity: ${idx === 0 ? 0.3 : 1};" onclick="shiftStatusOrder(${idx}, 'up')" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="calendar-nav-btn" style="width: 24px; height: 24px; opacity: ${idx === statuses.length - 1 ? 0.3 : 1};" onclick="shiftStatusOrder(${idx}, 'down')" ${idx === statuses.length - 1 ? 'disabled' : ''}>▼</button>
      </div>
      <div class="color-indicator-circle" style="background-color: ${st.color}"></div>
      
      ${!isEditing ? `
        <strong style="flex-grow: 1; font-size: 14px;">${escapeHTML(st.label)}</strong>
        <span style="font-size: 11px; color: var(--theme-text-muted); margin-right: 12px;">Order: ${st.sort_order}</span>
        <button class="btn btn-secondary btn-sm" onclick="triggerStatusEdit(${st.id}, '${escapeHTML(st.label)}', '${st.color}')">Edit</button>
      ` : `
        <input type="text" id="status-edit-label-${st.id}" value="${escapeHTML(editingStatus.label)}" style="flex-grow: 1; padding: 4px 8px; font-size: 13px;">
        <input type="color" id="status-edit-color-${st.id}" value="${editingStatus.color}" style="width: 40px; padding: 0; height: 28px; cursor: pointer;">
        <button class="btn btn-primary btn-sm" onclick="saveStatusEdit(${st.id})">Save</button>
        <button class="btn btn-secondary btn-sm" onclick="triggerStatusEdit(null)">Cancel</button>
      `}

      <button class="btn btn-danger btn-sm" onclick="deleteStatusColumn(${st.id})" title="Delete Status" style="padding: 6px;">🗑️</button>
    `;
    statusContainer.appendChild(row);
  });

  // 2b. Event Types Editor
  const eventTypeContainer = document.getElementById('event-type-edit-list-container');
  if (eventTypeContainer) {
    eventTypeContainer.innerHTML = '';
    eventTypes.forEach((et, idx) => {
      const isEditing = editingEventTypeId === et.id;
      const row = document.createElement('div');
      row.className = 'status-edit-row';

      row.innerHTML = `
        <div style="display: flex; gap: 4px;">
          <button type="button" class="calendar-nav-btn" style="width: 24px; height: 24px; opacity: ${idx === 0 ? 0.3 : 1};" onclick="shiftEventTypeOrder(${idx}, 'up')" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" class="calendar-nav-btn" style="width: 24px; height: 24px; opacity: ${idx === eventTypes.length - 1 ? 0.3 : 1};" onclick="shiftEventTypeOrder(${idx}, 'down')" ${idx === eventTypes.length - 1 ? 'disabled' : ''}>▼</button>
        </div>
        <div class="color-indicator-circle" style="background-color: ${et.color}"></div>
        
        ${!isEditing ? `
          <strong style="flex-grow: 1; font-size: 14px;">${escapeHTML(et.label)}</strong>
          <span style="font-size: 11px; color: var(--theme-text-muted); margin-right: 12px;">Order: ${et.sort_order}</span>
          <button class="btn btn-secondary btn-sm" onclick="triggerEventTypeEdit(${et.id}, '${escapeHTML(et.label)}', '${et.color}')">Edit</button>
        ` : `
          <input type="text" id="event-type-edit-label-${et.id}" value="${escapeHTML(editingEventType.label)}" style="flex-grow: 1; padding: 4px 8px; font-size: 13px;">
          <input type="color" id="event-type-edit-color-${et.id}" value="${editingEventType.color}" style="width: 40px; padding: 0; height: 28px; cursor: pointer;">
          <button class="btn btn-primary btn-sm" onclick="saveEventTypeEdit(${et.id})">Save</button>
          <button class="btn btn-secondary btn-sm" onclick="triggerEventTypeEdit(null)">Cancel</button>
        `}

        <button class="btn btn-danger btn-sm" onclick="deleteEventType(${et.id})" title="Delete Event Type" style="padding: 6px;">🗑️</button>
      `;
      eventTypeContainer.appendChild(row);
    });
  }

  // 3. App settings Form defaults
  document.getElementById('param-user-name').value = settings.user_name || '';
  document.getElementById('param-stale-days').value = settings.stale_threshold_days || '14';
  document.getElementById('param-snooze-days').value = settings.snooze_duration_days || '7';
  document.getElementById('param-first-day').value = settings.calendar_first_day_of_week || '0';
  document.getElementById('param-start-hour').value = settings.calendar_start_hour || '7';
  document.getElementById('param-end-hour').value = settings.calendar_end_hour || '19';
  document.getElementById('param-kanban-sort').value = settings.kanban_default_sort || 'last_activity';

  const tzSelect = document.getElementById('param-timezone');
  if (tzSelect) {
    tzSelect.innerHTML = '';
    timezones.forEach(tz => {
      const opt = document.createElement('option');
      opt.value = tz.name;
      opt.textContent = tz.label;
      if (tz.name === (settings.default_timezone || 'America/Los_Angeles')) {
        opt.selected = true;
      }
      tzSelect.appendChild(opt);
    });
  }

  // Default status selection dropdown
  const defaultSelect = document.getElementById('param-default-status');
  defaultSelect.innerHTML = '';
  statuses.forEach(st => {
    const opt = document.createElement('option');
    opt.value = st.id;
    opt.textContent = st.label;
    if (String(st.id) === String(settings.default_status_id)) {
      opt.selected = true;
    }
    defaultSelect.appendChild(opt);
  });
}

// Toggle Theme Builder Form
document.getElementById('btn-toggle-theme-builder').addEventListener('click', () => {
  const form = document.getElementById('theme-builder-form');
  const isHidden = form.style.display === 'none';
  form.style.display = isHidden ? 'block' : 'none';
});

document.getElementById('btn-cancel-theme-builder').addEventListener('click', () => {
  document.getElementById('theme-builder-form').style.display = 'none';
});

// Create Custom Theme Submission
document.getElementById('theme-builder-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const theme = {
    name: document.getElementById('theme-name').value,
    is_dark: document.getElementById('theme-is-dark').checked,
    primary_color: document.getElementById('color-primary').value,
    secondary_color: document.getElementById('color-secondary').value,
    background_color: document.getElementById('color-bg').value,
    card_background_color: document.getElementById('color-card').value,
    text_color: document.getElementById('color-text').value,
    border_color: document.getElementById('color-border').value
  };

  try {
    const res = await apiFetch('/api/themes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(theme)
    });
    showToast('Theme created and applied!', 'success');
    handleThemeSelect(res.id);
    document.getElementById('theme-builder-form').style.display = 'none';
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Select active theme
async function handleThemeSelect(themeId) {
  try {
    await apiFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active_theme_id: String(themeId) })
    });
    fetchDashboardData();
  } catch (err) {
    console.error(err);
  }
}

// Delete custom theme
async function handleThemeDelete(e, themeId) {
  e.stopPropagation();
  const confirmed = await showConfirmDialog(
    '🎨 Delete Theme?',
    'Are you sure you want to delete this custom theme? Settings will fall back to Default Dark.',
    'Delete Theme'
  );
  if (!confirmed) return;
  try {
    await apiFetch(`/api/themes/${themeId}`, { method: 'DELETE' });
    fetchDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Status re-ordering arrow updates
async function shiftStatusOrder(idx, direction) {
  if (direction === 'up' && idx === 0) return;
  if (direction === 'down' && idx === statuses.length - 1) return;

  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  const statusA = statuses[idx];
  const statusB = statuses[targetIdx];

  const orders = [
    { id: statusA.id, sort_order: statusB.sort_order },
    { id: statusB.id, sort_order: statusA.sort_order }
  ];

  try {
    await apiFetch('/api/statuses/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders })
    });
    fetchDashboardData();
  } catch (err) {
    console.error(err);
  }
}

// Edit status triggers
let editingStatusId = null;
let editingStatus = { label: '', color: '' };
window.triggerStatusEdit = (id, label = '', color = '') => {
  editingStatusId = id;
  editingStatus = { label, color };
  renderSettings();
};

async function saveStatusEdit(id) {
  const labelInput = document.getElementById(`status-edit-label-${id}`);
  const colorInput = document.getElementById(`status-edit-color-${id}`);
  
  if (!labelInput || !labelInput.value.trim()) return;
  
  const current = statuses.find(s => s.id === id);

  try {
    await apiFetch(`/api/statuses/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: labelInput.value.trim(),
        color: colorInput.value,
        sort_order: current.sort_order
      })
    });
    editingStatusId = null;
    fetchDashboardData();
  } catch (err) {
    console.error(err);
  }
}

async function deleteStatusColumn(id) {
  const defaultId = parseInt(settings.default_status_id || '1', 10);
  if (id === defaultId) {
    showToast('Cannot delete the default status column! Select a new default status in Settings first.', 'warning');
    return;
  }
  const confirmed = await showConfirmDialog(
    '🗂️ Delete Status Column?',
    'Delete this status column? Any applications currently in this status will be moved to the default status column.',
    'Delete Column'
  );
  if (!confirmed) return;

  try {
    await apiFetch(`/api/statuses/${id}`, { method: 'DELETE' });
    fetchDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Status inline additions
document.getElementById('create-status-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const labelInput = document.getElementById('new-status-label');
  const colorInput = document.getElementById('new-status-color');

  const maxOrder = statuses.length > 0 ? Math.max(...statuses.map(s => s.sort_order)) : 0;

  try {
    await apiFetch('/api/statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: labelInput.value.trim(),
        color: colorInput.value,
        sort_order: maxOrder + 1
      })
    });
    labelInput.value = '';
    fetchDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Event Type re-ordering arrow updates
async function shiftEventTypeOrder(idx, direction) {
  if (direction === 'up' && idx === 0) return;
  if (direction === 'down' && idx === eventTypes.length - 1) return;

  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  const typeA = eventTypes[idx];
  const typeB = eventTypes[targetIdx];

  const orders = [
    { id: typeA.id, sort_order: typeB.sort_order },
    { id: typeB.id, sort_order: typeA.sort_order }
  ];

  try {
    await apiFetch('/api/event_types/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders })
    });
    fetchDashboardData();
  } catch (err) {
    console.error(err);
  }
}
window.shiftEventTypeOrder = shiftEventTypeOrder;

// Edit event type triggers
window.triggerEventTypeEdit = (id, label = '', color = '') => {
  editingEventTypeId = id;
  editingEventType = { label, color };
  renderSettings();
};

async function saveEventTypeEdit(id) {
  const labelInput = document.getElementById(`event-type-edit-label-${id}`);
  const colorInput = document.getElementById(`event-type-edit-color-${id}`);
  
  if (!labelInput || !labelInput.value.trim()) return;
  
  const current = eventTypes.find(t => t.id === id);

  try {
    await apiFetch(`/api/event_types/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: labelInput.value.trim(),
        color: colorInput.value,
        sort_order: current.sort_order
      })
    });
    editingEventTypeId = null;
    fetchDashboardData();
  } catch (err) {
    console.error(err);
  }
}
window.saveEventTypeEdit = saveEventTypeEdit;

async function deleteEventType(id) {
  if (eventTypes.length <= 1) {
    showToast('You must have at least one calendar event type! Create another one first.', 'warning');
    return;
  }
  const confirmed = await showConfirmDialog(
    '📅 Delete Event Type?',
    'Delete this event type? Any calendar events currently assigned this type will be reassigned to a fallback event type.',
    'Delete Type'
  );
  if (!confirmed) return;

  try {
    await apiFetch(`/api/event_types/${id}`, { method: 'DELETE' });
    fetchDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.deleteEventType = deleteEventType;

// App settings Submit updates
document.getElementById('app-settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    user_name: document.getElementById('param-user-name').value.trim(),
    stale_threshold_days: document.getElementById('param-stale-days').value,
    snooze_duration_days: document.getElementById('param-snooze-days').value,
    default_status_id: document.getElementById('param-default-status').value,
    calendar_first_day_of_week: document.getElementById('param-first-day').value,
    calendar_start_hour: document.getElementById('param-start-hour').value,
    calendar_end_hour: document.getElementById('param-end-hour').value,
    kanban_default_sort: document.getElementById('param-kanban-sort').value,
    default_timezone: document.getElementById('param-timezone').value
  };

  try {
    await apiFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    showToast('Settings saved successfully.', 'success');
    fetchDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
});


// --- 4. Floating Modals Managers ---

// A. "+ Add Job" Modal Toggle Controls
window.closeAddJobModal = () => {
  document.getElementById('add-job-modal').classList.remove('active');
  document.getElementById('add-job-form').reset();
};

document.getElementById('btn-add-job-trigger').addEventListener('click', () => {
  // Populate status dropdown
  const select = document.getElementById('job-status');
  select.innerHTML = '';
  statuses.forEach(st => {
    const opt = document.createElement('option');
    opt.value = st.id;
    opt.textContent = st.label;
    if (st.label === 'Interested') {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
  
  document.getElementById('add-job-modal').classList.add('active');
});

// Submit new job
document.getElementById('add-job-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    organization: document.getElementById('job-org').value.trim(),
    title: document.getElementById('job-title').value.trim(),
    posted_date: document.getElementById('job-date').value || null,
    end_date: document.getElementById('job-end-date').value || null,
    salary_range: document.getElementById('job-salary').value.trim() || null,
    other_compensation: document.getElementById('job-comp').value.trim() || null,
    target_url: document.getElementById('job-url').value.trim() || null,
    description: document.getElementById('job-desc').value.trim() || null,
    required_experience: document.getElementById('job-req').value.trim() || null,
    preferred_experience: document.getElementById('job-pref').value.trim() || null,
    location: document.getElementById('job-location').value.trim() || null,
    remote: document.getElementById('job-remote').checked ? 1 : 0,
    requisition_id: document.getElementById('job-req-id').value.trim() || null
  };

  if (body.posted_date && body.end_date && body.end_date <= body.posted_date) {
    showToast('Safety Check: The End Date (closes date) must be after the Posted Date!', 'warning');
    return;
  }

  const statusVal = document.getElementById('job-status').value;
  if (statusVal) body.status_id = parseInt(statusVal, 10);

  try {
    await apiFetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    closeAddJobModal();
    fetchDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// B. Expand Detail Modals Manager
window.closeJobDetailModal = () => {
  document.getElementById('job-detail-modal').classList.remove('active');
  selectedJobId = null;
  isEditMode = false;
  fetchDashboardData(); // Refresh list to reflect updates
};

window.openJobDetailModal = async (jobId) => {
  selectedJobId = jobId;
  isEditMode = false;
  
  const modal = document.getElementById('job-detail-modal');
  modal.classList.add('active');

  renderDetailModalContent();
};

async function renderDetailModalContent() {
  const container = document.getElementById('detail-modal-body');
  container.innerHTML = '<p style="text-align: center; padding: 24px;">Retrieving application details...</p>';
  
  const btnToggle = document.getElementById('btn-toggle-edit-mode');
  const btnToggleText = document.getElementById('edit-btn-text');

  try {
    const job = await apiFetch(`/api/jobs/${selectedJobId}`);
    const isJobStale = staleJobs.some(sj => sj.id === selectedJobId);

    btnToggle.style.display = 'inline-flex';
    btnToggleText.textContent = isEditMode ? 'View Mode' : 'Edit Job';

    // Set toggle listener
    btnToggle.onclick = () => {
      isEditMode = !isEditMode;
      renderDetailModalContent();
    };

    if (!isEditMode) {
      // --- VIEW MODE TEMPLATE ---
      
      // Compute unified timeline log (notes + uploads + events)
      const feed = [];
      if (job.notes) {
        job.notes.forEach(n => {
          feed.push({ id: `note_${n.id}`, type: 'note', date: new Date(n.created_at), data: n });
        });
      }
      if (job.files) {
        job.files.forEach(f => {
          feed.push({ id: `file_${f.id}`, type: 'file', date: new Date(f.uploaded_at), data: f });
        });
      }
      if (job.calendar_events) {
        job.calendar_events.forEach(e => {
          feed.push({ id: `event_${e.id}`, type: 'event', date: new Date(e.start_time), data: e });
        });
      }
      // Sort reverse chronological
      feed.sort((a, b) => b.date - a.date);

      const hasSalary = job.salary_range && job.salary_range.trim() !== '';
      const hasOther = job.other_compensation && job.other_compensation.trim() !== '';
      
      container.innerHTML = `
        <!-- Header -->
        <div class="detail-header">
          <div class="detail-title-row" style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <!-- Left Column -->
            <div style="flex: 1; min-width: 0; padding-right: 16px;">
              <h2>${escapeHTML(job.title)}</h2>
              <div class="detail-org">
                <span>at ${escapeHTML(job.organization_name)}</span>
                ${(job.requisition_id && job.requisition_id !== 'None') ? `
                  <span style="background: rgba(251, 191, 36, 0.15); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.3); padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 8px;">Req ID: ${escapeHTML(job.requisition_id)}</span>
                ` : ''}
                ${job.target_url ? `
                  <a href="${job.target_url}" target="_blank" rel="noopener noreferrer" style="font-size: 14px; color: var(--theme-primary); text-decoration: underline; margin-left: 8px;">
                    View Job Post
                  </a>
                ` : ''}
              </div>
              <div style="display: flex; gap: 16px; margin-top: 8px; font-size: 13px; color: var(--theme-text-muted); flex-wrap: wrap; align-items: center;">
                ${job.posted_date ? `<span><strong>Posted:</strong> ${formatLocalDate(job.posted_date)}</span>` : ''}
                ${job.end_date ? `<span style="color: #fb7185; display: inline-flex; align-items: center; gap: 4px;"><strong>Closes:</strong> ${formatLocalDate(job.end_date)}</span>` : ''}
                ${job.remote ? `<span style="background: rgba(99, 102, 241, 0.2); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.4); padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;">☁️ Remote</span>` : ''}
                ${(job.location && job.location.trim() !== '' && job.location !== 'None') ? `<span><strong>Location:</strong> 📍 ${escapeHTML(job.location)}</span>` : ''}
              </div>
            </div>
            
            <!-- Center Column -->
            <div style="flex: 1; display: flex; justify-content: center; min-width: 200px;">
              <div style="display: flex; flex-direction: column; gap: 4px; align-items: center; text-align: center; width: 200px;">
                <label style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Application Status</label>
                <select id="detail-status-select" style="border-left: 5px solid ${job.status_color}; font-weight: 600;" onchange="updateJobStatus(${job.id}, this.value)">
                  ${statuses.map(st => `
                    <option value="${st.id}" ${String(st.id) === String(job.status_id) ? 'selected' : ''}>${st.label}</option>
                  `).join('')}
                </select>
              </div>
            </div>
            
            <!-- Right Column Spacer (balancing absolute buttons) -->
            <div style="width: 100px; flex-shrink: 0;"></div>
          </div>
        </div>

        <!-- Stale Alerts Banner -->
        ${isJobStale ? `
          <div class="alerts-banner" style="margin-bottom: 24px;">
            <div class="alerts-info">
              <span style="font-size: 20px;">⚠️</span>
              <div>
                <strong>Stale Opportunity Alert:</strong>
                <span style="font-size: 13px; margin-left: 6px;">No updates logged in over 14 days.</span>
              </div>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary btn-sm" onclick="triggerCalendarJobInquire(${job.id})">Inquire (Follow-up)</button>
              <button class="btn btn-secondary btn-sm" onclick="document.getElementById('detail-status-select').focus()">Update Status</button>
              <button class="btn btn-secondary btn-sm" onclick="snoozeStaleAlert(${job.id})">Snooze 7 Days</button>
            </div>
          </div>
        ` : ''}

        <!-- Details layout grid -->
        <div class="detail-grid">
          
          <!-- Left Column (Description, Note adding, timeline log) -->
          <div class="detail-main">
            
            <div style="display: flex; flex-direction: column; gap: 16px; background: rgba(0,0,0,0.1); padding: 20px; border-radius: var(--radius-md); border: 1px solid var(--theme-border);">
              ${job.description ? `<div><strong style="font-size: 12px; color: var(--theme-text-muted); text-transform: uppercase;">Job Description / Responsibilities:</strong><p style="font-size: 14px; white-space: pre-wrap; margin-top: 4px; line-height: 1.6;">${escapeHTML(job.description)}</p></div>` : ''}
              ${job.required_experience ? `<div><strong style="font-size: 12px; color: var(--theme-text-muted); text-transform: uppercase;">Required Experience:</strong><p style="font-size: 14px; white-space: pre-wrap; margin-top: 4px; line-height: 1.5;">${escapeHTML(job.required_experience)}</p></div>` : ''}
              ${job.preferred_experience ? `<div><strong style="font-size: 12px; color: var(--theme-text-muted); text-transform: uppercase;">Preferred Experience:</strong><p style="font-size: 14px; white-space: pre-wrap; margin-top: 4px; line-height: 1.5;">${escapeHTML(job.preferred_experience)}</p></div>` : ''}
              ${hasSalary ? `<div><strong style="font-size: 12px; color: var(--theme-text-muted); text-transform: uppercase;">Salary Range:</strong><div style="font-size: 15px; font-weight: 500; margin-top: 2px;">${escapeHTML(job.salary_range)}</div></div>` : ''}
              ${hasOther ? `<div><strong style="font-size: 12px; color: var(--theme-text-muted); text-transform: uppercase;">Other Compensation:</strong><div style="font-size: 14px; margin-top: 2px;">${escapeHTML(job.other_compensation)}</div></div>` : ''}
            </div>

            <!-- Notes Adding box -->
            <div>
              <h3 class="detail-section-title">Add Update Note</h3>
              <form id="note-submit-form" class="note-input-box" onsubmit="submitJobNote(event, ${job.id})">
                <div>
                  <label style="font-size: 11px; display: block; margin-bottom: 4px;">Note Originator</label>
                  <select id="note-originator-select" style="padding: 8px 12px; width: 220px;">
                    <option value="none"></option>
                    <option value="user">User (Me)</option>
                    <option value="other_generic">Other Representative</option>
                    ${job.contacts.map(c => `
                      <option value="contact_${c.id}">${escapeHTML(c.name)} (Contact)</option>
                    `).join('')}
                  </select>
                </div>
                <textarea id="note-content-input" placeholder="Type details of your email exchange, feedback, or logs..." required></textarea>
                <button type="submit" class="btn btn-primary btn-sm" style="align-self: flex-end;">Save Note</button>
              </form>
            </div>

            <!-- Combined Log Feed -->
            <div>
              <h3 class="detail-section-title">Activity & Updates Feed</h3>
              <div class="notes-container">
                ${feed.length > 0 ? feed.map(item => {
                  if (item.type === 'note') {
                    let author = '';
                    if (item.data.originator_type === 'user') author = 'User (Me)';
                    else if (item.data.originator_type === 'recruiter') author = item.data.contact_name ? `${escapeHTML(item.data.contact_name)}` : '';
                    else if (item.data.originator_type === 'other') author = 'Other Representative';

                    return `
                      <div class="note-card" id="note-card-${item.data.id}">
                        <div class="note-header" style="display: flex; justify-content: space-between; align-items: center;">
                          <div style="display: flex; align-items: center; gap: 8px;">
                            ${author ? `<span class="note-originator" style="color: ${item.data.originator_type === 'user' ? 'var(--theme-secondary)' : 'var(--theme-primary)'}">${author}</span>` : ''}
                            <button class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 10px; line-height: 1;" onclick="enterNoteEditMode(${item.data.id})">✏️ Edit</button>
                          </div>
                          <span>${new Date(item.data.created_at).toLocaleString()}</span>
                        </div>
                        
                        <!-- View mode -->
                        <div id="note-view-${item.data.id}">
                          <div class="note-body">${escapeHTML(item.data.content)}</div>
                        </div>
                        
                        <!-- Edit mode -->
                        <div id="note-edit-${item.data.id}" style="display: none; margin-top: 8px;">
                          <textarea id="note-edit-textarea-${item.data.id}" style="width: 100%; min-height: 80px; padding: 8px; margin-bottom: 8px; font-family: var(--font-body); font-size: 13px; background: rgba(0,0,0,0.3); color: var(--theme-text); border: 1px solid var(--theme-border); border-radius: var(--radius-sm); resize: vertical;">${escapeHTML(item.data.content)}</textarea>
                          <div style="display: flex; gap: 8px; justify-content: flex-end;">
                            <button class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 11px;" onclick="cancelNoteEditMode(${item.data.id})">Cancel</button>
                            <button class="btn btn-primary btn-sm" style="padding: 4px 8px; font-size: 11px;" onclick="saveNoteEdit(${item.data.id}, ${job.id})">Save</button>
                          </div>
                        </div>
                      </div>
                    `;
                  } else if (item.type === 'file') {
                    return `
                      <div class="file-row">
                        <div class="file-name">
                          <span style="margin-right: 6px; color: var(--theme-secondary);">📄</span>
                          <span>${escapeHTML(item.data.original_name)}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                          <span style="font-size: 11px; color: var(--theme-text-muted);">${new Date(item.data.uploaded_at).toLocaleDateString()}</span>
                          <a href="/api/files/download/${item.data.stored_name}" download class="file-download-icon" title="Download">⬇️</a>
                        </div>
                      </div>
                    `;
                  } else if (item.type === 'event') {
                    const color = item.data.is_tentative ? '#fbbf24' : '#10b981';
                    return `
                      <div class="file-row" style="border-left: 4px solid var(--theme-primary)">
                        <div class="file-name">
                          <span style="margin-right: 6px; color: var(--theme-primary);">📅</span>
                          <div>
                            <strong>${escapeHTML(item.data.description || 'Schedule Window')}</strong>
                            <div style="font-size: 11px; color: var(--theme-text-muted);">
                              ${formatEventDateTime(item.data.start_time)} to ${formatEventDateTime(item.data.end_time)} (${item.data.timezone})
                            </div>
                          </div>
                        </div>
                        <span class="badge-stale" style="background: rgba(0,0,0,0.2); color: ${color}; border-color: ${color};">${item.data.is_tentative ? 'Tentative' : 'Confirmed'}</span>
                      </div>
                    `;
                  }
                  return '';
                }).join('') : `
                  <div style="color: var(--theme-text-muted); font-size: 14px; text-align: center; padding: 24px 0;">No updates logged.</div>
                `}
              </div>
            </div>

          </div>

          <!-- Right Column Widgets (Contacts, Files, Calendar Windows) -->
          <div class="detail-sidebar">
            
            <!-- Contacts Widget -->
            <div>
              <div class="detail-section-title">
                <span>Contacts</span>
                <button class="btn btn-secondary btn-sm" style="padding: 2px 8px;" onclick="toggleWidgetForm('contact-widget-form')">👤+</button>
              </div>
              
              <form id="contact-widget-form" style="display: none; background: rgba(0,0,0,0.15); padding: 12px; border-radius: var(--radius-sm); margin-bottom: 16px; display: none; flex-direction: column; gap: 8px;" onsubmit="submitJobContact(event, ${job.id})">
                <input type="text" id="contact-name-input" placeholder="Name" required style="padding: 6px 10px; font-size: 13px;">
                <input type="email" id="contact-email-input" placeholder="Email" style="padding: 6px 10px; font-size: 13px;">
                <input type="text" id="contact-phone-input" placeholder="Phone" style="padding: 6px 10px; font-size: 13px;">
                <div style="display: flex; justify-content: flex-end; gap: 6px;">
                  <button type="button" class="btn btn-secondary btn-sm" onclick="toggleWidgetForm('contact-widget-form', false)">Cancel</button>
                  <button type="submit" class="btn btn-primary btn-sm">Save</button>
                </div>
              </form>

              <div class="contacts-list">
                ${job.contacts.length > 0 ? job.contacts.map(c => `
                  <div class="contact-item">
                    <div class="contact-name">${escapeHTML(c.name)}</div>
                    ${(c.email || c.phone) ? `
                      <div class="contact-details">
                        ${c.email ? `<div>${escapeHTML(c.email)}</div>` : ''}
                        ${c.phone ? `<div>${escapeHTML(c.phone)}</div>` : ''}
                      </div>
                    ` : ''}
                  </div>
                `).join('') : '<div style="font-size: 12px; color: var(--theme-text-muted); text-align: center; padding: 12px 0;">No contacts.</div>'}
              </div>
            </div>

            <!-- Uploads Widget -->
            <div>
              <div class="detail-section-title">
                <span>Uploaded Files / Resume</span>
                <button class="btn btn-secondary btn-sm" style="padding: 2px 8px;" onclick="triggerFilePicker()">📎+</button>
                <input type="file" id="job-file-picker" style="display: none;" accept=".pdf,.docx" onchange="uploadJobFile(${job.id})">
              </div>
              <div style="font-size: 11px; color: var(--theme-text-muted); margin-top: -8px; margin-bottom: 8px;">Supports .pdf & .docx files</div>

              <div class="files-list">
                ${job.files.length > 0 ? job.files.map(f => `
                  <div class="file-row" style="padding: 6px 10px; font-size: 12px;">
                    <span class="file-name" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;" title="${escapeHTML(f.original_name)}">${escapeHTML(f.original_name)}</span>
                    <a href="/api/files/download/${f.stored_name}" download class="file-download-icon">⬇️</a>
                  </div>
                `).join('') : '<div style="font-size: 12px; color: var(--theme-text-muted); text-align: center; padding: 12px 0;">No files uploaded.</div>'}
              </div>
            </div>

            <!-- Schedule Widget -->
            <div>
              <div class="detail-section-title">
                <span>Calendar Windows</span>
                <button class="btn btn-secondary btn-sm" style="padding: 2px 8px;" onclick="toggleWidgetForm('schedule-widget-form')">📅+</button>
              </div>

              <form id="schedule-widget-form" style="display: none; background: rgba(0,0,0,0.15); padding: 12px; border-radius: var(--radius-sm); margin-bottom: 16px; flex-direction: column; gap: 8px;" onsubmit="submitJobSchedule(event, ${job.id})">
                <div>
                  <label style="font-size: 10px; display: block; margin-bottom: 4px;">Event Type *</label>
                  <select id="sch-type" required style="padding: 6px 10px; font-size: 13px; width: 100%;">
                    <option value="">-- Select Event Type --</option>
                    ${eventTypes.map(t => `<option value="${t.id}">${escapeHTML(t.label)}</option>`).join('')}
                  </select>
                </div>
                <div style="display: flex; gap: 8px;">
                  <div style="flex: 1;">
                    <label style="font-size: 10px; display: block; margin-bottom: 4px;">Start Date</label>
                    <input type="date" id="sch-start-date" required style="padding: 6px 10px; font-size: 13px;">
                  </div>
                  <div style="flex: 1;">
                    <label style="font-size: 10px; display: block; margin-bottom: 4px;">Start Time</label>
                    <input type="text" id="sch-start-time" class="time-picker-input" placeholder="e.g. 09:30 AM" autocomplete="off" required style="padding: 6px 10px; font-size: 13px;">
                  </div>
                </div>
                <div style="display: flex; gap: 8px;">
                  <div style="flex: 1;">
                    <label style="font-size: 10px; display: block; margin-bottom: 4px;">End Date</label>
                    <input type="date" id="sch-end-date" required style="padding: 6px 10px; font-size: 13px;">
                  </div>
                  <div style="flex: 1;">
                    <label style="font-size: 10px; display: block; margin-bottom: 4px;">End Time</label>
                    <input type="text" id="sch-end-time" class="time-picker-input" placeholder="e.g. 10:00 AM" autocomplete="off" required style="padding: 6px 10px; font-size: 13px;">
                  </div>
                </div>
                <div>
                  <label style="font-size: 10px; display: block; margin-bottom: 4px;">Time Zone *</label>
                  <select id="sch-tz" required style="padding: 6px 10px; font-size: 13px; width: 100%;">
                    <option value="">-- Select Time Zone --</option>
                    ${timezones.map(tz => `<option value="${tz.name}" ${tz.name === (settings.default_timezone || 'America/Los_Angeles') ? 'selected' : ''}>${escapeHTML(tz.label)}</option>`).join('')}
                  </select>
                </div>
                <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; width: fit-content;">
                  <input type="checkbox" id="sch-tentative" checked style="width: auto; cursor: pointer;"> Is Tentative?
                </label>
                <div>
                  <label style="font-size: 10px; display: block; margin-bottom: 4px;">Event Description *</label>
                  <textarea id="sch-desc" placeholder="Event Description (e.g. Panel Screen)" required style="padding: 6px 10px; font-size: 13px; width: 100%; box-sizing: border-box; resize: vertical; min-height: 80px;" rows="3"></textarea>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px;">
                  <button type="button" class="btn btn-secondary btn-sm" onclick="toggleWidgetForm('schedule-widget-form', false)">Cancel</button>
                  <button type="submit" class="btn btn-primary btn-sm">Schedule</button>
                </div>
              </form>

              <div class="events-list">
                ${job.calendar_events.length > 0 ? job.calendar_events.map(e => `
                  <div class="contact-item" style="font-size: 12px; border-left: 3px solid ${e.is_tentative ? '#fbbf24' : '#10b981'}; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                    <div>
                      <strong>${escapeHTML(e.description || 'Schedule Event')}</strong>
                      <div style="font-size: 11px; color: var(--theme-text-muted); margin-top: 2px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${e.event_type_color || '#6b7280'};"></span>
                        <span>${escapeHTML(e.event_type_label || 'Event')}</span>
                        <span>•</span>
                        <span>${parseTzNaive(e.start_time).toLocaleDateString()} at ${parseTzNaive(e.start_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} (${e.timezone})</span>
                      </div>
                    </div>
                    <button class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 10px;" onclick="openEditEventModal(${e.id}, ${job.id})">✏️</button>
                  </div>
                `).join('') : '<div style="font-size: 12px; color: var(--theme-text-muted); text-align: center; padding: 12px 0;">No events.</div>'}
              </div>
            </div>

          </div>

        </div>
      `;
    } else {
      // --- EDIT MODE TEMPLATE ---
      container.innerHTML = `
        <h2 style="font-family: var(--font-heading); margin-bottom: 24px;">Edit Job Opportunity</h2>
        <form onsubmit="saveJobDetailsEdit(event, ${job.id})">
          <div class="form-row">
            <div class="form-group">
              <label for="edit-org">Organization/Company *</label>
              <input type="text" id="edit-org" value="${escapeHTML(job.organization_name)}" placeholder="e.g. Google, Stripe" required>
            </div>
            <div class="form-group">
              <label for="edit-title">Job Title *</label>
              <input type="text" id="edit-title" value="${escapeHTML(job.title)}" placeholder="e.g. Senior Frontend Engineer" required>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
            <!-- Left Column Stack -->
            <div style="display: flex; flex-direction: column; gap: 16px;">
              <div class="form-group" style="margin-bottom: 0;">
                <label for="edit-url">Target Job Posting URL</label>
                <input type="url" id="edit-url" value="${escapeHTML(job.target_url || '')}" placeholder="https://careers.company.com/job/...">
              </div>
              <div class="form-group" style="margin-bottom: 0;">
                <label for="edit-req-id">Requisition ID</label>
                <input type="text" id="edit-req-id" value="${escapeHTML(job.requisition_id && job.requisition_id !== 'None' ? job.requisition_id : '')}" placeholder="e.g. REQ-12345">
              </div>
              <div style="display: flex; gap: 16px;">
                <div class="form-group" style="margin-bottom: 0; flex: 1;">
                  <label for="edit-posted">Posted Date</label>
                  <input type="date" id="edit-posted" value="${job.posted_date || ''}">
                </div>
                <div class="form-group" style="margin-bottom: 0; flex: 1;">
                  <label for="edit-posted-end">End Date</label>
                  <input type="date" id="edit-posted-end" value="${job.end_date || ''}">
                </div>
              </div>
              <div class="form-group" style="margin-bottom: 0;">
                <label for="edit-status">Status</label>
                <select id="edit-status">
                  ${statuses.map(st => `
                    <option value="${st.id}" ${String(st.id) === String(job.status_id) ? 'selected' : ''}>${st.label}</option>
                  `).join('')}
                </select>
              </div>
              <div class="form-group" style="margin-bottom: 0;">
                <label for="edit-location">Location</label>
                <input type="text" id="edit-location" value="${escapeHTML(job.location && job.location !== 'None' ? job.location : '')}" placeholder="e.g. San Francisco, CA">
              </div>
              <div class="form-group" style="margin-bottom: 0; justify-content: center;">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; font-weight: 500; margin-top: 8px;">
                  <input type="checkbox" id="edit-remote" ${job.remote ? 'checked' : ''} style="width: auto; cursor: pointer;">
                  Remote position?
                </label>
              </div>
            </div>
            <!-- Right Column Stack -->
            <div style="display: flex; flex-direction: column; gap: 16px;">
              <div class="form-group" style="margin-bottom: 0;">
                <label for="edit-salary">Salary Range</label>
                <input type="text" id="edit-salary" value="${escapeHTML(job.salary_range || '')}" placeholder="e.g. $120,000 - $150,000">
              </div>
              <div class="form-group" style="margin-bottom: 0; flex-grow: 1; display: flex; flex-direction: column;">
                <label for="edit-comp">Other Compensation</label>
                <textarea id="edit-comp" placeholder="e.g. 10% bonus, equity, 401(k), health benefits..." style="flex-grow: 1; min-height: 110px; resize: vertical;">${escapeHTML(job.other_compensation || '')}</textarea>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label for="edit-desc">Job Description / Responsibilities</label>
            <textarea id="edit-desc" placeholder="Paste job details..." style="min-height: 220px;">${escapeHTML(job.description || '')}</textarea>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="edit-req">Required Experience</label>
              <textarea id="edit-req" placeholder="Paste required experience details..." style="min-height: 200px;">${escapeHTML(job.required_experience || '')}</textarea>
            </div>
            <div class="form-group">
              <label for="edit-pref">Preferred Experience</label>
              <textarea id="edit-pref" placeholder="Paste preferred/bonus qualifications..." style="min-height: 200px;">${escapeHTML(job.preferred_experience || '')}</textarea>
            </div>
          </div>

          <!-- Bottom controls -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 32px; padding-top: 20px;">
            <button type="button" class="btn btn-danger" onclick="deleteJobOpportunity(${job.id})" style="display: flex; align-items: center; gap: 6px;">
              <span>🗑️</span>
              <span>Delete Opportunity</span>
            </button>
            <div style="display: flex; gap: 12px;">
              <button type="button" class="btn btn-secondary" onclick="toggleEditMode(false)">Cancel</button>
              <button type="submit" class="btn btn-primary" style="display: flex; align-items: center; gap: 6px;">
                <span>💾</span>
                <span>Save Changes</span>
              </button>
            </div>
          </div>
        </form>
      `;
    }
  } catch (err) {
    console.error(err);
  }
}

// Inline widget forms triggers
window.toggleWidgetForm = (formId, show = true) => {
  const form = document.getElementById(formId);
  if (form) {
    form.style.display = show ? 'flex' : 'none';
    if (!show) form.reset();
  }
};

window.triggerFilePicker = () => {
  document.getElementById('job-file-picker').click();
};

window.toggleEditMode = (edit) => {
  isEditMode = edit;
  renderDetailModalContent();
};

// Actions triggers inside expanded modal

// Change job status
window.updateJobStatus = async (jobId, statusId) => {
  try {
    await apiFetch(`/api/jobs/${jobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status_id: parseInt(statusId, 10) })
    });

    const statusObj = statuses.find(s => String(s.id) === String(statusId));
    const statusLabel = statusObj ? statusObj.label : 'Unknown';
    const formattedNote = `Application status changed to ${statusLabel}`;

    await apiFetch(`/api/jobs/${jobId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: formattedNote,
        originator_type: 'user',
        contact_id: null
      })
    });

    fetchDashboardData(); // Refreshes app.js state
    openJobDetailModal(jobId); // Keep open, refresh popup
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// Snooze stale alert
window.snoozeStaleAlert = async (jobId) => {
  try {
    await apiFetch(`/api/jobs/${jobId}/snooze`, { method: 'POST' });
    fetchDashboardData();
    openJobDetailModal(jobId);
    showToast('Stale alert snoozed successfully.', 'success');
  } catch (err) {
    console.error(err);
  }
};

// Add note
window.submitJobNote = async (e, jobId) => {
  e.preventDefault();
  const select = document.getElementById('note-originator-select');
  const textarea = document.getElementById('note-content-input');
  
  if (!textarea.value.trim()) return;

  let originator_type = 'none';
  let contact_id = null;

  if (select.value === 'user') {
    originator_type = 'user';
  } else if (select.value === 'other_generic') {
    originator_type = 'other';
  } else if (select.value.startsWith('contact_')) {
    originator_type = 'recruiter';
    contact_id = parseInt(select.value.split('_')[1], 10);
  }

  try {
    await apiFetch(`/api/jobs/${jobId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: textarea.value.trim(),
        originator_type,
        contact_id
      })
    });
    textarea.value = '';
    openJobDetailModal(jobId);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// Add contact
window.submitJobContact = async (e, jobId) => {
  e.preventDefault();
  const name = document.getElementById('contact-name-input').value;
  const email = document.getElementById('contact-email-input').value;
  const phone = document.getElementById('contact-phone-input').value;

  try {
    await apiFetch(`/api/jobs/${jobId}/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone })
    });
    toggleWidgetForm('contact-widget-form', false);
    openJobDetailModal(jobId);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// Add calendar event
window.submitJobSchedule = async (e, jobId) => {
  e.preventDefault();
  const description = document.getElementById('sch-desc').value;
  const startDate = document.getElementById('sch-start-date').value;
  const startTime = document.getElementById('sch-start-time').value;
  const endDate = document.getElementById('sch-end-date').value;
  const endTime = document.getElementById('sch-end-time').value;
  
  const start24 = parseTimeTo24h(startTime);
  const end24 = parseTimeTo24h(endTime);
  if (!start24 || !end24) {
    showToast('Please enter a valid time (e.g. 09:30 AM or 14:00).', 'warning');
    return;
  }
  const start_time = `${startDate}T${start24}`;
  const end_time = `${endDate}T${end24}`;
  
  const isSafe = await validateCalendarEvent(start_time, end_time);
  if (!isSafe) return;
  
  const timezone = document.getElementById('sch-tz').value;
  const event_type_id = parseInt(document.getElementById('sch-type').value, 10);
  const is_tentative = document.getElementById('sch-tentative').checked;

  if (!timezone) {
    showToast('Please select a valid time zone!', 'warning');
    return;
  }

  try {
    await apiFetch(`/api/jobs/${jobId}/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, start_time, end_time, timezone, event_type_id, is_tentative })
    });
    toggleWidgetForm('schedule-widget-form', false);
    openJobDetailModal(jobId);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// File Upload
window.uploadJobFile = async (jobId) => {
  const picker = document.getElementById('job-file-picker');
  const file = picker.files[0];
  if (!file) return;

  const allowed = ['.pdf', '.docx'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  if (!allowed.includes(ext)) {
    showToast('Only .pdf and .docx file attachments are allowed!', 'warning');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(`/api/jobs/${jobId}/files`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error || 'Upload failed', 'error');
    } else {
      openJobDetailModal(jobId);
    }
  } catch (err) {
    console.error(err);
  }
};

// Save edits
window.saveJobDetailsEdit = async (e, jobId) => {
  e.preventDefault();
  const body = {
    organization: document.getElementById('edit-org').value.trim(),
    title: document.getElementById('edit-title').value.trim(),
    posted_date: document.getElementById('edit-posted').value || null,
    end_date: document.getElementById('edit-posted-end').value || null,
    status_id: parseInt(document.getElementById('edit-status').value, 10) || null,
    target_url: document.getElementById('edit-url').value.trim() || null,
    salary_range: document.getElementById('edit-salary').value.trim() || null,
    other_compensation: document.getElementById('edit-comp').value.trim() || null,
    description: document.getElementById('edit-desc').value.trim() || null,
    required_experience: document.getElementById('edit-req').value.trim() || null,
    preferred_experience: document.getElementById('edit-pref').value.trim() || null,
    location: document.getElementById('edit-location').value.trim() || null,
    remote: document.getElementById('edit-remote').checked ? 1 : 0,
    requisition_id: document.getElementById('edit-req-id').value.trim() || null
  };

  if (body.posted_date && body.end_date && body.end_date <= body.posted_date) {
    showToast('Safety Check: The End Date (closes date) must be after the Posted Date!', 'warning');
    return;
  }

  try {
    await apiFetch(`/api/jobs/${jobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    isEditMode = false;
    await fetchDashboardData();
    openJobDetailModal(jobId);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// Delete job opportunity (triggers custom confirm modal)
window.deleteJobOpportunity = (jobId) => {
  jobIdToDelete = jobId;
  const modal = document.getElementById('delete-confirm-modal');
  if (modal) modal.classList.add('active');
};

window.closeDeleteConfirmModal = () => {
  jobIdToDelete = null;
  const modal = document.getElementById('delete-confirm-modal');
  if (modal) modal.classList.remove('active');
};

window.confirmDeleteJobOpportunity = async () => {
  if (!jobIdToDelete) return;
  try {
    await apiFetch(`/api/jobs/${jobIdToDelete}`, { method: 'DELETE' });
    closeDeleteConfirmModal();
    closeJobDetailModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
};


// --- Note Editing functions ---
window.enterNoteEditMode = (noteId) => {
  document.getElementById(`note-view-${noteId}`).style.display = 'none';
  document.getElementById(`note-edit-${noteId}`).style.display = 'block';
};

window.cancelNoteEditMode = (noteId) => {
  document.getElementById(`note-view-${noteId}`).style.display = 'block';
  document.getElementById(`note-edit-${noteId}`).style.display = 'none';
};

window.saveNoteEdit = async (noteId, jobId) => {
  const content = document.getElementById(`note-edit-textarea-${noteId}`).value;
  if (!content.trim()) {
    showToast('Note content cannot be empty.', 'warning');
    return;
  }
  
  try {
    await apiFetch(`/api/notes/${noteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    openJobDetailModal(jobId);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// --- Calendar Event Editing functions ---
window.openEditEventModal = (eventId, jobId) => {
  const evt = globalEvents.find(e => e.id === eventId);
  if (!evt) return;

  document.getElementById('edit-event-id').value = evt.id;
  document.getElementById('edit-event-job-id').value = jobId;
  document.getElementById('edit-event-desc').value = evt.description || '';
  
  const start = parseTzNaive(evt.start_time);
  const end = parseTzNaive(evt.end_time);
  
  const formatDateStr = (date) => {
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  const formatTimeStr = (date) => {
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
  };
  
  document.getElementById('edit-event-start-date').value = formatDateStr(start);
  document.getElementById('edit-event-start-time').value = formatTimeStr(start);
  document.getElementById('edit-event-end-date').value = formatDateStr(end);
  document.getElementById('edit-event-end-time').value = formatTimeStr(end);
  const editTzSelect = document.getElementById('edit-event-tz');
  if (editTzSelect) {
    editTzSelect.innerHTML = '<option value="">-- Select Timezone --</option>';
    timezones.forEach(tz => {
      const opt = document.createElement('option');
      opt.value = tz.name;
      opt.textContent = tz.label;
      if (tz.name === (evt.timezone || settings.default_timezone || 'America/Los_Angeles')) {
        opt.selected = true;
      }
      editTzSelect.appendChild(opt);
    });
  }
  document.getElementById('edit-event-tentative').checked = evt.is_tentative === 1 || evt.is_tentative === true;

  // Populate Event Type dropdown
  const typeSelect = document.getElementById('edit-event-type');
  if (typeSelect) {
    typeSelect.innerHTML = '';
    eventTypes.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label;
      if (t.id === evt.event_type_id) {
        opt.selected = true;
      }
      typeSelect.appendChild(opt);
    });
  }

  document.getElementById('edit-event-modal').classList.add('active');
  
  document.getElementById('btn-delete-event').onclick = async () => {
    const confirmed = await showConfirmDialog(
      '🗑️ Delete Calendar Event?',
      'Delete this calendar event permanently? This cannot be undone.',
      'Delete Event'
    );
    if (confirmed) {
      try {
        await apiFetch(`/api/calendar/${evt.id}`, { method: 'DELETE' });
        closeEditEventModal();
        const detailModal = document.getElementById('job-detail-modal');
        if (detailModal && detailModal.classList.contains('active') && selectedJobId === jobId) {
          openJobDetailModal(jobId);
        }
        renderCalendar();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  };

  document.getElementById('btn-view-job-details').onclick = () => {
    closeEditEventModal();
    openJobDetailModal(jobId);
  };
};

window.closeEditEventModal = () => {
  document.getElementById('edit-event-modal').classList.remove('active');
};

// Validates dates and checks for conflicting overlaps, returns true if safe to save
async function validateCalendarEvent(startTimeStr, endTimeStr, eventIdToIgnore = null) {
  const start = new Date(startTimeStr);
  const end = new Date(endTimeStr);
  
  if (end <= start) {
    showToast('Safety Check Failed: The end date/time must be after the start date/time!', 'warning');
    return false;
  }
  
  let calendarEvents = [];
  try {
    calendarEvents = await apiFetch('/api/calendar');
  } catch (err) {
    console.error("Failed to fetch calendar events for safety check", err);
  }
  
  const overlaps = [];
  calendarEvents.forEach(evt => {
    if (eventIdToIgnore && String(evt.id) === String(eventIdToIgnore)) {
      return;
    }
    
    const evtStart = new Date(evt.start_time);
    const evtEnd = new Date(evt.end_time);
    
    if (start < evtEnd && end > evtStart) {
      overlaps.push(evt);
    }
  });
  
  if (overlaps.length > 0) {
    const conflictNames = overlaps.map(o => `  • ${o.organization_name}: ${o.event_type_label || 'Event'} (${o.description || 'No description'}) on ${parseTzNaive(o.start_time).toLocaleString()}`).join('\n');
    return await showConfirmDialog(
      '⚠️ Scheduling Conflict',
      `The scheduled window overlaps with existing event(s):\n\n${conflictNames}\n\nDo you want to proceed and save this event anyway?`,
      'Save Anyway',
      true
    );
  }
  
  return true;
}

// Parse user typed time string into standard HH:MM (24h) format
function parseTimeTo24h(timeStr) {
  if (!timeStr) return null;
  timeStr = timeStr.trim().toUpperCase();
  
  // 1. Check HH:MM AM/PM or H:MM AM/PM
  const ampmMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2];
    const ampm = ampmMatch[3];
    
    if (ampm === 'PM' && hours < 12) {
      hours += 12;
    } else if (ampm === 'AM' && hours === 12) {
      hours = 0;
    }
    
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }
  
  // 2. Check plain HH AM/PM or H AM/PM (e.g. "9 AM" or "9PM")
  const ampmOnlyMatch = timeStr.match(/^(\d{1,2})\s*(AM|PM)$/);
  if (ampmOnlyMatch) {
    let hours = parseInt(ampmOnlyMatch[1], 10);
    const ampm = ampmOnlyMatch[2];
    if (ampm === 'PM' && hours < 12) hours += 12;
    else if (ampm === 'AM' && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:00`;
  }
  
  // 3. Check 24h format HH:MM
  const h24Match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (h24Match) {
    const hours = parseInt(h24Match[1], 10);
    const minutes = h24Match[2];
    if (hours >= 0 && hours < 24) {
      return `${String(hours).padStart(2, '0')}:${minutes}`;
    }
  }
  
  return null;
}

// --- Custom Time Picker Combobox Dropdown Helper Logic ---
function showCustomTimeDropdown(input) {
  let dropdown = input.nextElementSibling;
  if (!dropdown || !dropdown.classList.contains('custom-time-dropdown')) {
    dropdown = document.createElement('div');
    dropdown.className = 'custom-time-dropdown';
    
    const parent = input.parentElement;
    if (parent && getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    
    input.parentNode.insertBefore(dropdown, input.nextSibling);
    
    dropdown.addEventListener('click', (optEvent) => {
      const option = optEvent.target.closest('.custom-time-option');
      if (option) {
        input.value = option.dataset.value;
        dropdown.classList.remove('active');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    input.addEventListener('input', () => {
      populateCustomTimeOptions(input, dropdown, false);
      dropdown.classList.add('active');
    });
  }
  
  populateCustomTimeOptions(input, dropdown, true);
  closeAllTimeDropdowns();
  dropdown.classList.add('active');
}

function populateCustomTimeOptions(input, dropdown, ignoreFilter = false) {
  const query = ignoreFilter ? '' : input.value.trim().toUpperCase();
  dropdown.innerHTML = '';
  
  const slots = [
    "12:00 AM", "12:30 AM", "01:00 AM", "01:30 AM", "02:00 AM", "02:30 AM",
    "03:00 AM", "03:30 AM", "04:00 AM", "04:30 AM", "05:00 AM", "05:30 AM",
    "06:00 AM", "06:30 AM", "07:00 AM", "07:30 AM", "08:00 AM", "08:30 AM",
    "09:00 AM", "09:30 AM", "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM",
    "12:00 PM", "12:30 PM", "01:00 PM", "01:30 PM", "02:00 PM", "02:30 PM",
    "03:00 PM", "03:30 PM", "04:00 PM", "04:30 PM", "05:00 PM", "05:30 PM",
    "06:00 PM", "06:30 PM", "07:00 PM", "07:30 PM", "08:00 PM", "08:30 PM",
    "09:00 PM", "09:30 PM", "10:00 PM", "10:30 PM", "11:00 PM", "11:30 PM"
  ];
  
  const filtered = query ? slots.filter(s => s.toUpperCase().includes(query)) : slots;
  const listToRender = filtered.length > 0 ? filtered : slots;
  
  const currentValue = input.value.trim().toUpperCase();
  
  listToRender.forEach(slot => {
    const div = document.createElement('div');
    div.className = 'custom-time-option';
    if (slot.toUpperCase() === currentValue) {
      div.classList.add('current');
      div.style.fontWeight = 'bold';
      div.style.background = 'rgba(255, 255, 255, 0.15)';
    }
    div.dataset.value = slot;
    div.textContent = slot;
    dropdown.appendChild(div);
  });

  if (currentValue) {
    const currentOpt = dropdown.querySelector('.current');
    if (currentOpt) {
      setTimeout(() => {
        currentOpt.scrollIntoView({ block: 'center' });
      }, 30);
    }
  }
}

function closeAllTimeDropdowns() {
  document.querySelectorAll('.custom-time-dropdown').forEach(d => {
    d.classList.remove('active');
  });
}

// --- UI Escapes Helpers ---
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Intercept rich text pastes on specific fields and convert them to formatted plain text list items (bullets)
function setupRichTextPasteInterceptors() {
  const selectors = [
    '#job-comp', '#job-desc', '#job-req', '#job-pref',
    '#edit-comp', '#edit-desc', '#edit-req', '#edit-pref'
  ];

  document.addEventListener('paste', function(e) {
    const target = e.target;
    const isTarget = selectors.some(sel => target.matches(sel));
    if (!isTarget) return;

    const html = e.clipboardData.getData('text/html');
    if (!html) return; // Allow standard plain-text paste if HTML clipboard data is empty

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // If it contains bullet lists or block elements
    const hasStructure = doc.querySelector('li, ul, ol, p, br, div');
    if (!hasStructure) return;

    // Helper function to recursively format nodes
    function convertNodeToText(node) {
      let text = '';
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
      }
      
      const tagName = node.tagName ? node.tagName.toLowerCase() : '';
      
      if (tagName === 'li') {
        let bullet = '• ';
        const parent = node.parentNode;
        if (parent && parent.tagName.toLowerCase() === 'ol') {
          const index = Array.from(parent.children).indexOf(node) + 1;
          bullet = `${index}. `;
        }
        
        let liContent = '';
        node.childNodes.forEach(child => {
          liContent += convertNodeToText(child);
        });
        return bullet + liContent.trim() + '\n';
      }
      
      if (tagName === 'ul' || tagName === 'ol') {
        node.childNodes.forEach(child => {
          text += convertNodeToText(child);
        });
        return text + '\n';
      }

      if (tagName === 'p' || tagName === 'div' || tagName === 'h1' || tagName === 'h2' || tagName === 'h3' || tagName === 'h4') {
        node.childNodes.forEach(child => {
          text += convertNodeToText(child);
        });
        return text.trim() + '\n';
      }

      if (tagName === 'br') {
        return '\n';
      }

      // Default: process children
      node.childNodes.forEach(child => {
        text += convertNodeToText(child);
      });
      return text;
    }

    let formattedText = convertNodeToText(doc.body).trim();
    // Normalize line breaks
    formattedText = formattedText.replace(/\r\n/g, '\n');
    formattedText = formattedText.replace(/\n{3,}/g, '\n\n');

    if (formattedText) {
      e.preventDefault();
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const value = target.value;
      
      target.value = value.substring(0, start) + formattedText + value.substring(end);
      target.selectionStart = target.selectionEnd = start + formattedText.length;
      
      // Manually trigger standard input event so form dirty states or resize triggers update
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

// --- App Load Bootstrap ---
document.addEventListener('DOMContentLoaded', () => {
  setupRichTextPasteInterceptors();

  // Bind board sorting and filtering listeners
  const boardSortSelect = document.getElementById('board-sort-select');
  if (boardSortSelect) {
    boardSortSelect.addEventListener('change', (e) => {
      boardSortPref = e.target.value;
      boardSortSelect.dataset.userChanged = 'true';
      renderKanbanBoard();
    });
  }

  const filterLocationInput = document.getElementById('filter-location');
  if (filterLocationInput) {
    filterLocationInput.addEventListener('input', (e) => {
      filterLocation = e.target.value.trim().toLowerCase();
      renderKanbanBoard();
    });
  }

  const filterRemoteCheckbox = document.getElementById('filter-remote-only');
  if (filterRemoteCheckbox) {
    filterRemoteCheckbox.addEventListener('change', (e) => {
      filterRemoteOnly = e.target.checked;
      renderKanbanBoard();
    });
  }

  // Bind focusout event delegation for salary auto-formatting
  document.addEventListener('focusout', (e) => {
    if (e.target && (e.target.id === 'job-salary' || e.target.id === 'edit-salary')) {
      e.target.value = parseAndFormatSalary(e.target.value);
    }
  });

  // Bind form submit for edit event
  const editEventForm = document.getElementById('edit-event-form');
  if (editEventForm) {
    editEventForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const eventId = document.getElementById('edit-event-id').value;
      const jobId = parseInt(document.getElementById('edit-event-job-id').value, 10);
      const description = document.getElementById('edit-event-desc').value;
      const startDate = document.getElementById('edit-event-start-date').value;
      const startTime = document.getElementById('edit-event-start-time').value;
      const endDate = document.getElementById('edit-event-end-date').value;
      const endTime = document.getElementById('edit-event-end-time').value;
      
      const start24 = parseTimeTo24h(startTime);
      const end24 = parseTimeTo24h(endTime);
      if (!start24 || !end24) {
        showToast('Please enter a valid time (e.g. 09:30 AM or 14:00).', 'warning');
        return;
      }
      const start_time = `${startDate}T${start24}`;
      const end_time = `${endDate}T${end24}`;
      
      const isSafe = await validateCalendarEvent(start_time, end_time, eventId);
      if (!isSafe) return;
      
      const timezone = document.getElementById('edit-event-tz').value;
      const event_type_id = parseInt(document.getElementById('edit-event-type').value, 10);
      const is_tentative = document.getElementById('edit-event-tentative').checked;

      try {
        await apiFetch(`/api/calendar/${eventId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description, start_time, end_time, timezone, event_type_id, is_tentative })
        });
        closeEditEventModal();
        const detailModal = document.getElementById('job-detail-modal');
        if (detailModal && detailModal.classList.contains('active') && selectedJobId === jobId) {
          openJobDetailModal(jobId);
        }
        renderCalendar();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Bind form submit for create event type
  const createEventTypeForm = document.getElementById('create-event-type-form');
  if (createEventTypeForm) {
    createEventTypeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const labelInput = document.getElementById('new-event-type-label');
      const colorInput = document.getElementById('new-event-type-color');
      
      const maxOrder = eventTypes.length > 0 ? Math.max(...eventTypes.map(t => t.sort_order)) : 0;

      try {
        await apiFetch('/api/event_types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: labelInput.value.trim(),
            color: colorInput.value,
            sort_order: maxOrder + 1
          })
        });
        labelInput.value = '';
        fetchDashboardData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
  
  // Handle Date picker popups and close custom dropdowns on click outside
  document.addEventListener('click', (e) => {
    if (e.target && e.target.type === 'date') {
      try {
        e.target.showPicker();
      } catch (err) {
        console.warn('showPicker is not supported in this browser context:', err);
      }
    }
    
    if (e.target && e.target.classList.contains('time-picker-input')) {
      showCustomTimeDropdown(e.target);
    }
    
    if (e.target && !e.target.classList.contains('time-picker-input') && !e.target.closest('.custom-time-dropdown')) {
      closeAllTimeDropdowns();
    }
    
    // Close notification dropdown when clicking outside
    const notiDropdown = document.getElementById('notification-dropdown');
    if (notiDropdown && notiDropdown.classList.contains('active') && !e.target.closest('.notification-wrapper')) {
      notiDropdown.classList.remove('active');
    }
  });

  document.addEventListener('focusin', (e) => {
    if (e.target && e.target.classList.contains('time-picker-input')) {
      showCustomTimeDropdown(e.target);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllTimeDropdowns();
    }
  });

  // Notification dropdown and actions binding
  const btnNotiTrigger = document.getElementById('btn-notification-trigger');
  const notiDropdown = document.getElementById('notification-dropdown');
  if (btnNotiTrigger && notiDropdown) {
    btnNotiTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      notiDropdown.classList.toggle('active');
    });
    notiDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  const btnClearAll = document.getElementById('btn-clear-all-alerts');
  if (btnClearAll) {
    btnClearAll.addEventListener('click', (e) => {
      e.stopPropagation();
      acknowledgeAllNotifications();
    });
  }

  const btnViewHistory = document.getElementById('btn-view-history');
  if (btnViewHistory) {
    btnViewHistory.addEventListener('click', (e) => {
      e.stopPropagation();
      if (notiDropdown) notiDropdown.classList.remove('active');
      openNotificationHistoryModal();
    });
  }

  // Mobile navigation menu toggle and outside click auto-dismissal logic
  const mobileToggle = document.getElementById('mobile-menu-toggle');
  const navLinks = document.getElementById('sidebar-nav-links');

  if (mobileToggle && navLinks) {
    mobileToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      navLinks.classList.toggle('mobile-active');
    });

    const navItems = navLinks.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        navLinks.classList.remove('mobile-active');
      });
    });

    document.addEventListener('click', (e) => {
      if (!navLinks.contains(e.target) && !mobileToggle.contains(e.target)) {
        navLinks.classList.remove('mobile-active');
      }
    });
  }

  // Helper to calculate the next 30-minute block/entry
  function getNext30MinSlot(timeStr) {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return '';
    let hours = parseInt(match[1], 10);
    let minutes = parseInt(match[2], 10);
    const ampm = match[3].toUpperCase();

    if (ampm === 'PM' && hours < 12) {
      hours += 12;
    } else if (ampm === 'AM' && hours === 12) {
      hours = 0;
    }

    minutes += 30;
    if (minutes >= 60) {
      minutes -= 60;
      hours += 1;
    }
    if (hours >= 24) {
      hours -= 24;
    }

    let nextAmpm = 'AM';
    if (hours >= 12) {
      nextAmpm = 'PM';
      if (hours > 12) {
        hours -= 12;
      }
    } else if (hours === 0) {
      hours = 12;
    }

    const paddedHours = String(hours).padStart(2, '0');
    const paddedMinutes = String(minutes).padStart(2, '0');
    return `${paddedHours}:${paddedMinutes} ${nextAmpm}`;
  }

  // Intercept date/time selection to auto-fill end date/time
  document.addEventListener('input', (e) => {
    if (!e.target) return;
    if (e.target.id === 'sch-start-date') {
      const endEl = document.getElementById('sch-end-date');
      if (endEl) endEl.value = e.target.value;
    } else if (e.target.id === 'sch-start-time') {
      const endEl = document.getElementById('sch-end-time');
      if (endEl) endEl.value = getNext30MinSlot(e.target.value);
    } else if (e.target.id === 'edit-event-start-date') {
      const endEl = document.getElementById('edit-event-end-date');
      if (endEl) endEl.value = e.target.value;
    } else if (e.target.id === 'edit-event-start-time') {
      const endEl = document.getElementById('edit-event-end-time');
      if (endEl) endEl.value = getNext30MinSlot(e.target.value);
    }
  });

  fetchDashboardData();
});
