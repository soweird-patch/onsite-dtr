const root = document.getElementById('app');
const state = {
  session: null, section: 'home', employeeData: { punches: [], overtime: [] },
  employees: [], adminData: { punches: [], overtime: [] }, historyRange: null,
  adminRange: null, reportRange: null, selectedEmployee: null, capture: null,
  cameraStream: null, sitePromptedDate: null, installPrompt: null, modal: null, auditItems: [],
  message: '', messageType: 'notice'
};

const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const today = () => state.session?.today;
const config = () => state.session?.settings;
const currentRange = () => state.session?.cutoff;
const timeZone = 'Asia/Manila';
const toMinutes = text => Number(text?.slice(0, 2) || 0) * 60 + Number(text?.slice(3, 5) || 0);

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...options,
      headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers });
  } catch { throw new Error('No connection. Attendance was not saved. Please contact admin if you cannot connect.'); }
  let data = {};
  try { data = await response.json(); } catch { /* no JSON */ }
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') { state.session = null; render(); }
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
}

function flash(message, type = 'notice') {
  state.message = message; state.messageType = type;
  const box = document.getElementById('flash');
  if (box) { box.className = `notice ${type}`; box.textContent = message; box.hidden = false; }
  else render();
}
function formatTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-PH', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}
function time24(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
function prettyDate(date) {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}
function dateSpan(range) { return `${prettyDate(range.start || range.from)} – ${prettyDate(range.end || range.to)}`; }
function weekday(date) { return new Date(`${date}T00:00:00Z`).getUTCDay(); }
function yesterday(date) { return new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10); }
function tomorrow(date) { return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10); }
function cutoffFor(date) {
  const [year, month, day] = date.split('-').map(Number);
  const starts = [...config().cutoffDays].sort((a, b) => a - b);
  let sy = year, sm = month, sd = starts[0];
  if (day >= starts[1]) sd = starts[1];
  else if (day < starts[0]) { sm--; if (!sm) { sm = 12; sy--; } sd = starts[1]; }
  let ny = sy, nm = sm, nd = sd === starts[0] ? starts[1] : starts[0];
  if (sd === starts[1]) { nm++; if (nm === 13) { nm = 1; ny++; } }
  const pad = n => String(n).padStart(2, '0');
  return { start: `${sy}-${pad(sm)}-${pad(sd)}`, end: yesterday(`${ny}-${pad(nm)}-${pad(nd)}`) };
}
function rangeUrl(path, range, employeeId) {
  const query = new URLSearchParams({ from: range.start, to: range.end });
  if (employeeId) query.set('employeeId', employeeId);
  return `${path}?${query}`;
}
function getTodayPunch(slot) { return state.employeeData.punches.find(p => p.workDate === today() && p.slot === slot); }
function badge(punch) {
  if (!punch) return '<span class="pill pending">Not recorded</span>';
  if (punch.method === 'ADMIN') return '<span class="pill admin">Created by admin</span>';
  if (punch.verification === 'PENDING') return '<span class="pill pending">Pending verification</span>';
  if (punch.verification === 'REJECTED') return '<span class="pill rejected">Rejected</span>';
  return `<span class="pill">${punch.method === 'ONSITE' ? 'Onsite' : 'Offsite'} verified</span>`;
}
function minutesStatus(inPunch, outPunch, employee) {
  return {
    late: inPunch ? Math.max(0, toMinutes(time24(inPunch.timeUtc)) - toMinutes(employee.scheduleStart) - employee.graceMinutes) : 0,
    early: outPunch ? Math.max(0, toMinutes(employee.scheduleEnd) - toMinutes(time24(outPunch.timeUtc))) : 0
  };
}
function initials(name) { return String(name || '').split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase(); }
function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}
function statusOf(inPunch, outPunch) {
  if (!inPunch && !outPunch) return 'No record';
  if (!inPunch || !outPunch) return 'Incomplete';
  if (inPunch.verification === 'REJECTED' || outPunch.verification === 'REJECTED') return 'Needs correction';
  if (inPunch.verification === 'PENDING' || outPunch.verification === 'PENDING') return 'Pending verification';
  return 'Present';
}
function locationText(p) {
  if (!p) return '—';
  if (p.method === 'ADMIN') return 'Created by admin';
  return `${p.method === 'ONSITE' ? 'Site GPS' : 'Field GPS'} · ±${Math.round(p.accuracyM || 0)} m`;
}
function mapLink(p) {
  if (p?.latitude == null || p?.longitude == null) return '';
  const lat = Number(p.latitude), lng = Number(p.longitude);
  return `<a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}" target="_blank" rel="noopener noreferrer">Open map pin ↗</a>`;
}

async function refreshSession() { state.session = await api('/api/session'); }
async function loadEmployee(range = state.historyRange || currentRange()) {
  state.historyRange = range;
  state.employeeData = await api(rangeUrl('/api/attendance', range));
}
async function loadEmployees() { state.employees = (await api('/api/admin/employees')).employees; }
async function loadAdmin(range = state.adminRange || currentRange(), employeeId = null) {
  state.adminRange = range;
  state.adminData = await api(rangeUrl('/api/admin/attendance', range, employeeId));
}
async function go(section) {
  stopCamera(); state.section = section; state.modal = null; state.message = '';
  try {
    if (state.session.user.role === 'employee' && ['home', 'history'].includes(section)) await loadEmployee(section === 'home' ? currentRange() : state.historyRange || currentRange());
    if (state.session.user.role === 'admin') {
      if (['dashboard', 'employees', 'backfill', 'records', 'report'].includes(section)) await loadEmployees();
      if (['dashboard', 'records', 'report'].includes(section)) await loadAdmin(section === 'dashboard' ? currentRange() : section === 'report' ? state.reportRange || currentRange() : state.adminRange || currentRange());
      if (section === 'audit') state.auditItems = (await api('/api/admin/audit')).items;
    }
  } catch (error) { flash(error.message, 'error'); }
  render();
  if (section === 'home' && state.session?.user.role === 'employee') checkSitePrompt();
}

