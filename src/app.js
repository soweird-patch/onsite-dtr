import { ConvexHttpClient } from 'convex/browser';
import { api as functions } from '../convex/_generated/api.js';
import { holidayFor, isScheduledWorkday, localDateTime, shiftInstant, workBreakdown } from '../rules.js';

const root = document.getElementById('app');
const deploymentUrl = import.meta.env.VITE_CONVEX_URL;
const client = deploymentUrl ? new ConvexHttpClient(deploymentUrl) : null;
let accessToken = localStorage.getItem('dtr_token') || sessionStorage.getItem('dtr_token') || '';
const state = {
  session: null, section: 'home', employeeData: { punches: [], extensions: [], overtime: [], openShift: null },
  branding: { appName: 'Onsite DTR', logo192Url: null, logo512Url: null },
  signupAvailable: false, authMode: 'login', signupPhoto: null,
  employees: [], adminData: { punches: [], extensions: [], overtime: [] }, historyRange: null,
  adminRange: null, reportRange: null, includeDemoReport: false, selectedEmployee: null, capture: null,
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
  if (!client) throw new Error('Convex is not configured. Set VITE_CONVEX_URL and rebuild the PWA.');
  const parsed = new URL(path, window.location.origin);
  const route = parsed.pathname;
  const input = options.body ? JSON.parse(options.body) : {};
  const from = parsed.searchParams.get('from') || undefined;
  const to = parsed.searchParams.get('to') || undefined;
  try {
    if (route === '/api/login') {
      const result = await client.action(functions.authActions.login, { email: input.email, password: input.password, remember: !!input.remember });
      accessToken = result.token;
      const storage = input.remember ? localStorage : sessionStorage;
      localStorage.removeItem('dtr_token'); sessionStorage.removeItem('dtr_token');
      storage.setItem('dtr_token', accessToken);
      return { user: result.user };
    }
    if (route === '/api/signup-status') return await client.query(functions.core.signupStatus, {});
    if (route === '/api/admin/signup') {
      const result = await client.action(functions.authActions.registerFirstAdmin, input);
      accessToken = result.token;
      const storage = input.remember ? localStorage : sessionStorage;
      localStorage.removeItem('dtr_token'); sessionStorage.removeItem('dtr_token');
      storage.setItem('dtr_token', accessToken);
      return { user: result.user };
    }
    if (route === '/api/branding') return await client.query(functions.core.branding, {});
    if (route === '/api/logout') {
      if (accessToken) await client.mutation(functions.core.logout, { token: accessToken });
      accessToken = ''; localStorage.removeItem('dtr_token'); sessionStorage.removeItem('dtr_token');
      return { ok: true };
    }
    if (!accessToken) throw new Error('Please sign in.');
    if (route === '/api/session') return await client.query(functions.core.session, { token: accessToken });
    if (route === '/api/password') return await client.action(functions.authActions.changePassword, { token: accessToken, ...input });
    if (route === '/api/admin/profile-photo') return await client.action(functions.authActions.setProfilePhoto, { token: accessToken, ...input });
    if (route === '/api/admin/account') return await client.action(functions.authActions.deleteAdminAccount, { token: accessToken, ...input });
    if (route === '/api/attendance') return await client.query(functions.core.attendance, { token: accessToken, from, to });
    if (route === '/api/punch') return await client.action(functions.storageActions.punch, { token: accessToken, input });
    if (route === '/api/continue-offsite') return await client.mutation(functions.core.continueOffsite, { token: accessToken, ...input });
    if (route === '/api/admin/settings') return options.method === 'PUT'
      ? await client.mutation(functions.core.updateSettings, { token: accessToken, input })
      : await client.query(functions.core.adminSettings, { token: accessToken });
    if (route === '/api/admin/holidays') return await client.mutation(functions.core.updateHolidays, { token: accessToken, holidays: input.holidays });
    if (route === '/api/admin/branding') return await client.action(functions.storageActions.setBranding, { token: accessToken, ...input });
    if (route === '/api/admin/employees') return options.method === 'POST'
      ? await client.action(functions.authActions.createEmployee, { token: accessToken, input })
      : await client.query(functions.core.employees, { token: accessToken });
    const employeeId = /^\/api\/admin\/employees\/(.+)$/.exec(route)?.[1];
    if (employeeId) return options.method === 'DELETE'
      ? await client.mutation(functions.core.deleteDemoEmployee, { token: accessToken, id: employeeId })
      : await client.action(functions.authActions.updateEmployee, { token: accessToken, id: employeeId, input });
    if (route === '/api/admin/attendance') return options.method === 'POST'
      ? await client.mutation(functions.core.backfill, { token: accessToken, input })
      : await client.query(functions.core.adminAttendance, { token: accessToken, from, to, employeeId: parsed.searchParams.get('employeeId') || undefined });
    if (route === '/api/admin/audit') return await client.query(functions.core.auditItems, { token: accessToken });
    const verifyId = /^\/api\/admin\/punches\/(.+)\/verify$/.exec(route)?.[1];
    if (verifyId) return await client.mutation(functions.core.verify, { token: accessToken, id: verifyId, verification: input.verification, reason: input.reason || undefined });
    const extensionId = /^\/api\/admin\/extensions\/(.+)\/review$/.exec(route)?.[1];
    if (extensionId) return await client.mutation(functions.core.reviewExtension, { token: accessToken,
      id: extensionId, stage: input.stage, decision: input.decision, reason: input.reason || undefined });
    throw new Error('Unknown API request.');
  } catch (error) {
    const message = /Uncaught Error: ([^\n]+)/.exec(error.message)?.[1] || error.message;
    if (message.includes('Please sign in.')) {
      accessToken = ''; localStorage.removeItem('dtr_token'); sessionStorage.removeItem('dtr_token');
      if (route !== '/api/login') { state.session = null; await loadSignupStatus(); render(); }
    }
    throw new Error(message || 'No connection. Attendance was not saved. Please contact admin.');
  }
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
function formatShiftTime(iso, workDate) {
  return iso && workDate && localDateTime(iso, timeZone).date > workDate
    ? `${formatTime(iso)} (+1 day)` : formatTime(iso);
}
function punchSource(punch) {
  if (!punch) return '—';
  if (punch.method === 'ADMIN') return `Admin ${punch.assignmentType?.toLowerCase() || 'created'}`;
  if (punch.method === 'SYSTEM') return 'Auto 6:00 AM';
  return punch.method === 'ONSITE' ? 'Onsite' : 'Offsite';
}
function formatMinutes(minutes) {
  if (!minutes) return '0h 00m';
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
function time24(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
function prettyDate(date) {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}
function incomingHolidays(limit = 4) {
  const dates = new Map((config()?.legalHolidays || []).filter(item => item.type === 'Special working').map(item => [item.date, item]));
  for (const holiday of config()?.holidays || []) dates.set(holiday.date, holiday);
  return [...dates.values()].filter(item => item.date >= today()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit);
}
function holidayList(holidays) {
  return holidays.length ? `<div class="holiday-list">${holidays.map(item => `<div class="holiday-item"><div class="holiday-date"><strong>${h(new Intl.DateTimeFormat('en-PH', { month: 'short', timeZone: 'UTC' }).format(new Date(`${item.date}T00:00:00Z`)))}</strong><span>${h(item.date.slice(8))}</span></div><div class="holiday-info"><strong>${h(item.name)}</strong><small>${h(item.type || 'Company holiday')} · ${item.nonWorking === false ? 'Workday' : 'No work scheduled'}</small></div>${item.source ? `<a class="holiday-source" href="${h(item.source)}" target="_blank" rel="noopener noreferrer" aria-label="Official source for ${h(item.name)}">Source ↗</a>` : ''}</div>`).join('')}</div>` : '<div class="empty">No published upcoming holidays in this calendar yet.</div>';
}
function renderHolidayCard(limit = 4) {
  return `<section class="card wide"><div class="card-title"><span class="symbol">▦</span> INCOMING HOLIDAYS</div><p class="card-sub">Nationwide Philippine holidays and company no-work dates.</p>${holidayList(incomingHolidays(limit))}<p class="tiny-label holiday-note">Published national dates for 2026–2027. Eid dates for 2027 need a separate proclamation and calendar update. Admin can add local holidays.</p></section>`;
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
function activeWorkDate() { return state.employeeData.openShift?.workDate || today(); }
function getTodayPunch(slot) {
  if (state.employeeData.openShift) return slot === 'IN' ? state.employeeData.openShift.inPunch : null;
  return state.employeeData.punches.find(p => p.workDate === today() && p.slot === slot);
}
function activeExtension() {
  return state.employeeData.openShift?.extension ||
    state.employeeData.extensions.find(item => item.workDate === activeWorkDate());
}
function premiumBreakdown(date, inPunch, outPunch, extension) {
  return workBreakdown(date, inPunch?.timeUtc, outPunch?.timeUtc, extension?.continuedAt);
}
function runningBreakdown(date, inPunch, outPunch, extension) {
  if (outPunch || !extension || !inPunch) return premiumBreakdown(date, inPunch, outPunch, extension);
  const estimate = new Date(Math.min(Date.now(), Date.parse(shiftInstant(date, '06:00', true)))).toISOString();
  return workBreakdown(date, inPunch.timeUtc, estimate, extension.continuedAt);
}
function badge(punch) {
  if (!punch) return '<span class="pill pending">Not recorded</span>';
  if (punch.method === 'ADMIN') return '<span class="pill admin">Created by admin</span>';
  if (punch.method === 'SYSTEM') return '<span class="pill admin">Auto-closed at 6:00 AM</span>';
  if (punch.verification === 'PENDING') return '<span class="pill pending">Pending verification</span>';
  if (punch.verification === 'REJECTED') return '<span class="pill rejected">Rejected</span>';
  return `<span class="pill">${punch.method === 'ONSITE' ? 'Onsite' : 'Offsite'} verified</span>`;
}
function minutesStatus(inPunch, outPunch, employee, date) {
  if (!isScheduledWorkday(date, employee.workdays, config().holidays)) return { late: 0, early: 0 };
  return {
    late: inPunch ? Math.max(0, toMinutes(time24(inPunch.timeUtc)) - 8 * 60) : 0,
    early: outPunch ? premiumBreakdown(date, inPunch, outPunch).undertimeMinutes : 0
  };
}
function brandMarkup() {
  const logo = state.branding.logo192Url;
  return `${logo ? `<img class="brand-icon brand-image" src="${h(logo)}" alt="">` : '<span class="brand-icon">◈</span>'}<span>${h(state.branding.appName)}</span>`;
}
async function loadBranding() {
  try {
    state.branding = await api('/api/branding');
    document.title = state.branding.appName;
    const icon = document.querySelector('link[rel="icon"]');
    if (icon) { icon.href = state.branding.logo192Url || '/icon.svg'; icon.type = state.branding.logo192Url ? 'image/png' : 'image/svg+xml'; }
  } catch { /* Use the built-in brand when the network is unavailable. */ }
}
async function loadSignupStatus() {
  try { state.signupAvailable = (await api('/api/signup-status')).available; }
  catch { state.signupAvailable = false; }
  state.authMode = state.signupAvailable ? 'signup' : 'login';
}
function initials(name) { return String(name || '').split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase(); }
function avatarMarkup(user) { return user.profileImageUrl ? `<img src="${h(user.profileImageUrl)}" alt="">` : h(initials(user.name)); }
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
  if (p.method === 'SYSTEM') return 'Automatic 6:00 AM cutoff';
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
  window.scrollTo(0, 0);
  if (section === 'home' && state.session?.user.role === 'employee') checkSitePrompt();
}

function renderLogin() {
  const signup = state.signupAvailable && state.authMode === 'signup';
  root.innerHTML = `<div class="login-wrap"><div class="login-art"><div class="brand">${brandMarkup()}</div><div><div class="headline">Attendance made clear, wherever work happens.</div><p>Record onsite and field work with verified time, selfie, and GPS proof.</p></div><small class="muted">Secure employee and admin access</small></div><div class="login-panel"><div class="login-box"><p class="eyebrow">${signup ? 'FIRST ADMIN ACCOUNT' : 'WELCOME BACK'}</p><h1>${signup ? 'Create your admin account' : 'Sign in to your DTR'}</h1><p>${signup ? 'No administrator is registered. The first account created here becomes the administrator.' : 'Use the account created by your administrator.'}</p>${state.message ? `<div class="notice ${h(state.messageType)}">${h(state.message)}</div>` : ''}${signup ? `<form id="signup-form"><div class="field"><label for="signup-name">Full name</label><input id="signup-name" name="name" minlength="2" maxlength="120" autocomplete="name" required></div><div class="field"><label for="signup-email">Email address</label><input id="signup-email" name="email" type="email" autocomplete="email" required></div><div class="field-row"><div class="field"><label for="signup-password">Password (8+ characters)</label><input id="signup-password" name="password" type="password" minlength="8" autocomplete="new-password" required></div><div class="field"><label for="signup-confirm">Confirm password</label><input id="signup-confirm" name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required></div></div><div class="field"><label for="signup-photo">Profile picture (optional)</label><input id="signup-photo" type="file" accept="image/png,image/jpeg,image/webp"><img id="signup-photo-preview" class="profile-photo-preview ${state.signupPhoto ? '' : 'hidden'}" src="${state.signupPhoto || ''}" alt="Profile photo preview"><p class="tiny-label">PNG, JPG, or WebP · up to 5 MB.</p></div><label class="check-row"><input type="checkbox" name="remember" checked> Remember me on this device</label><button class="btn block" type="submit">Create admin account →</button></form><button class="link-button auth-switch" data-action="auth-login">Have an employee account? Sign in</button>` : `<form id="login-form"><div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="username" required></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><label class="check-row"><input type="checkbox" name="remember" checked> Remember me on this device</label><button class="btn block" type="submit">Sign in →</button></form>${state.signupAvailable ? '<button class="link-button auth-switch" data-action="auth-signup">Create the first admin account</button>' : '<p class="tiny-label" style="margin-top:20px">Forgot your password? Ask your administrator for a reset.</p>'}`}</div></div></div>`;
}

const employeeNav = [['home', '⌂', 'Home'], ['history', '▤', 'Attendance'], ['capture', '◎', 'Time clock'], ['profile', '◉', 'Profile']];
const adminNav = [['dashboard', '⌂', 'Home'], ['records', '▤', 'Records'], ['employees', '♙', 'Employees'], ['backfill', '＋', 'Add'], ['report', '▥', 'Reports']];
function renderShell() {
  const user = state.session.user, admin = user.role === 'admin';
  const nav = admin ? adminNav : employeeNav;
  root.innerHTML = `<div class="shell"><header class="topbar"><div class="brand">${brandMarkup()}</div><div class="top-right"><span class="tiny-label">${admin ? 'Admin' : 'Employee'} · ${h(user.name)}</span><button class="avatar" data-nav="profile" aria-label="Open ${h(user.name)} profile">${avatarMarkup(user)}</button></div></header><div id="offline" class="offline hidden">Offline — punches cannot be submitted. Contact admin if needed.</div><main class="container"><div id="flash" class="notice ${h(state.messageType)}" ${state.message ? '' : 'hidden'}>${h(state.message)}</div><div id="view"></div></main><nav class="bottom-nav" aria-label="Main navigation"><div class="bottom-inner">${nav.map(([id, icon, label]) => `<button class="nav-item ${state.section === id ? 'active' : ''}" data-nav="${id}" aria-label="${label}"><span class="nav-icon">${icon}</span>${label}</button>`).join('')}</div></nav></div><div id="modal-root"></div>`;
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
  const workDate = activeWorkDate(), extension = activeExtension();
  const holiday = holidayFor(workDate, config().holidays), current = currentRange();
  const days = new Set(punches.filter(p => p.slot === 'IN' && p.verification !== 'REJECTED' &&
    p.workDate >= current.start && p.workDate <= current.end).map(p => p.workDate));
  const late = punches.filter(p => p.slot === 'IN' && p.workDate >= current.start && p.workDate <= current.end)
    .reduce((n, p) => n + minutesStatus(p, null, user, p.workDate).late, 0);
  const undertime = punches.filter(p => p.slot === 'OUT' && p.workDate >= current.start && p.workDate <= current.end)
    .reduce((n, p) => n + premiumBreakdown(p.workDate,
      punches.find(q => q.workDate === p.workDate && q.slot === 'IN'), p).undertimeMinutes, 0);
  const action = holiday ? null : !inPunch ? 'IN' : !outPunch ? 'OUT' : null;
  const clock = toMinutes(time24(new Date().toISOString()));
  const canContinue = action === 'OUT' && !extension && clock >= 17 * 60 && clock < 22 * 60;
  const extra = runningBreakdown(workDate, inPunch, outPunch, extension);
  return `<div class="hero"><p class="eyebrow">${h(prettyDate(today()))}</p><h1>${greeting()}, ${h(user.name.split(' ')[0])}</h1><p>Here's your attendance at a glance.</p></div>
    <div class="grid"><section class="card wide"><div class="card-title"><span class="symbol">◷</span> ${state.employeeData.openShift ? 'OVERNIGHT SHIFT' : "TODAY'S ATTENDANCE"}</div><div class="pill ${statusOf(inPunch,outPunch) === 'Present' ? '' : 'pending'}">${h(holiday && !inPunch && !outPunch ? `Holiday · ${holiday.name}` : statusOf(inPunch,outPunch))}</div><p class="card-sub">Work date: ${h(prettyDate(workDate))}</p><div class="punch-line"><span>AM In</span><strong class="${inPunch ? '' : 'missing'}">${h(formatTime(inPunch?.timeUtc))}</strong></div><div class="card-sub">${badge(inPunch)} ${h(locationText(inPunch))}</div><div class="punch-line"><span>Time Out</span><strong class="${outPunch ? '' : 'missing'}">${h(formatTime(outPunch?.timeUtc))}</strong></div><div class="card-sub">${badge(outPunch)} ${h(locationText(outPunch))}</div><div class="divider"></div><p class="card-sub">Regular: 8:00 AM–5:00 PM (9 hours including break) · Overtime: 5:00–10:00 PM (minimum 1 hour) · Night differential: 10:00 PM–6:00 AM.</p>${extension ? `<p class="card-sub">Offsite continuation: ${h(formatTime(extension.continuedAt))}. ${outPunch ? `OT ${h(formatMinutes(extra.overtimeEligible ? extra.overtimeCandidateMinutes : 0))} (${h(extra.overtimeEligible ? extension.overtimeDecision.toLowerCase() : 'below 1 hour')}) · Night ${h(formatMinutes(extra.nightCandidateMinutes))} (${h(extra.nightCandidateMinutes ? extension.nightDecision.toLowerCase() : 'none')}).` : 'Time Out with selfie and GPS when finished. The shift closes automatically at 6:00 AM if still open.'}</p>` : ''}<div class="card-actions">${action ? `${extension ? '' : `<button class="btn" data-action="capture-onsite" data-slot="${action}">${action === 'IN' ? 'Time In' : 'Time Out'} onsite</button>`}<button class="btn secondary" data-action="capture-offsite" data-slot="${action}">${action === 'IN' ? 'Time In' : 'Time Out'} offsite</button>${canContinue ? '<button class="btn ghost" data-action="continue-offsite">Continue overtime offsite →</button>' : ''}` : `<button class="btn secondary" data-nav="history">View logs</button>`}</div></section>
    <section class="card"><div class="card-title"><span class="symbol">▤</span> CURRENT CUTOFF</div><div class="card-sub">${h(dateSpan(current))}</div><div class="metric-row"><div class="metric-cell"><div class="metric green">${days.size}</div><span class="label">Days with Time In</span></div><div class="metric-cell"><div class="metric amber">${late}</div><span class="label">Late minutes</span></div></div><p class="card-sub">Undertime: ${h(formatMinutes(undertime))}</p><button class="link-button" data-nav="history">View cutoff details ›</button></section>
    <section class="card"><div class="card-title"><span class="symbol">◌</span> KAMUSTA KA?</div><p class="card-sub">See your previous attendance, verification results, and past payroll cutoffs.</p><div class="card-actions"><button class="btn secondary" data-nav="history">Previous attendance →</button></div></section>${renderHolidayCard()}</div>
    <div style="height:16px"></div>${extension && !outPunch ? `<div class="notice">Offsite work is still running. Estimated overtime: <strong>${h(formatMinutes(extra.overtimeCandidateMinutes))}</strong>; estimated night differential: <strong>${h(formatMinutes(extra.nightCandidateMinutes))}</strong>. These are provisional until Time Out or the 6:00 AM auto-close, then require admin approval.</div>` : ''}<div class="notice">${config().configured ? `Onsite Time In is available only inside <strong>${h(config().siteName)}</strong> (${h(config().radiusM)} m radius).` : 'Admin needs to set the site GPS pin before onsite punches can be used.'} Selfie and device location are required for both onsite and offsite punches.</div>`;
}

function renderHistory() {
  const range = state.historyRange || currentRange();
  const grouped = new Map();
  for (const p of state.employeeData.punches) {
    if (!grouped.has(p.workDate)) grouped.set(p.workDate, {});
    grouped.get(p.workDate)[p.slot] = p;
  }
  for (const holiday of config().holidays) {
    if (holiday.date >= range.start && holiday.date <= range.end && !grouped.has(holiday.date)) grouped.set(holiday.date, {});
  }
  const sorted = [...grouped.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  return `<div class="section-head"><div><p class="eyebrow">MY RECORDS</p><h1 class="section-title">Attendance history</h1><p>Actual punch times stay visible while extra hours await admin review.</p></div></div><div class="card"><div class="section-head"><strong>Payroll cutoff</strong><div><button class="btn small secondary" data-action="cutoff-prev" aria-label="Previous cutoff">‹</button> <button class="btn small secondary" data-action="cutoff-next" aria-label="Next cutoff">›</button></div></div><strong style="color:var(--teal)">${h(dateSpan(range))}</strong><form id="history-form" class="filters" style="margin-top:16px"><div class="field"><label>From</label><input type="date" name="from" value="${h(range.start)}" required></div><div class="field"><label>To</label><input type="date" name="to" value="${h(range.end)}" required></div><button class="btn secondary" type="submit">Show</button></form></div><div style="height:16px"></div>${sorted.length ? `<div class="list">${sorted.map(([date, pair]) => {
    const holiday = holidayFor(date, config().holidays);
    const status = holiday && !pair.IN && !pair.OUT ? `Holiday · ${holiday.name}` : statusOf(pair.IN, pair.OUT);
    const mins = minutesStatus(pair.IN, pair.OUT, state.session.user, date);
    const extension = state.employeeData.extensions.find(item => item.workDate === date);
    const hours = runningBreakdown(date, pair.IN, pair.OUT, extension);
    const premiumText = extension && pair.OUT
      ? hours.overtimeEligible
        ? `OT ${formatMinutes(hours.overtimeCandidateMinutes)} (${extension.overtimeDecision.toLowerCase()}) · Night ${formatMinutes(hours.nightCandidateMinutes)} (${hours.nightCandidateMinutes ? extension.nightDecision.toLowerCase() : 'none'})`
        : 'Overtime below 1 hour · regular time only'
      : extension ? `Offsite work in progress · estimated OT ${formatMinutes(hours.overtimeCandidateMinutes)} · night ${formatMinutes(hours.nightCandidateMinutes)}` : 'No overtime request';
    return `<div class="list-item"><div><strong>${h(prettyDate(date))}</strong><p>${h(status)} · Late ${mins.late} min · Undertime ${h(formatMinutes(hours.undertimeMinutes))}</p><p>In: ${h(formatShiftTime(pair.IN?.timeUtc, date))} (${h(punchSource(pair.IN))}) · Out: ${h(formatShiftTime(pair.OUT?.timeUtc, date))} (${h(punchSource(pair.OUT))})</p><p>Regular ${h(formatMinutes(hours.regularMinutes))} · ${h(premiumText)}</p><p>${pair.IN?.verification === 'REJECTED' ? `Time In rejected: ${h(pair.IN.rejectionReason)}` : ''} ${pair.OUT?.verification === 'REJECTED' ? `Time Out rejected: ${h(pair.OUT.rejectionReason)}` : ''}</p></div><div class="right">${holiday && !pair.IN && !pair.OUT ? '<span class="pill">No work</span>' : badge(pair.IN || pair.OUT)}</div></div>`;
  }).join('')}</div>` : '<div class="empty">No attendance records in this date range.</div>'}`;
}

function renderCapture() {
  const holiday = holidayFor(activeWorkDate(), config().holidays);
  if (holiday) return `<div class="section-head"><div><p class="eyebrow">TIME CLOCK</p><h1 class="section-title">No work today</h1><p>${h(prettyDate(today()))} · ${h(holiday.name)}</p></div></div><div class="notice">This date is marked as a holiday. Ask an administrator to record exceptional work.</div><button class="btn secondary" data-nav="home">Back to home</button>`;
  const extension = activeExtension();
  const c = state.capture || { method: extension ? 'OFFSITE' : 'ONSITE', slot: getTodayPunch('IN') ? 'OUT' : 'IN',
    location: null, selfie: null, note: extension ? (getTodayPunch('IN')?.note || '') : '' };
  state.capture = c;
  const site = config();
  const distance = c.location && site.configured ? Math.round(haversine(c.location.latitude, c.location.longitude, site.siteLat, site.siteLng)) : null;
  const allowed = c.method !== 'ONSITE' || (distance !== null && distance <= site.radiusM && c.location?.accuracyM <= site.maxAccuracyM);
  return `<div class="section-head"><div><p class="eyebrow">TIME CLOCK</p><h1 class="section-title">${c.slot === 'IN' ? 'Time In' : 'Time Out'}</h1><p>${h(prettyDate(activeWorkDate()))} · ${h(c.method === 'ONSITE' ? 'Onsite' : 'Offsite / field')}</p></div></div><div class="split"><div class="card"><div class="card-title"><span class="symbol">◎</span> ${c.method === 'ONSITE' ? 'ONSITE' : 'OFFSITE'} ${c.slot === 'IN' ? 'TIME IN' : 'TIME OUT'}</div>${extension && c.slot === 'OUT' ? '<p class="notice">Offsite overtime continuation is active. Finish with offsite Time Out, selfie, and GPS. Night hours after 10:00 PM stop at 6:00 AM.</p>' : `<div class="field"><label>Work location type</label><select id="capture-method"><option value="ONSITE" ${c.method === 'ONSITE' ? 'selected' : ''}>Onsite — ${h(site.siteName)}</option><option value="OFFSITE" ${c.method === 'OFFSITE' ? 'selected' : ''}>Offsite / field</option></select></div>`}${c.method === 'OFFSITE' ? `<div class="field"><label for="capture-note">Field location / assignment</label><input id="capture-note" maxlength="300" placeholder="e.g. Client visit at Quezon City" value="${h(c.note)}" required></div>` : ''}
    <div class="card-title"><span class="symbol">◉</span> DEVICE LOCATION</div><div class="map-card">${c.location ? `<strong>${Number(c.location.latitude).toFixed(6)}, ${Number(c.location.longitude).toFixed(6)}</strong><small>Accuracy ±${Math.round(c.location.accuracyM)} m${distance !== null ? ` · ${distance} m from site pin` : ''}</small>` : '<span class="muted">Location not captured yet.</span>'}</div><div class="card-actions"><button class="btn secondary" data-action="location">${c.location ? 'Refresh location' : 'Get my location'}</button></div>${c.method === 'ONSITE' && c.location && !allowed ? `<p class="notice warn">You are outside the site radius or GPS accuracy is too low. Use Offsite DTR or retry location.</p>` : ''}
    <div class="divider"></div><button class="btn block" data-action="submit-punch" ${!c.location || !c.selfie || !allowed || (c.method === 'OFFSITE' && c.note.trim().length < 3) ? 'disabled' : ''}>Confirm ${c.slot === 'IN' ? 'Time In' : 'Time Out'}</button><p class="tiny-label">Official time is set by the server when the punch is saved. A success receipt appears only after confirmation.</p></div>
    <div class="card"><div class="card-title"><span class="symbol">▣</span> SELFIE PROOF</div><div class="camera-box" id="camera-box">${c.selfie ? `<img src="${c.selfie}" alt="Captured selfie preview">` : '<div class="camera-placeholder"><div class="symbol">◉</div><p>Take a clear selfie for this punch.</p></div>'}</div><div class="capture-actions"><button class="btn secondary" data-action="camera-start">Open camera</button><button class="btn secondary hidden" id="camera-snap" data-action="camera-snap">Take selfie</button><label class="btn ghost" for="selfie-file">Device camera fallback</label><input id="selfie-file" type="file" accept="image/*" capture="user" class="hidden"></div><p class="tiny-label">Selfie and GPS are required for both onsite and offsite employee punches. Admin-created attendance is clearly marked separately.</p></div></div>`;
}

function renderProfile() {
  const user = state.session.user;
  return `<div class="section-head"><div><p class="eyebrow">ACCOUNT</p><h1 class="section-title">Profile & security</h1></div></div>
    <div class="split"><div class="card"><div class="card-title"><span class="symbol">◉</span> MY ACCOUNT</div>
      <div class="profile-identity"><div class="profile-avatar">${avatarMarkup(user)}</div><p><strong>${h(user.name)}</strong><br><span class="muted">${h(user.email)} · ${h(user.role)}</span></p></div>
      ${user.role === 'employee' ? `<p class="card-sub">Schedule: ${h(user.scheduleStart)}–${h(user.scheduleEnd)} · Late starts immediately after 8:00 AM.</p>` : ''}
      <div class="card-actions"><button class="btn secondary" data-action="logout">Sign out</button>${state.installPrompt ? '<button class="btn ghost" data-action="install">Install PWA</button>' : ''}</div></div>
      <div class="card"><div class="card-title"><span class="symbol">◇</span> CHANGE PASSWORD</div><form id="password-form"><div class="field"><label>Current password</label><input name="currentPassword" type="password" autocomplete="current-password" required></div><div class="field"><label>New password (8+ characters)</label><input name="newPassword" type="password" minlength="8" autocomplete="new-password" required></div><button class="btn" type="submit">Update password</button></form></div></div>
    ${user.role === 'admin' ? `<div class="split settings-extra">${renderBrandingForm()}<div class="card"><div class="card-title"><span class="symbol">▣</span> PROFILE PICTURE</div><p class="card-sub">Update the picture shown on your admin profile and header.</p><form id="profile-photo-form"><div class="field"><label for="profile-photo">Replace picture</label><input id="profile-photo" type="file" accept="image/png,image/jpeg,image/webp"></div>${user.profileImageUrl ? '<label class="check-row"><input type="checkbox" name="removePhoto"> Remove current picture</label>' : ''}<button class="btn secondary" type="submit">Save picture</button></form></div></div><div class="grid settings-extra"><div class="card wide danger-card"><div class="card-title"><span class="symbol">⌫</span> DELETE ADMIN ACCOUNT</div><p class="card-sub">This permanently removes your admin login and profile picture. Attendance, employee accounts, and audit records remain. If no other admin exists, anyone who opens the app can create the next admin account and access those records.</p><form id="delete-account-form"><div class="field"><label>Current password</label><input name="password" type="password" autocomplete="current-password" required></div><div class="field"><label>Type DELETE to confirm</label><input name="confirmation" type="text" autocomplete="off" pattern="DELETE" required></div><button class="btn danger" type="submit">Delete my admin account</button></form></div></div>` : ''}`;
}

function renderAudit() {
  return `<div class="section-head"><div><p class="eyebrow">ADMIN</p><h1 class="section-title">Audit trail</h1><p>Recent account, punch, review, and correction actions.</p></div></div>${state.auditItems.length ? `<div class="list">${state.auditItems.map(item => `<div class="list-item"><div><strong>${h(item.action.replaceAll('_', ' '))}</strong><p>${h(item.actor_name || 'System')} · ${h(item.target_type)} #${h(item.target_id)}</p><p>${h(new Date(item.created_at).toLocaleString('en-PH', { timeZone }))}</p></div></div>`).join('')}</div>` : '<div class="empty">No audit entries yet.</div>'}`;
}

function renderAdminHome() {
  const rows = state.adminData.punches, employees = state.employees;
  const todayRows = rows.filter(p => p.workDate === today());
  const present = new Set(todayRows.filter(p => p.slot === 'IN').map(p => p.userId)).size;
  const pendingPremium = (state.adminData.extensions || []).filter(extension => {
    const pair = rows.filter(p => p.userId === extension.userId && p.workDate === extension.workDate);
    const hours = premiumBreakdown(extension.workDate, pair.find(p => p.slot === 'IN'), pair.find(p => p.slot === 'OUT'), extension);
    return hours.overtimeEligible && (extension.overtimeDecision === 'PENDING' ||
      hours.nightCandidateMinutes > 0 && extension.nightDecision === 'PENDING');
  }).length;
  const pending = rows.filter(p => p.verification === 'PENDING').length + pendingPremium;
  const incomplete = new Set(todayRows.filter(p => p.slot === 'IN' && !todayRows.some(q => q.userId === p.userId && q.slot === 'OUT')).map(p => p.userId)).size;
  const recent = rows.slice(0, 8);
  return `<div class="hero"><p class="eyebrow">ADMIN DASHBOARD · ${h(prettyDate(today()))}</p><h1>Attendance overview</h1><p>Review field proofs and resolve missing records before payroll cutoff.</p></div><div class="mini-grid"><div class="stat-card"><div class="num">${employees.filter(e => e.active).length}</div><div class="label">Active employees</div></div><div class="stat-card"><div class="num">${present}</div><div class="label">Timed in today</div></div><div class="stat-card"><div class="num">${pending}</div><div class="label">Pending reviews</div></div><div class="stat-card"><div class="num">${incomplete}</div><div class="label">Incomplete today</div></div></div><div style="height:17px"></div><div class="grid"><div class="card"><div class="card-title"><span class="symbol">◎</span> SITE STATUS</div><p>${config().configured ? `<strong>${h(config().siteName)}</strong><br><span class="card-sub">${config().siteLat}, ${config().siteLng} · ${config().radiusM} m radius</span>` : '<span class="pill pending">Site GPS not configured</span>'}</p><button class="link-button" data-nav="settings">Manage site & cutoff ›</button></div><div class="card"><div class="card-title"><span class="symbol">▥</span> CURRENT CUTOFF</div><strong>${h(dateSpan(currentRange()))}</strong><p class="card-sub">Review exceptions and prepare printable payroll summary.</p><button class="link-button" data-nav="report">Open report ›</button></div></div><div style="height:17px"></div><div class="grid">${renderHolidayCard()}</div><div style="height:23px"></div><div class="section-head"><h2 class="section-title">Recent punches</h2><button class="btn small secondary" data-nav="records">See all</button></div>${recent.length ? `<div class="list">${recent.map(recordItem).join('')}</div>` : '<div class="empty">No attendance punches in this cutoff yet.</div>'}`;
}

function renderBrandingForm() {
  return `<div class="card"><div class="card-title"><span class="symbol">◈</span> APP NAME & LOGO</div><p class="card-sub">The name and logo appear on the sign-in screen, header, report, browser tab, and PWA install details.</p>
    <form id="branding-form"><div class="field"><label for="app-brand-name">App name</label><input id="app-brand-name" name="appName" minlength="2" maxlength="60" value="${h(state.branding.appName)}" required></div><div class="brand-preview">${brandMarkup()}</div><div class="field"><label for="app-brand-logo">Replace logo (PNG, JPG, or WebP)</label><input id="app-brand-logo" name="logoFile" type="file" accept="image/png,image/jpeg,image/webp"></div><p class="tiny-label">The image is fitted into square 192 px and 512 px PNG icons. Leave this blank to keep the current logo.</p>${state.branding.logo192Url ? '<label class="check-row"><input name="removeLogo" type="checkbox"> Remove current logo and use the default icon</label>' : ''}<button class="btn block" type="submit">Save app branding</button></form></div>`;
}

function recordItem(p) {
  return `<div class="list-item"><div><strong>${h(p.employeeName)}</strong><p>${h(prettyDate(p.workDate))} · ${h(p.slot === 'IN' ? 'Time In' : 'Time Out')} ${h(formatShiftTime(p.timeUtc, p.workDate))} · ${h(punchSource(p))}</p></div><div class="right">${badge(p)}<br><button class="link-button" data-action="record-detail" data-id="${p.id}">View proof ›</button></div></div>`;
}
function renderPremiumQueue() {
  const extensions = state.adminData.extensions || [];
  return `<section class="card premium-queue"><div class="card-title"><span class="symbol">◷</span> OVERTIME & NIGHT REVIEW</div><p class="card-sub">Review offsite proof first. A full hour between 5:00 and 10:00 PM qualifies for overtime. Night differential from 10:00 PM needs its own approval.</p>${extensions.length ? `<div class="list">${extensions.map(extension => {
    const pair = state.adminData.punches.filter(p => p.userId === extension.userId && p.workDate === extension.workDate);
    const inPunch = pair.find(p => p.slot === 'IN'), outPunch = pair.find(p => p.slot === 'OUT');
    const hours = runningBreakdown(extension.workDate, inPunch, outPunch, extension);
    const proofReady = inPunch?.verification === 'APPROVED' && outPunch?.verification === 'APPROVED' &&
      (outPunch.method !== 'ADMIN' || outPunch.assignmentType === 'OFFSITE');
    return `<div class="list-item premium-item"><div><strong>${h(extension.employeeName)} · ${h(prettyDate(extension.workDate))}</strong><p>${h(extension.source === 'ADMIN' ? 'Admin-entered offsite' : 'Employee offsite')} · In ${h(formatTime(inPunch?.timeUtc))} · Out ${h(formatShiftTime(outPunch?.timeUtc, extension.workDate))}</p><p>OT ${h(formatMinutes(hours.overtimeCandidateMinutes))} · ${h(!outPunch ? 'In progress' : hours.overtimeEligible ? extension.overtimeDecision.toLowerCase() : 'below 1 hour; regular only')} · Night ${h(formatMinutes(hours.nightCandidateMinutes))} · ${h(hours.nightCandidateMinutes ? extension.nightDecision.toLowerCase() : 'none')}</p>${outPunch && !proofReady ? '<p class="tiny-label">Approved offsite punch proof or offsite admin assignment is required before granting.</p>' : ''}${extension.overtimeReason ? `<p class="tiny-label">OT reason: ${h(extension.overtimeReason)}</p>` : ''}${extension.nightReason ? `<p class="tiny-label">Night reason: ${h(extension.nightReason)}</p>` : ''}</div><div class="premium-actions">${outPunch && hours.overtimeEligible ? `<button class="btn small secondary" data-action="premium-review" data-id="${extension.id}" data-stage="OVERTIME" data-decision="APPROVED" ${proofReady ? '' : 'disabled'}>Grant OT</button><button class="btn small danger" data-action="premium-review" data-id="${extension.id}" data-stage="OVERTIME" data-decision="REJECTED">Deny OT</button>` : ''}${outPunch && hours.nightCandidateMinutes && extension.overtimeDecision === 'APPROVED' ? `<button class="btn small secondary" data-action="premium-review" data-id="${extension.id}" data-stage="NIGHT" data-decision="APPROVED" ${proofReady ? '' : 'disabled'}>Grant night</button><button class="btn small danger" data-action="premium-review" data-id="${extension.id}" data-stage="NIGHT" data-decision="REJECTED">Deny night</button>` : ''}</div></div>`;
  }).join('')}</div>` : '<div class="empty">No offsite overtime requests in this range.</div>'}</section>`;
}
function renderRecords() {
  const range = state.adminRange || currentRange();
  return `<div class="section-head"><div><p class="eyebrow">ADMIN</p><h1 class="section-title">Attendance records</h1><p>Review each Time In and Time Out location separately, then grant or deny extra hours.</p></div></div><form id="records-filter" class="filters"><div class="field"><label>From</label><input type="date" name="from" value="${h(range.start)}" required></div><div class="field"><label>To</label><input type="date" name="to" value="${h(range.end)}" required></div><div class="field"><label>Employee</label><select name="employeeId"><option value="">All employees</option>${state.employees.map(e => `<option value="${e.id}">${h(e.name)}</option>`).join('')}</select></div><button class="btn secondary" type="submit">Filter</button></form>${renderPremiumQueue()}<div class="section-head settings-extra"><h2 class="section-title">Time In & Time Out proofs</h2></div>${state.adminData.punches.length ? `<div class="list">${state.adminData.punches.map(recordItem).join('')}</div>` : '<div class="empty">No attendance records for this filter.</div>'}`;
}
function renderEmployees() {
  const e = state.selectedEmployee;
  const days = e?.workdays || [1, 2, 3, 4, 5, 6];
  return `<div class="section-head"><div><p class="eyebrow">ADMIN</p><h1 class="section-title">Employees</h1><p>Create accounts and set workdays. Regular time is fixed at 8:00 AM–5:00 PM, with the break included.</p></div><button class="btn small secondary" data-action="employee-new">New</button></div>
    <div class="split"><div class="card"><div class="card-title"><span class="symbol">♙</span> ${e ? 'EDIT EMPLOYEE' : 'CREATE EMPLOYEE'}</div>
    <form id="employee-form"><input type="hidden" name="id" value="${e?.id || ''}">
      <div class="field"><label>Name</label><input name="name" value="${h(e?.name || '')}" required maxlength="120"></div>
      <div class="field"><label>Email / login</label><input name="email" type="email" value="${h(e?.email || '')}" required></div>
      <div class="field"><label>${e ? 'New password (leave blank to keep)' : 'Temporary password (8+ characters)'}</label><input name="password" type="password" minlength="8" ${e ? '' : 'required'} autocomplete="new-password"></div>
      <div class="notice">Regular shift: <strong>8:00 AM–5:00 PM</strong> · 9 hours including break. Overtime and night differential are reviewed separately.</div>
      <div class="field"><label>Workdays</label><div class="day-picker">${[['Sun',0],['Mon',1],['Tue',2],['Wed',3],['Thu',4],['Fri',5],['Sat',6]].map(([name,n]) => `<label><input type="checkbox" name="day" value="${n}" ${days.includes(n) ? 'checked' : ''}> ${name}</label>`).join('')}</div></div>
      ${e ? `<label class="check-row"><input name="active" type="checkbox" ${e.active ? 'checked' : ''}> Active account</label><div class="notice">${e.isDemo ? 'Demo account: excluded from payroll reports by default. Its test records can be deleted from the list.' : 'Regular employee account.'}</div>`
        : '<label class="check-row"><input name="isDemo" type="checkbox"> Demo / test account</label><p class="card-sub">Demo accounts are excluded from payroll reports by default and can be deleted with their test records.</p>'}
      <button class="btn block" type="submit">${e ? 'Save employee' : 'Create account'}</button>
    </form></div><div class="card"><div class="card-title"><span class="symbol">▤</span> EMPLOYEE LIST</div><div class="list">${state.employees.length ? state.employees.map(item => `<div class="list-item"><div><strong>${h(item.name)} ${item.isDemo ? '<span class="pill admin">DEMO</span>' : ''}</strong><p>${h(item.email)} · 8:00 AM–5:00 PM ${item.active ? '' : '· Disabled'}</p></div><div class="employee-actions"><button class="btn small secondary" data-action="employee-edit" data-id="${item.id}">Edit</button>${item.isDemo ? `<button class="btn small danger" data-action="employee-delete" data-id="${item.id}">Delete demo</button>` : ''}</div></div>`).join('') : '<div class="empty">No employees yet.</div>'}</div></div></div>`;
}
function renderSettings() {
  const s = config();
  const holidays = [...(s.customHolidays || [])].sort((a, b) => a.date.localeCompare(b.date));
  return `<div class="section-head"><div><p class="eyebrow">ADMIN SETTINGS</p><h1 class="section-title">Site, cutoff & holidays</h1><p>Manage the site pin, payroll periods, and no-work dates.</p></div><button class="btn small secondary no-print" data-nav="dashboard" aria-label="Close settings">× Close</button></div>
    <div class="split"><div class="card"><div class="card-title"><span class="symbol">◎</span> SITE GPS</div>
      <form id="settings-form"><div class="field"><label>Site name</label><input name="siteName" value="${h(s.siteName)}" required></div>
      <div class="field-row"><div class="field"><label>Latitude</label><input name="siteLat" type="number" step="any" min="-90" max="90" value="${s.siteLat ?? ''}" required></div><div class="field"><label>Longitude</label><input name="siteLng" type="number" step="any" min="-180" max="180" value="${s.siteLng ?? ''}" required></div></div>
      <button type="button" class="btn small secondary" data-action="site-my-location">Use my current location</button><p class="tiny-label">Use this only while physically at the site. Site edits are recorded in the audit trail.</p>
      <div class="field-row"><div class="field"><label>Allowed radius (m)</label><input name="radiusM" type="number" min="25" max="2000" value="${s.radiusM}" required></div><div class="field"><label>Max GPS error (m)</label><input name="maxAccuracyM" type="number" min="10" max="500" value="${s.maxAccuracyM}" required></div></div>
      <div class="divider"></div><div class="card-title"><span class="symbol">▤</span> PAYROLL CUTOFF</div><p class="card-sub">Two start days define the cutoff periods. Example: 11 and 26 creates 11–25 and 26–10.</p>
      <div class="field-row"><div class="field"><label>First start day</label><input name="cutoffA" type="number" min="1" max="28" value="${s.cutoffDays[0]}" required></div><div class="field"><label>Second start day</label><input name="cutoffB" type="number" min="1" max="28" value="${s.cutoffDays[1]}" required></div></div><button class="btn block" type="submit">Save site & cutoff</button></form></div>
      <div class="card"><div class="card-title"><span class="symbol">◇</span> HOW ONSITE WORKS</div><p class="card-sub">Employee login and attendance history work from anywhere. The site GPS pin controls whether a punch can be labelled onsite.</p><p class="card-sub">Every employee punch needs a selfie and current device location. Outside the radius, the employee uses Offsite DTR and the admin verifies it.</p>
      <div class="map-card">${s.configured ? `<strong>${h(s.siteName)}</strong><small>${s.siteLat}, ${s.siteLng} · ${s.radiusM} m radius</small><a href="https://www.openstreetmap.org/?mlat=${s.siteLat}&mlon=${s.siteLng}#map=17/${s.siteLat}/${s.siteLng}" target="_blank" rel="noopener noreferrer">View site pin ↗</a>` : '<span class="muted">Pin not set yet.</span>'}</div></div></div>
    <div class="grid settings-extra"><div class="card wide"><div class="card-title"><span class="symbol">▦</span> COMPANY HOLIDAYS · NO WORK</div><p class="card-sub">Add site or company no-work dates. Nationwide Philippine non-working holidays are already included in the schedule. Employees cannot punch on a no-work day; admins can record exceptional work.</p>
      <form id="holiday-form"><div class="field-row"><div class="field"><label>Holiday date</label><input name="date" type="date" required></div><div class="field"><label>Holiday name</label><input name="name" maxlength="80" minlength="2" placeholder="e.g. Christmas Day" required></div></div><button class="btn" type="submit">Add holiday</button></form>
      <div class="divider"></div>${holidays.length ? `<div class="list">${holidays.map(holiday => `<div class="list-item"><div><strong>${h(prettyDate(holiday.date))}</strong><p>${h(holiday.name)}</p></div><button class="btn small danger" data-action="holiday-remove" data-date="${h(holiday.date)}" aria-label="Remove ${h(holiday.name)}">Remove</button></div>`).join('')}</div>` : '<div class="empty">No company holidays added yet.</div>'}</div>
      </div><div class="grid settings-extra">${renderHolidayCard(8)}</div>`;
}
function renderBackfill() {
  return `<div class="section-head"><div><p class="eyebrow">ADMIN</p><h1 class="section-title">Add attendance</h1><p>For no-signal field work or a documented correction.</p></div></div><div class="split"><div class="card"><div class="card-title"><span class="symbol">＋</span> ADMIN-CREATED RECORD</div><form id="backfill-form"><div class="field"><label>Employee</label><select name="employeeId" required><option value="">Select employee</option>${state.employees.map(e => `<option value="${e.id}">${h(e.name)}</option>`).join('')}</select></div><div class="field"><label>Work date</label><input name="workDate" type="date" value="${h(today())}" required></div><div class="field-row"><div class="field"><label>Time In (optional)</label><input name="timeIn" type="time"></div><div class="field"><label>Time Out (optional)</label><input name="timeOut" type="time"></div></div><label class="check-row"><input name="timeOutNextDay" type="checkbox"> Time Out is after midnight (next day, no later than 6:00 AM)</label><label class="check-row"><input name="offsite" type="checkbox"> Offsite / field assignment — calculate overtime and night hours for review</label><div class="field"><label>Reason / field assignment</label><textarea name="reason" minlength="5" maxlength="300" required placeholder="e.g. No mobile signal at client site"></textarea></div><label class="check-row"><input name="replaceExisting" type="checkbox"> Replace an existing punch with an audited correction</label><button class="btn block" type="submit">Save admin-created attendance</button></form></div><div class="card"><div class="card-title"><span class="symbol">ⓘ</span> HOW HOURS ARE COUNTED</div><p class="card-sub">Regular time is 8:00 AM–5:00 PM, including break. Offsite overtime is calculated from 5:00–10:00 PM and only qualifies after 1 hour. Night differential runs from 10:00 PM to 6:00 AM.</p><p class="card-sub">A selfie or GPS is not required for admin-created attendance. Actual punch times are shown immediately; overtime and night hours appear in Records for separate approval. Corrections reset those approvals.</p><button class="link-button" data-nav="records">Review extra hours ›</button></div></div>`;
}
function reportRows() {
  const range = state.reportRange || currentRange();
  const punches = state.adminData.punches;
  const otMap = new Map(state.adminData.overtime.map(o => [`${o.user_id}|${o.work_date}`, o.minutes]));
  const extensionMap = new Map((state.adminData.extensions || []).map(item => [`${item.userId}|${item.workDate}`, item]));
  return state.employees.filter(employee => state.includeDemoReport || !employee.isDemo).map(employee => {
    const rows = [];
    const totals = { present: 0, noRecord: 0, holidays: 0, late: 0, undertime: 0,
      regular: 0, overtime: 0, night: 0, pending: 0 };
    for (let date = range.start; date <= range.end; date = tomorrow(date)) {
      const pair = punches.filter(p => p.userId === employee.id && p.workDate === date);
      const inPunch = pair.find(p => p.slot === 'IN'), outPunch = pair.find(p => p.slot === 'OUT');
      const extension = extensionMap.get(`${employee.id}|${date}`);
      const holiday = holidayFor(date, config().holidays);
      const scheduled = isScheduledWorkday(date, employee.workdays, config().holidays);
      if (!scheduled && !holiday && !pair.length && !extension && !otMap.has(`${employee.id}|${date}`)) continue;
      let status = statusOf(inPunch, outPunch);
      if (holiday) status = pair.length ? `${status} (holiday: ${holiday.name})` : `Holiday · ${holiday.name}`;
      else if (status === 'No record' && date > today()) status = 'Upcoming';
      else if (status === 'No record' && date === today()) status = 'Today · not recorded';
      else if (!scheduled) status = `${status} (off day)`;
      const late = minutesStatus(inPunch, outPunch, employee, date).late;
      const hours = premiumBreakdown(date, inPunch, outPunch, extension);
      const legacyOvertime = extension ? 0 : (otMap.get(`${employee.id}|${date}`) || 0);
      const overtime = (hours.overtimeEligible && extension?.overtimeDecision === 'APPROVED'
        ? hours.overtimeCandidateMinutes : 0) + legacyOvertime;
      const night = hours.nightCandidateMinutes && extension?.overtimeDecision === 'APPROVED' &&
        extension?.nightDecision === 'APPROVED' ? hours.nightCandidateMinutes : 0;
      const overtimeStatus = !extension ? (legacyOvertime ? 'Admin granted' : 'No request') : !outPunch
        ? 'In progress' : hours.overtimeEligible ? extension.overtimeDecision : 'Below 1h · regular only';
      const nightStatus = hours.nightCandidateMinutes ? extension.nightDecision : '—';
      if (status.startsWith('Present')) totals.present++;
      if (status === 'No record' && scheduled) totals.noRecord++;
      if (holiday) totals.holidays++;
      if (status.startsWith('Pending verification') || status.startsWith('Needs correction') ||
          overtimeStatus === 'PENDING' || nightStatus === 'PENDING') totals.pending++;
      totals.late += late; totals.undertime += scheduled ? hours.undertimeMinutes : 0;
      totals.regular += hours.regularMinutes; totals.overtime += overtime; totals.night += night;
      rows.push({ date, inPunch, outPunch, status, late, undertime: scheduled ? hours.undertimeMinutes : 0,
        regular: hours.regularMinutes, overtime, night, overtimeStatus, nightStatus });
    }
    return { employee, rows, totals };
  });
}
function renderReportEmployee({ employee, rows, totals }) {
  const body = rows.map(row => `<tr><td>${h(prettyDate(row.date))}</td>
    <td>${h(formatShiftTime(row.inPunch?.timeUtc, row.date))}</td>
    <td>${h(formatShiftTime(row.outPunch?.timeUtc, row.date))}</td>
    <td>${h(punchSource(row.inPunch))} / ${h(punchSource(row.outPunch))}</td>
    <td>${h(formatMinutes(row.regular))}</td><td>${h(formatMinutes(row.late))}</td>
    <td>${h(formatMinutes(row.undertime))}</td>
    <td>${h(formatMinutes(row.overtime))}<br>${h(row.overtimeStatus)}</td>
    <td>${h(formatMinutes(row.night))}<br>${h(row.nightStatus)}</td><td>${h(row.status)}</td></tr>`).join('');
  return `<section class="report-employee"><h3>${h(employee.name)}</h3>
    <p class="report-summary"><strong>Total regular ${h(formatMinutes(totals.regular))}</strong> · <strong>Total overtime granted ${h(formatMinutes(totals.overtime))}</strong> · <strong>Total night differential granted ${h(formatMinutes(totals.night))}</strong> · Undertime ${h(formatMinutes(totals.undertime))} · Late ${h(formatMinutes(totals.late))} · Exceptions ${totals.pending}</p>
    <p class="report-summary">Present ${totals.present} · No record ${totals.noRecord} · Holidays ${totals.holidays}</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Time In</th><th>Time Out</th><th>Source</th><th>Regular</th><th>Late</th><th>Undertime</th><th>OT granted / review</th><th>Night granted / review</th><th>Status</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}
function renderReport() {
  const range = state.reportRange || currentRange();
  const report = reportRows();
  return `<div class="section-head no-print"><div><p class="eyebrow">PAYROLL</p><h1 class="section-title">Cutoff report</h1><p>Logged regular hours include break. Only admin-granted overtime and night hours enter premium totals.</p></div><div class="header-actions"><button class="btn small secondary" data-nav="dashboard" aria-label="Close report">× Close</button><button class="btn" data-action="print">Print / Save PDF</button></div></div>
    <form id="report-filter" class="filters no-print"><div class="field"><label>From</label><input type="date" name="from" value="${h(range.start)}" required></div><div class="field"><label>To</label><input type="date" name="to" value="${h(range.end)}" required></div><label class="check-row"><input name="includeDemo" type="checkbox" ${state.includeDemoReport ? 'checked' : ''}> Include demo data for testing</label><button class="btn secondary" type="submit">Show report</button></form>
    <div class="report-sheet"><div class="report-head"><div class="report-brand"><img src="${h(state.branding.logo512Url || '/aoda-report-logo.jpg')}" alt="Philippine AODA Power Corp. logo"><div class="report-company"><h2>PHILIPPINE AODA POWER CORP.</h2><p>PCCCII BLDG., MOONSTONE AVE., GRAND CENTENNIAL HOMES,<br>KAWIT 4104, CAVITE, PHILIPPINES</p></div></div></div>
    <div class="report-meta"><div><strong>EMPLOYEE ATTENDANCE SUMMARY</strong><p>${h(state.branding.appName)} · Cutoff: ${h(dateSpan(range))} · Asia/Manila</p></div><small>Generated: ${h(new Date().toLocaleString('en-PH', { timeZone }))}</small></div>
    <p class="report-policy">${state.includeDemoReport ? '<strong>TEST REPORT — DEMO DATA INCLUDED.</strong><br>' : ''}Regular: 8:00 AM–5:00 PM (9h, break included) · OT: 5:00–10:00 PM, minimum 1h · Night differential: 10:00 PM–6:00 AM. Punch times are actual; pending or denied premiums are excluded from granted totals.</p>
    ${report.length ? report.map(renderReportEmployee).join('') : '<p class="empty">No regular employees in this report. Select “Include demo data for testing” to preview the demo account.</p>'}</div>`;
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
  if (state.sitePromptedDate === today() || !config()?.configured || getTodayPunch('IN') || holidayFor(today(), config().holidays)) return;
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
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Punch details"><div class="modal-head"><h2>${h(p.employeeName)} · ${h(p.slot === 'IN' ? 'Time In' : 'Time Out')}</h2><button class="close" data-action="modal-close" aria-label="Close">×</button></div><p>${h(prettyDate(p.workDate))} at <strong>${h(formatTime(p.timeUtc))}</strong> · ${h(p.method)}</p><p>${badge(p)}</p>${p.method === 'SYSTEM' ? '<div class="notice">Shift automatically closed at 6:00 AM. No exit selfie or GPS was captured.</div>' : p.method === 'ADMIN' ? `<div class="notice">Created by admin · ${h(p.assignmentType || 'assignment not set')}. Reason: ${h(p.note)}</div>` : `<div class="map-card"><strong>${p.latitude}, ${p.longitude}</strong><small>GPS accuracy ±${Math.round(p.accuracyM)} m · ${p.distanceM == null ? 'Offsite' : `${Math.round(p.distanceM)} m from site`} · Site setting v${p.siteVersion || '—'}</small>${mapLink(p)}</div><div style="height:12px"></div>${p.hasSelfie ? `<p class="card-sub">Loading selfie…</p><img class="detail-photo hidden" id="proof-selfie" alt="Employee selfie proof">` : ''}`}<p class="card-sub">${h(p.note || '')}</p>${p.verification === 'REJECTED' ? `<p class="notice error">Rejected: ${h(p.rejectionReason)}</p>` : ''}${p.method === 'OFFSITE' ? `<div class="card-actions"><button class="btn" data-action="verify-approve" data-id="${p.id}">Approve</button><button class="btn danger" data-action="verify-reject" data-id="${p.id}">Reject</button></div>` : ''}</div></div>`;
  } else if (modal.kind === 'premium') {
    const { extension, stage, decision } = modal;
    const pin = extension.latitude == null ? '<p class="card-sub">Admin-created offsite attendance · no employee GPS proof.</p>'
      : `<div class="map-card"><strong>Continuation GPS: ${h(extension.latitude)}, ${h(extension.longitude)}</strong><small>Accuracy ±${h(Math.round(extension.accuracyM))} m</small><a href="https://www.openstreetmap.org/?mlat=${extension.latitude}&mlon=${extension.longitude}#map=18/${extension.latitude}/${extension.longitude}" target="_blank" rel="noopener noreferrer">Open continuation map pin ↗</a></div>`;
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Review extra hours"><div class="modal-head"><h2>${decision === 'APPROVED' ? 'Grant' : 'Deny'} ${stage === 'OVERTIME' ? 'overtime' : 'night differential'}</h2><button class="close" data-action="modal-close" aria-label="Close">×</button></div><p>${h(extension.employeeName)} · ${h(prettyDate(extension.workDate))}</p>${pin}<form id="premium-review-form"><input type="hidden" name="id" value="${h(extension.id)}"><input type="hidden" name="stage" value="${h(stage)}"><input type="hidden" name="decision" value="${h(decision)}"><div class="field"><label for="premium-reason">Reason (optional)</label><textarea id="premium-reason" name="reason" maxlength="300" placeholder="Add a note for the payroll audit trail"></textarea></div><button class="btn block ${decision === 'REJECTED' ? 'danger' : ''}" type="submit">Confirm ${decision === 'APPROVED' ? 'grant' : 'denial'}</button></form></div></div>`;
  } else if (modal.kind === 'delete-demo') {
    const e = modal.employee;
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Delete demo employee"><div class="modal-head"><h2>Delete demo account</h2><button class="close" data-action="modal-close" aria-label="Close">×</button></div><p><strong>${h(e.name)}</strong> · ${h(e.email)}</p><p class="notice warn">This permanently deletes the demo account, its attendance, review requests, sessions, and selfies. The audit trail remains.</p><form id="delete-demo-form"><input type="hidden" name="id" value="${h(e.id)}"><div class="field"><label>Type DELETE to confirm</label><input name="confirmation" required autocomplete="off" pattern="DELETE"></div><button class="btn danger block" type="submit">Delete demo and test records</button></form></div></div>`;
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
async function logoImages(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5_000_000)
    throw new Error('Choose a PNG, JPG, or WebP logo under 5 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const make = size => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const scale = Math.min(size * .84 / bitmap.width, size * .84 / bitmap.height);
      const width = bitmap.width * scale, height = bitmap.height * scale;
      canvas.getContext('2d').drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
      return canvas.toDataURL('image/png');
    };
    return { logo192: make(192), logo512: make(512) };
  } finally { bitmap.close?.(); }
}
async function profileImageData(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5_000_000)
    throw new Error('Choose a PNG, JPG, or WebP profile photo under 5 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const side = Math.min(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#173e50'; context.fillRect(0, 0, 512, 512);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 512, 512);
    return canvas.toDataURL('image/jpeg', .82);
  } finally { bitmap.close?.(); }
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
    if (action === 'auth-login' || action === 'auth-signup') { state.authMode = action === 'auth-signup' ? 'signup' : 'login'; state.message = ''; return renderLogin(); }
    if (action === 'logout') { await api('/api/logout', { method: 'POST', body: '{}' }); state.session = null; state.section = 'home'; state.message = ''; await loadSignupStatus(); return render(); }
    if (action === 'capture-onsite' || action === 'capture-offsite') {
      if (holidayFor(activeWorkDate(), config().holidays)) throw new Error('No work is scheduled today. Ask admin to record exceptional work.');
      state.capture = { slot: node.dataset.slot, method: action === 'capture-onsite' ? 'ONSITE' : 'OFFSITE',
        location: null, selfie: null, note: action === 'capture-offsite' && activeExtension()
          ? (getTodayPunch('IN')?.note || '') : '' };
      return go('capture');
    }
    if (action === 'continue-offsite') {
      if (!navigator.onLine) throw new Error('Connect to the internet before continuing overtime.');
      const location = await geo();
      await api('/api/continue-offsite', { method: 'POST', body: JSON.stringify(location) });
      await loadEmployee(currentRange()); renderView();
      return flash('Offsite continuation recorded. Time Out with selfie and GPS when finished; extra hours need admin approval.', 'success');
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
    if (action === 'employee-edit') { state.selectedEmployee = state.employees.find(e => e.id === node.dataset.id); return renderView(); }
    if (action === 'employee-delete') {
      const employee = state.employees.find(e => e.id === node.dataset.id && e.isDemo);
      if (employee) showModal({ kind: 'delete-demo', employee });
      return;
    }
    if (action === 'site-my-location') {
      const pos = await geo(), form = document.getElementById('settings-form');
      form.elements.siteLat.value = pos.latitude.toFixed(7); form.elements.siteLng.value = pos.longitude.toFixed(7);
      return flash(`Current pin filled (GPS accuracy ±${Math.round(pos.accuracyM)} m). Check it before saving.`, 'success');
    }
    if (action === 'holiday-remove') {
      const holidays = config().customHolidays.filter(holiday => holiday.date !== node.dataset.date);
      await api('/api/admin/holidays', { method: 'PUT', body: JSON.stringify({ holidays }) });
      await refreshSession(); renderView(); return flash('Holiday removed.', 'success');
    }
    if (action === 'record-detail') {
      const p = state.adminData.punches.find(item => item.id === node.dataset.id);
      if (p) {
        showModal({ kind: 'record', punch: p });
        if (p.hasSelfie) {
          const data = await client.action(functions.storageActions.selfie, { token: accessToken, id: p.id });
          const img = document.getElementById('proof-selfie');
          if (img && state.modal?.punch?.id === p.id) { img.src = data; img.classList.remove('hidden'); img.previousElementSibling?.remove(); }
        }
      }
      return;
    }
    if (action === 'premium-review') {
      const extension = state.adminData.extensions.find(item => item.id === node.dataset.id);
      if (extension) showModal({ kind: 'premium', extension, stage: node.dataset.stage, decision: node.dataset.decision });
      return;
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
    if (event.target.id === 'signup-photo') {
      state.signupPhoto = await profileImageData(event.target.files[0]);
      const preview = document.getElementById('signup-photo-preview');
      if (preview) { preview.src = state.signupPhoto; preview.classList.remove('hidden'); }
    }
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
    if (id === 'signup-form') {
      if (values.password !== values.confirmPassword) throw new Error('Passwords do not match.');
      await api('/api/admin/signup', { method: 'POST', body: JSON.stringify({ name: values.name, email: values.email,
        password: values.password, remember: !!values.remember, ...(state.signupPhoto ? { profileImage: state.signupPhoto } : {}) }) });
      state.signupPhoto = null; state.signupAvailable = false;
      await refreshSession(); await go('dashboard'); return flash('Admin account created.', 'success');
    }
    if (id === 'password-form') { await api('/api/password', { method: 'POST', body: JSON.stringify(values) }); form.reset(); return flash('Password updated.', 'success'); }
    if (id === 'profile-photo-form') {
      const file = form.querySelector('#profile-photo').files[0], remove = !!values.removePhoto;
      if ((file && remove) || (!file && !remove)) throw new Error('Choose a new picture or remove the current one.');
      await api('/api/admin/profile-photo', { method: 'POST', body: JSON.stringify({ remove,
        ...(file ? { profileImage: await profileImageData(file) } : {}) }) });
      await refreshSession(); render(); return flash('Profile picture updated.', 'success');
    }
    if (id === 'delete-account-form') {
      await api('/api/admin/account', { method: 'DELETE', body: JSON.stringify({ password: values.password, confirmation: values.confirmation }) });
      accessToken = ''; localStorage.removeItem('dtr_token'); sessionStorage.removeItem('dtr_token');
      state.session = null; state.section = 'home'; await loadSignupStatus(); render();
      return flash('Admin account deleted. A new admin can now sign up.', 'success');
    }
    if (id === 'history-form') { state.historyRange = validateRange(values.from, values.to); await loadEmployee(state.historyRange); return renderView(); }
    if (id === 'records-filter') { state.adminRange = validateRange(values.from, values.to); await loadAdmin(state.adminRange, values.employeeId || null); return renderView(); }
    if (id === 'report-filter') { state.reportRange = validateRange(values.from, values.to); state.includeDemoReport = !!values.includeDemo; await loadAdmin(state.reportRange); return renderView(); }
    if (id === 'delete-demo-form') {
      if (values.confirmation !== 'DELETE') throw new Error('Type DELETE to confirm.');
      await api(`/api/admin/employees/${values.id}`, { method: 'DELETE' });
      closeModal(); state.selectedEmployee = null; await loadEmployees(); await loadAdmin(state.adminRange || currentRange());
      renderView(); return flash('Demo account and test records deleted.', 'success');
    }
    if (id === 'premium-review-form') {
      await api(`/api/admin/extensions/${values.id}/review`, { method: 'POST', body: JSON.stringify(values) });
      closeModal(); await loadAdmin(state.adminRange || currentRange()); renderView();
      return flash(`${values.stage === 'OVERTIME' ? 'Overtime' : 'Night differential'} ${values.decision === 'APPROVED' ? 'granted' : 'denied'}.`, 'success');
    }
    if (id === 'settings-form') {
      const input = { siteName: values.siteName, siteLat: Number(values.siteLat), siteLng: Number(values.siteLng), radiusM: Number(values.radiusM), maxAccuracyM: Number(values.maxAccuracyM), cutoffDays: [Number(values.cutoffA), Number(values.cutoffB)] };
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(input) }); await refreshSession(); render(); return flash('Site and cutoff settings saved.', 'success');
    }
    if (id === 'holiday-form') {
      const holidays = [...config().customHolidays, { date: values.date, name: values.name.trim() }];
      await api('/api/admin/holidays', { method: 'PUT', body: JSON.stringify({ holidays }) });
      await refreshSession(); renderView(); return flash('No-work holiday saved.', 'success');
    }
    if (id === 'branding-form') {
      const file = form.elements.logoFile.files[0];
      if (file && values.removeLogo) throw new Error('Choose a new logo or remove the current one.');
      const images = file ? await logoImages(file) : {};
      await api('/api/admin/branding', { method: 'POST', body: JSON.stringify({ appName: values.appName, ...images, removeLogo: !!values.removeLogo }) });
      await loadBranding(); await refreshSession(); render(); return flash('App name and logo saved.', 'success');
    }
    if (id === 'employee-form') {
      const input = { name: values.name, email: values.email, password: values.password, scheduleStart: '08:00', scheduleEnd: '17:00',
        workdays: [...form.querySelectorAll('input[name="day"]:checked')].map(el => Number(el.value)), active: !!values.active, isDemo: !!values.isDemo };
      const editing = !!values.id;
      await api(editing ? `/api/admin/employees/${values.id}` : '/api/admin/employees', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(input) });
      state.selectedEmployee = null; await loadEmployees(); renderView(); return flash(editing ? 'Employee updated.' : 'Employee account created.', 'success');
    }
    if (id === 'backfill-form') {
      const input = { employeeId: values.employeeId, workDate: values.workDate, timeIn: values.timeIn || null, timeOut: values.timeOut || null,
        timeOutNextDay: !!values.timeOutNextDay, offsite: !!values.offsite,
        reason: values.reason, replaceExisting: !!values.replaceExisting };
      await api('/api/admin/attendance', { method: 'POST', body: JSON.stringify(input) });
      state.adminRange = { start: values.workDate, end: values.workDate };
      await go('records'); return flash('Admin-created attendance saved. Review any extra hours below.', 'success');
    }
  } catch (error) { flash(error.message, 'error'); }
  finally { if (submit?.isConnected) submit.disabled = false; }
});

window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline);
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

async function resumeAttendance() {
  if (!state.session) return;
  try {
    await refreshSession();
    await go(state.section);
  } catch (error) { flash(error.message, 'error'); }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void resumeAttendance();
});
setInterval(() => {
  if (!state.session || document.visibilityState !== 'visible') return;
  if (new Date().toLocaleDateString('en-CA', { timeZone }) !== today()) void resumeAttendance();
  else if (state.session.user.role === 'employee' && state.section === 'home' &&
           activeExtension() && !getTodayPunch('OUT')) renderView();
}, 60000);

await loadBranding();
try {
  await refreshSession();
  state.section = state.session.user.role === 'admin' ? 'dashboard' : 'home';
  await go(state.section);
} catch { state.session = null; await loadSignupStatus(); if (!navigator.onLine) { state.message = 'Offline. Attendance cannot be saved until you reconnect; contact admin if you need a backfill.'; state.messageType = 'warn'; } render(); }