function renderLogin() {
  root.innerHTML = `<div class="login-wrap"><div class="login-art"><div class="brand"><span class="brand-icon">◈</span> Onsite DTR</div><div><div class="headline">Attendance made clear, wherever work happens.</div><p>Record onsite and field work with verified time, selfie, and GPS proof.</p></div><small class="muted">Secure employee and admin access</small></div><div class="login-panel"><div class="login-box"><p class="eyebrow">WELCOME BACK</p><h1>Sign in to your DTR</h1><p>Use the account created by your administrator.</p>${state.message ? `<div class="notice ${h(state.messageType)}">${h(state.message)}</div>` : ''}<form id="login-form"><div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="username" required></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><label class="check-row"><input type="checkbox" name="remember" checked> Remember me on this device</label><button class="btn block" type="submit">Sign in →</button></form><p class="tiny-label" style="margin-top:20px">Forgot your password? Ask your administrator for a reset.</p></div></div></div>`;
}

const employeeNav = [['home', '⌂', 'Home'], ['history', '▤', 'Attendance'], ['capture', '◎', 'Time clock'], ['profile', '◉', 'Profile']];
const adminNav = [['dashboard', '⌂', 'Home'], ['records', '▤', 'Records'], ['employees', '♙', 'Employees'], ['backfill', '＋', 'Add'], ['report', '▥', 'Reports']];
function renderShell() {
  const user = state.session.user, admin = user.role === 'admin';
  const nav = admin ? adminNav : employeeNav;
  root.innerHTML = `<div class="shell"><header class="topbar"><div class="brand"><span class="brand-icon">◈</span><span>Onsite DTR</span></div><div class="top-right"><span class="tiny-label">${admin ? 'Admin' : 'Employee'} · ${h(user.name)}</span><button class="avatar" data-nav="profile" aria-label="Open ${h(user.name)} profile">${h(initials(user.name))}</button></div></header><div id="offline" class="offline hidden">Offline — punches cannot be submitted. Contact admin if needed.</div><main class="container"><div id="flash" class="notice ${h(state.messageType)}" ${state.message ? '' : 'hidden'}>${h(state.message)}</div><div id="view"></div></main><nav class="bottom-nav" aria-label="Main navigation"><div class="bottom-inner">${nav.map(([id, icon, label]) => `<button class="nav-item ${state.section === id ? 'active' : ''}" data-nav="${id}" aria-label="${label}"><span class="nav-icon">${icon}</span>${label}</button>`).join('')}</div></nav></div><div id="modal-root"></div>`;
  renderView(); updateOnline();
  if (state.modal) showModal(state.modal);
}
function renderView() {
  const view = document.getElementById('view'); if (!view) return;
  const admin = state.session.user.role === 'admin';
  view.innerHTML = admin ? ({ dashboard: renderAdminHome, records: renderRecords, employees: renderEmployees, backfill: renderBackfill, report: renderReport, settings: renderSettings, profile: renderProfile, audit: renderAudit }[state.section] || renderAdminHome)()
    : ({ home: renderEmployeeHome, history: renderHistory, capture: renderCapture, profile: renderProfile }[state.section] || renderEmployeeHome)();
}
function render() { if (!state.session) renderLogin(); else renderShell(); }

function renderEmployeeHome() {
  const user = state.session.user, punches = state.employeeData.punches;
  const inPunch = getTodayPunch('IN'), outPunch = getTodayPunch('OUT');
  const current = currentRange(), days = new Set(punches.filter(p => p.slot === 'IN' && p.verification !== 'REJECTED').map(p => p.workDate));
  const late = punches.filter(p => p.slot === 'IN').reduce((n, p) => n + Math.max(0, toMinutes(time24(p.timeUtc)) - toMinutes(user.scheduleStart) - user.graceMinutes), 0);
  const early = punches.filter(p => p.slot === 'OUT').reduce((n, p) => n + Math.max(0, toMinutes(user.scheduleEnd) - toMinutes(time24(p.timeUtc))), 0);
  const action = !inPunch ? 'IN' : !outPunch ? 'OUT' : null;
  return `<div class="hero"><p class="eyebrow">${h(prettyDate(today()))}</p><h1>${greeting()}, ${h(user.name.split(' ')[0])}</h1><p>Here's your attendance at a glance.</p></div>
    <div class="grid"><section class="card wide"><div class="card-title"><span class="symbol">◷</span> TODAY'S ATTENDANCE</div><div class="pill ${statusOf(inPunch,outPunch) === 'Present' ? '' : 'pending'}">${h(statusOf(inPunch,outPunch))}</div><div class="punch-line"><span>AM In</span><strong class="${inPunch ? '' : 'missing'}">${h(formatTime(inPunch?.timeUtc))}</strong></div><div class="card-sub">${badge(inPunch)} ${h(locationText(inPunch))}</div><div class="punch-line"><span>PM Out</span><strong class="${outPunch ? '' : 'missing'}">${h(formatTime(outPunch?.timeUtc))}</strong></div><div class="card-sub">${badge(outPunch)} ${h(locationText(outPunch))}</div><div class="divider"></div><div class="card-sub">Schedule: ${h(user.scheduleStart)}–${h(user.scheduleEnd)} · ${h(user.graceMinutes)} min grace</div><div class="card-actions">${action ? `<button class="btn" data-action="capture-onsite" data-slot="${action}">${action === 'IN' ? 'Time In' : 'Time Out'} onsite</button><button class="btn secondary" data-action="capture-offsite" data-slot="${action}">Offsite DTR</button>` : `<button class="btn secondary" data-nav="history">View logs</button>`}</div></section>
    <section class="card"><div class="card-title"><span class="symbol">▤</span> CURRENT CUTOFF</div><div class="card-sub">${h(dateSpan(current))}</div><div class="metric-row"><div class="metric-cell"><div class="metric green">${days.size}</div><span class="label">Days with Time In</span></div><div class="metric-cell"><div class="metric amber">${late}</div><span class="label">Late minutes</span></div></div><p class="card-sub">Early out: ${early} min</p><button class="link-button" data-nav="history">View cutoff details ›</button></section>
    <section class="card"><div class="card-title"><span class="symbol">◌</span> KAMUSTA KA?</div><p class="card-sub">See your previous attendance, verification results, and past payroll cutoffs.</p><div class="card-actions"><button class="btn secondary" data-nav="history">Previous attendance →</button></div></section></div>
    <div style="height:16px"></div><div class="notice">${config().configured ? `Onsite Time In is available only inside <strong>${h(config().siteName)}</strong> (${h(config().radiusM)} m radius).` : 'Admin needs to set the site GPS pin before onsite punches can be used.'} Selfie and device location are required for both onsite and offsite punches.</div>`;
}

function renderHistory() {
  const range = state.historyRange || currentRange();
  const grouped = new Map();
  for (const p of state.employeeData.punches) {
    if (!grouped.has(p.workDate)) grouped.set(p.workDate, {});
    grouped.get(p.workDate)[p.slot] = p;
  }
  const sorted = [...grouped.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  return `<div class="section-head"><div><p class="eyebrow">MY RECORDS</p><h1 class="section-title">Attendance history</h1><p>Only your own DTR entries are shown.</p></div></div><div class="card"><div class="section-head"><strong>Payroll cutoff</strong><div><button class="btn small secondary" data-action="cutoff-prev" aria-label="Previous cutoff">‹</button> <button class="btn small secondary" data-action="cutoff-next" aria-label="Next cutoff">›</button></div></div><strong style="color:var(--teal)">${h(dateSpan(range))}</strong><form id="history-form" class="filters" style="margin-top:16px"><div class="field"><label>From</label><input type="date" name="from" value="${h(range.start)}" required></div><div class="field"><label>To</label><input type="date" name="to" value="${h(range.end)}" required></div><button class="btn secondary" type="submit">Show</button></form></div><div style="height:16px"></div>${sorted.length ? `<div class="list">${sorted.map(([date, pair]) => { const status = statusOf(pair.IN, pair.OUT), mins = minutesStatus(pair.IN, pair.OUT, state.session.user); return `<div class="list-item"><div><strong>${h(prettyDate(date))}</strong><p>${h(status)} · Late ${mins.late} min · Early ${mins.early} min</p><p>In: ${h(formatTime(pair.IN?.timeUtc))} (${h(pair.IN?.method || '—')}) · Out: ${h(formatTime(pair.OUT?.timeUtc))} (${h(pair.OUT?.method || '—')})</p><p>${pair.IN?.verification === 'REJECTED' ? `Time In rejected: ${h(pair.IN.rejectionReason)}` : ''} ${pair.OUT?.verification === 'REJECTED' ? `Time Out rejected: ${h(pair.OUT.rejectionReason)}` : ''}</p></div><div class="right">${badge(pair.IN || pair.OUT)}</div></div>`; }).join('')}</div>` : '<div class="empty">No attendance records in this date range.</div>'}`;
}

function renderCapture() {
  const c = state.capture || { method: 'ONSITE', slot: getTodayPunch('IN') ? 'OUT' : 'IN', location: null, selfie: null, note: '' };
  state.capture = c;
  const site = config();
  const distance = c.location && site.configured ? Math.round(haversine(c.location.latitude, c.location.longitude, site.siteLat, site.siteLng)) : null;
  const allowed = c.method !== 'ONSITE' || (distance !== null && distance <= site.radiusM && c.location?.accuracyM <= site.maxAccuracyM);
  return `<div class="section-head"><div><p class="eyebrow">TIME CLOCK</p><h1 class="section-title">${c.slot === 'IN' ? 'Time In' : 'Time Out'}</h1><p>${h(prettyDate(today()))} · ${h(c.method === 'ONSITE' ? 'Onsite' : 'Offsite / field')}</p></div></div><div class="split"><div class="card"><div class="card-title"><span class="symbol">◎</span> ${c.method === 'ONSITE' ? 'ONSITE' : 'OFFSITE'} ${c.slot === 'IN' ? 'TIME IN' : 'TIME OUT'}</div><div class="field"><label>Work location type</label><select id="capture-method"><option value="ONSITE" ${c.method === 'ONSITE' ? 'selected' : ''}>Onsite — ${h(site.siteName)}</option><option value="OFFSITE" ${c.method === 'OFFSITE' ? 'selected' : ''}>Offsite / field</option></select></div>${c.method === 'OFFSITE' ? `<div class="field"><label for="capture-note">Field location / assignment</label><input id="capture-note" maxlength="300" placeholder="e.g. Client visit at Quezon City" value="${h(c.note)}" required></div>` : ''}
    <div class="card-title"><span class="symbol">◉</span> DEVICE LOCATION</div><div class="map-card">${c.location ? `<strong>${Number(c.location.latitude).toFixed(6)}, ${Number(c.location.longitude).toFixed(6)}</strong><small>Accuracy ±${Math.round(c.location.accuracyM)} m${distance !== null ? ` · ${distance} m from site pin` : ''}</small>` : '<span class="muted">Location not captured yet.</span>'}</div><div class="card-actions"><button class="btn secondary" data-action="location">${c.location ? 'Refresh location' : 'Get my location'}</button></div>${c.method === 'ONSITE' && c.location && !allowed ? `<p class="notice warn">You are outside the site radius or GPS accuracy is too low. Use Offsite DTR or retry location.</p>` : ''}
    <div class="divider"></div><button class="btn block" data-action="submit-punch" ${!c.location || !c.selfie || !allowed || (c.method === 'OFFSITE' && c.note.trim().length < 3) ? 'disabled' : ''}>Confirm ${c.slot === 'IN' ? 'Time In' : 'Time Out'}</button><p class="tiny-label">Official time is set by the server when the punch is saved. A success receipt appears only after confirmation.</p></div>
    <div class="card"><div class="card-title"><span class="symbol">▣</span> SELFIE PROOF</div><div class="camera-box" id="camera-box">${c.selfie ? `<img src="${c.selfie}" alt="Captured selfie preview">` : '<div class="camera-placeholder"><div class="symbol">◉</div><p>Take a clear selfie for this punch.</p></div>'}</div><div class="capture-actions"><button class="btn secondary" data-action="camera-start">Open camera</button><button class="btn secondary hidden" id="camera-snap" data-action="camera-snap">Take selfie</button><label class="btn ghost" for="selfie-file">Device camera fallback</label><input id="selfie-file" type="file" accept="image/*" capture="user" class="hidden"></div><p class="tiny-label">Selfie and GPS are required for both onsite and offsite employee punches. Admin-created attendance is clearly marked separately.</p></div></div>`;
}

function renderProfile() {
  const user = state.session.user;
  return `<div class="section-head"><div><p class="eyebrow">ACCOUNT</p><h1 class="section-title">Profile & security</h1></div></div><div class="split"><div class="card"><div class="card-title"><span class="symbol">◉</span> MY ACCOUNT</div><p><strong>${h(user.name)}</strong><br><span class="muted">${h(user.email)} · ${h(user.role)}</span></p>${user.role === 'employee' ? `<p class="card-sub">Schedule: ${h(user.scheduleStart)}–${h(user.scheduleEnd)} · Grace ${user.graceMinutes} min</p>` : ''}<div class="card-actions"><button class="btn secondary" data-action="logout">Sign out</button>${state.installPrompt ? '<button class="btn ghost" data-action="install">Install PWA</button>' : ''}</div></div><div class="card"><div class="card-title"><span class="symbol">◇</span> CHANGE PASSWORD</div><form id="password-form"><div class="field"><label>Current password</label><input name="currentPassword" type="password" autocomplete="current-password" required></div><div class="field"><label>New password (12+ characters)</label><input name="newPassword" type="password" minlength="12" autocomplete="new-password" required></div><button class="btn" type="submit">Update password</button></form></div></div>${user.role === 'admin' ? `<div class="card-actions"><button class="btn secondary" data-nav="settings">Site & cutoff settings →</button><button class="btn secondary" data-nav="audit">Audit trail →</button></div>` : ''}`;
}

function renderAudit() {
  return `<div class="section-head"><div><p class="eyebrow">ADMIN</p><h1 class="section-title">Audit trail</h1><p>Recent account, punch, review, and correction actions.</p></div></div>${state.auditItems.length ? `<div class="list">${state.auditItems.map(item => `<div class="list-item"><div><strong>${h(item.action.replaceAll('_', ' '))}</strong><p>${h(item.actor_name || 'System')} · ${h(item.target_type)} #${h(item.target_id)}</p><p>${h(new Date(item.created_at).toLocaleString('en-PH', { timeZone }))}</p></div></div>`).join('')}</div>` : '<div class="empty">No audit entries yet.</div>'}`;
}

function renderAdminHome() {
  const rows = state.adminData.punches, employees = state.employees;
  const todayRows = rows.filter(p => p.workDate === today());
  const present = new Set(todayRows.filter(p => p.slot === 'IN').map(p => p.userId)).size;
  const pending = rows.filter(p => p.verification === 'PENDING').length;
  const incomplete = new Set(todayRows.filter(p => p.slot === 'IN' && !todayRows.some(q => q.userId === p.userId && q.slot === 'OUT')).map(p => p.userId)).size;
  const recent = rows.slice(0, 8);
  return `<div class="hero"><p class="eyebrow">ADMIN DASHBOARD · ${h(prettyDate(today()))}</p><h1>Attendance overview</h1><p>Review field proofs and resolve missing records before payroll cutoff.</p></div><div class="mini-grid"><div class="stat-card"><div class="num">${employees.filter(e => e.active).length}</div><div class="label">Active employees</div></div><div class="stat-card"><div class="num">${present}</div><div class="label">Timed in today</div></div><div class="stat-card"><div class="num">${pending}</div><div class="label">Pending proofs</div></div><div class="stat-card"><div class="num">${incomplete}</div><div class="label">Incomplete today</div></div></div><div style="height:17px"></div><div class="grid"><div class="card"><div class="card-title"><span class="symbol">◎</span> SITE STATUS</div><p>${config().configured ? `<strong>${h(config().siteName)}</strong><br><span class="card-sub">${config().siteLat}, ${config().siteLng} · ${config().radiusM} m radius</span>` : '<span class="pill pending">Site GPS not configured</span>'}</p><button class="link-button" data-nav="settings">Manage site & cutoff ›</button></div><div class="card"><div class="card-title"><span class="symbol">▥</span> CURRENT CUTOFF</div><strong>${h(dateSpan(currentRange()))}</strong><p class="card-sub">Review exceptions and prepare printable payroll summary.</p><button class="link-button" data-nav="report">Open report ›</button></div></div><div style="height:23px"></div><div class="section-head"><h2 class="section-title">Recent punches</h2><button class="btn small secondary" data-nav="records">See all</button></div>${recent.length ? `<div class="list">${recent.map(recordItem).join('')}</div>` : '<div class="empty">No attendance punches in this cutoff yet.</div>'}`;
}
function recordItem(p) {
  return `<div class="list-item"><div><strong>${h(p.employeeName)}</strong><p>${h(prettyDate(p.workDate))} · ${h(p.slot === 'IN' ? 'Time In' : 'Time Out')} ${h(formatTime(p.timeUtc))} · ${h(p.method)}</p></div><div class="right">${badge(p)}<br><button class="link-button" data-action="record-detail" data-id="${p.id}">View proof ›</button></div></div>`;
}
function renderRecords() {
  const range = state.adminRange || currentRange();
  return `<div class="section-head"><div><p class="eyebrow">ADMIN</p><h1 class="section-title">Attendance records</h1><p>Review each Time In and Time Out location separately.</p></div></div><form id="records-filter" class="filters"><div class="field"><label>From</label><input type="date" name="from" value="${h(range.start)}" required></div><div class="field"><label>To</label><input type="date" name="to" value="${h(range.end)}" required></div><div class="field"><label>Employee</label><select name="employeeId"><option value="">All employees</option>${state.employees.map(e => `<option value="${e.id}">${h(e.name)}</option>`).join('')}</select></div><button class="btn secondary" type="submit">Filter</button></form>${state.adminData.punches.length ? `<div class="list">${state.adminData.punches.map(recordItem).join('')}</div>` : '<div class="empty">No attendance records for this filter.</div>'}`;
}
function renderEmployees() {
  const e = state.selectedEmployee;
  const days = e?.workdays || [1, 2, 3, 4, 5, 6];
  return `<div class="section-head"><div><p class="eyebrow">ADMIN</p><h1 class="section-title">Employees</h1><p>Create accounts and set individual schedules.</p></div><button class="btn small secondary" data-action="employee-new">New</button></div><div class="split"><div class="card"><div class="card-title"><span class="symbol">♙</span> ${e ? 'EDIT EMPLOYEE' : 'CREATE EMPLOYEE'}</div><form id="employee-form"><input type="hidden" name="id" value="${e?.id || ''}"><div class="field"><label>Name</label><input name="name" value="${h(e?.name || '')}" required maxlength="120"></div><div class="field"><label>Email / login</label><input name="email" type="email" value="${h(e?.email || '')}" required></div><div class="field"><label>${e ? 'New password (leave blank to keep)' : 'Temporary password (12+ characters)'}</label><input name="password" type="password" minlength="12" ${e ? '' : 'required'} autocomplete="new-password"></div><div class="field-row"><div class="field"><label>Shift start</label><input name="scheduleStart" type="time" value="${h(e?.scheduleStart || '08:30')}" required></div><div class="field"><label>Shift end</label><input name="scheduleEnd" type="time" value="${h(e?.scheduleEnd || '17:30')}" required></div></div><div class="field"><label>Workdays</label><div class="day-picker">${[['Sun',0],['Mon',1],['Tue',2],['Wed',3],['Thu',4],['Fri',5],['Sat',6]].map(([name,n]) => `<label><input type="checkbox" name="day" value="${n}" ${days.includes(n) ? 'checked' : ''}> ${name}</label>`).join('')}</div></div><div class="field"><label>Grace minutes</label><input name="graceMinutes" type="number" min="0" max="120" value="${e?.graceMinutes ?? 0}"></div>${e ? `<label class="check-row"><input name="active" type="checkbox" ${e.active ? 'checked' : ''}> Active account</label>` : ''}<button class="btn block" type="submit">${e ? 'Save employee' : 'Create account'}</button></form></div><div class="card"><div class="card-title"><span class="symbol">▤</span> EMPLOYEE LIST</div><div class="list">${state.employees.length ? state.employees.map(item => `<div class="list-item"><div><strong>${h(item.name)}</strong><p>${h(item.email)} · ${h(item.scheduleStart)}–${h(item.scheduleEnd)} ${item.active ? '' : '· Disabled'}</p></div><button class="btn small secondary" data-action="employee-edit" data-id="${item.id}">Edit</button></div>`).join('') : '<div class="empty">No employees yet.</div>'}</div></div></div>`;
}
function renderSettings() {
  const s = config();
  return `<div class="section-head"><div><p class="eyebrow">ADMIN SETTINGS</p><h1 class="section-title">Site & cutoff</h1><p>One site pin controls onsite Time In and Time Out.</p></div></div><div class="split"><div class="card"><div class="card-title"><span class="symbol">◎</span> SITE GPS</div><form id="settings-form"><div class="field"><label>Site name</label><input name="siteName" value="${h(s.siteName)}" required></div><div class="field-row"><div class="field"><label>Latitude</label><input name="siteLat" type="number" step="any" min="-90" max="90" value="${s.siteLat ?? ''}" required></div><div class="field"><label>Longitude</label><input name="siteLng" type="number" step="any" min="-180" max="180" value="${s.siteLng ?? ''}" required></div></div><button type="button" class="btn small secondary" data-action="site-my-location">Use my current location</button><p class="tiny-label">Use this only while physically at the site. Site edits are recorded in the audit trail.</p><div class="field-row"><div class="field"><label>Allowed radius (m)</label><input name="radiusM" type="number" min="25" max="2000" value="${s.radiusM}" required></div><div class="field"><label>Max GPS error (m)</label><input name="maxAccuracyM" type="number" min="10" max="500" value="${s.maxAccuracyM}" required></div></div><div class="divider"></div><div class="card-title"><span class="symbol">▤</span> PAYROLL CUTOFF</div><p class="card-sub">Enter the two start days. Example: 11 and 26 creates 11–25 and 26–10 periods.</p><div class="field-row"><div class="field"><label>First start day</label><input name="cutoffA" type="number" min="1" max="28" value="${s.cutoffDays[0]}" required></div><div class="field"><label>Second start day</label><input name="cutoffB" type="number" min="1" max="28" value="${s.cutoffDays[1]}" required></div></div><button class="btn block" type="submit">Save settings</button></form></div><div class="card"><div class="card-title"><span class="symbol">◇</span> HOW ONSITE WORKS</div><p class="card-sub">Employee login and attendance history work from anywhere. The site GPS pin only controls whether a punch can be labelled onsite.</p><p class="card-sub">Every employee punch still needs a selfie and current device location. If outside the radius, the employee uses Offsite DTR and the admin verifies it.</p><div class="map-card">${s.configured ? `<strong>${h(s.siteName)}</strong><small>${s.siteLat}, ${s.siteLng} · ${s.radiusM} m radius</small><a href="https://www.openstreetmap.org/?mlat=${s.siteLat}&mlon=${s.siteLng}#map=17/${s.siteLat}/${s.siteLng}" target="_blank" rel="noopener noreferrer">View site pin ↗</a>` : '<span class="muted">Pin not set yet.</span>'}</div></div></div>`;
}
function renderBackfill() {
  return `<div class="section-head"><div><p class="eyebrow">ADMIN</p><h1 class="section-title">Add attendance</h1><p>For no-signal field work or a documented correction.</p></div></div><div class="split"><div class="card"><div class="card-title"><span class="symbol">＋</span> ADMIN-CREATED RECORD</div><form id="backfill-form"><div class="field"><label>Employee</label><select name="employeeId" required><option value="">Select employee</option>${state.employees.map(e => `<option value="${e.id}">${h(e.name)}</option>`).join('')}</select></div><div class="field"><label>Work date</label><input name="workDate" type="date" value="${h(today())}" required></div><div class="field-row"><div class="field"><label>AM Time In (optional)</label><input name="timeIn" type="time"></div><div class="field"><label>PM Time Out (optional)</label><input name="timeOut" type="time"></div></div><div class="field"><label>Overtime minutes (optional)</label><input name="overtimeMinutes" type="number" min="0" max="1440" placeholder="0"></div><div class="field"><label>Reason / field assignment</label><textarea name="reason" minlength="5" maxlength="300" required placeholder="e.g. No mobile signal at client site"></textarea></div><label class="check-row"><input name="replaceExisting" type="checkbox"> Replace an existing punch with an audited correction</label><button class="btn block" type="submit">Save admin-created attendance</button></form></div><div class="card"><div class="card-title"><span class="symbol">ⓘ</span> AUDIT RULE</div><p class="card-sub">A selfie or GPS is not required for admin-created attendance. Employee and payroll views will show “Created by admin.” Existing records are retained when corrected.</p><p class="card-sub">Time In and Time Out can be entered separately. Time Out must be later than Time In.</p></div></div>`;
}
function reportRows() {
  const range = state.reportRange || currentRange();
  const punches = state.adminData.punches;
  const otMap = new Map(state.adminData.overtime.map(o => [`${o.user_id}|${o.work_date}`, o.minutes]));
  const employees = state.employees;
  return employees.map(e => {
    const rows = []; let totals = { present: 0, noRecord: 0, late: 0, early: 0, overtime: 0, pending: 0 };
    for (let date = range.start; date <= range.end; date = tomorrow(date)) {
      const pair = punches.filter(p => p.userId === e.id && p.workDate === date);
      const inPunch = pair.find(p => p.slot === 'IN'), outPunch = pair.find(p => p.slot === 'OUT');
      const scheduled = e.workdays.includes(weekday(date));
      if (!scheduled && !pair.length && !otMap.has(`${e.id}|${date}`)) continue;
      let status = statusOf(inPunch, outPunch);
      if (status === 'No record' && date > today()) status = 'Upcoming';
      else if (status === 'No record' && date === today()) status = 'Today · not recorded';
      const mins = minutesStatus(inPunch, outPunch, e);
      const overtime = otMap.get(`${e.id}|${date}`) || 0;
      if (status === 'Present') totals.present++;
      if (status === 'No record' && scheduled) totals.noRecord++;
      if (status === 'Pending verification' || status === 'Needs correction') totals.pending++;
      totals.late += mins.late; totals.early += mins.early; totals.overtime += overtime;
      rows.push({ date, inPunch, outPunch, status: scheduled ? status : `${status} (off day)`, late: mins.late, early: mins.early, overtime });
    }
    return { employee: e, rows, totals };
  });
}
function renderReport() {
  const range = state.reportRange || currentRange();
  const report = reportRows();
  return `<div class="section-head no-print"><div><p class="eyebrow">PAYROLL</p><h1 class="section-title">Cutoff report</h1><p>Review pending proofs before printing. No salary or deduction is calculated.</p></div><button class="btn" data-action="print">Print / Save PDF</button></div><form id="report-filter" class="filters no-print"><div class="field"><label>From</label><input type="date" name="from" value="${h(range.start)}" required></div><div class="field"><label>To</label><input type="date" name="to" value="${h(range.end)}" required></div><button class="btn secondary" type="submit">Show report</button></form><div class="report-sheet"><div class="report-head"><div><h2>Onsite DTR · Attendance Summary</h2><p class="muted">Cutoff: ${h(dateSpan(range))}<br>Timezone: Asia/Manila</p></div><small>Printed: ${h(new Date().toLocaleString('en-PH', { timeZone }))}</small></div>${report.map(({ employee, rows, totals }) => `<section class="report-employee"><h3>${h(employee.name)} <small class="muted">#${employee.id}</small></h3><p class="report-summary">Present ${totals.present} · No record ${totals.noRecord} · Late ${totals.late} min · Early out ${totals.early} min · Overtime ${totals.overtime} min · Exceptions ${totals.pending}</p><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Time In</th><th>In source</th><th>Time Out</th><th>Out source</th><th>Late</th><th>Early</th><th>OT</th><th>Status</th></tr></thead><tbody>${rows.map(r => `<tr><td>${h(prettyDate(r.date))}</td><td>${h(formatTime(r.inPunch?.timeUtc))}</td><td>${h(r.inPunch?.method === 'ADMIN' ? 'Created by admin' : r.inPunch?.method || '—')}</td><td>${h(formatTime(r.outPunch?.timeUtc))}</td><td>${h(r.outPunch?.method === 'ADMIN' ? 'Created by admin' : r.outPunch?.method || '—')}</td><td>${r.late}</td><td>${r.early}</td><td>${r.overtime}</td><td>${h(r.status)}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>`;
}

function haversine(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function geo() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is unavailable on this device.'));
    navigator.geolocation.getCurrentPosition(position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyM: position.coords.accuracy }),
      error => reject(new Error(error.code === 1 ? 'Location permission was denied. Enable it in browser settings.' : 'Unable to get current location. Move to an open area and retry.')),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 16000 });
  });
}
async function checkSitePrompt() {
  if (state.sitePromptedDate === today() || !config()?.configured || getTodayPunch('IN')) return;
  try {
    const permission = await navigator.permissions?.query({ name: 'geolocation' });
    if (permission && permission.state !== 'granted') return;
    const place = await geo();
    if (place.accuracyM <= config().maxAccuracyM && haversine(place.latitude, place.longitude, config().siteLat, config().siteLng) <= config().radiusM) {
      state.sitePromptedDate = today();
      state.modal = { kind: 'arrival', location: place };
      showModal(state.modal);
    }
  } catch { /* Location reminder is best effort; manual action remains visible. */ }
}
function showModal(modal) {
  const holder = document.getElementById('modal-root'); if (!holder) return;
  state.modal = modal;
  if (modal.kind === 'arrival') {
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Onsite arrival"><div class="modal-head"><h2>You're at ${h(config().siteName)} 👋</h2><button class="close" data-action="modal-close" aria-label="Close">×</button></div><p>Your onsite Time In is not recorded yet. Take a selfie and confirm to save your attendance.</p><div class="map-card">Within site radius · GPS accuracy ±${Math.round(modal.location.accuracyM)} m</div><div class="card-actions"><button class="btn" data-action="arrival-time-in">Open Time In</button><button class="btn secondary" data-action="modal-close">Later</button></div></div></div>`;
  } else if (modal.kind === 'record') {
    const p = modal.punch;
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Punch details"><div class="modal-head"><h2>${h(p.employeeName)} · ${h(p.slot === 'IN' ? 'Time In' : 'Time Out')}</h2><button class="close" data-action="modal-close" aria-label="Close">×</button></div><p>${h(prettyDate(p.workDate))} at <strong>${h(formatTime(p.timeUtc))}</strong> · ${h(p.method)}</p><p>${badge(p)}</p>${p.method !== 'ADMIN' ? `<div class="map-card"><strong>${p.latitude}, ${p.longitude}</strong><small>GPS accuracy ±${Math.round(p.accuracyM)} m · ${p.distanceM == null ? 'Offsite' : `${Math.round(p.distanceM)} m from site`} · Site setting v${p.siteVersion || '—'}</small>${mapLink(p)}</div><div style="height:12px"></div>${p.hasSelfie ? `<img class="detail-photo" src="/api/selfie/${p.id}" alt="Employee selfie proof">` : ''}` : `<div class="notice">Created by admin. Reason: ${h(p.note)}</div>`}<p class="card-sub">${h(p.note || '')}</p>${p.verification === 'REJECTED' ? `<p class="notice error">Rejected: ${h(p.rejectionReason)}</p>` : ''}${p.method === 'OFFSITE' ? `<div class="card-actions"><button class="btn" data-action="verify-approve" data-id="${p.id}">Approve</button><button class="btn danger" data-action="verify-reject" data-id="${p.id}">Reject</button></div>` : ''}</div></div>`;
  }
}
function closeModal() { state.modal = null; const holder = document.getElementById('modal-root'); if (holder) holder.innerHTML = ''; }
function stopCamera() { state.cameraStream?.getTracks().forEach(track => track.stop()); state.cameraStream = null; }
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API is unavailable. Use the device camera fallback over HTTPS.');
  stopCamera();
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
  state.cameraStream = stream;
  const box = document.getElementById('camera-box');
  box.innerHTML = '<video autoplay playsinline muted aria-label="Selfie camera"></video>';
  box.querySelector('video').srcObject = stream;
  document.getElementById('camera-snap')?.classList.remove('hidden');
}
function snapCamera() {
  const video = document.querySelector('#camera-box video');
  if (!video || !video.videoWidth) throw new Error('Camera is not ready yet.');
  const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = Math.round(video.videoHeight * (720 / video.videoWidth));
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  state.capture.selfie = canvas.toDataURL('image/jpeg', .8);
  stopCamera(); renderView();
}
async function fileSelfie(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) throw new Error('Choose an image from the device camera.');
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.();
  state.capture.selfie = canvas.toDataURL('image/jpeg', .78);
  renderView();
}
async function submitPunch() {
  const c = state.capture;
  if (!navigator.onLine) throw new Error('Offline. The punch was not saved. Ask admin for a backfill if needed.');
  if (!c?.location || !c.selfie) throw new Error('Selfie and device location are required.');
  c.location = await geo();
  renderView();
  c.note = document.getElementById('capture-note')?.value || c.note || '';
  const result = await api('/api/punch', { method: 'POST', body: JSON.stringify({ slot: c.slot, method: c.method,
    latitude: c.location.latitude, longitude: c.location.longitude, accuracyM: c.location.accuracyM,
    selfie: c.selfie, note: c.note }) });
  stopCamera(); state.capture = null;
  await loadEmployee(currentRange()); state.section = 'home'; render();
  flash(`${result.punch.slot === 'IN' ? 'Time In' : 'Time Out'} saved at ${formatTime(result.punch.timeUtc)}. ${result.punch.verification === 'PENDING' ? 'Pending admin verification.' : 'Onsite verified.'}`, 'success');
}

function updateOnline() { document.getElementById('offline')?.classList.toggle('hidden', navigator.onLine); }
function formData(form) { return Object.fromEntries(new FormData(form)); }
function validateRange(from, to) { if (!from || !to || from > to) throw new Error('Choose a valid date range.'); return { start: from, end: to }; }

document.addEventListener('click', async event => {
  const node = event.target.closest('[data-nav],[data-action]'); if (!node) return;
  const action = node.dataset.action;
  try {
    if (node.dataset.nav) return await go(node.dataset.nav);
    if (action === 'logout') { await api('/api/logout', { method: 'POST', body: '{}' }); state.session = null; state.section = 'home'; state.message = ''; return render(); }
    if (action === 'capture-onsite' || action === 'capture-offsite') {
      state.capture = { slot: node.dataset.slot, method: action === 'capture-onsite' ? 'ONSITE' : 'OFFSITE', location: null, selfie: null, note: '' };
      return go('capture');
    }
    if (action === 'arrival-time-in') { const location = state.modal.location; closeModal(); state.capture = { slot: 'IN', method: 'ONSITE', location, selfie: null, note: '' }; return go('capture'); }
    if (action === 'modal-close') return closeModal();
    if (action === 'location') { state.capture.location = await geo(); return renderView(); }
    if (action === 'camera-start') return await startCamera();
    if (action === 'camera-snap') return snapCamera();
    if (action === 'submit-punch') return await submitPunch();
    if (action === 'cutoff-prev' || action === 'cutoff-next') {
      const range = state.historyRange || currentRange();
      state.historyRange = cutoffFor(action === 'cutoff-prev' ? yesterday(range.start) : tomorrow(range.end));
      await loadEmployee(state.historyRange); return renderView();
    }
    if (action === 'employee-new') { state.selectedEmployee = null; return renderView(); }
    if (action === 'employee-edit') { state.selectedEmployee = state.employees.find(e => e.id === Number(node.dataset.id)); return renderView(); }
    if (action === 'site-my-location') {
      const pos = await geo(), form = document.getElementById('settings-form');
      form.elements.siteLat.value = pos.latitude.toFixed(7); form.elements.siteLng.value = pos.longitude.toFixed(7);
      return flash(`Current pin filled (GPS accuracy ±${Math.round(pos.accuracyM)} m). Check it before saving.`, 'success');
    }
    if (action === 'record-detail') {
      const p = state.adminData.punches.find(item => item.id === Number(node.dataset.id));
      if (p) showModal({ kind: 'record', punch: p }); return;
    }
    if (action === 'verify-approve' || action === 'verify-reject') {
      const verification = action === 'verify-approve' ? 'APPROVED' : 'REJECTED';
      const reason = verification === 'REJECTED' ? window.prompt('Reason for rejection (at least 5 characters):') : '';
      if (verification === 'REJECTED' && reason == null) return;
      await api(`/api/admin/punches/${node.dataset.id}/verify`, { method: 'POST', body: JSON.stringify({ verification, reason }) });
      closeModal(); await loadAdmin(state.adminRange || currentRange()); renderView(); return flash(`Offsite punch ${verification.toLowerCase()}.`, 'success');
    }
    if (action === 'print') return window.print();
    if (action === 'install' && state.installPrompt) { await state.installPrompt.prompt(); state.installPrompt = null; return renderView(); }
  } catch (error) { flash(error.message, 'error'); }
});

document.addEventListener('change', async event => {
  try {
    if (event.target.id === 'capture-method') { state.capture.method = event.target.value; state.capture.location = null; return renderView(); }
    if (event.target.id === 'selfie-file') return await fileSelfie(event.target.files[0]);
  } catch (error) { flash(error.message, 'error'); }
});
document.addEventListener('input', event => {
  if (event.target.id === 'capture-note' && state.capture) {
    state.capture.note = event.target.value;
    const button = document.querySelector('[data-action="submit-punch"]');
    if (button) button.disabled = !state.capture.location || !state.capture.selfie || state.capture.note.trim().length < 3;
  }
});

document.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target, id = form.getAttribute('id'), values = formData(form);
  const submit = form.querySelector('[type="submit"]'); if (submit) submit.disabled = true;
  try {
    if (id === 'login-form') {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ email: values.email, password: values.password, remember: !!values.remember }) });
      await refreshSession(); state.section = state.session.user.role === 'admin' ? 'dashboard' : 'home';
      await go(state.section); return;
    }
    if (id === 'password-form') { await api('/api/password', { method: 'POST', body: JSON.stringify(values) }); form.reset(); return flash('Password updated.', 'success'); }
    if (id === 'history-form') { state.historyRange = validateRange(values.from, values.to); await loadEmployee(state.historyRange); return renderView(); }
    if (id === 'records-filter') { state.adminRange = validateRange(values.from, values.to); await loadAdmin(state.adminRange, values.employeeId || null); return renderView(); }
    if (id === 'report-filter') { state.reportRange = validateRange(values.from, values.to); await loadAdmin(state.reportRange); return renderView(); }
    if (id === 'settings-form') {
      const input = { siteName: values.siteName, siteLat: Number(values.siteLat), siteLng: Number(values.siteLng), radiusM: Number(values.radiusM), maxAccuracyM: Number(values.maxAccuracyM), cutoffDays: [Number(values.cutoffA), Number(values.cutoffB)] };
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(input) }); await refreshSession(); render(); return flash('Site and cutoff settings saved.', 'success');
    }
    if (id === 'employee-form') {
      const input = { name: values.name, email: values.email, password: values.password, scheduleStart: values.scheduleStart, scheduleEnd: values.scheduleEnd,
        graceMinutes: Number(values.graceMinutes), workdays: [...form.querySelectorAll('input[name="day"]:checked')].map(el => Number(el.value)), active: !!values.active };
      const editing = !!values.id;
      await api(editing ? `/api/admin/employees/${values.id}` : '/api/admin/employees', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(input) });
      state.selectedEmployee = null; await loadEmployees(); renderView(); return flash(editing ? 'Employee updated.' : 'Employee account created.', 'success');
    }
    if (id === 'backfill-form') {
      const input = { employeeId: Number(values.employeeId), workDate: values.workDate, timeIn: values.timeIn || null, timeOut: values.timeOut || null,
        overtimeMinutes: values.overtimeMinutes || null, reason: values.reason, replaceExisting: !!values.replaceExisting };
      await api('/api/admin/attendance', { method: 'POST', body: JSON.stringify(input) });
      form.reset(); return flash('Admin-created attendance saved with an audit record.', 'success');
    }
  } catch (error) { flash(error.message, 'error'); }
  finally { if (submit?.isConnected) submit.disabled = false; }
});

window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline);
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

try {
  await refreshSession();
  state.section = state.session.user.role === 'admin' ? 'dashboard' : 'home';
  await go(state.section);
} catch { state.session = null; if (!navigator.onLine) { state.message = 'Offline. Attendance cannot be saved until you reconnect; contact admin if you need a backfill.'; state.messageType = 'warn'; } render(); }
