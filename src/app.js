import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import { api as functions } from '../convex/_generated/api.js';
import { attendanceDetails } from './reportDetails.js';
import { openFrontCamera, closeFrontCamera } from './selfieCamera.js';
import { eligibleAttendancePunches, groupPunches, holidayFor, isPayrollDayReady, isPayrollReady, isScheduledWorkday,
  expectedTimeOut, localDateTime, payrollDayTotals, premiumCalculationKey, punchProvenance, resolveWorkInterval, safeDate, shiftInstant, workBreakdown, workBreakdownIntervals, workIntervalBreakdowns } from '../rules.js';

const root = document.getElementById('app');
const deploymentUrl = import.meta.env.VITE_CONVEX_URL;
const client = deploymentUrl ? new ConvexHttpClient(deploymentUrl) : null;
const liveClient = deploymentUrl ? new ConvexClient(deploymentUrl) : null;
const liveSubscriptions = new Map();
const liveVersions = new Map();
const liveKeys = new Map();
let adminDataKey = '', employeeDataKey = '', employeesLoaded = false;
const dataKey = args => JSON.stringify([accessToken, args]);
let adminLoadVersion = 0;
let navigationVersion = 0;
function stopWatch(key) {
  liveVersions.set(key, (liveVersions.get(key) || 0) + 1);
  liveSubscriptions.get(key)?.();
  liveSubscriptions.delete(key);
  liveKeys.delete(key);
}
function stopLiveUpdates() {
  adminLoadVersion++;
  navigationVersion++;
  adminDataKey = employeeDataKey = ''; employeesLoaded = false;
  for (const key of liveSubscriptions.keys()) stopWatch(key);
}
function watchData(key, query, args, apply, sections) {
  const identity = dataKey(args);
  if (liveSubscriptions.has(key) && liveKeys.get(key) === identity) return;
  stopWatch(key);
  const version = liveVersions.get(key);
  if (!liveClient) return;
  const token = accessToken;
  liveKeys.set(key, identity);
  let previousValue;
  liveSubscriptions.set(key, liveClient.onUpdate(query, { token, ...args }, value => {
    if (!state.session || accessToken !== token || liveVersions.get(key) !== version) return;
    const serialized = JSON.stringify(value);
    if (serialized === previousValue) return;
    previousValue = serialized;
    apply(value);
    if (!state.modal && sections.includes(state.section)) renderView();
  }, () => { /* Normal requests surface authentication and connection errors. */ }));
}
let accessToken = localStorage.getItem('dtr_token') || sessionStorage.getItem('dtr_token') || '';
let toastTimer = null;
const state = {
  session: null, section: 'home', employeeData: { punches: [], extensions: [], overtime: [], openShift: null },
  branding: { appName: 'Onsite DTR', logo192Url: null, logo512Url: null },
  signupAvailable: false, authMode: 'login', signupPhoto: null,
  employees: [], adminData: { punches: [], extensions: [], overtime: [] }, historyRange: null,
  adminLoading: false, adminLoadError: '', adminRange: null, reportRange: null, reportEmployeeId: null, capture: null,
  backfillDraft: null, backfillLoadId: 0, backfillLoading: false,
  sitePromptedDate: null, onsiteAccess: null, installPrompt: null, installDismissed: false, modal: null, auditItems: [],
  message: '', messageType: 'notice'
};

const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const workdayLabel = days => (days || []).map(day => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(', ') || 'None selected';
const today = () => state.session?.today;
const config = () => state.session?.settings;
const currentRange = () => state.session?.cutoff;
const timeZone = 'Asia/Manila';
const toMinutes = text => Number(text?.slice(0, 2) || 0) * 60 + Number(text?.slice(3, 5) || 0);
const appInstalled = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const iosBrowser = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

function installPromptMarkup(extraClass = '') {
  if (state.session?.user.role === 'admin' || appInstalled() || state.installDismissed || (!state.installPrompt && !iosBrowser())) return '';
  const ios = iosBrowser() && !state.installPrompt;
  return `<aside class="install-banner ${h(extraClass)}" aria-label="Install ${h(state.branding.appName)}"><div class="install-mark">${brandIconMarkup()}</div><div class="install-copy"><strong>Install ${h(state.branding.appName)}</strong><p>${ios ? 'On iPhone or iPad, tap Share then “Add to Home Screen”.' : 'Add this app to your device for faster, full-screen attendance access.'}</p></div><div class="install-actions">${ios ? '' : '<button class="btn small" data-action="install">Install</button>'}<button class="install-close" data-action="dismiss-install" aria-label="Dismiss install prompt">×</button></div></aside>`;
}

async function api(path, options = {}) {
  if (!client) throw new Error('Convex is not configured. Set VITE_CONVEX_URL and rebuild the PWA.');
  const parsed = new URL(path, window.location.origin);
  const route = parsed.pathname;
  const input = options.body ? JSON.parse(options.body) : {};
  const from = parsed.searchParams.get('from') || undefined;
  const to = parsed.searchParams.get('to') || undefined;
  try {
    if (route === '/api/login') {
      const result = await client.action(functions.authActions.login, { identifier: input.identifier, password: input.password, remember: !!input.remember });
      stopLiveUpdates();
      accessToken = result.token;
      const storage = input.remember ? localStorage : sessionStorage;
      localStorage.removeItem('dtr_token'); sessionStorage.removeItem('dtr_token');
      storage.setItem('dtr_token', accessToken);
      return { user: result.user };
    }
    if (route === '/api/signup-status') return await client.query(functions.core.signupStatus, {});
    if (route === '/api/admin/signup') {
      const result = await client.action(functions.authActions.registerFirstAdmin, input);
      stopLiveUpdates();
      accessToken = result.token;
      const storage = input.remember ? localStorage : sessionStorage;
      localStorage.removeItem('dtr_token'); sessionStorage.removeItem('dtr_token');
      storage.setItem('dtr_token', accessToken);
      return { user: result.user };
    }
    if (route === '/api/branding') return await client.query(functions.core.branding, {});
    if (route === '/api/logout') {
      if (accessToken) await client.mutation(functions.core.logout, { token: accessToken });
      stopLiveUpdates();
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
      ? await client.mutation(functions.core.deleteEmployee, { token: accessToken, id: employeeId })
      : await client.action(functions.authActions.updateEmployee, { token: accessToken, id: employeeId, input });
    if (route === '/api/admin/attendance') return options.method === 'POST'
      ? await client.mutation(functions.core.backfill, { token: accessToken, input })
      : await client.query(functions.core.adminAttendance, { token: accessToken, from, to, employeeId: parsed.searchParams.get('employeeId') || undefined });
    if (route === '/api/admin/extensions/sync') return await client.mutation(functions.core.syncAutomaticPremiums,
      { token: accessToken, from: input.from, to: input.to });
    if (route === '/api/admin/attendance/day') return await client.mutation(functions.core.saveAdminAttendanceDay,
      { token: accessToken, input });
    if (route === '/api/admin/audit') return await client.query(functions.core.auditItems, { token: accessToken });
    if (route === '/api/admin/attendance/day/reset') return await client.mutation(functions.core.resetAttendanceDay,
      { token: accessToken, ...input });
    if (route === '/api/admin/attendance/day/approve') return await client.mutation(functions.core.approveAttendanceDay,
      { token: accessToken, userId: input.userId, workDate: input.workDate });
    if (route === '/api/admin/attendance/interval/review') return await client.mutation(functions.core.reviewAttendanceInterval,
      { token: accessToken, ...input });
    const verifyId = /^\/api\/admin\/punches\/(.+)\/verify$/.exec(route)?.[1];
    if (verifyId) return await client.mutation(functions.core.verify, { token: accessToken, id: verifyId, verification: input.verification, reason: input.reason || undefined });
    const extensionId = /^\/api\/admin\/extensions\/(.+)\/review$/.exec(route)?.[1];
    if (extensionId) return await client.mutation(functions.core.reviewExtension, { token: accessToken,
      id: extensionId, stage: input.stage, decision: input.decision, reason: input.reason || undefined, calculationKey: input.calculationKey || undefined });
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

function hideToast() {
  state.message = '';
  const flashBox = document.getElementById('flash');
  if (flashBox) { flashBox.hidden = true; flashBox.textContent = ''; }
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.classList.remove('toast-show');
  toast.setAttribute('aria-hidden', 'true');
  window.setTimeout(() => toast.remove(), 220);
}
function flash(message, type = 'notice') {
  state.message = message; state.messageType = type;
  const box = document.getElementById('flash');
  if (box) { box.className = `notice ${type}`; box.textContent = message; box.hidden = false; }
  else render();

  if (toastTimer) window.clearTimeout(toastTimer);
  document.getElementById('toast')?.remove();

  const normalizedType = ['success', 'error', 'warn'].includes(type) ? type : 'notice';
  const lowerMessage = String(message).toLowerCase();
  const title = normalizedType === 'error' ? 'Action failed'
    : normalizedType === 'warn' ? 'Attention needed'
      : normalizedType === 'success' && /(delete|remove)/.test(lowerMessage) ? 'Deleted successfully'
        : normalizedType === 'success' && /approv/.test(lowerMessage) ? 'Approved successfully'
          : normalizedType === 'success' ? 'Saved successfully' : 'Update';
  const icons = { success: '✓', error: '!', warn: '!', notice: 'i' };
  const toast = document.createElement('aside');
  toast.id = 'toast';
  toast.className = `app-toast toast-${normalizedType}`;
  toast.setAttribute('role', normalizedType === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', normalizedType === 'error' ? 'assertive' : 'polite');
  toast.setAttribute('aria-hidden', 'false');

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = icons[normalizedType];
  const copy = document.createElement('div');
  copy.className = 'toast-copy';
  const heading = document.createElement('strong');
  heading.textContent = title;
  const detail = document.createElement('p');
  detail.textContent = message;
  copy.append(heading, detail);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Close notification');
  close.textContent = '×';
  close.addEventListener('click', () => {
    if (toastTimer) window.clearTimeout(toastTimer);
    hideToast();
  });
  toast.append(icon, copy, close);
  document.body.append(toast);
  window.requestAnimationFrame(() => toast.classList.add('toast-show'));
  toastTimer = window.setTimeout(hideToast, 3000);
}
function formatTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-PH', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}
function punchSource(punch) {
  return punchProvenance(punch).sourceLabel;
}
function formatMinutes(minutes) {
  if (!minutes) return '0h 00m';
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
function time24(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
function formatClockText(value) {
  if (!/^\d{2}:\d{2}$/.test(value || '')) return value || '—';
  const [hours, minutes] = value.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
}
function weekdayLabel(date) {
  return `${new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))}.`;
}
function prettyDate(date) {
  if (!date) return '';
  return `${new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))} ${weekdayLabel(date)}`;
}
function numericDate(date) {
  if (!date) return '';
  return `${new Intl.DateTimeFormat('en-PH', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))} ${weekdayLabel(date)}`;
}
function reportDay(date) {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}
function reportDate(date) {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-PH', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}
function reportSource(punches = []) {
  return [...new Set(punches.map(punch => ({ EMPLOYEE: 'Employee', ADMIN: 'Admin', SYSTEM: 'System' })[punchProvenance(punch).source] || 'Unknown'))].join(' / ') || '—';
}
function reportStatus(punches = []) {
  const locations = punches.map(punch => punch.assignmentType || punchProvenance(punch).locationType)
    .filter(type => ['ONSITE', 'OFFSITE'].includes(type));
  return [...new Set(locations)].map(type => type === 'ONSITE' ? 'Onsite' : 'Offsite').join(' / ') || '—';
}
function incomingHolidays(limit = 4) {
  const dates = new Map((config()?.legalHolidays || []).filter(item => item.type === 'Special working').map(item => [item.date, item]));
  for (const holiday of config()?.holidays || []) dates.set(holiday.date, holiday);
  return [...dates.values()].filter(item => item.date >= today()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit);
}
function holidayList(holidays) {
  if (!holidays.length) return '<div class="holiday-empty"><span aria-hidden="true">◇</span><strong>Calendar is clear</strong><p>No published upcoming holidays yet.</p></div>';
  const current = Date.parse(`${today()}T00:00:00Z`);
  return `<div class="holiday-list">${holidays.map((item, index) => {
    const date = new Date(`${item.date}T00:00:00Z`);
    const daysAway = Math.round((date.getTime() - current) / 86400000);
    const proximity = daysAway === 0 ? 'Today' : daysAway === 1 ? 'Tomorrow' : `In ${daysAway} days`;
    const noWork = item.nonWorking !== false;
    return `<article class="holiday-item ${index === 0 ? 'is-next' : ''}">
      <div class="holiday-date"><strong>${h(new Intl.DateTimeFormat('en-PH', { month: 'short', timeZone: 'UTC' }).format(date))}</strong><span>${h(item.date.slice(8))}</span><small>${h(new Intl.DateTimeFormat('en-PH', { weekday: 'short', timeZone: 'UTC' }).format(date))}</small></div>
      <div class="holiday-info"><div class="holiday-kicker">${index === 0 ? `<span class="holiday-next">Next · ${h(proximity)}</span>` : `<span>${h(proximity)}</span>`}<span class="holiday-status ${noWork ? 'no-work' : 'workday'}">${noWork ? 'No work' : 'Workday'}</span></div><strong>${h(item.name)}</strong><small>${h(item.type || 'Company holiday')}</small></div>
      ${item.source ? `<a class="holiday-source" href="${h(item.source)}" target="_blank" rel="noopener noreferrer" aria-label="View official source for ${h(item.name)}"><span>Official source</span> ↗</a>` : '<span class="holiday-company">Company calendar</span>'}
    </article>`;
  }).join('')}</div>`;
}
function renderHolidayCard(limit = 4) {
  const holidays = incomingHolidays(limit);
  return `<section class="card wide holiday-card"><div class="holiday-card-head"><div><div class="card-title"><span class="symbol">▦</span> UPCOMING HOLIDAYS</div><p class="card-sub">Philippine public holidays and company no-work dates.</p></div><span class="holiday-count">${holidays.length} upcoming</span></div>${holidayList(holidays)}<div class="holiday-note"><span aria-hidden="true">ⓘ</span><p>National dates for 2026–2027 are included. Admins can manage company dates from Holiday settings.</p></div></section>`;
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
function monthDate(month, day) { return `${month}-${String(day).padStart(2, '0')}`; }
function nextMonth(month) {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, value, 1));
  return date.toISOString().slice(0, 7);
}
function monthEnd(month) { return yesterday(`${nextMonth(month)}-01`); }
function payrollRanges(month, firstStart, secondStart) {
  return {
    first: { start: firstStart, end: yesterday(secondStart) },
    second: { start: secondStart, end: yesterday(monthDate(nextMonth(month), Number(firstStart.slice(8)))) }
  };
}
function payrollPreviewMarkup(month, firstStart, secondStart) {
  if (!month || !firstStart || !secondStart || !firstStart.startsWith(`${month}-`) || !secondStart.startsWith(`${month}-`) || firstStart >= secondStart)
    return '<p class="tiny-label">Choose two start dates in order within the selected month.</p>';
  const ranges = payrollRanges(month, firstStart, secondStart);
  return `<div class="cutoff-preview-row"><span>First cutoff</span><strong>${h(dateSpan(ranges.first))}</strong></div><div class="cutoff-preview-row"><span>Second cutoff</span><strong>${h(dateSpan(ranges.second))}</strong></div>`;
}
function syncPayrollEditor(resetDates = false) {
  const form = document.getElementById('payroll-settings-form');
  if (!form) return;
  const month = form.elements.payrollMonth.value;
  if (!month) return;
  const min = `${month}-01`, max = monthEnd(month);
  for (const input of [form.elements.firstStart, form.elements.secondStart]) { input.min = min; input.max = max; }
  if (resetDates || !form.elements.firstStart.value.startsWith(`${month}-`)) {
    form.elements.firstStart.value = monthDate(month, config().cutoffDays[0]);
    form.elements.secondStart.value = monthDate(month, config().cutoffDays[1]);
  }
  const preview = document.getElementById('payroll-preview');
  if (preview) preview.innerHTML = payrollPreviewMarkup(month, form.elements.firstStart.value, form.elements.secondStart.value);
}
function rangeUrl(path, range, employeeId) {
  const query = new URLSearchParams({ from: range.start, to: range.end });
  if (employeeId) query.set('employeeId', employeeId);
  return `${path}?${query}`;
}
function activeWorkDate() { return state.employeeData.clock?.workDate || state.employeeData.openShift?.workDate || today(); }
function currentWorkPunches() {
  if (state.employeeData.clock) return state.employeeData.clock.punches;
  const punches = state.employeeData.punches.filter(p => p.workDate === activeWorkDate());
  const open = state.employeeData.openShift?.inPunch;
  if (open && !punches.some(punch => punch.id === open.id)) punches.push(open);
  return punches;
}
function nextEmployeePunch() {
  if (state.employeeData.clock) return state.employeeData.clock;
  const last = groupPunches(currentWorkPunches()).at(-1);
  const nextSlot = last?.inPunch && !last.outPunch ? 'OUT' : 'IN';
  const nextSegment = nextSlot === 'OUT' ? last.number : (last?.number || 0) + 1;
  return { workDate: activeWorkDate(), nextSlot, nextSegment,
    blockReason: nextSegment > 6 ? 'All six intervals for this workday are complete.' : '' };
}
function getTodayPunch(slot) {
  const group = groupPunches(currentWorkPunches()).at(-1);
  return slot === 'IN' ? group?.inPunch : group?.outPunch;
}
function activeExtension() {
  return state.employeeData.openShift?.extension ||
    state.employeeData.extensions.find(item => item.workDate === activeWorkDate());
}
function premiumBreakdown(date, inPunch, outPunch, extension, employee = state.session?.user) {
  return workBreakdown(date, inPunch?.timeUtc, outPunch?.timeUtc, extension?.continuedAt,
    inPunch ? (inPunch.scheduleStart || '08:00') : (employee?.scheduleStart || '08:00'),
    inPunch ? (inPunch.scheduleEnd || '17:00') : (employee?.scheduleEnd || '17:00'));
}
function dayBreakdown(date, punches, extension, employee = state.session?.user) {
  punches = eligibleAttendancePunches(punches);
  const schedulePunch = groupPunches(punches).find(group => group.inPunch)?.inPunch;
  return workBreakdownIntervals(date, groupPunches(punches).map(group => ({
    inUtc: group.inPunch?.timeUtc, outUtc: group.outPunch?.timeUtc
  })), extension?.continuedAt, schedulePunch ? (schedulePunch.scheduleStart || '08:00') : (employee?.scheduleStart || '08:00'),
    schedulePunch ? (schedulePunch.scheduleEnd || '17:00') : (employee?.scheduleEnd || '17:00'));
}
function intervalHoursMarkup(hours) {
  if (!hours) return '';
  return `<div class="attendance-hour-grid interval-hours"><div><span>Regular</span><strong>${h(formatMinutes(hours.regularMinutes))}</strong></div><div><span>Fills regular shortage</span><strong>${h(formatMinutes(hours.regularTopUpMinutes))}</strong></div><div><span>Remaining OT</span><strong>${h(formatMinutes(hours.overtimeCandidateMinutes))}</strong></div><div><span>Night differential</span><strong>${h(formatMinutes(hours.nightCandidateMinutes))}</strong></div></div><p class="tiny-label">OT total (remaining OT + ND): <strong>${h(formatMinutes(hours.totalOvertimeCandidateMinutes))}</strong>. Regular shortage after this interval: ${h(formatMinutes(hours.shortageAfterMinutes))}. ND never reduces undertime. Remaining OT and ND need separate admin approval.</p>`;
}
function intervalHoursForPunches(date, punches) {
  return workIntervalBreakdowns(date, groupPunches(eligibleAttendancePunches(punches)).map(group => ({ number: group.number,
    inUtc: group.inPunch?.timeUtc, outUtc: group.outPunch?.timeUtc })));
}
function resolvedDraftIntervals(draft) {
  let previousOut = null;
  return draft.segments.map(segment => {
    try {
      const resolved = resolveWorkInterval(draft.workDate, segment, previousOut);
      previousOut = resolved.outUtc;
      return { ...segment, ...resolved };
    } catch (error) {
      previousOut = null;
      return { ...segment, inUtc: null, outUtc: null, dateError: error.message };
    }
  });
}
function draftIntervalHours(draft) {
  if (!safeDate(draft.workDate)) return [];
  return workIntervalBreakdowns(draft.workDate, resolvedDraftIntervals(draft));
}
function draftDayHoursMarkup(draft) {
  if (!safeDate(draft.workDate)) return '';
  const hours = workBreakdownIntervals(draft.workDate, resolvedDraftIntervals(draft));
  return `<strong>Workday totals</strong><div class="attendance-hour-grid"><div><span>Regular</span><strong>${h(formatMinutes(hours.regularMinutes))}</strong></div><div><span>Undertime</span><strong>${h(formatMinutes(hours.undertimeMinutes))}</strong></div><div><span>Remaining OT</span><strong>${h(formatMinutes(hours.remainingOvertimeMinutes))}</strong></div><div><span>Night differential</span><strong>${h(formatMinutes(hours.nightCandidateMinutes))}</strong></div></div><p>OT total (remaining OT + ND): <strong>${h(formatMinutes(hours.totalOvertimeCandidateMinutes))}</strong></p><p class="tiny-label">ND stays intact even when regular time is short. Remaining OT and ND require separate admin approval before payroll.</p>`;
}
function intervalDatesMarkup(segment, workDate) {
  if (!safeDate(workDate)) return '';
  if (segment.dateError) return `<p class="notice warn">${h(segment.dateError)}</p>`;
  if (!segment.inUtc) return '';
  return `<p class="tiny-label">Time In date: ${h(numericDate(localDateTime(segment.inUtc, timeZone).date))}${segment.outUtc ? ` · Time Out date: ${h(numericDate(localDateTime(segment.outUtc, timeZone).date))}` : ''}${segment.timeInNextDay || segment.timeOutNextDay ? ` Attendance stays on ${h(numericDate(workDate))}` : ''}</p>`;
}
function updateIntervalPreviews(form) {
  state.backfillDraft = { ...state.backfillDraft, ...backfillInputFromForm(form) };
  const hours = draftIntervalHours(state.backfillDraft);
  for (const [index, element] of [...form.querySelectorAll('[data-interval-hours]')].entries())
    element.innerHTML = intervalHoursMarkup(hours[index]);
  const segments = resolvedDraftIntervals(state.backfillDraft);
  for (const [index, element] of [...form.querySelectorAll('[data-interval-dates]')].entries())
    element.innerHTML = intervalDatesMarkup(segments[index], state.backfillDraft.workDate);
  const daySummary = form.querySelector('[data-day-hours]');
  if (daySummary) daySummary.innerHTML = draftDayHoursMarkup(state.backfillDraft);
}
function intervalText(punches, date, slot) {
  return groupPunches(punches).map(group => formatTime(group[slot === 'IN' ? 'inPunch' : 'outPunch']?.timeUtc) +
    ([group.inPunch, group.outPunch].some(punch => punch?.verification === 'REJECTED') ? ' (Declined)' : '')).join(' / ');
}
function runningBreakdown(date, inPunch, outPunch, extension) {
  if (outPunch || !inPunch) return premiumBreakdown(date, inPunch, outPunch, extension);
  const estimate = new Date(Math.min(Date.now(), Date.parse(shiftInstant(date, '06:00', true)))).toISOString();
  return workBreakdown(date, inPunch.timeUtc, estimate, extension?.continuedAt);
}
function badge(punch) {
  if (!punch) return '<span class="pill pending">Not recorded</span>';
  if (punch.verification === 'REJECTED') return `<span class="pill rejected">${h(punchSource(punch))} · Declined</span>`;
  if (punch.verification === 'PENDING') return `<span class="pill pending">${h(punchSource(punch))} · Pending verification</span>`;
  if (punch.method === 'ADMIN') return '<span class="pill admin">Admin · Manual time</span>';
  if (punch.method === 'SYSTEM') return '<span class="pill admin">System · Auto-closed at 6:00 AM</span>';
  if (punch.verification === 'PENDING') return `<span class="pill pending">${h(punchSource(punch))} · Pending verification</span>`;
  if (punch.verification === 'REJECTED') return `<span class="pill rejected">${h(punchSource(punch))} · Rejected</span>`;
  return `<span class="pill">${h(punchSource(punch))} · Verified</span>`;
}
function minutesStatus(inPunch, outPunch, employee, date) {
  if (!isScheduledWorkday(date, employee.workdays, config().holidays)) return { late: 0, early: 0 };
  if (!inPunch || !outPunch) return { late: 0, early: 0 };
  const hours = premiumBreakdown(date, inPunch, outPunch, null, employee);
  return {
    late: 0,
    early: hours.undertimeMinutes
  };
}
function brandIconMarkup() {
  const logo = state.branding.logo192Url;
  return `<img class="brand-icon brand-image" src="${h(logo || '/icon-192.png')}" alt="">`;
}
function brandMarkup() {
  return `${brandIconMarkup()}<span>${h(state.branding.appName)}</span>`;
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
function statusOfDay(punches) {
  const groups = groupPunches(punches);
  if (!groups.length) return 'No record';
  if (groups.some(group => !group.inPunch || !group.outPunch)) return 'Incomplete';
  if (eligibleAttendancePunches(punches).some(punch => punch.verification === 'PENDING')) return 'Pending verification';
  const declined = groups.filter(group => [group.inPunch, group.outPunch].some(p => p?.verification === 'REJECTED')).length;
  if (declined) return declined === groups.length ? 'Declined' : `Approved · ${declined} declined interval(s)`;
  return 'Present';
}
function minutesStatusDay(punches, employee, date) {
  if (!isScheduledWorkday(date, employee.workdays, config().holidays)) return { late: 0, early: 0 };
  const groups = groupPunches(punches);
  if (!groups.length || groups.some(group => !group.inPunch || !group.outPunch)) return { late: 0, early: 0 };
  const shortfall = dayBreakdown(date, punches, null, employee).undertimeMinutes;
  return { late: 0, early: shortfall };
}
function locationText(p) {
  if (!p) return '—';
  if (p.method === 'ADMIN') return 'Manual time set by admin';
  if (p.method === 'SYSTEM') return 'Automatic 6:00 AM cutoff';
  return `${p.method === 'ONSITE' ? 'Site GPS' : 'Field GPS'} · ±${Math.round(p.accuracyM || 0)} m`;
}
function mapLink(p, label = 'Open in Google Maps ↗') {
  if (p?.latitude == null || p?.longitude == null) return '';
  const lat = Number(p.latitude), lng = Number(p.longitude);
  return `<a href="https://www.google.com/maps/search/?api=1&amp;query=${lat},${lng}" target="_blank" rel="noopener noreferrer">${h(label)}</a>`;
}
function detectedPunchMethod(location, extension = null) {
  if (extension) return 'OFFSITE';
  const site = config();
  if (!location || !site?.configured) return 'OFFSITE';
  return haversine(location.latitude, location.longitude, site.siteLat, site.siteLng) <= site.radiusM ? 'ONSITE' : 'OFFSITE';
}
function recentAttendanceFolders(punches) {
  const grouped = new Map();
  for (const punch of punches) {
    if (!grouped.has(punch.workDate)) grouped.set(punch.workDate, []);
    grouped.get(punch.workDate).push(punch);
  }
  const entries = [...grouped.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  return `<section class="card attendance-folders-card"><div class="attendance-folders-head"><div><div class="card-title"><span class="symbol">▤</span> RECENT ATTENDANCE</div><p class="card-sub">Your latest Time In and Time Out records.</p></div><button class="link-button" data-nav="history">View all ›</button></div>${entries.length ? `<div class="attendance-folders">${entries.map(([date, dayPunches]) => {
    const status = statusOfDay(dayPunches);
    return `<article class="attendance-folder"><div class="attendance-folder-tab"><strong>${h(prettyDate(date))}</strong><span class="${status === 'Present' ? 'complete' : ''}">${h(status)}</span></div>${groupPunches(dayPunches).map((group, index) => `<div class="attendance-folder-times"><div><span>${index + 1} · TIME IN</span><strong>${h(formatTime(group.inPunch?.timeUtc))}</strong><small>${h(punchSource(group.inPunch))}</small>${group.inPunch ? mapLink(group.inPunch, 'View map ↗') : ''}</div><div><span>${index + 1} · TIME OUT</span><strong>${h(formatTime(group.outPunch?.timeUtc))}</strong><small>${h(punchSource(group.outPunch))}</small>${group.outPunch ? mapLink(group.outPunch, 'View map ↗') : ''}</div></div>`).join('')}</article>`;
  }).join('')}</div>` : '<div class="holiday-empty"><span aria-hidden="true">◷</span><strong>No attendance yet</strong><p>Your first punch will appear here.</p></div>'}</section>`;
}

async function refreshSession() {
  state.session = await api('/api/session');
  watchData('session', functions.core.session, {}, value => { state.session = value; }, ['home', 'history']);
}
async function loadEmployee(range = state.historyRange || currentRange(), useCache = false) {
  const key = dataKey(range);
  state.historyRange = range;
  if (useCache && employeeDataKey === key && liveSubscriptions.has('attendance')) return;
  state.employeeData = await api(rangeUrl('/api/attendance', range));
  employeeDataKey = key;
  watchData('attendance', functions.core.attendance, { from: range.start, to: range.end },
    value => { state.employeeData = value; }, ['home', 'history']);
}
async function loadEmployees(useCache = false) {
  if (useCache && employeesLoaded && liveSubscriptions.has('employees')) return;
  state.employees = (await api('/api/admin/employees')).employees;
  employeesLoaded = true;
  watchData('employees', functions.core.employees, {}, value => { state.employees = value.employees; },
    ['records', 'report', 'dashboard']);
}
async function loadAdmin(range = state.adminRange || currentRange(), employeeId = null, rememberRange = true, useCache = false) {
  const key = dataKey({ range, employeeId });
  if (rememberRange) state.adminRange = range;
  if (useCache && adminDataKey === key && liveSubscriptions.has('adminAttendance')) {
    state.adminLoading = false; state.adminLoadError = ''; return;
  }
  const version = ++adminLoadVersion, token = accessToken;
  if (adminDataKey !== key) stopWatch('adminAttendance');
  state.adminLoading = adminDataKey !== key; state.adminLoadError = '';
  if (!state.modal) renderView();
  try {
    await api('/api/admin/extensions/sync', { method: 'POST', body: JSON.stringify({ from: range.start, to: range.end }) });
    if (version !== adminLoadVersion || token !== accessToken) return;
    const data = await api(rangeUrl('/api/admin/attendance', range, employeeId));
    if (version !== adminLoadVersion || token !== accessToken) return;
    state.adminData = data;
    adminDataKey = key;
    watchData('adminAttendance', functions.core.adminAttendance,
      { from: range.start, to: range.end, ...(employeeId ? { employeeId } : {}) },
      value => { state.adminData = value; }, ['records', 'report', 'dashboard']);
  } catch (error) {
    if (version !== adminLoadVersion || token !== accessToken) return;
    state.adminLoadError = error.message;
    throw error;
  } finally {
    if (version === adminLoadVersion && token === accessToken) state.adminLoading = false;
  }
}
function blankBackfillDraft() {
  return { employeeId: '', workDate: today(), reason: '', expectedIds: [], punches: [],
    segments: [{ timeIn: '', timeOut: '', timeInNextDay: false, timeOutNextDay: false,
      inId: null, outId: null, offsite: false }] };
}
async function loadBackfillDay(employeeId, workDate) {
  const request = ++state.backfillLoadId;
  const draft = { ...blankBackfillDraft(), employeeId, workDate };
  state.backfillDraft = draft;
  state.backfillLoading = !!(employeeId && workDate);
  renderView();
  if (!state.backfillLoading) return;
  try {
    const result = await api(rangeUrl('/api/admin/attendance', { start: workDate, end: workDate }, employeeId));
    if (request !== state.backfillLoadId) return;
    const punches = result.punches.filter(punch => punch.userId === employeeId && punch.workDate === workDate);
    draft.punches = punches;
    draft.expectedIds = punches.map(punch => punch.id);
    if (punches.length) draft.segments = groupPunches(punches).map(group => {
      const source = group.outPunch || group.inPunch;
      return { inId: group.inPunch?.id || null, outId: group.outPunch?.id || null,
        timeIn: time24(group.inPunch?.timeUtc), timeOut: time24(group.outPunch?.timeUtc),
        timeInNextDay: !!group.inPunch && localDateTime(group.inPunch.timeUtc, timeZone).date > workDate,
        timeOutNextDay: !!group.outPunch && localDateTime(group.outPunch.timeUtc, timeZone).date > workDate,
        offsite: source?.assignmentType ? source.assignmentType === 'OFFSITE' : source?.method === 'OFFSITE',
        reason: group.inPunch?.reason || group.outPunch?.reason || '',
        fieldAssignment: group.inPunch?.fieldAssignment || group.outPunch?.fieldAssignment || '' };
    });
  } finally {
    if (request === state.backfillLoadId) { state.backfillDraft = draft; state.backfillLoading = false; renderView(); }
  }
}
function backfillInputFromForm(form) {
  const draft = state.backfillDraft || blankBackfillDraft();
  const input = { employeeId: form.elements.employeeId.value, workDate: form.elements.workDate.value,
    expectedIds: draft.expectedIds, punches: draft.punches,
    segments: [...form.querySelectorAll('.manual-interval')].map((row, index) => ({
      inId: draft.segments[index]?.inId || null, outId: draft.segments[index]?.outId || null,
      timeIn: row.querySelector('[name="timeIn"]').value,
      timeOut: row.querySelector('[name="timeOut"]').value,
      timeInNextDay: row.querySelector('[name="timeIn"]').value === draft.segments[index]?.timeIn && !!draft.segments[index]?.timeInNextDay,
      timeOutNextDay: row.querySelector('[name="timeOut"]').value === draft.segments[index]?.timeOut && !!draft.segments[index]?.timeOutNextDay,
      offsite: row.querySelector('[name="offsite"]').checked,
      reason: row.querySelector('[name="intervalReason"]').value,
      fieldAssignment: row.querySelector('[name="fieldAssignment"]').value
    })) };
  input.segments = resolvedDraftIntervals(input).map(({ inUtc, outUtc, dateError, ...segment }) => segment);
  return input;
}
async function go(section) {
  const navigation = ++navigationVersion;
  adminLoadVersion++;
  state.adminLoading = ['dashboard', 'records', 'report'].includes(section);
  state.adminLoadError = '';
  if (section !== 'capture') closeFrontCamera();
  state.section = section; state.modal = null; state.message = '';

  if (section === 'report') { state.reportRange = null; state.reportEmployeeId = null; }
  if (section === 'backfill') { state.backfillLoadId++; state.backfillLoading = false; state.backfillDraft = blankBackfillDraft(); }
  try {
    if (state.session.user.role === 'employee' && ['home', 'history'].includes(section)) await loadEmployee(section === 'home' ? currentRange() : state.historyRange || currentRange(), true);
    if (state.session.user.role === 'admin') {
      if (['dashboard', 'employees', 'backfill', 'records', 'report'].includes(section)) await loadEmployees(true);
      if (navigation !== navigationVersion) return;
      if (section === 'dashboard') await loadAdmin(currentRange(), null, false, true);
      if (section === 'records') await loadAdmin(state.adminRange || currentRange(), null, true, true);
      if (section === 'report') await loadAdmin(state.reportRange || currentRange(), null, false, true);
      if (section === 'audit') state.auditItems = (await api('/api/admin/audit')).items;
    }
  } catch (error) { if (navigation === navigationVersion) { state.adminLoading = false; state.adminLoadError = error.message; flash(error.message, 'error'); } }
  if (navigation !== navigationVersion) return;
  render();
  window.scrollTo(0, 0);
}

function renderLogin() {
  const signup = state.signupAvailable && state.authMode === 'signup';
  root.innerHTML = `${installPromptMarkup('floating-install')}<div class="login-wrap"><section class="login-art" aria-label="Philippine AODA Power Corp. generator facility"><div class="login-company"><div class="login-company-logo">${brandIconMarkup()}</div><div class="login-company-name"><span>PHILIPPINE</span><strong>AODA POWER CORP.</strong></div></div><div class="login-hero-copy"><span class="login-hero-rule"></span><div class="headline">Reliable power.<br>Accountable work.</div></div><div class="login-art-footer"><span>GENSET OPERATIONS</span><span>DIGITAL TIME RECORD</span></div></section><section class="login-panel"><div class="login-mobile-brand"><div class="login-company-logo">${brandIconMarkup()}</div><div class="login-company-name"><span>PHILIPPINE</span><strong>AODA POWER CORP.</strong></div></div><div class="login-box"><div class="login-form-mark">${brandIconMarkup()}</div><p class="eyebrow">${signup ? 'ADMIN SETUP' : 'SECURE ACCESS'}</p><h1>${signup ? 'Create admin account' : 'Welcome back'}</h1>${state.message ? `<div id="flash" class="notice ${h(state.messageType)}">${h(state.message)}</div>` : ''}${signup ? `<form id="signup-form"><div class="field"><label for="signup-name">Full name</label><input id="signup-name" name="name" minlength="2" maxlength="120" autocomplete="name" required></div><div class="field"><label for="signup-email">Email address</label><input id="signup-email" name="email" type="email" autocomplete="email" required></div><div class="field-row"><div class="field"><label for="signup-password">Password</label><input id="signup-password" name="password" type="password" minlength="8" autocomplete="new-password" placeholder="8+ characters" required></div><div class="field"><label for="signup-confirm">Confirm password</label><input id="signup-confirm" name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required></div></div><div class="field"><label for="signup-photo">Profile picture</label><input id="signup-photo" type="file" accept="image/png,image/jpeg,image/webp"><img id="signup-photo-preview" class="profile-photo-preview ${state.signupPhoto ? '' : 'hidden'}" src="${state.signupPhoto || ''}" alt="Profile photo preview"></div><label class="check-row"><input type="checkbox" name="remember" checked> Keep me signed in</label><button class="btn block login-submit" type="submit">Create account <span aria-hidden="true">→</span></button></form><button class="link-button auth-switch" data-action="auth-login">Return to sign in</button>` : `<form id="login-form"><div class="field"><label for="identifier">Username or admin email</label><input id="identifier" name="identifier" type="text" autocapitalize="none" spellcheck="false" maxlength="200" autocomplete="username" placeholder="Employee username or admin email" required></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required></div><label class="check-row"><input type="checkbox" name="remember" checked> Keep me signed in</label><button class="btn block login-submit" type="submit">Sign in <span aria-hidden="true">→</span></button></form>${state.signupAvailable ? '<button class="link-button auth-switch" data-action="auth-signup">Set up administrator access</button>' : ''}`}</div><div class="login-panel-footer"><span>${h(state.branding.appName)}</span><span>Asia/Manila</span></div></section></div>`;
}

const employeeNav = [['home', '⌂', 'Home'], ['history', '▤', 'Attendance'], ['capture', '◎', 'Time clock'], ['profile', '◉', 'Profile']];
const adminNav = [['dashboard', '⌂', 'Home'], ['records', '▤', 'Records'], ['employees', '♙', 'Employees'], ['backfill', '＋', 'Add'], ['report', '▥', 'Reports']];
function renderShell() {
  const user = state.session.user, admin = user.role === 'admin';
  const nav = admin ? adminNav : employeeNav;
  root.innerHTML = `<div class="shell"><header class="topbar"><div class="brand">${brandMarkup()}</div><div class="top-right"><span class="tiny-label">${admin ? 'Admin' : 'Employee'} · ${h(user.name)}</span><button class="avatar" data-nav="profile" aria-label="Open ${h(user.name)} profile">${avatarMarkup(user)}</button></div></header><div id="offline" class="offline hidden">Offline — punches cannot be submitted. Contact admin if needed.</div><main class="container">${installPromptMarkup()}<div id="flash" class="notice ${h(state.messageType)}" ${state.message ? '' : 'hidden'}>${h(state.message)}</div><div id="view"></div></main><nav class="bottom-nav" aria-label="Main navigation"><div class="bottom-inner">${nav.map(([id, icon, label]) => `<button class="nav-item ${state.section === id ? 'active' : ''}" data-nav="${id}" aria-label="${label}"><span class="nav-icon">${icon}</span>${label}</button>`).join('')}</div></nav></div><div id="modal-root"></div>`;
  renderView(); updateOnline();
  if (state.modal) showModal(state.modal);
}
function renderView() {
  const view = document.getElementById('view'); if (!view) return;
  const admin = state.session.user.role === 'admin';
  if (admin && ['dashboard', 'records', 'report'].includes(state.section) && (state.adminLoading || state.adminLoadError)) {
    view.innerHTML = state.adminLoading ? '<div class="notice" role="status">Loading attendance for the selected date range…</div>'
      : '<div class="notice warn" role="alert">Could not load attendance. Please reopen this page to retry. ' + h(state.adminLoadError) + '</div>';
    return;
  }
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
  const cutoffDates = [...new Set(punches.filter(p => p.workDate >= current.start && p.workDate <= current.end).map(p => p.workDate))];
  const late = cutoffDates.reduce((n, date) => n + minutesStatusDay(punches.filter(p => p.workDate === date), user, date).late, 0);
  const undertime = cutoffDates.reduce((n, date) => n + minutesStatusDay(punches.filter(p => p.workDate === date), user, date).early, 0);
  const clock = nextEmployeePunch();
  const action = holiday || clock.blockReason ? null : clock.nextSlot;
  const dayPunches = currentWorkPunches();
  const extra = dayBreakdown(workDate, dayPunches, extension);
  if (inPunch && !outPunch) Object.assign(extra, dayBreakdown(workDate,
    [...dayPunches, { slot: 'OUT', segment: inPunch.segment || 1, timeUtc: new Date(Math.min(Date.now(), Date.parse(shiftInstant(workDate, '06:00', true)))).toISOString() }], extension));
  const expectedOut = expectedTimeOut(workDate, groupPunches(eligibleAttendancePunches(dayPunches)).map(group => ({
    inUtc: group.inPunch?.timeUtc, outUtc: group.outPunch?.timeUtc
  })));
  return `<div class="hero"><p class="eyebrow">${h(prettyDate(today()))}</p><h1>${greeting()}, ${h(user.name.split(' ')[0])}</h1><p>Here's your attendance at a glance.</p></div>
    <div class="grid employee-home-grid"><section class="card wide employee-attendance-card"><div class="employee-attendance-head"><div class="card-title"><span class="symbol">◷</span> ${state.employeeData.openShift ? 'OVERNIGHT SHIFT' : "TODAY'S ATTENDANCE"} · Interval ${h(inPunch?.segment || 1)}</div><button class="attendance-view-button" data-nav="history" aria-label="View attendance history" title="View attendance history"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.8"></circle></svg></button></div><div class="pill ${statusOf(inPunch,outPunch) === 'Present' ? '' : 'pending'}">${h(holiday && !inPunch && !outPunch ? `Holiday · ${holiday.name}` : statusOf(inPunch,outPunch))}</div><p class="card-sub">Work date: ${h(prettyDate(workDate))}</p>${expectedOut ? `<p class="card-sub">Expected Time Out for 8 working hours: <strong>${h(formatTime(expectedOut))}</strong>${outPunch ? '' : ' · assumes no further unpaid breaks'}</p>` : inPunch ? '<p class="card-sub">The remaining regular hours cannot be completed before 10:00 PM. Night differential is recorded separately.</p>' : '<p class="card-sub">Time In is available from 6:00 AM to 5:00 PM.</p>'}<div class="punch-line"><span>Time In</span><strong class="${inPunch ? '' : 'missing'}">${h(formatTime(inPunch?.timeUtc))}</strong></div><div class="card-sub">${badge(inPunch)} ${h(locationText(inPunch))} ${inPunch ? mapLink(inPunch, 'Open Time In map ↗') : ''}</div><div class="punch-line"><span>Time Out</span><strong class="${outPunch ? '' : 'missing'}">${h(formatTime(outPunch?.timeUtc))}</strong></div><div class="card-sub">${badge(outPunch)} ${h(locationText(outPunch))} ${outPunch ? mapLink(outPunch, 'Open Time Out map ↗') : ''}</div>${extension && outPunch ? `<p class="card-sub">OT total (remaining OT + ND): ${h(formatMinutes(extra.totalOvertimeCandidateMinutes))}. Remaining OT ${h(formatMinutes(extra.overtimeCandidateMinutes))} (${h(extension.overtimeDecision.toLowerCase())}) · Night differential ${h(formatMinutes(extra.nightCandidateMinutes))} (${h(extra.nightCandidateMinutes ? extension.nightDecision.toLowerCase() : 'none')}).</p>` : ''}${action ? `<div class="card-actions"><button class="btn auto-punch-button" data-action="capture-auto" data-slot="${action}"><span aria-hidden="true">◎</span> ${action === 'IN' ? 'Time In' : 'Time Out'}${clock.nextSegment > 1 ? ` · Interval ${clock.nextSegment}` : ''}</button></div>` : ''}${action ? `<div class="punch-location-status ready"><span>GPS automatically marks this punch as <strong>Onsite</strong> inside the site pin or <strong>Offsite</strong> outside it.</span></div>` : ''}</section>
    <section class="card employee-cutoff-card"><div class="card-title"><span class="symbol">▤</span> CURRENT CUTOFF</div><div class="card-sub">${h(dateSpan(current))}</div><div class="metric-row"><div class="metric-cell"><div class="metric green">${days.size}</div><span class="label">Days with Time In</span></div><div class="metric-cell"><div class="metric amber">${late}</div><span class="label">Late minutes</span></div></div><p class="card-sub">Undertime: ${h(formatMinutes(undertime))}</p><button class="link-button" data-nav="history">View cutoff details ›</button></section>
    ${recentAttendanceFolders(punches)}${renderHolidayCard()}</div>
    ${inPunch && !outPunch && extra.overtimeCandidateMinutes ? `<div style="height:16px"></div><div class="notice">Current estimated overtime beyond 8 actual working hours: <strong>${h(formatMinutes(extra.overtimeCandidateMinutes))}</strong>. The final OT request is created automatically when Time Out is recorded.</div>` : ''}`;
}

function employeeAttendanceDayCard(date, pair) {
  const holiday = holidayFor(date, config().holidays);
  const status = holiday && !pair.IN && !pair.OUT ? `Holiday · ${holiday.name}` : statusOf(pair.IN, pair.OUT);
  const mins = minutesStatus(pair.IN, pair.OUT, state.session.user, date);
  const extension = state.employeeData.extensions.find(item => item.workDate === date);
  const hours = runningBreakdown(date, pair.IN, pair.OUT, extension);
  const overtime = extension && pair.OUT ? hours.totalOvertimeCandidateMinutes : 0;
  const verification = pair.IN?.verification === 'REJECTED' || pair.OUT?.verification === 'REJECTED' ? 'rejected'
    : pair.IN?.verification === 'APPROVED' && pair.OUT?.verification === 'APPROVED' ? 'approved' : 'pending';
  return `<article class="attendance-day-card"><div class="attendance-day-head"><div><span class="attendance-day-label">WORKDAY</span><h3>${h(prettyDate(date))}</h3></div><span class="attendance-state ${verification}">${h(status)}</span></div><div class="attendance-time-grid"><div><span>TIME IN</span><strong>${h(formatTime(pair.IN?.timeUtc))}</strong><small>${h(punchSource(pair.IN))}</small>${pair.IN ? mapLink(pair.IN, 'View map ↗') : ''}</div><div><span>TIME OUT</span><strong>${h(formatTime(pair.OUT?.timeUtc))}</strong><small>${h(punchSource(pair.OUT))}</small>${pair.OUT ? mapLink(pair.OUT, 'View map ↗') : ''}</div></div><div class="attendance-hour-grid"><div><span>Regular</span><strong>${h(formatMinutes(hours.regularMinutes))}</strong></div><div><span>Undertime</span><strong>${h(formatMinutes(hours.undertimeMinutes))}</strong></div><div><span>Overtime</span><strong>${h(formatMinutes(overtime))}</strong></div><div class="differential"><span>Night differential</span><strong>${h(formatMinutes(hours.nightCandidateMinutes))}</strong></div></div>${mins.late ? `<div class="attendance-alert">Late balance · ${h(formatMinutes(mins.late))}</div>` : ''}${extension ? `<p class="attendance-review">Remaining OT ${h(extension.overtimeDecision.toLowerCase())} · Night differential ${h(hours.nightCandidateMinutes ? extension.nightDecision.toLowerCase() : 'none')}</p>` : ''}${pair.IN?.verification === 'REJECTED' ? `<p class="attendance-rejected">Time In rejected: ${h(pair.IN.rejectionReason)}</p>` : ''}${pair.OUT?.verification === 'REJECTED' ? `<p class="attendance-rejected">Time Out rejected: ${h(pair.OUT.rejectionReason)}</p>` : ''}</article>`;
}

function employeeAttendanceDayCardSegments(date, punches) {
  const holiday = holidayFor(date, config().holidays);
  const status = holiday && !punches.length ? `Holiday · ${holiday.name}` : statusOfDay(punches);
  const extension = state.employeeData.extensions.find(item => item.workDate === date);
  const hours = dayBreakdown(date, punches, extension);
  const overtime = extension ? hours.totalOvertimeCandidateMinutes : 0;
  const mins = minutesStatusDay(punches, state.session.user, date);
  const verification = punches.some(punch => punch.verification === 'REJECTED') ? 'rejected'
    : isPayrollDayReady(punches) ? 'approved' : 'pending';
  const rows = groupPunches(punches).map((group, index) => `<div class="attendance-time-grid"><div><span>${index + 1} · TIME IN</span><strong>${h(formatTime(group.inPunch?.timeUtc))}</strong><small>${h(punchSource(group.inPunch))}</small>${group.inPunch ? mapLink(group.inPunch, 'View map ↗') : ''}</div><div><span>${index + 1} · TIME OUT</span><strong>${h(formatTime(group.outPunch?.timeUtc))}</strong><small>${h(punchSource(group.outPunch))}</small>${group.outPunch ? mapLink(group.outPunch, 'View map ↗') : ''}</div></div>`).join('');
  return `<article class="attendance-day-card"><div class="attendance-day-head"><div><span class="attendance-day-label">WORKDAY</span><h3>${h(prettyDate(date))}</h3></div><span class="attendance-state ${verification}">${h(status)}</span></div>${rows}<div class="attendance-hour-grid"><div><span>Regular</span><strong>${h(formatMinutes(hours.regularMinutes))}</strong></div><div><span>Undertime</span><strong>${h(formatMinutes(hours.undertimeMinutes))}</strong></div><div><span>Overtime</span><strong>${h(formatMinutes(overtime))}</strong></div><div class="differential"><span>Night differential</span><strong>${h(formatMinutes(hours.nightCandidateMinutes))}</strong></div></div>${mins.late ? `<div class="attendance-alert">Late balance · ${h(formatMinutes(mins.late))}</div>` : ''}${extension ? `<p class="attendance-review">Remaining OT ${h(extension.overtimeDecision.toLowerCase())} · Night differential ${h(hours.nightCandidateMinutes ? extension.nightDecision.toLowerCase() : 'none')}</p>` : ''}${punches.filter(punch => punch.verification === 'REJECTED').map(punch => `<p class="attendance-rejected">Interval ${punch.segment || 1} ${punch.slot === 'IN' ? 'Time In' : 'Time Out'} rejected: ${h(punch.rejectionReason)}</p>`).join('')}</article>`;
}

function renderHistory() {
  const range = state.historyRange || currentRange();
  const grouped = new Map();
  for (const p of state.employeeData.punches) {
    if (!grouped.has(p.workDate)) grouped.set(p.workDate, []);
    grouped.get(p.workDate).push(p);
  }
  for (const holiday of config().holidays) {
    if (holiday.date >= range.start && holiday.date <= range.end && !grouped.has(holiday.date)) grouped.set(holiday.date, []);
  }
  const sorted = [...grouped.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  return `<div class="section-head"><div><p class="eyebrow">MY RECORDS</p><h1 class="section-title">Attendance history</h1><p>Review each workday, recorded locations, regular hours, OT, and Night differential.</p></div></div><div class="card attendance-range-card"><div class="section-head"><div><span class="tiny-label">PAYROLL CUTOFF</span><strong>${h(dateSpan(range))}</strong></div><div><button class="btn small secondary" data-action="cutoff-prev" aria-label="Previous cutoff">‹</button> <button class="btn small secondary" data-action="cutoff-next" aria-label="Next cutoff">›</button></div></div><form id="history-form" class="filters"><div class="field"><label>From</label><input type="date" name="from" value="${h(range.start)}" required></div><div class="field"><label>To</label><input type="date" name="to" value="${h(range.end)}" required></div><button class="btn secondary" type="submit">Show records</button></form></div>${sorted.length ? `<div class="attendance-history-grid">${sorted.map(([date, punches]) => employeeAttendanceDayCardSegments(date, punches)).join('')}</div>` : '<div class="empty attendance-history-empty">No attendance records in this date range.</div>'}`;
}

function renderCapture() {
  const clock = nextEmployeePunch();
  if (clock.blockReason) return '<div class="section-head"><h1 class="section-title">Time clock</h1></div><div class="notice">'+h(clock.blockReason)+'</div><button class="btn secondary" data-nav="home">Back to home</button>';
  const holiday = holidayFor(activeWorkDate(), config().holidays);
  if (holiday) return `<div class="section-head"><div><p class="eyebrow">TIME CLOCK</p><h1 class="section-title">No work today</h1><p>${h(prettyDate(today()))} · ${h(holiday.name)}</p></div></div><div class="notice">This date is marked as a holiday. Ask an administrator to record exceptional work.</div><button class="btn secondary" data-nav="home">Back to home</button>`;
  const c = state.capture || newCapture(clock.nextSlot);
  state.capture = c;
  const site = config(), label = c.slot === 'IN' ? 'Time In' : 'Time Out';
  const accurate = c.location && c.location.accuracyM <= site.maxAccuracyM;
  const ready = captureReady(c);
  const locationLabel = c.location ? (c.method === 'ONSITE' ? 'Onsite' : 'Offsite') : 'Waiting for location';
  return `<div class="section-head"><div><p class="eyebrow">ATTENDANCE</p><h1 class="section-title">${h(label)}</h1><p>${c.selfie ? 'Review your photo and details before recording.' : 'Take a clear photo to continue.'}</p></div></div>
    <section class="card capture-review"><div class="capture-review-grid"><div class="capture-photo-panel"><div class="card-title"><span class="symbol">▣</span> PHOTO PREVIEW</div><div class="camera-box capture-review-photo">${c.selfie ? `<img src="${h(c.selfie)}" alt="${h(label)} photo preview">` : '<div class="camera-placeholder"><div class="symbol">◉</div><p>Your photo will appear here.</p></div>'}</div>
    <button class="btn secondary block" type="button" data-action="capture-photo" ${c.photoProcessing || c.submitting ? 'disabled' : ''}>${c.photoProcessing ? 'Preparing photo…' : c.selfie ? 'Retake photo' : 'Take photo'}</button>${c.photoProcessing ? '<p class="tiny-label" role="status">Preparing your photo…</p>' : ''}</div>
    <div class="capture-details-panel"><div class="card-title"><span class="symbol">◷</span> ${h(label.toUpperCase())} PREVIEW</div><dl class="capture-preview-details"><div><dt>Employee</dt><dd>${h(state.session.user.name)}</dd></div><div><dt>Work date</dt><dd>${h(prettyDate(c.workDate))}</dd></div><div><dt>Work interval</dt><dd>${h(c.segment)}</dd></div><div><dt>Time</dt><dd>${h(formatTime(c.previewAt))}</dd></div><div><dt>Status</dt><dd>${h(locationLabel)}</dd></div></dl><p class="tiny-label">Time is recorded when you tap Proceed.</p>
    <div class="map-card" role="status" aria-live="polite">${c.locationPending ? '<span>Checking your location…</span>' : c.locationError ? `<span>${h(c.locationError)}</span>` : c.location ? `<strong>${c.method === 'ONSITE' ? h(site.siteName) : 'Offsite / field location'}</strong><small>GPS accuracy ±${Math.round(c.location.accuracyM)} m</small>${mapLink(c.location)}` : '<span>Location will be checked after you take a photo.</span>'}</div>
    ${!c.locationPending && (c.locationError || c.location && !accurate) ? `<div class="notice warn">${c.location && !accurate ? 'Move near a window or outdoors for a more accurate location. ' : ''}<button class="link-button" type="button" data-action="location" ${c.submitting ? 'disabled' : ''}>Retry GPS</button></div>` : ''}
    ${c.segment > 1 || c.location && c.method === 'OFFSITE' ? `<div class="field"><label for="capture-note">Task / assignment note (optional)</label><input id="capture-note" maxlength="300" placeholder="Client, location, or task" value="${h(c.note)}" ${c.submitting ? 'disabled' : ''}></div>` : ''}</div></div>
    <div class="capture-review-actions"><button class="btn ghost" type="button" data-action="capture-cancel" ${c.submitting ? 'disabled' : ''}>Cancel</button><button class="btn" type="button" data-action="submit-punch" ${ready ? '' : 'disabled'} aria-busy="${!!c.submitting}">${c.submitting ? 'Recording…' : 'Proceed'}</button></div></section>`;
}

function renderProfile() {
  const user = state.session.user;
  if (user.role !== 'admin') return `<div class="section-head"><div><p class="eyebrow">ACCOUNT</p><h1 class="section-title">Profile & security</h1></div></div>
    <div class="split"><div class="card"><div class="card-title"><span class="symbol">◉</span> MY ACCOUNT</div>
      <div class="profile-identity"><div class="profile-avatar">${avatarMarkup(user)}</div><p><strong>${h(user.name)}</strong><br><span class="muted">${h(user.username || user.email)} · ${h(user.role)}</span></p></div>
      <p class="card-sub">Schedule: ${h(formatClockText(user.scheduleStart))}–${h(formatClockText(user.scheduleEnd))} · Lunch from 12:00–1:00 PM is excluded. Late or early-out time remains undertime.</p>
      <div class="card-actions"><button class="btn secondary" data-action="logout">Sign out</button>${state.installPrompt ? '<button class="btn ghost" data-action="install">Install PWA</button>' : ''}</div></div>
      <div class="card"><div class="card-title"><span class="symbol">◇</span> CHANGE PASSWORD</div><form id="password-form"><div class="field"><label>Current password</label><input name="currentPassword" type="password" autocomplete="current-password" required></div><div class="field"><label>New password (8+ characters)</label><input name="newPassword" type="password" minlength="8" autocomplete="new-password" required></div><button class="btn" type="submit">Update password</button></form></div></div>`;

  const s = config();
  return `<div class="section-head"><div><p class="eyebrow">ACCOUNT</p><h1 class="section-title">Profile & settings</h1><p>Manage your account, company app, work site, and payroll schedule.</p></div></div>
    <div class="profile-card card"><div class="profile-summary"><div class="profile-avatar profile-avatar-large">${avatarMarkup(user)}</div><div class="profile-copy"><span class="pill admin">Administrator</span><h2>${h(user.name)}</h2><p>${h(user.email)}</p></div></div>
      <div class="profile-actions"><button class="btn" data-action="edit-profile"><span aria-hidden="true">✎</span> Edit Profile</button><button class="btn ghost" data-action="logout">Sign out</button></div></div>
    <div class="settings-list settings-extra">
      <div class="settings-row"><div class="settings-icon">${brandIconMarkup()}</div><div class="settings-copy"><strong>App appearance</strong><p>${h(state.branding.appName)} · Update the app name and logo.</p></div><button class="btn secondary small" data-action="update-app">Update App</button></div>
      <div class="settings-row"><div class="settings-icon"><span class="symbol">◎</span></div><div class="settings-copy"><strong>Manage site</strong><p>${s.configured ? `${h(s.siteName)} · ${s.radiusM} m allowed radius` : 'Site GPS location has not been configured.'}</p></div><button class="btn secondary small" data-action="site-settings">Site GPS</button></div>
      <div class="settings-row"><div class="settings-icon"><span class="symbol">▥</span></div><div class="settings-copy"><strong>Payroll cutoff</strong><p>${h(dateSpan(currentRange()))} · Starts every ${s.cutoffDays[0]} and ${s.cutoffDays[1]}</p></div><button class="btn secondary small" data-action="payroll-settings">Set Cutoff</button></div>
      <div class="settings-row"><div class="settings-icon"><span class="symbol">▦</span></div><div class="settings-copy"><strong>Holidays & no-work dates</strong><p>Manage company holidays and exceptional work dates.</p></div><button class="btn secondary small" data-nav="settings">Manage</button></div>
    </div>`;
}

function renderAudit() {
  return `<div class="section-head"><div><p class="eyebrow">ADMIN</p><h1 class="section-title">Audit trail</h1><p>Recent account, punch, review, and correction actions.</p></div></div>${state.auditItems.length ? `<div class="list">${state.auditItems.map(item => `<div class="list-item"><div><strong>${h(item.action.replaceAll('_', ' '))}</strong><p>${h(item.actor_name || 'System')} · ${h(item.target_type)} #${h(item.target_id)}</p><p>${h(new Date(item.created_at).toLocaleString('en-PH', { timeZone }))}</p></div></div>`).join('')}</div>` : '<div class="empty">No audit entries yet.</div>'}`;
}

function renderAdminHome() {
  const rows = state.adminData.punches, employees = state.employees;
  const todayRows = rows.filter(p => p.workDate === today());
  const present = new Set(todayRows.filter(p => p.slot === 'IN').map(p => p.userId)).size;
  const pendingPremium = (state.adminData.extensions || []).filter(extension => premiumReviewState(extension).pending).length;
  const pending = rows.filter(p => p.verification === 'PENDING').length + pendingPremium;
  const incomplete = new Set(todayRows.filter(p => groupPunches(todayRows.filter(q => q.userId === p.userId))
    .some(group => !group.inPunch || !group.outPunch)).map(p => p.userId)).size;
  const recent = recentEmployeeFolders(rows);
  return `<div class="hero"><p class="eyebrow">ADMIN DASHBOARD · ${h(prettyDate(today()))}</p><h1>Attendance overview</h1><p>Review field proofs and resolve missing records before payroll cutoff.</p></div><div class="mini-grid"><div class="stat-card"><div class="num">${employees.filter(e => e.active).length}</div><div class="label">Active employees</div></div><div class="stat-card"><div class="num">${present}</div><div class="label">Timed in today</div></div><div class="stat-card"><div class="num">${pending}</div><div class="label">Pending reviews</div></div><div class="stat-card"><div class="num">${incomplete}</div><div class="label">Incomplete today</div></div></div><div style="height:17px"></div><div class="grid"><div class="card wide"><div class="card-title"><span class="symbol">▥</span> CURRENT CUTOFF</div><strong>${h(dateSpan(currentRange()))}</strong><p class="card-sub">Review exceptions and prepare printable payroll summary.</p><button class="link-button" data-nav="report">Open report ›</button></div></div><div style="height:17px"></div><div class="grid">${renderHolidayCard()}</div><div style="height:23px"></div><div class="section-head"><div><h2 class="section-title">Recent punches</h2><p>Click an employee folder to view the latest proof.</p></div><button class="btn small secondary" data-nav="records">See all</button></div>${recent.length ? `<div class="punch-folders">${recent.map(recentPunchFolder).join('')}</div>` : '<div class="empty">No attendance punches in this cutoff yet.</div>'}`;
}

function renderBrandingForm() {
  return `<form id="branding-form"><div class="field"><label for="app-brand-name">App name</label><input id="app-brand-name" name="appName" minlength="2" maxlength="60" value="${h(state.branding.appName)}" required></div><div class="brand-preview" id="brand-preview">${brandMarkup()}</div><div class="field"><label for="app-brand-logo">New logo</label><input id="app-brand-logo" name="logoFile" type="file" accept="image/png,image/jpeg,image/webp"></div><p class="tiny-label">PNG, JPG, or WebP up to 5 MB. Leave blank to keep the current logo.</p>${state.branding.logo192Url ? '<label class="check-row"><input name="removeLogo" type="checkbox"> Use the default icon instead</label>' : ''}<div class="modal-actions"><button class="btn ghost" type="button" data-action="modal-close">Cancel</button><button class="btn" type="submit">Save App</button></div></form>`;
}

function recentEmployeeFolders(punches, limit = 8) {
  const employees = new Map();
  for (const punch of punches) {
    const current = employees.get(punch.userId);
    if (!current || punch.timeUtc > current.latest.timeUtc) employees.set(punch.userId, { latest: punch });
  }
  return [...employees.values()].sort((a, b) => b.latest.timeUtc.localeCompare(a.latest.timeUtc)).slice(0, limit).map(item => {
    const dayPunches = punches.filter(p => p.userId === item.latest.userId && p.workDate === item.latest.workDate);
    const latestInterval = groupPunches(dayPunches).at(-1);
    return { ...item, inPunch: latestInterval?.inPunch, outPunch: latestInterval?.outPunch };
  });
}
function recentPunchFolder({ latest, inPunch, outPunch }) {
  const status = latest.slot === 'OUT' ? 'TIME OUT' : 'TIME IN';
  return `<button type="button" class="punch-folder" data-action="record-detail" data-id="${latest.id}" aria-label="View latest proof for ${h(latest.employeeName)}"><span class="folder-tab" aria-hidden="true"></span><span class="folder-main"><span class="folder-person"><span class="folder-avatar">${h(latest.employeeName.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase())}</span><span><strong>${h(latest.employeeName)}</strong><small>${h(prettyDate(latest.workDate))} · ${h(punchSource(latest))}</small></span></span><span class="folder-status ${latest.slot === 'OUT' ? 'out' : 'in'}"><small>LATEST</small><strong>${status}</strong><span>${h(formatTime(latest.timeUtc))}</span></span></span><span class="folder-times"><span><small>Time In</small><strong>${h(formatTime(inPunch?.timeUtc))}</strong></span><span><small>Time Out</small><strong>${h(formatTime(outPunch?.timeUtc))}</strong></span><span class="folder-open">Open proof <span aria-hidden="true">›</span></span></span></button>`;
}
function dailyRecordItems(punches) {
  const days = new Map();
  for (const punch of punches) {
    const key = `${punch.userId}|${punch.workDate}`;
    if (!days.has(key)) days.set(key, { employeeName: punch.employeeName, workDate: punch.workDate, punches: [] });
    days.get(key).punches.push(punch);
  }
  return [...days.values()].map(day => {
    const payrollReady = isPayrollDayReady(day.punches);
    const rejected = day.punches.some(p => p.verification === 'REJECTED');
    const complete = groupPunches(day.punches).every(group => group.inPunch && group.outPunch);
    const status = payrollReady ? 'APPROVED FOR PAYROLL' : rejected ? 'NEEDS CORRECTION' : complete ? 'READY FOR REVIEW' : 'INCOMPLETE';
    const id = day.punches[0]?.id;
    return `<button type="button" class="list-item record-item-button" data-action="record-detail" data-id="${h(id)}" aria-label="Review daily attendance for ${h(day.employeeName)} on ${h(prettyDate(day.workDate))}"><div><strong>${h(day.employeeName)}</strong><p>${h(prettyDate(day.workDate))} · ${groupPunches(day.punches).length} interval(s) · In ${h(intervalText(day.punches, day.workDate, 'IN'))} · Out ${h(intervalText(day.punches, day.workDate, 'OUT'))}</p></div><div class="right"><span class="record-action ${payrollReady ? 'out' : 'in'}">${status}</span></div></button>`;
  }).join('');
}
function punchProofRow(p, slot) {
  const label = slot === 'IN' ? 'Time In' : 'Time Out';
  if (!p) return `<section class="proof-row missing-proof"><div class="proof-row-head"><div><span class="proof-step">${slot === 'IN' ? '01' : '02'}</span><h3>${label}</h3></div><span class="pill pending">Not recorded</span></div></section>`;
  const location = p.latitude == null || p.longitude == null
    ? `<div class="proof-location"><strong>No device location</strong><small>${p.method === 'ADMIN' ? 'Attendance created by admin' : 'Automatically generated record'}</small></div>`
    : `<div class="proof-location"><strong>${Number(p.latitude).toFixed(6)}, ${Number(p.longitude).toFixed(6)}</strong><small>Accuracy ±${Math.round(p.accuracyM)} m · ${p.distanceM == null ? 'Field location' : `${Math.round(p.distanceM)} m from site pin`}</small>${mapLink(p)}</div>`;
  const photo = p.hasSelfie
    ? `<div class="proof-photo"><p id="proof-loading-${h(p.id)}">Loading selfie…</p><img class="hidden" id="proof-selfie-${h(p.id)}" alt="${label} selfie proof for ${h(p.employeeName)}"></div>`
    : `<div class="proof-photo proof-photo-empty"><span>No selfie</span></div>`;
  return `<section class="proof-row"><div class="proof-row-head"><div><span class="proof-step">${slot === 'IN' ? '01' : '02'}</span><h3>${label}</h3></div>${badge(p)}</div><div class="proof-body"><div class="proof-data"><div class="proof-time"><span>SERVER PUNCH TIME</span><strong>${h(formatTime(p.timeUtc))}</strong><small>${h(punchSource(p))}</small></div>${location}${p.note ? `<div class="proof-note"><span>NOTE</span><p>${h(p.note)}</p></div>` : ''}${p.reason ? `<div class="proof-note"><span>REASON</span><p>${h(p.reason)}</p></div>` : ''}${p.fieldAssignment ? `<div class="proof-note"><span>FIELD ASSIGNMENT</span><p>${h(p.fieldAssignment)}</p></div>` : ''}${p.verification === 'REJECTED' ? `<div class="notice error">Rejected: ${h(p.rejectionReason)}</div>` : ''}${['ONSITE', 'OFFSITE'].includes(p.method) && p.verification !== 'APPROVED' ? `<div class="card-actions"><button class="btn small danger" data-action="verify-reject" data-id="${p.id}">Reject ${label}</button></div>` : ''}</div>${photo}</div></section>`;
}
function intervalReviewMarkup(group) {
  const pair = [group.inPunch, group.outPunch].filter(Boolean);
  if (pair.length !== 2) return '<p class="notice warn">Waiting for Time Out before this interval can be reviewed.</p>';
  const approved = pair.every(punch => punch.verification === 'APPROVED');
  const declined = pair.some(punch => punch.verification === 'REJECTED');
  return `<div class="interval-review-actions"><p class="card-sub">${declined ? 'Declined interval · excluded from working hours and payroll.' : approved ? 'Interval approved. Calculated OT and night differential still require premium approval.' : 'Review this interval’s photos and GPS, then approve or decline both punches together.'}</p><div class="card-actions"><button class="btn small" data-action="interval-review" data-segment="${group.number}" data-decision="APPROVED" ${approved ? 'disabled' : ''}>Approve interval ${group.number}</button><button class="btn small danger" data-action="interval-review" data-segment="${group.number}" data-decision="REJECTED" ${declined ? 'disabled' : ''}>Decline interval ${group.number}</button></div></div>`;
}
function premiumReviewState(extension) {
  const punches = eligibleAttendancePunches(state.adminData.punches.filter(p => p.userId === extension.userId && p.workDate === extension.workDate));
  const complete = groupPunches(punches).length > 0 && groupPunches(punches).every(group => group.inPunch && group.outPunch);
  const employee = state.employees.find(item => item.id === extension.userId);
  const hours = dayBreakdown(extension.workDate, punches, extension, employee);
  const adjustmentPending = hours.proposedTransferMinutes > 0 && extension.adjustmentDecision === 'PENDING';
  const overtimePending = hours.remainingOvertimeMinutes > 0 && extension.overtimeDecision === 'PENDING';
  const nightPending = hours.nightCandidateMinutes > 0 && extension.nightDecision === 'PENDING';
  return { extension, punches, complete, employee, hours,
    proofReady: isPayrollDayReady(punches), adjustmentPending, overtimePending, nightPending,
    nightReady: true,
    pending: adjustmentPending || overtimePending || nightPending };
}
function renderPremiumQueue() {
  const reviews = (state.adminData.extensions || []).map(premiumReviewState).filter(review => review.pending);
  return `<section class="card premium-queue"><div class="card-title"><span class="symbol">◷</span> OVERTIME & NIGHT DIFFERENTIAL REVIEW</div><p class="card-sub">Only employees with an unfinished approval appear here. Completed approval stages disappear automatically.</p>${reviews.length ? `<div class="list">${reviews.map(({ extension, punches, complete, employee, hours, proofReady, adjustmentPending, overtimePending, nightPending, nightReady }) => {
    const source = extension.source === 'ADMIN' ? 'Admin-entered attendance' : extension.source === 'AUTO' ? 'Auto-applied from Time Out' : 'Legacy offsite continuation';
    const schedule = groupPunches(punches).find(group => group.inPunch)?.inPunch || employee;
    const notes = attendanceDetails([{ date: extension.workDate, punches }]).map(item =>
      `<p class="card-sub"><strong>${h(formatTime(item.inUtc))} – ${h(formatTime(item.outUtc))}</strong><br>Reason: ${h(item.reason || '—')}<br>Field Assignment: ${h(item.fieldAssignment || '—')}</p>`).join('');
    const intervalHours = intervalHoursForPunches(extension.workDate, punches).map((hours,index) =>
      `<div><strong>Interval ${hours.number}</strong>${intervalHoursMarkup(hours)}</div>`).join('');
    const adjustmentApproved = extension.adjustmentDecision === 'APPROVED';
    const displayedRegular = hours.regularMinutes + (adjustmentApproved ? hours.proposedTransferMinutes : 0);
    const displayedShortage = Math.max(0, hours.shortageMinutes - (adjustmentApproved ? hours.proposedTransferMinutes : 0));
    return `<div class="list-item premium-item"><div><strong>${h(extension.employeeName)} · ${h(prettyDate(extension.workDate))}</strong><p>${h(source)} · Schedule ${h(formatClockText(schedule?.scheduleStart || '08:00'))}–${h(formatClockText(schedule?.scheduleEnd || '17:00'))}</p>${notes}${intervalHours}<div class="attendance-hour-grid"><div><span>Regular time</span><strong>${h(formatMinutes(displayedRegular))}</strong></div><div><span>Remaining shortage</span><strong>${h(formatMinutes(displayedShortage))}</strong></div><div><span>Night differential</span><strong>${h(formatMinutes(hours.nightCandidateMinutes))}</strong></div><div><span>Overtime</span><strong>${h(formatMinutes(hours.totalOvertimeCandidateMinutes))}</strong></div></div><p>OT total = remaining OT ${h(formatMinutes(hours.remainingOvertimeMinutes))} + ND ${h(formatMinutes(hours.nightCandidateMinutes))}. ND never reduces undertime.</p><p>Remaining OT ${h(hours.remainingOvertimeMinutes ? extension.overtimeDecision.toLowerCase() : 'none')} · Night differential ${h(formatMinutes(hours.nightCandidateMinutes))} ${h(hours.nightCandidateMinutes ? extension.nightDecision.toLowerCase() : '')}</p>${complete && !proofReady ? '<p class="tiny-label">Approve the daily attendance before reviewing calculated hours.</p>' : ''}${nightPending && !nightReady ? '<p class="tiny-label">Finish the remaining OT decision to unlock Night differential.</p>' : ''}</div><div class="premium-actions">${complete && adjustmentPending ? `<button class="btn small secondary" data-action="premium-review" data-id="${extension.id}" data-stage="ADJUSTMENT" data-decision="APPROVED" ${proofReady ? '' : 'disabled'}>Approve regular adjustment</button><button class="btn small danger" data-action="premium-review" data-id="${extension.id}" data-stage="ADJUSTMENT" data-decision="REJECTED" ${proofReady ? '' : 'disabled'}>Reject adjustment</button>` : ''}${complete && overtimePending ? `<button class="btn small secondary" data-action="premium-review" data-id="${extension.id}" data-stage="OVERTIME" data-decision="APPROVED" ${proofReady ? '' : 'disabled'}>Approve remaining OT</button><button class="btn small danger" data-action="premium-review" data-id="${extension.id}" data-stage="OVERTIME" data-decision="REJECTED" ${proofReady ? '' : 'disabled'}>Reject remaining OT</button>` : ''}${complete && nightPending && nightReady ? `<button class="btn small secondary" data-action="premium-review" data-id="${extension.id}" data-stage="NIGHT" data-decision="APPROVED" ${proofReady ? '' : 'disabled'}>Approve Night differential</button><button class="btn small danger" data-action="premium-review" data-id="${extension.id}" data-stage="NIGHT" data-decision="REJECTED" ${proofReady ? '' : 'disabled'}>Reject Night differential</button>` : ''}</div></div>`;
  }).join('')}</div>` : '<div class="empty"><strong>Approval completed</strong><p>No employees need overtime or differential approval in this date range.</p></div>'}</section>`;
}
function renderRecords() {
  const range = state.adminRange || currentRange();
  return `<div class="section-head"><div><p class="eyebrow">ADMIN · ${h(dateSpan(range))}</p><h1 class="section-title">Attendance records</h1><p>Open one employee workday, review both punches, then approve it for payroll.</p></div><button class="icon-btn" type="button" data-action="records-filter" aria-label="Filter attendance by date range" title="Filter by date range"><span aria-hidden="true">☷</span></button></div>${renderPremiumQueue()}<div class="section-head settings-extra"><h2 class="section-title">Daily employee attendance</h2></div>${state.adminData.punches.length ? `<div class="list">${dailyRecordItems(state.adminData.punches)}</div>` : '<div class="empty">No attendance records for this date range.</div>'}`;
}
function renderEmployeeForm(employee = null, draft = null) {
  const editing = !!employee?.id;
  const e = draft || employee;
  const days = e?.workdays || [1, 2, 3, 4, 5, 6];
  const custom = e?.scheduleType ? e.scheduleType === 'CUSTOM' : !!e && (e.scheduleStart !== '08:00' || e.scheduleEnd !== '17:00');
  return `<form id="employee-form"><input type="hidden" name="id" value="${h(employee?.id || '')}">
      <div class="field"><label>Name</label><input name="name" value="${h(e?.name || '')}" required maxlength="120"></div>
      <div class="field"><label for="employee-username">Username / login</label><input id="employee-username" name="username" type="text" autocapitalize="none" spellcheck="false" autocomplete="off" pattern="[A-Za-z][A-Za-z0-9._\\-]{2,31}" minlength="3" maxlength="32" placeholder="e.g. juan.delacruz" value="${h(e?.username || '')}" required><p class="tiny-label">3–32 characters. Start with a letter; use letters, numbers, dots, underscores, or hyphens. Usernames are not case-sensitive.</p></div>
      <div class="field"><label>${editing ? 'New password (leave blank to keep)' : 'Temporary password (8+ characters)'}</label><input name="password" type="password" minlength="8" ${editing ? '' : 'required'} value="${h(draft?.password || '')}" autocomplete="new-password"></div>
      <div class="field"><label>Working Hours</label><select id="working-hours-type" name="scheduleType"><option value="STANDARD" ${custom ? '' : 'selected'}>Standard · 8:00 AM–5:00 PM</option><option value="CUSTOM" ${custom ? 'selected' : ''}>Custom schedule</option></select></div>
      <div id="custom-working-hours" class="field-row ${custom ? '' : 'hidden'}"><div class="field"><label>Scheduled start</label><input name="scheduleStart" type="time" value="${h(e?.scheduleStart || '08:00')}"></div><div class="field"><label>Scheduled end</label><input name="scheduleEnd" type="time" value="${h(e?.scheduleEnd || '17:00')}"></div></div>
      ${editing ? `<div class="field"><label>Apply schedule from</label><input name="scheduleEffectiveDate" type="date" max="${today()}" value="${h(e?.scheduleEffectiveDate || today())}" required><p class="tiny-label">Updates this date and all later recorded attendance.</p></div>` : ''}
      <div class="field"><label>Workdays</label><div class="day-picker">${[['Sun',0],['Mon',1],['Tue',2],['Wed',3],['Thu',4],['Fri',5],['Sat',6]].map(([name,n]) => `<label><input type="checkbox" name="day" value="${n}" ${days.includes(n) ? 'checked' : ''}> ${name}</label>`).join('')}</div></div>
      ${editing ? `<label class="check-row"><input name="active" type="checkbox" ${e.active ? 'checked' : ''}> Active account</label>` : ''}
      <div class="modal-actions"><button class="btn ghost" type="button" data-action="modal-close">Close</button><button class="btn" type="submit">${editing ? 'Save employee' : 'Create account'}</button></div>
    </form>`;
}
function renderEmployees() {
  return `<div class="section-head"><div><p class="eyebrow">ADMIN</p><h1 class="section-title">Employees</h1><p>View employees or choose New to create an account.</p></div><button class="btn small secondary" type="button" data-action="employee-new" aria-haspopup="dialog">New</button></div>
    <div class="card"><div class="card-title"><span class="symbol">▤</span> EMPLOYEE LIST</div><div class="list">${state.employees.length ? state.employees.map(item => `<div class="list-item"><div><strong>${h(item.name)}</strong><p>${h(item.username || 'Username not set')} · ${h(formatClockText(item.scheduleStart))}–${h(formatClockText(item.scheduleEnd))} ${item.active ? '' : '· Disabled'}</p></div><div class="employee-actions"><button class="btn small secondary" data-action="employee-edit" data-id="${item.id}">Edit</button><button class="btn small danger" data-action="employee-delete" data-id="${item.id}">Delete</button></div></div>`).join('') : '<div class="empty">No employees yet.</div>'}</div></div>`;
}
function renderSettings() {
  const s = config();
  const holidays = [...(s.customHolidays || [])].sort((a, b) => a.date.localeCompare(b.date));
  return `<div class="section-head"><div><p class="eyebrow">ADMIN SETTINGS</p><h1 class="section-title">Holiday calendar</h1><p>Manage company no-work dates and review the Philippine holiday calendar.</p></div><button class="btn small secondary no-print" data-nav="profile" aria-label="Close holiday settings">× Close</button></div>
    <div class="grid settings-extra"><div class="card wide"><div class="card-title"><span class="symbol">▦</span> COMPANY HOLIDAYS · NO WORK</div><p class="card-sub">Add site or company no-work dates. Nationwide Philippine non-working holidays are already included in the schedule. Employees cannot punch on a no-work day; admins can record exceptional work.</p>
      <form id="holiday-form"><div class="field-row"><div class="field"><label>Holiday date</label><input name="date" type="date" required></div><div class="field"><label>Holiday name</label><input name="name" maxlength="80" minlength="2" placeholder="e.g. Christmas Day" required></div></div><button class="btn" type="submit">Add holiday</button></form>
      <div class="divider"></div>${holidays.length ? `<div class="list">${holidays.map(holiday => `<div class="list-item"><div><strong>${h(prettyDate(holiday.date))}</strong><p>${h(holiday.name)}</p></div><button class="btn small danger" data-action="holiday-remove" data-date="${h(holiday.date)}" aria-label="Remove ${h(holiday.name)}">Remove</button></div>`).join('')}</div>` : '<div class="empty">No company holidays added yet.</div>'}</div>
      </div><div class="grid settings-extra">${renderHolidayCard(8)}</div>`;
}
function renderBackfill() {
  const draft = state.backfillDraft || blankBackfillDraft();
  const intervalHours = draftIntervalHours(draft);
  const segments = resolvedDraftIntervals(draft).map((segment, index) => {
    const saved = groupPunches(draft.punches)[index];
    return `<section class="manual-interval" data-index="${index}">
    <div class="manual-interval-head"><strong>${index === 0 ? 'First work interval' : `Return to work · interval ${index + 1}`}</strong>${index > 0 && !segment.inId && !segment.outId ? `<button class="link-button" type="button" data-action="remove-manual-interval" data-index="${index}">Remove</button>` : ''}</div>
    <div class="field-row"><div class="field"><label>Time In</label><input name="timeIn" type="time" value="${h(segment.timeIn)}" required></div><div class="field"><label>Time Out ${index === 0 ? '(optional until shift ends)' : ''}</label><input name="timeOut" type="time" value="${h(segment.timeOut)}" ${index > 0 ? 'required' : ''}></div></div>
    <div data-interval-dates="${index}" aria-live="polite">${intervalDatesMarkup(segment, draft.workDate)}</div>
    <div class="manual-options"><label class="check-row"><input name="offsite" type="checkbox" ${segment.offsite ? 'checked' : ''}> Offsite / field work</label></div>
    <div class="field"><label>Reason (optional)</label><textarea name="intervalReason" maxlength="300" placeholder="Add a reason for this interval (optional)">${h(segment.reason || '')}</textarea></div><div class="field"><label>Field Assignment</label><textarea name="fieldAssignment" maxlength="300" placeholder="Client, location, or task for this interval (optional)">${h(segment.fieldAssignment || '')}</textarea></div>
    <div data-interval-hours="${index}" aria-live="polite">${intervalHoursMarkup(intervalHours[index])}</div>
    ${saved ? `<div class="manual-saved-proof">${[saved.inPunch, saved.outPunch].filter(Boolean).map(punch => `<span>${punch.slot === 'IN' ? 'In' : 'Out'}: ${h(punchSource(punch))} · ${h(punch.verification.toLowerCase())}${punch.hasSelfie ? ' · selfie' : ''}${mapLink(punch, 'Map ↗')}</span>`).join('')}</div><p class="tiny-label">Unchanged times keep the original selfie, GPS, and approval. Edited times become audited admin corrections.</p>` : ''}</section>`;
  }).join('');
  return `<div class="section-head"><div><p class="eyebrow">ADMIN</p><h1 class="section-title">Add attendance</h1><p>Select an employee and work date to load existing punches, edit the times, or add a return-to-work interval.</p></div></div><div class="split"><div class="card"><div class="card-title"><span class="symbol">＋</span> ADMIN ATTENDANCE EDITOR</div><form id="backfill-form"><div class="field"><label>Employee</label><select name="employeeId" required><option value="">Select employee</option>${state.employees.map(e => `<option value="${e.id}" ${e.id === draft.employeeId ? 'selected' : ''}>${h(e.name)}</option>`).join('')}</select></div><div class="field"><label>Work date</label><input name="workDate" type="date" value="${h(draft.workDate)}" required></div>${state.backfillLoading ? '<div class="notice">Loading saved punches…</div>' : draft.employeeId ? `<div class="notice ${draft.expectedIds.length ? 'success' : ''}">${draft.expectedIds.length ? `${draft.expectedIds.length} existing punch${draft.expectedIds.length === 1 ? '' : 'es'} loaded for this day. Edit only the time that needs correction.` : 'No punches saved for this day yet.'}</div>` : '<p class="tiny-label">Choose an employee to check this day’s current attendance.</p>'}<div class="manual-interval-list">${segments}</div><section class="manual-day-summary" data-day-hours aria-live="polite">${draftDayHoursMarkup(draft)}</section><button class="btn secondary small" type="button" data-action="add-manual-interval" ${state.backfillLoading ? 'disabled' : ''}>＋ Add another Time In / Time Out</button><p class="tiny-label">New or edited punches are marked Created by admin. Existing punches with unchanged times keep their proof. Extra hours still require admin review.</p><button class="btn block" type="submit" ${state.backfillLoading ? 'disabled' : ''}>Review attendance changes</button>${!state.backfillLoading && draft.expectedIds.length ? '<button class="btn danger small" type="button" data-action="reset-backfill-day">Reset selected attendance</button>' : ''}</form></div><div class="card"><div class="card-title"><span class="symbol">ⓘ</span> HOW HOURS ARE COUNTED</div><p class="card-sub">Employees may clock in from 6:00 AM to 5:00 PM. The first 8 actual working hours before 10:00 PM are regular time. Later daytime intervals fill any regular shortage first, then earn OT. Night intervals retain their ND hours and are added to the OT total after daytime allocation. The 12:00–1:00 PM lunch and gaps between intervals are unpaid. Working fewer than 8 hours creates undertime.</p><p class="card-sub">Work beyond 8 actual working hours is pending OT until 10:00 PM, including before 5:00 PM. Night differential is fixed at 10:00 PM–6:00 AM and needs separate admin approval. ND never fills regular shortage. OT total equals remaining daytime OT plus ND, with each component requiring approval. Gaps between work intervals never earn hours.</p><button class="link-button" data-nav="records">Review extra hours ›</button></div></div>`;
}
function reportRows() {
  const range = state.reportRange || currentRange();
  const punches = state.adminData.punches;
  const otMap = new Map(state.adminData.overtime.map(o => [`${o.user_id}|${o.work_date}`, o.minutes]));
  const extensionMap = new Map((state.adminData.extensions || []).map(item => [`${item.userId}|${item.workDate}`, item]));
  return state.employees.map(employee => {
    const rows = [];
    const totals = { noRecord: 0, holidays: 0, undertime: 0,
      regular: 0, overtime: 0, night: 0, pendingOvertime: 0, pendingNight: 0, pending: 0 };
    for (let date = range.start; date <= range.end; date = tomorrow(date)) {
      const pair = punches.filter(p => p.userId === employee.id && p.workDate === date);
      const segments = groupPunches(pair);
      const inPunch = segments[0]?.inPunch, outPunch = segments.at(-1)?.outPunch;
      const complete = segments.length && segments.every(group => group.inPunch && group.outPunch);
      const extension = extensionMap.get(`${employee.id}|${date}`);
      const holiday = holidayFor(date, config().holidays);
      const scheduled = isScheduledWorkday(date, employee.workdays, config().holidays);
      if (!scheduled && !holiday && !pair.length && !extension && !otMap.has(`${employee.id}|${date}`)) continue;
      let status = statusOfDay(pair);
      if (holiday) status = pair.length ? `${status} (holiday: ${holiday.name})` : `Holiday · ${holiday.name}`;
      else if (status === 'No record' && date > today()) status = 'Upcoming';
      else if (status === 'No record' && date === today()) status = 'Today · not recorded';
      else if (!scheduled) status = `${status} (off day)`;
      const hours = dayBreakdown(date, pair, extension, employee);

      const approved = payrollDayTotals(date, pair, extension);
      const overtime = approved.overtime, night = approved.night;
      const currentCalculation = extension?.calculationKey === premiumCalculationKey(date, pair);
      const pendingDaytimeOvertime = !currentCalculation || extension?.overtimeDecision === 'PENDING'
        ? hours.overtimeCandidateMinutes : 0;
      const pendingNight = !currentCalculation || extension?.nightDecision === 'PENDING'
        ? hours.nightCandidateMinutes : 0;
      const pendingOvertime = pendingDaytimeOvertime + pendingNight;
      const overtimeStatus = !extension ? 'No request' : !complete
        ? 'In progress' : hours.remainingOvertimeMinutes ? extension.overtimeDecision : 'No remaining OT';
      const adjustmentStatus = hours.proposedTransferMinutes ? (extension?.adjustmentDecision || 'PENDING') : '—';
      const nightStatus = hours.nightCandidateMinutes ? (extension?.nightDecision || 'Needs review record') : '—';
      if (status === 'No record' && scheduled) totals.noRecord++;
      if (holiday) totals.holidays++;
      if (status.startsWith('Pending verification') || status.startsWith('Needs correction') ||
          adjustmentStatus === 'PENDING' || overtimeStatus === 'PENDING' || nightStatus === 'PENDING' || pendingOvertime || pendingNight) totals.pending++;
      const undertime = approved.undertime;
      const regular = approved.regular;
      totals.undertime += scheduled ? undertime : 0;
      totals.regular += regular; totals.overtime += overtime; totals.night += night;
      totals.pendingOvertime += pendingOvertime; totals.pendingNight += pendingNight;
      rows.push({ date, inPunch, outPunch, punches: pair, undertime: scheduled ? undertime : 0,
        regular, overtime, night, pendingOvertime, pendingNight });
    }
    return { employee, rows, totals };
  });
}
function renderReportHeader(range, generated, className = '') {
  return `<div class="${className}"><div class="report-head"><div class="report-brand"><img src="${h(state.branding.logo512Url || '/aoda-report-logo.jpg')}" alt="Philippine AODA Power Corp. logo"><div class="report-company"><h2>PHILIPPINE AODA POWER CORP.</h2><p>PCCCII BLDG., MOONSTONE AVE., GRAND CENTENNIAL HOMES,<br>KAWIT 4104, CAVITE, PHILIPPINES</p></div></div></div>
    <div class="report-meta"><div><strong>EMPLOYEE ATTENDANCE SUMMARY</strong><p>${h(state.branding.appName)} · Cutoff: ${h(reportDate(range.start))} – ${h(reportDate(range.end))} · Asia/Manila</p></div><small>Generated: ${h(generated)}</small></div></div>`;
}
function renderReportEmployee({ employee, rows, totals }, range, generated, visible = false) {
  const details = attendanceDetails(rows);
  const detailTable = details.length ? `<h3 class="report-details-title">Reasons and Field Assignments</h3>
    <div class="table-wrap report-details-wrap"><table class="table report-details"><thead><tr><th>Day</th><th>Date</th><th>Time In</th><th>Time Out</th><th>Status</th><th>Reason</th><th>Field Assignment</th></tr></thead><tbody>${details.map(item => `<tr>
      <td data-label="Day">${h(reportDay(item.date))}</td><td data-label="Date">${h(reportDate(item.date))}</td><td data-label="Time In">${h(formatTime(item.inUtc))}</td>
      <td data-label="Time Out">${h(formatTime(item.outUtc))}</td><td data-label="Status">${h(reportStatus(item.punches))}</td><td data-label="Reason">${h(item.reason || '—')}</td>
      <td data-label="Field Assignment">${h(item.fieldAssignment || '—')}</td></tr>`).join('')}</tbody></table></div>` : '';
  const body = rows.map(row => `<tr><td data-label="Day">${h(reportDay(row.date))}</td><td data-label="Date">${h(reportDate(row.date))}</td>
    <td data-label="Time In">${groupPunches(row.punches).map((group, index) => `<div>${index + 1}. ${h(formatTime(group.inPunch?.timeUtc))}</div>`).join('') || '—'}</td>
    <td data-label="Time Out">${groupPunches(row.punches).map((group, index) => `<div>${index + 1}. ${h(formatTime(group.outPunch?.timeUtc))}</div>`).join('') || '—'}</td>
    <td data-label="Source">${h(reportSource(row.punches))}</td><td data-label="Status">${h(reportStatus(row.punches))}</td>
    <td data-label="Regular">${h(formatMinutes(row.regular))}</td><td data-label="Undertime">${h(formatMinutes(row.undertime))}</td>
    <td data-label="Overtime">${h(formatMinutes(row.overtime))}${row.pendingOvertime ? `<small class="report-pending">Pending OT: ${h(formatMinutes(row.pendingOvertime))}</small>` : ''}</td><td data-label="Night differential">${h(formatMinutes(row.night))}${row.pendingNight ? `<small class="report-pending">Pending ND: ${h(formatMinutes(row.pendingNight))}</small>` : ''}</td></tr>`).join('');
  return `<section class="report-employee ${visible ? '' : 'report-unselected'}">${renderReportHeader(range, generated, 'employee-report-header')}<div class="report-employee-head"><div><span>EMPLOYEE</span><h3>${h(employee.name)}</h3></div><div class="report-total"><span>Approved regular</span><strong>${h(formatMinutes(totals.regular))}</strong></div></div>
    <div class="report-summary-grid"><div><span>Approved Overtime</span><strong>${h(formatMinutes(totals.overtime))}</strong>${totals.pendingOvertime ? `<small class="report-pending">Pending OT: ${h(formatMinutes(totals.pendingOvertime))}</small>` : ''}</div><div><span>Approved night differential</span><strong>${h(formatMinutes(totals.night))}</strong>${totals.pendingNight ? `<small class="report-pending">Pending ND: ${h(formatMinutes(totals.pendingNight))}</small>` : ''}</div><div><span>Undertime</span><strong>${h(formatMinutes(totals.undertime))}</strong></div><div><span>Exceptions</span><strong>${totals.pending}</strong></div><div><span>No record</span><strong>${totals.noRecord}</strong></div><div><span>Holidays</span><strong>${totals.holidays}</strong></div></div>
    <div class="table-wrap"><table class="table report-attendance"><thead><tr><th>Day</th><th>Date</th><th>Time In</th><th>Time Out</th><th>Source</th><th>Status</th><th>Regular</th><th>Undertime</th><th>Overtime</th><th>Night differential</th></tr></thead><tbody>${body}</tbody></table></div>${detailTable}</section>`;
}
function renderReport() {
  const range = state.reportRange || currentRange();
  const report = reportRows().sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  const selected = report.some(item => item.employee.id === state.reportEmployeeId);
  const generated = new Date().toLocaleString('en-PH', { timeZone });
  return `<div class="section-head no-print"><div><p class="eyebrow">PAYROLL</p><h1 class="section-title">Cutoff report</h1><p>Only daily attendance approved by the admin is included in payroll totals.</p></div><button class="icon-btn print-button" type="button" data-action="print" aria-label="Print or save PDF" title="Print / Save PDF"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3h10v6M7 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2 2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/><path d="M17.5 12h.01"/></svg></button></div>
    <div id="report-filter" class="filters no-print"><div class="field"><label for="report-period">Payroll filter</label><select id="report-period" name="period"><option value="current" ${state.reportRange ? '' : 'selected'}>Current payroll · ${h(dateSpan(currentRange()))}</option><option value="custom" ${state.reportRange ? 'selected' : ''}>Custom dates</option></select></div>${state.reportRange ? `<div class="field"><label for="report-from">From</label><input id="report-from" type="date" name="from" value="${h(range.start)}" required></div><div class="field"><label for="report-to">To</label><input id="report-to" type="date" name="to" value="${h(range.end)}" required></div>` : ''}</div>
    <div class="report-employee-list no-print" aria-label="Employee reports">${report.length ? report.map(item => `<button type="button" class="report-employee-choice ${item.employee.id === state.reportEmployeeId ? 'active' : ''}" data-action="open-report-employee" data-id="${h(item.employee.id)}" aria-expanded="${item.employee.id === state.reportEmployeeId}"><span>${h(item.employee.name)}</span><span aria-hidden="true">${item.employee.id === state.reportEmployeeId ? '⌃' : '›'}</span></button>`).join('') : '<p class="empty">No employees found for this report.</p>'}</div>
    <div class="report-sheet ${selected ? '' : 'report-sheet-collapsed'}">${renderReportHeader(range, generated, 'report-cover-header')}
    ${report.length ? report.map(item => renderReportEmployee(item, range, generated, item.employee.id === state.reportEmployeeId)).join('') : '<p class="empty">No employees found for this report.</p>'}</div>`;
}
function haversine(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function geoAttempt(options) {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyM: position.coords.accuracy }),
    reject,
    options
  ));
}
function geoError(error) {
  if (error?.code === 1) return new Error('Location access is blocked. Open this site’s browser permissions, allow Location, then tap Try again.');
  if (error?.code === 3) return new Error('Location request timed out. Turn on device Location/GPS, move near a window or outdoors, then try again.');
  return new Error('Your device could not determine its location. Turn on Location/GPS and Wi-Fi, then try again.');
}
async function geo() {
  if (!window.isSecureContext) throw new Error('Location requires a secure HTTPS connection.');
  if (!navigator.geolocation) throw new Error('This browser does not provide device location. Enter the latitude and longitude manually.');
  const policy = document.permissionsPolicy || document.featurePolicy;
  if (policy?.allowsFeature && !policy.allowsFeature('geolocation')) throw new Error('Location is blocked in this browser window. Open the site directly in Chrome, Edge, or Safari, or enter the coordinates manually.');
  try {
    const permission = await navigator.permissions?.query?.({ name: 'geolocation' });
    if (permission?.state === 'denied') throw Object.assign(new Error(), { code: 1 });
  } catch (error) {
    if (error?.code === 1) throw geoError(error);
    // Some browsers do not support querying geolocation permission; the location request still can.
  }
  try {
    return await geoAttempt({ enableHighAccuracy: true, maximumAge: 0, timeout: 22000 });
  } catch (firstError) {
    if (firstError?.code === 1) throw geoError(firstError);
    try {
      return await geoAttempt({ enableHighAccuracy: false, maximumAge: 300000, timeout: 14000 });
    } catch (fallbackError) {
      throw geoError(fallbackError);
    }
  }
}
async function refreshOnsiteAccess(renderAfter = true) {
  const site = config();
  if (!site?.configured) {
    state.onsiteAccess = { status: 'unconfigured', message: 'Admin must set the site GPS first.' };
  } else {
    state.onsiteAccess = { status: 'checking', message: 'Checking your GPS location…' };
    if (renderAfter && state.section === 'home') renderView();
    try {
      const location = await geo();
      const distanceM = Math.round(haversine(location.latitude, location.longitude, site.siteLat, site.siteLng));
      const allowed = distanceM <= site.radiusM && location.accuracyM <= site.maxAccuracyM;
      state.onsiteAccess = { status: allowed ? 'inside' : 'outside', allowed, location, distanceM,
        message: allowed ? `Inside ${site.siteName} · ${distanceM} m from site pin` : `Outside ${site.siteName} · ${distanceM} m from site pin` };
    } catch (error) {
      state.onsiteAccess = { status: 'error', allowed: false, message: error.message };
    }
  }
  if (renderAfter && state.section === 'home') renderView();
  return state.onsiteAccess;
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
  if (modal.kind === 'employee-editor') {
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="employee-editor-title"><div class="modal-head"><div><p class="modal-kicker">EMPLOYEES</p><h2 id="employee-editor-title">${modal.employee ? 'Edit employee' : 'Create employee'}</h2></div><button class="close" type="button" data-action="modal-close" aria-label="Close employee form">×</button></div>${renderEmployeeForm(modal.employee, modal.draft)}</div></div>`;
  } else if (modal.kind === 'edit-profile') {
    const user = state.session.user;
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="edit-profile-title"><div class="modal-head"><div><p class="modal-kicker">ADMIN ACCOUNT</p><h2 id="edit-profile-title">Edit Profile</h2></div><button class="close" data-action="modal-close" aria-label="Close Edit Profile">×</button></div><div class="modal-profile"><div class="profile-avatar profile-avatar-preview" id="profile-photo-preview">${avatarMarkup(user)}</div><div><strong>${h(user.name)}</strong><p>${h(user.email)}</p></div></div><section class="modal-section"><h3>Profile photo</h3><p>Choose a clear photo for your account and header.</p><form id="profile-photo-form"><div class="field"><label for="profile-photo">Upload image</label><input id="profile-photo" type="file" accept="image/png,image/jpeg,image/webp"></div>${user.profileImageUrl ? '<label class="check-row"><input type="checkbox" name="removePhoto"> Remove current picture</label>' : ''}<div class="modal-actions"><button class="btn ghost" type="button" data-action="modal-close">Cancel</button><button class="btn" type="submit">Save Profile</button></div></form></section><section class="modal-section"><h3>Security</h3><p>Change your password without leaving this window.</p><form id="password-form"><div class="field-row"><div class="field"><label for="current-password">Current password</label><input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required></div><div class="field"><label for="new-password">New password</label><input id="new-password" name="newPassword" type="password" minlength="8" autocomplete="new-password" required></div></div><button class="btn secondary block" type="submit">Save New Password</button></form></section></div></div>`;
  } else if (modal.kind === 'update-app') {
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="update-app-title"><div class="modal-head"><div><p class="modal-kicker">APP SETTINGS</p><h2 id="update-app-title">Update App</h2></div><button class="close" data-action="modal-close" aria-label="Close Update App">×</button></div><p>Change the name and logo shown in the header, login screen, browser title, and installed app.</p>${renderBrandingForm()}</div></div>`;
  } else if (modal.kind === 'site-settings') {
    const s = config();
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="site-settings-title"><div class="modal-head"><div><p class="modal-kicker">SITE SETTINGS</p><h2 id="site-settings-title">Set Site GPS</h2></div><button class="close" data-action="modal-close" aria-label="Close Site GPS settings">×</button></div><p>Set the location employees must be near for an onsite punch.</p><form id="site-settings-form"><div class="field"><label for="site-name">Site name</label><input id="site-name" name="siteName" value="${h(s.siteName)}" required></div><div class="field-row"><div class="field"><label for="site-latitude">Latitude</label><input id="site-latitude" name="siteLat" type="number" step="any" min="-90" max="90" value="${s.siteLat ?? ''}" required></div><div class="field"><label for="site-longitude">Longitude</label><input id="site-longitude" name="siteLng" type="number" step="any" min="-180" max="180" value="${s.siteLng ?? ''}" required></div></div><button type="button" class="btn small secondary site-location-button" data-action="site-my-location"><span aria-hidden="true">◎</span> Use my current location</button><div id="site-location-status" class="site-location-status" role="status" aria-live="polite"><span aria-hidden="true">ⓘ</span><p>While physically at the site, allow Location when your browser asks. You can also enter both coordinates manually.</p></div><div class="field-row"><div class="field"><label for="site-radius">Allowed radius (m)</label><input id="site-radius" name="radiusM" type="number" min="25" max="2000" value="${s.radiusM}" required></div><div class="field"><label for="site-accuracy">Max GPS error (m)</label><input id="site-accuracy" name="maxAccuracyM" type="number" min="10" max="500" value="${s.maxAccuracyM}" required></div></div><div class="modal-actions"><button class="btn ghost" type="button" data-action="modal-close">Cancel</button><button class="btn" type="submit">Save Site GPS</button></div></form></div></div>`;
  } else if (modal.kind === 'payroll-settings') {
    const month = today().slice(0, 7), [firstDay, secondDay] = [...config().cutoffDays].sort((a, b) => a - b);
    const firstStart = monthDate(month, firstDay), secondStart = monthDate(month, secondDay);
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="payroll-settings-title"><div class="modal-head"><div><p class="modal-kicker">PAYROLL SETTINGS</p><h2 id="payroll-settings-title">Set Payroll Cutoff</h2></div><button class="close" data-action="modal-close" aria-label="Close Payroll settings">×</button></div><p>Select a month first, then choose the two cutoff start dates. The date ranges update to match that calendar month.</p><form id="payroll-settings-form"><div class="field"><label for="payroll-month">Payroll month</label><input id="payroll-month" name="payrollMonth" type="month" value="${month}" required></div><div class="field-row"><div class="field"><label for="cutoff-first-start">First cutoff starts</label><input id="cutoff-first-start" name="firstStart" type="date" min="${month}-01" max="${monthEnd(month)}" value="${firstStart}" required></div><div class="field"><label for="cutoff-second-start">Second cutoff starts</label><input id="cutoff-second-start" name="secondStart" type="date" min="${month}-01" max="${monthEnd(month)}" value="${secondStart}" required></div></div><div class="cutoff-preview" id="payroll-preview">${payrollPreviewMarkup(month, firstStart, secondStart)}</div><div class="notice">Sundays are not counted as scheduled cutoff days by default. If an employee works on Sunday, use <strong>Add attendance</strong>; that record will still appear in payroll as off-day work.</div><div class="modal-actions"><button class="btn ghost" type="button" data-action="modal-close">Cancel</button><button class="btn" type="submit">Save Payroll</button></div></form></div></div>`;
  } else if (modal.kind === 'records-filter') {
    const range = state.adminRange || currentRange();
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal account-modal filter-modal" role="dialog" aria-modal="true" aria-labelledby="records-filter-title"><div class="modal-head"><div><p class="modal-kicker">ATTENDANCE RECORDS</p><h2 id="records-filter-title">Filter Date Range</h2></div><button class="close" data-action="modal-close" aria-label="Close date filter">×</button></div><p>Records show today by default. Choose another date range when needed.</p><form id="records-filter"><div class="field-row"><div class="field"><label for="records-from">From</label><input id="records-from" type="date" name="from" value="${h(range.start)}" required></div><div class="field"><label for="records-to">To</label><input id="records-to" type="date" name="to" value="${h(range.end)}" required></div></div><div class="modal-actions"><button class="btn ghost" type="button" data-action="modal-close">Cancel</button><button class="btn" type="submit">Apply Filter</button></div></form></div></div>`;
  } else if (modal.kind === 'employee-confirm') {
    const { input, editing } = modal;
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal account-modal review-modal" role="dialog" aria-modal="true" aria-labelledby="employee-confirm-title"><div class="modal-head"><div><p class="modal-kicker">REVIEW ACTION</p><h2 id="employee-confirm-title">Review employee account</h2></div><button class="close" data-action="modal-close" aria-label="Close employee review">×</button></div><p>Check these details before ${editing ? 'updating' : 'creating'} the account.</p><div class="review-list"><div class="review-row"><span>Action</span><strong>${editing ? 'Update employee' : 'Create employee'}</strong></div><div class="review-row"><span>Name</span><strong>${h(input.name)}</strong></div><div class="review-row"><span>Username</span><strong>${h(input.username)}</strong></div><div class="review-row"><span>Working Hours</span><strong>${h(input.scheduleType === 'STANDARD' ? 'Standard' : 'Custom')} · ${h(formatClockText(input.scheduleStart))}–${h(formatClockText(input.scheduleEnd))}</strong></div>${editing ? `<div class="review-row"><span>Apply schedule from</span><strong>${h(numericDate(input.scheduleEffectiveDate))}</strong></div>` : ''}<div class="review-row"><span>Workdays</span><strong>${h(workdayLabel(input.workdays))}</strong></div>${editing ? `<div class="review-row"><span>Account</span><strong>${input.active ? 'Active' : 'Disabled'}</strong></div>` : ''}<div class="review-row"><span>Password</span><strong>${input.password ? (editing ? 'Will be changed' : 'Temporary password is set') : 'Keep current password'}</strong></div></div><div class="notice warn">Confirm only after reviewing the employee login and schedule.</div><form id="employee-confirm-form"><div class="modal-actions"><button class="btn ghost" type="button" data-action="employee-back">Go back</button><button class="btn" type="submit">Confirm &amp; ${editing ? 'Save' : 'Create'}</button></div></form></div></div>`;
  } else if (modal.kind === 'attendance-confirm') {
    const { input, employeeName } = modal;
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal account-modal review-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-confirm-title"><div class="modal-head"><div><p class="modal-kicker">REVIEW ACTION</p><h2 id="attendance-confirm-title">Review attendance changes</h2></div><button class="close" data-action="modal-close" aria-label="Close attendance review">×</button></div><p>Verify the intervals before saving this workday.</p><div class="review-list"><div class="review-row"><span>Employee</span><strong>${h(employeeName)}</strong></div><div class="review-row"><span>Work date</span><strong>${h(numericDate(input.workDate))}</strong></div>${input.segments.map((segment, index) => `<div class="review-row"><span>Interval ${index + 1}</span><strong>${h(segment.timeIn)} → ${h(segment.timeOut || 'Open')} · ${segment.offsite ? 'Offsite' : 'Onsite'}<br>Reason: ${h(segment.reason || '—')}<br>Field Assignment: ${h(segment.fieldAssignment || '—')}</strong></div>`).join('')}</div><div class="notice warn">Edited punches replace the active time and keep the original in the audit trail. Unchanged punches keep their selfie, GPS, and verification.</div><form id="attendance-confirm-form"><div class="modal-actions"><button class="btn ghost" type="button" data-action="modal-close">Go back</button><button class="btn" type="submit">Confirm &amp; Save</button></div></form></div></div>`;
  } else if (modal.kind === 'arrival') {
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Onsite arrival"><div class="modal-head"><h2>You're at ${h(config().siteName)} 👋</h2><button class="close" data-action="modal-close" aria-label="Close">×</button></div><p>Your onsite Time In is not recorded yet. Take a selfie and confirm to save your attendance.</p><div class="map-card">Within site radius · GPS accuracy ±${Math.round(modal.location.accuracyM)} m</div><div class="card-actions"><button class="btn" data-action="arrival-time-in">Open Time In</button><button class="btn secondary" data-action="modal-close">Later</button></div></div></div>`;
  } else if (modal.kind === 'record-day') {
    const segments = groupPunches(modal.punches);
    const payrollReady = isPayrollDayReady(modal.punches);
    const complete = segments.length && segments.every(group => group.inPunch && group.outPunch);
    const reviewAction = payrollReady
      ? '<div class="notice success proof-payroll-status"><strong>Regular attendance approved.</strong> Regular hours and undertime are included in payroll; OT and Night differential still require separate approval.</div>'
      : complete
        ? `<div class="proof-approve"><p>Review every punch time, GPS location, and photo before approval.</p><button class="btn" data-action="approve-attendance-day" data-user-id="${h(modal.punches[0].userId)}" data-work-date="${h(modal.workDate)}">Approve Daily Attendance</button></div>`
        : '<div class="notice warn proof-payroll-status">Time In and Time Out must be recorded for every interval before this day can be approved for payroll.</div>';
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal proof-modal" role="dialog" aria-modal="true" aria-labelledby="proof-day-title"><div class="modal-head"><div><p class="modal-kicker">DAILY ATTENDANCE REVIEW</p><h2 id="proof-day-title">${h(modal.employeeName)}</h2><p>${h(prettyDate(modal.workDate))}</p></div><button class="close" data-action="modal-close" aria-label="Close daily proof">×</button></div><div class="proof-rows">${segments.map(group => `<h3 class="proof-interval-title">Work interval ${group.number}</h3>${punchProofRow(group.inPunch, 'IN')}${punchProofRow(group.outPunch, 'OUT')}${intervalReviewMarkup(group)}`).join('')}</div>${reviewAction}<button class="btn secondary small" data-action="edit-record-day" data-user-id="${h(modal.punches[0]?.userId)}" data-work-date="${h(modal.workDate)}">Edit or add interval</button>${modal.punches.length ? '<button class="btn danger small" data-action="reset-attendance-day">Reset selected attendance</button>' : ''}</div></div>`;
  } else if (modal.kind === 'reset-day') {
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="reset-day-title"><div class="modal-head"><h2 id="reset-day-title">Reset selected attendance?</h2><button class="close" data-action="modal-close" aria-label="Close">×</button></div><p><strong>${h(modal.employeeName)}</strong> · ${h(prettyDate(modal.workDate))}</p><div class="notice warn">This clears all ${modal.expectedIds.length} punches for this date, including every interval and its OT / night differential approvals. Attendance and payroll will show no recorded hours for this date. You can add corrected attendance afterward. The original proof stays in the admin audit history.</div><form id="reset-day-form"><div class="field"><label>Reason (optional)</label><textarea name="reason" maxlength="300"></textarea></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="modal-close">Cancel</button><button type="submit" class="btn danger">Reset punches</button></div></form></div></div>`;
  } else if (modal.kind === 'interval-review') {
    const label = modal.decision === 'APPROVED' ? 'Approve' : 'Decline';
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Review work interval"><div class="modal-head"><h2>${label} interval ${h(modal.segment)}?</h2><button class="close" data-action="modal-close" aria-label="Close">×</button></div><p>${h(modal.employeeName)} · ${h(prettyDate(modal.workDate))}</p><p>${h(formatTime(modal.inTime))} – ${h(formatTime(modal.outTime))}</p><p class="card-sub">${modal.decision === 'APPROVED' ? 'Approve both punches for this interval. OT and night differential remain subject to their separate premium review.' : 'Exclude this interval from working hours and payroll. Its punches, photos, and review history remain saved.'}</p><form id="interval-review-form"><div class="field"><label for="interval-review-reason">Reason (optional)</label><textarea id="interval-review-reason" name="reason" maxlength="300"></textarea></div><button class="btn block ${modal.decision === 'REJECTED' ? 'danger' : ''}" type="submit">${label} interval</button></form></div></div>`;
  } else if (modal.kind === 'approve-day') {
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal account-modal review-modal" role="dialog" aria-modal="true" aria-labelledby="approve-day-title"><div class="modal-head"><div><p class="modal-kicker">CONFIRM ATTENDANCE</p><h2 id="approve-day-title">Approve regular attendance?</h2></div><button class="close" data-action="modal-close" aria-label="Close attendance approval">×</button></div><p><strong>${h(modal.employeeName)}</strong> · ${h(prettyDate(modal.workDate))}</p><div class="notice">This approves the remaining eligible Time In and Time Out proof. Declined intervals stay excluded. Regular hours and undertime enter payroll; work beyond 8 actual working hours, up to 10:00 PM, remains pending OT. Night differential from 10:00 PM to 6:00 AM needs separate approval.</div><form id="approve-day-form"><div class="modal-actions"><button class="btn ghost" type="button" data-action="modal-close">Go back</button><button class="btn" type="submit">Approve Regular Time</button></div></form></div></div>`;
  } else if (modal.kind === 'premium') {
    const { extension, stage, decision } = modal;
    const pin = extension.latitude == null ? '<p class="card-sub">Calculated from attendance intervals. Open the daily attendance record to review punch proof.</p>'
      : `<div class="map-card"><strong>Continuation GPS: ${h(extension.latitude)}, ${h(extension.longitude)}</strong><small>Accuracy ±${h(Math.round(extension.accuracyM))} m</small>${mapLink(extension, 'Open continuation in Google Maps ↗')}</div>`;
    const stageLabel = stage === 'ADJUSTMENT' ? 'regular-time adjustment' : stage === 'OVERTIME' ? 'remaining overtime' : 'Night differential';
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Review extra hours"><div class="modal-head"><h2>${decision === 'APPROVED' ? 'Approve' : 'Reject'} ${stageLabel}</h2><button class="close" data-action="modal-close" aria-label="Close">×</button></div><p>${h(extension.employeeName)} · ${h(prettyDate(extension.workDate))}</p>${pin}<form id="premium-review-form"><input type="hidden" name="id" value="${h(extension.id)}"><input type="hidden" name="stage" value="${h(stage)}"><input type="hidden" name="calculationKey" value="${h(extension.calculationKey || '')}"><input type="hidden" name="decision" value="${h(decision)}"><div class="field"><label for="premium-reason">Reason (optional)</label><textarea id="premium-reason" name="reason" maxlength="300" placeholder="Add a note for the payroll audit trail"></textarea></div><button class="btn block ${decision === 'REJECTED' ? 'danger' : ''}" type="submit">Confirm ${decision === 'APPROVED' ? 'approval' : 'rejection'}</button></form></div></div>`;
  } else if (modal.kind === 'delete-employee') {
    const e = modal.employee;
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="delete-employee-title"><div class="modal-head"><div><p class="modal-kicker">CONFIRM DELETION</p><h2 id="delete-employee-title">Delete employee account?</h2></div><button class="close" data-action="modal-close" aria-label="Close employee deletion">×</button></div><p><strong>${h(e.name)}</strong> · ${h(e.username || e.email)}</p><p class="notice warn">This permanently deletes the employee account, attendance, review requests, sessions, and selfies. The audit trail remains.</p><form id="delete-employee-form"><input type="hidden" name="id" value="${h(e.id)}"><div class="field"><label>Type DELETE to confirm</label><input name="confirmation" required autocomplete="off" pattern="DELETE"></div><div class="modal-actions"><button class="btn ghost" type="button" data-action="modal-close">Cancel</button><button class="btn danger" type="submit">Confirm deletion</button></div></form></div></div>`;
  } else if (modal.kind === 'delete-holiday') {
    const holiday = modal.holiday;
    holder.innerHTML = `<div class="modal-backdrop"><div class="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="delete-holiday-title"><div class="modal-head"><div><p class="modal-kicker">CONFIRM DELETION</p><h2 id="delete-holiday-title">Remove holiday?</h2></div><button class="close" data-action="modal-close" aria-label="Close holiday deletion">×</button></div><p><strong>${h(holiday.name)}</strong> · ${h(numericDate(holiday.date))}</p><p class="notice warn">Employees will be scheduled normally on this date after removal.</p><form id="delete-holiday-form"><input type="hidden" name="date" value="${h(holiday.date)}"><div class="modal-actions"><button class="btn ghost" type="button" data-action="modal-close">Cancel</button><button class="btn danger" type="submit">Confirm removal</button></div></form></div></div>`;
  }
  requestAnimationFrame(() => holder.querySelector(modal.kind === 'employee-editor' ? '[name="name"]' : '.close')?.focus());
}
function closeModal() {
  const employeeModal = ['employee-editor', 'employee-confirm'].includes(state.modal?.kind);
  state.modal = null;
  const holder = document.getElementById('modal-root'); if (holder) holder.innerHTML = '';
  if (employeeModal && state.section === 'employees') document.querySelector('[data-action="employee-new"]')?.focus();
}
async function loadProofSelfies(punches) {
  await Promise.all(punches.filter(item => item.hasSelfie).map(async item => {
    try {
      const data = await client.action(functions.storageActions.selfie, { token: accessToken, id: item.id });
      const img = document.getElementById(`proof-selfie-${item.id}`);
      if (img && state.modal?.kind === 'record-day' && state.modal.punches.some(current => current.id === item.id)) {
        img.src = data;
        img.classList.remove('hidden');
        document.getElementById(`proof-loading-${item.id}`)?.remove();
      }
    } catch {
      const loading = document.getElementById(`proof-loading-${item.id}`);
      if (loading) loading.textContent = 'Selfie unavailable.';
    }
  }));
}
function newCapture(slot, location = null) {
  return { slot, segment: nextEmployeePunch().nextSegment, userId: state.session.user.id, workDate: activeWorkDate(),
    method: detectedPunchMethod(location, activeExtension()), location,
    selfie: null, selfieBytes: null, previewAt: null, note: slot === 'OUT' ? getTodayPunch('IN')?.note || '' : '',
    cameraOpen: false, photoProcessing: false, locationPending: false, locationError: '', submitting: false };
}
function captureReady(c = state.capture) {
  return !!(c?.selfie && c.location && c.location.accuracyM <= config().maxAccuracyM &&
    !c.cameraOpen && !c.photoProcessing && !c.locationPending && !c.locationError && !c.submitting);
}
function clearCapture() {
  closeFrontCamera();
  state.capture = null;
}
async function openDeviceCamera() {
  const c = state.capture;
  if (!c || c.cameraOpen || c.photoProcessing || c.submitting) return;
  c.cameraOpen = true;
  renderView();
  try {
    const canvas = await openFrontCamera();
    if (!canvas || state.capture !== c || state.session?.user.id !== c.userId) return;
    c.cameraOpen = false;
    await saveSelfiePhoto(canvas, c);
    if (state.capture === c && state.section === 'capture') window.scrollTo(0, 0);
  } finally {
    c.cameraOpen = false;
    if (state.capture === c && state.section === 'capture') renderView();
  }
}
function beginDeviceCapture(slot, location = null) {
  if (state.capture?.submitting) return;
  if (!navigator.onLine) throw new Error('Connect to the internet before recording attendance.');
  if (holidayFor(activeWorkDate(), config().holidays)) throw new Error('No work is scheduled today. Ask an administrator to record exceptional work.');
  const clock = nextEmployeePunch();
  if (clock.blockReason) throw new Error(clock.blockReason);
  if (slot !== clock.nextSlot) throw new Error('Attendance changed. Open the time clock again.');
  closeModal();
  closeFrontCamera();
  state.capture = newCapture(slot, location); state.section = 'capture'; state.message = '';
  render();
  window.scrollTo(0, 0);
  // Open the front camera immediately; GPS starts after the employee takes the photo.
  return openDeviceCamera();
}
async function refreshCaptureLocation(c = state.capture) {
  if (!c) return;
  const request = c.locationRequest = (c.locationRequest || 0) + 1;
  c.locationPending = true; c.locationError = '';
  if (state.section === 'capture') renderView();
  try {
    const location = await geo();
    if (state.capture !== c || c.locationRequest !== request) return;
    c.location = location; c.method = detectedPunchMethod(location, activeExtension());
  } catch (error) {
    if (state.capture === c && c.locationRequest === request) c.locationError = error.message;
  } finally {
    if (state.capture === c && c.locationRequest === request) {
      c.locationPending = false;
      if (state.section === 'capture') renderView();
    }
  }
}
function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to compress this image.')), 'image/jpeg', quality));
}
function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read the compressed image.'));
    reader.readAsDataURL(blob);
  });
}
async function compressedJpeg(canvas, targetBytes, initialQuality = .78) {
  let quality = initialQuality, blob;
  do {
    blob = await canvasBlob(canvas, quality);
    quality -= .07;
  } while (blob.size > targetBytes && quality >= .43);
  if (blob.size > 750_000) throw new Error('The image is still too large after compression. Try another photo.');
  return { dataUrl: await blobDataUrl(blob), bytes: blob.size };
}
async function saveSelfiePhoto(canvas, c = state.capture) {
  if (!canvas || !c || state.capture !== c || c.photoProcessing || c.submitting) return;
  c.photoProcessing = true;
  void refreshCaptureLocation(c);
  try {
    const compressed = await compressedJpeg(canvas, 220_000, .78);
    if (state.capture !== c) return;
    c.selfie = compressed.dataUrl; c.selfieBytes = compressed.bytes;
    c.previewAt = new Date().toISOString();
  } finally {
    c.photoProcessing = false;
    if (state.capture === c && state.section === 'capture') renderView();
  }
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
    return (await compressedJpeg(canvas, 160_000, .8)).dataUrl;
  } finally { bitmap.close?.(); }
}
async function submitPunch() {
  const c = state.capture;
  if (c?.submitting) return;
  if (!navigator.onLine) throw new Error('Offline. Attendance was not saved. Reconnect and try again.');
  const clock = nextEmployeePunch();
  if (clock.blockReason) throw new Error(clock.blockReason);
  if (c && (c.segment !== clock.nextSegment || c.slot !== clock.nextSlot || c.workDate !== clock.workDate))
    throw new Error('Attendance changed. Open the time clock again.');
  if (!captureReady(c)) throw new Error('Take a photo and finish the location check before proceeding.');
  c.note = document.getElementById('capture-note')?.value || c.note || '';
  c.submitting = true; renderView();
  try {
    try { c.location = await geo(); c.locationError = ''; }
    catch (error) { c.locationError = error.message; throw error; }
    if (state.capture !== c || state.session?.user.id !== c.userId) return;
    if (c.location.accuracyM > config().maxAccuracyM) throw new Error('Location is not accurate enough. Retry GPS before proceeding.');
    c.method = detectedPunchMethod(c.location, activeExtension());
    if (c.method === 'OFFSITE' && c.note.trim().length < 3) c.note = 'Offsite location automatically detected';
    const result = await api('/api/punch', { method: 'POST', body: JSON.stringify({ slot: c.slot, segment: c.segment, workDate: c.workDate, method: c.method,
      latitude: c.location.latitude, longitude: c.location.longitude, accuracyM: c.location.accuracyM,
      selfie: c.selfie, note: c.note }) });
    if (!state.session || state.session.user.id !== c.userId) return;
    state.employeeData.punches = [...state.employeeData.punches.filter(punch => punch.id !== result.punch.id), result.punch];
    if (result.clock) state.employeeData.clock = result.clock;
    if (c.slot === 'OUT' && state.employeeData.openShift?.workDate === result.punch.workDate) state.employeeData.openShift = null;
    clearCapture();
    try { await loadEmployee(currentRange()); } catch { /* The server receipt already confirms this punch. */ }
    if (state.session?.user.id !== c.userId) return;
    state.section = 'home'; render();
    flash(`${result.punch.slot === 'IN' ? 'Time In' : 'Time Out'} recorded successfully at ${formatTime(result.punch.timeUtc)}. Pending admin verification.${result.overtimeAutoApplied ? ' Extra hours were submitted for admin approval.' : ''}`, 'success');
  } finally {
    c.submitting = false;
    if (state.capture === c && state.section === 'capture') renderView();
  }
}

function updateOnline() { document.getElementById('offline')?.classList.toggle('hidden', navigator.onLine); }
function formData(form) { return Object.fromEntries(new FormData(form)); }
function validateRange(from, to) { if (!from || !to || from > to) throw new Error('Choose a valid date range.'); return { start: from, end: to }; }

document.addEventListener('click', async event => {
  if (event.target instanceof Element && event.target.classList.contains('modal-backdrop')) return closeModal();
  const node = event.target.closest('[data-nav],[data-action]'); if (!node) return;
  const action = node.dataset.action;
  try {
    if (node.dataset.nav) return await go(node.dataset.nav);
    if (action === 'auth-login' || action === 'auth-signup') { state.authMode = action === 'auth-signup' ? 'signup' : 'login'; state.message = ''; return renderLogin(); }
    if (action === 'logout') { await api('/api/logout', { method: 'POST', body: '{}' }); clearCapture(); state.session = null; state.section = 'home'; state.message = ''; await loadSignupStatus(); return render(); }
    if (action === 'capture-auto') return await beginDeviceCapture(node.dataset.slot);
    if (action === 'continue-offsite') {
      if (!navigator.onLine) throw new Error('Connect to the internet before continuing overtime.');
      const location = await geo();
      await api('/api/continue-offsite', { method: 'POST', body: JSON.stringify(location) });
      await loadEmployee(currentRange()); renderView();
      return flash('Offsite continuation recorded. Time Out with selfie and GPS when finished; extra hours need admin approval.', 'success');
    }
    if (action === 'arrival-time-in') return await beginDeviceCapture('IN', state.modal.location);
    if (action === 'modal-close') return closeModal();
    if (action === 'edit-profile') return showModal({ kind: 'edit-profile' });
    if (action === 'update-app') return showModal({ kind: 'update-app' });
    if (action === 'site-settings') return showModal({ kind: 'site-settings' });
    if (action === 'payroll-settings') return showModal({ kind: 'payroll-settings' });
    if (action === 'records-filter') return showModal({ kind: 'records-filter' });
    if (action === 'open-report-employee') {
      state.reportEmployeeId = state.reportEmployeeId === node.dataset.id ? null : node.dataset.id;
      renderView();
      document.querySelector(state.reportEmployeeId ? '.report-sheet' : '.report-employee-list')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (action === 'location' && !state.capture?.submitting) return await refreshCaptureLocation();
    if (action === 'capture-photo') return await openDeviceCamera();
    if (action === 'capture-cancel' && !state.capture?.submitting) { clearCapture(); return await go('home'); }
    if (action === 'submit-punch') return await submitPunch();
    if (action === 'cutoff-prev' || action === 'cutoff-next') {
      const range = state.historyRange || currentRange();
      state.historyRange = cutoffFor(action === 'cutoff-prev' ? yesterday(range.start) : tomorrow(range.end));
      await loadEmployee(state.historyRange); return renderView();
    }
    if (action === 'add-manual-interval') {
      const form = document.getElementById('backfill-form');
      if (!form?.elements.employeeId.value) throw new Error('Choose an employee first.');
      const input = backfillInputFromForm(form);
      if (input.segments.length >= 6) throw new Error('A maximum of six intervals can be saved for one workday.');
      if (!input.segments.at(-1).timeOut) throw new Error('Finish the previous Time Out before adding another interval.');
      state.backfillDraft = { ...input, segments: [...input.segments, { timeIn: '', timeOut: '',
        timeInNextDay: false, timeOutNextDay: false, inId: null, outId: null,
        offsite: input.segments.at(-1).offsite }] };
      return renderView();
    }
    if (action === 'remove-manual-interval') {
      const form = document.getElementById('backfill-form');
      const input = backfillInputFromForm(form), index = Number(node.dataset.index);
      if (index < 1 || input.segments[index]?.inId || input.segments[index]?.outId) throw new Error('Only a new unsaved interval can be removed.');
      input.segments.splice(index, 1); state.backfillDraft = input; return renderView();
    }
    if (action === 'edit-record-day') {
      const employeeId = node.dataset.userId, workDate = node.dataset.workDate;
      closeModal(); await go('backfill'); await loadBackfillDay(employeeId, workDate); return;
    }
    if (action === 'employee-new') return showModal({ kind: 'employee-editor' });
    if (action === 'employee-edit') {
      const employee = state.employees.find(e => e.id === node.dataset.id);
      if (employee) showModal({ kind: 'employee-editor', employee });
      return;
    }
    if (action === 'employee-back') {
      const review = state.modal;
      if (review?.kind === 'employee-confirm') showModal({ kind: 'employee-editor', employee: review.employee, draft: review.input });
      return;
    }
    if (action === 'employee-delete') {
      const employee = state.employees.find(e => e.id === node.dataset.id);
      if (employee) showModal({ kind: 'delete-employee', employee });
      return;
    }
    if (action === 'site-my-location') {
      const form = document.getElementById('site-settings-form'), status = document.getElementById('site-location-status');
      node.disabled = true; node.setAttribute('aria-busy', 'true'); node.innerHTML = '<span class="location-spinner" aria-hidden="true"></span> Locating device…';
      if (status) { status.className = 'site-location-status locating'; status.querySelector('p').textContent = 'Getting a precise GPS pin. Keep this window open; a second attempt will run automatically if needed.'; }
      try {
        const pos = await geo();
        form.elements.siteLat.value = pos.latitude.toFixed(7); form.elements.siteLng.value = pos.longitude.toFixed(7);
        if (status) { status.className = 'site-location-status ready'; status.querySelector('p').textContent = `Pin ready · accuracy ±${Math.round(pos.accuracyM)} m. Review the coordinates, then save.`; }
        return flash(`Current pin filled (GPS accuracy ±${Math.round(pos.accuracyM)} m). Check it before saving.`, 'success');
      } catch (error) {
        if (status) { status.className = 'site-location-status blocked'; status.querySelector('p').textContent = `${error.message} Manual coordinate entry remains available above.`; }
        throw error;
      } finally {
        node.disabled = false; node.removeAttribute('aria-busy'); node.innerHTML = '<span aria-hidden="true">◎</span> Try my location again';
      }
    }
    if (action === 'holiday-remove') {
      const holiday = config().customHolidays.find(item => item.date === node.dataset.date);
      if (holiday) showModal({ kind: 'delete-holiday', holiday });
      return;
    }
    if (action === 'record-detail') {
      const p = state.adminData.punches.find(item => item.id === node.dataset.id);
      if (p) {
        const punches = state.adminData.punches.filter(item => item.userId === p.userId && item.workDate === p.workDate);
        showModal({ kind: 'record-day', punches, employeeName: p.employeeName, workDate: p.workDate });
        await loadProofSelfies(punches);
      }
      return;
    }
    if (action === 'premium-review') {
      const extension = state.adminData.extensions.find(item => item.id === node.dataset.id);
      if (extension) showModal({ kind: 'premium', extension, stage: node.dataset.stage, decision: node.dataset.decision });
      return;
    }
    if (action === 'reset-backfill-day') {
      const draft = state.backfillDraft;
      if (state.backfillLoading || !draft?.expectedIds.length) return;
      showModal({ kind: 'reset-day', userId: draft.employeeId, workDate: draft.workDate,
        employeeName: state.employees.find(employee => employee.id === draft.employeeId)?.name || 'Employee',
        expectedIds: [...draft.expectedIds], fromBackfill: true });
      return;
    }
    if (action === 'reset-attendance-day') {
      const record = state.modal;
      if (record?.kind !== 'record-day' || !record.punches.length) return;
      showModal({ kind: 'reset-day', userId: record.punches[0].userId, workDate: record.workDate,
        employeeName: record.employeeName, expectedIds: record.punches.map(punch => punch.id) });
      return;
    }
    if (action === 'approve-attendance-day') {
      const punches = state.modal?.kind === 'record-day' ? state.modal.punches : [];
      const employeeName = state.modal?.kind === 'record-day' ? state.modal.employeeName : 'Employee';
      showModal({ kind: 'approve-day', userId: node.dataset.userId, workDate: node.dataset.workDate,
        employeeName, punches });
      return;
    }
    if (action === 'interval-review') {
      const context = state.modal;
      if (context?.kind !== 'record-day') return;
      const group = groupPunches(context.punches).find(group => group.number === Number(node.dataset.segment));
      if (!group?.inPunch || !group.outPunch) throw new Error('Wait for Time Out before reviewing this interval.');
      showModal({ kind: 'interval-review', userId: group.inPunch.userId, workDate: context.workDate,
        employeeName: context.employeeName, segment: group.number, decision: node.dataset.decision,
        expectedIds: [group.inPunch.id, group.outPunch.id], inTime: group.inPunch.timeUtc, outTime: group.outPunch.timeUtc });
      return;
    }
    if (action === 'verify-approve' || action === 'verify-reject') {
      const verification = action === 'verify-approve' ? 'APPROVED' : 'REJECTED';
      const reason = verification === 'REJECTED' ? window.prompt('Reason for rejection (optional):') : '';
      if (verification === 'REJECTED' && reason == null) return;
      const proofContext = state.modal?.kind === 'record-day'
        ? { userId: state.modal.punches[0]?.userId, employeeName: state.modal.employeeName, workDate: state.modal.workDate }
        : null;
      await api(`/api/admin/punches/${node.dataset.id}/verify`, { method: 'POST', body: JSON.stringify({ verification, reason }) });
      closeModal();
      await loadAdmin(state.adminRange || currentRange());
      renderView();
      if (proofContext?.userId) {
        const punches = state.adminData.punches.filter(item => item.userId === proofContext.userId && item.workDate === proofContext.workDate);
        showModal({ kind: 'record-day', punches, employeeName: proofContext.employeeName, workDate: proofContext.workDate });
        await loadProofSelfies(punches);
      }
      return flash(`Punch ${verification.toLowerCase()}.`, 'success');
    }
    if (action === 'print') return window.print();
    if (action === 'dismiss-install') { state.installDismissed = true; return render(); }
    if (action === 'install' && state.session?.user.role !== 'admin' && state.installPrompt) {
      const prompt = state.installPrompt;
      await prompt.prompt();
      const choice = await prompt.userChoice;
      state.installPrompt = null;
      state.installDismissed = choice.outcome !== 'accepted';
      return render();
    }
  } catch (error) { flash(error.message, 'error'); }
});

document.addEventListener('change', async event => {
  try {
    if (event.target.id === 'working-hours-type') {
      const custom = event.target.value === 'CUSTOM';
      document.getElementById('custom-working-hours')?.classList.toggle('hidden', !custom);
      for (const input of document.querySelectorAll('#custom-working-hours input')) input.required = custom;
      return;
    }
    if (event.target.closest('#report-filter')) {
      if (event.target.name === 'period') {
        state.reportRange = event.target.value === 'current' ? null : { ...currentRange() };
        state.reportEmployeeId = null;
        if (!state.reportRange) await loadAdmin(currentRange(), null, false);
        return renderView();
      }
      const filter = document.getElementById('report-filter');
      const range = validateRange(filter.querySelector('[name="from"]').value, filter.querySelector('[name="to"]').value);
      await loadAdmin(range, null, false);
      state.reportRange = range;
      state.reportEmployeeId = null;
      return renderView();
    }
    if (event.target.closest('#backfill-form') && ['employeeId', 'workDate'].includes(event.target.name)) {
      const form = event.target.form;
      return await loadBackfillDay(form.elements.employeeId.value, form.elements.workDate.value);
    }
    if (event.target.closest('.manual-interval')) updateIntervalPreviews(event.target.closest('form'));
    if (event.target.id === 'payroll-month') return syncPayrollEditor(true);
    if (event.target.id === 'cutoff-first-start' || event.target.id === 'cutoff-second-start') return syncPayrollEditor();
    if (event.target.id === 'signup-photo') {
      state.signupPhoto = await profileImageData(event.target.files[0]);
      const preview = document.getElementById('signup-photo-preview');
      if (preview) { preview.src = state.signupPhoto; preview.classList.remove('hidden'); }
    }
    if (event.target.id === 'profile-photo' && event.target.files[0]) {
      const preview = document.getElementById('profile-photo-preview');
      if (preview) preview.innerHTML = `<img src="${URL.createObjectURL(event.target.files[0])}" alt="New profile photo preview">`;
    }
    if (event.target.id === 'app-brand-logo' && event.target.files[0]) {
      const preview = document.getElementById('brand-preview');
      if (preview) preview.innerHTML = `<img class="brand-preview-image" src="${URL.createObjectURL(event.target.files[0])}" alt="New app logo preview"><strong>${h(document.getElementById('app-brand-name')?.value || state.branding.appName)}</strong>`;
    }
  } catch (error) { flash(error.message, 'error'); }
});
document.addEventListener('input', event => {
  if (event.target.closest('.manual-interval')) updateIntervalPreviews(event.target.closest('form'));
  if (event.target.id === 'cutoff-first-start' || event.target.id === 'cutoff-second-start') syncPayrollEditor();
  if (event.target.id === 'capture-note' && state.capture) {
    state.capture.note = event.target.value;
    const button = document.querySelector('[data-action="submit-punch"]');
    if (button) button.disabled = !captureReady();
  }
  if (event.target.id === 'app-brand-name') {
    const label = document.querySelector('#brand-preview span:last-child, #brand-preview strong');
    if (label) label.textContent = event.target.value || 'App name';
  }
});

document.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target, id = form.getAttribute('id'), values = formData(form);
  const submit = form.querySelector('[type="submit"]'); if (submit) submit.disabled = true;
  try {
    if (id === 'login-form') {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ identifier: values.identifier, password: values.password, remember: !!values.remember }) });
      clearCapture(); await refreshSession(); state.section = state.session.user.role === 'admin' ? 'dashboard' : 'home';
      await go(state.section); return;
    }
    if (id === 'signup-form') {
      if (values.password !== values.confirmPassword) throw new Error('Passwords do not match.');
      await api('/api/admin/signup', { method: 'POST', body: JSON.stringify({ name: values.name, email: values.email,
        password: values.password, remember: !!values.remember, ...(state.signupPhoto ? { profileImage: state.signupPhoto } : {}) }) });
      clearCapture(); state.signupPhoto = null; state.signupAvailable = false;
      await refreshSession(); await go('dashboard'); return flash('Admin account created.', 'success');
    }
    if (id === 'password-form') { await api('/api/password', { method: 'POST', body: JSON.stringify(values) }); closeModal(); render(); return flash('Password updated.', 'success'); }
    if (id === 'profile-photo-form') {
      const file = form.querySelector('#profile-photo').files[0], remove = !!values.removePhoto;
      if ((file && remove) || (!file && !remove)) throw new Error('Choose a new picture or remove the current one.');
      await api('/api/admin/profile-photo', { method: 'POST', body: JSON.stringify({ remove,
        ...(file ? { profileImage: await profileImageData(file) } : {}) }) });
      await refreshSession(); closeModal(); render(); return flash('Profile picture updated.', 'success');
    }
    if (id === 'delete-account-form') {
      await api('/api/admin/account', { method: 'DELETE', body: JSON.stringify({ password: values.password, confirmation: values.confirmation }) });
      stopLiveUpdates();
      accessToken = ''; localStorage.removeItem('dtr_token'); sessionStorage.removeItem('dtr_token');
      state.session = null; state.section = 'home'; await loadSignupStatus(); render();
      return flash('Admin account deleted. A new admin can now sign up.', 'success');
    }
    if (id === 'history-form') { state.historyRange = validateRange(values.from, values.to); await loadEmployee(state.historyRange); return renderView(); }
    if (id === 'records-filter') { state.adminRange = validateRange(values.from, values.to); await loadAdmin(state.adminRange); closeModal(); return renderView(); }
    if (id === 'delete-employee-form') {
      if (values.confirmation !== 'DELETE') throw new Error('Type DELETE to confirm.');
      await api(`/api/admin/employees/${values.id}`, { method: 'DELETE' });
      closeModal(); await loadEmployees(); await loadAdmin(state.adminRange || currentRange());
      renderView(); return flash('Employee account and related records deleted.', 'success');
    }
    if (id === 'delete-holiday-form') {
      const holidays = config().customHolidays.filter(holiday => holiday.date !== values.date);
      await api('/api/admin/holidays', { method: 'PUT', body: JSON.stringify({ holidays }) });
      await refreshSession(); closeModal(); renderView(); return flash('Holiday removed.', 'success');
    }
    if (id === 'reset-day-form') {
      const pending = state.modal;
      if (pending?.kind !== 'reset-day') throw new Error('Reopen the selected record before resetting.');
      await api('/api/admin/attendance/day/reset', { method: 'POST', body: JSON.stringify({
        userId: pending.userId, workDate: pending.workDate, expectedIds: pending.expectedIds, reason: values.reason }) });
      state.backfillDraft = null;
      closeModal(); await loadAdmin(state.adminRange || currentRange());
      if (pending.fromBackfill) await loadBackfillDay(pending.userId, pending.workDate);
      renderView();
      return flash('Selected attendance cleared. You can now add corrected attendance.', 'success');
    }
    if (id === 'interval-review-form') {
      const review = state.modal;
      if (review?.kind !== 'interval-review') throw new Error('Reopen the interval to review it.');
      await api('/api/admin/attendance/interval/review', { method: 'POST', body: JSON.stringify({
        userId: review.userId, workDate: review.workDate, segment: review.segment,
        expectedIds: review.expectedIds, decision: review.decision, reason: values.reason }) });
      closeModal(); await loadAdmin(state.adminRange || currentRange()); renderView();
      const punches = state.adminData.punches.filter(punch => punch.userId === review.userId && punch.workDate === review.workDate);
      showModal({ kind: 'record-day', punches, employeeName: review.employeeName, workDate: review.workDate });
      await loadProofSelfies(punches);
      return flash(`Interval ${review.segment} ${review.decision === 'APPROVED' ? 'approved' : 'declined'}.`, 'success');
    }
    if (id === 'approve-day-form') {
      const pending = state.modal;
      if (pending?.kind !== 'approve-day') throw new Error('Attendance approval expired. Open the daily review again.');
      await api('/api/admin/attendance/day/approve', { method: 'POST', body: JSON.stringify({
        userId: pending.userId, workDate: pending.workDate
      }) });
      const context = { userId: pending.userId, workDate: pending.workDate, employeeName: pending.employeeName };
      closeModal();
      await loadAdmin(state.adminRange || currentRange());
      renderView();
      const punches = state.adminData.punches.filter(item => item.userId === context.userId && item.workDate === context.workDate);
      showModal({ kind: 'record-day', punches, employeeName: context.employeeName, workDate: context.workDate });
      await loadProofSelfies(punches);
      return flash('Regular attendance approved. Calculated OT until 10:00 PM and night differential are now ready for separate review.', 'success');
    }
    if (id === 'premium-review-form') {
      await api(`/api/admin/extensions/${values.id}/review`, { method: 'POST', body: JSON.stringify(values) });
      closeModal(); await loadAdmin(state.adminRange || currentRange()); renderView();
      const label = values.stage === 'ADJUSTMENT' ? 'Regular-time adjustment' : values.stage === 'OVERTIME' ? 'Remaining overtime' : 'Night differential';
      const updated = state.adminData.extensions.find(extension => extension.id === values.id);
      const completed = !updated || !premiumReviewState(updated).pending;
      return flash(completed
        ? `Approval completed. ${updated?.employeeName || 'Employee'} no longer needs extra-hours review.`
        : `${label} ${values.decision === 'APPROVED' ? 'approved' : 'rejected'}. Remaining decisions are ready below.`, 'success');
    }
    if (id === 'site-settings-form') {
      const input = { siteName: values.siteName, siteLat: Number(values.siteLat), siteLng: Number(values.siteLng), radiusM: Number(values.radiusM), maxAccuracyM: Number(values.maxAccuracyM), cutoffDays: config().cutoffDays };
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(input) }); await refreshSession(); closeModal(); render(); return flash('Site GPS settings saved.', 'success');
    }
    if (id === 'payroll-settings-form') {
      if (!values.firstStart.startsWith(`${values.payrollMonth}-`) || !values.secondStart.startsWith(`${values.payrollMonth}-`)) throw new Error('Both cutoff dates must be inside the selected month.');
      if (values.firstStart >= values.secondStart) throw new Error('The first cutoff must start before the second cutoff.');
      const cutoffDays = [Number(values.firstStart.slice(8)), Number(values.secondStart.slice(8))];
      if (cutoffDays.some(day => day > 28)) throw new Error('Choose cutoff start dates from day 1 through 28 so every month stays valid.');
      const s = config(), input = { siteName: s.siteName, siteLat: s.siteLat, siteLng: s.siteLng, radiusM: s.radiusM, maxAccuracyM: s.maxAccuracyM, cutoffDays };
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(input) }); await refreshSession(); closeModal(); render(); return flash('Payroll cutoff saved and synced to the calendar.', 'success');
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
      await loadBranding(); await refreshSession(); closeModal(); render(); return flash('App name and logo saved.', 'success');
    }
    if (id === 'employee-form') {
      const custom = values.scheduleType === 'CUSTOM';
      const input = { name: values.name, username: values.username.trim().toLowerCase(), password: values.password, scheduleType: custom ? 'CUSTOM' : 'STANDARD',
        scheduleStart: custom ? values.scheduleStart : '08:00', scheduleEnd: custom ? values.scheduleEnd : '17:00',
        ...(values.id ? { scheduleEffectiveDate: values.scheduleEffectiveDate } : {}),
        workdays: [...form.querySelectorAll('input[name="day"]:checked')].map(el => Number(el.value)), active: !!values.active };
      const editing = !!values.id;
      showModal({ kind: 'employee-confirm', input, employee: state.modal?.employee, employeeId: values.id || null, editing }); return;
    }
    if (id === 'employee-confirm-form') {
      const pending = state.modal;
      if (pending?.kind !== 'employee-confirm') throw new Error('Employee review expired. Please review the form again.');
      const { input, employeeId, editing } = pending;
      await api(editing ? `/api/admin/employees/${employeeId}` : '/api/admin/employees', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(input) });
      closeModal(); await loadEmployees(); renderView(); return flash(editing ? 'Employee updated successfully.' : 'Employee account created successfully.', 'success');
    }
    if (id === 'backfill-form') {
      const { punches: _loadedPunches, ...input } = backfillInputFromForm(form);
      const employeeName = state.employees.find(employee => employee.id === input.employeeId)?.name || 'Selected employee';
      showModal({ kind: 'attendance-confirm', input, employeeName }); return;
    }
    if (id === 'attendance-confirm-form') {
      const pending = state.modal;
      if (pending?.kind !== 'attendance-confirm') throw new Error('Attendance review expired. Please review the form again.');
      const { input } = pending;
      const result = await api('/api/admin/attendance/day', { method: 'POST', body: JSON.stringify(input) });
      closeModal(); state.backfillDraft = null; state.adminRange = { start: input.workDate, end: input.workDate };
      await go('records'); return flash(`${result.created} punch${result.created === 1 ? '' : 'es'} saved${result.replaced ? `, including ${result.replaced} audited correction${result.replaced === 1 ? '' : 's'}` : ''}. Review extra hours and daily approval below.`, 'success');
    }
  } catch (error) { flash(error.message, 'error'); }
  finally { if (submit?.isConnected) submit.disabled = false; }
});

window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline);
window.addEventListener('keydown', event => { if (event.key === 'Escape' && state.modal) closeModal(); });
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; if (!appInstalled()) render(); });
window.addEventListener('appinstalled', () => { state.installPrompt = null; state.installDismissed = true; render(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

async function resumeAttendance() {
  if (!state.session || new Date().toLocaleDateString('en-CA', { timeZone }) === today()) return;
  try {
    await refreshSession();
    // Preserve an open review and its unsaved reason when returning to this tab.
    if (state.modal) return;
    if (state.session.user.role === 'admin' && ['dashboard', 'records', 'report'].includes(state.section)) {
      const range = state.section === 'records' ? state.adminRange || currentRange()
        : state.section === 'report' ? state.reportRange || currentRange() : currentRange();
      await loadAdmin(range, null, state.section === 'records');
      if (!state.modal) renderView();
    } else await go(state.section);
  } catch (error) { flash(error.message, 'error'); }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void resumeAttendance();
  else closeFrontCamera();
});
window.addEventListener('pagehide', closeFrontCamera);
setInterval(() => {
  if (!state.session || document.visibilityState !== 'visible') return;
  if (new Date().toLocaleDateString('en-CA', { timeZone }) !== today()) void resumeAttendance();
  else if (state.session.user.role === 'employee' && state.section === 'home') {
    if (getTodayPunch('IN') && !getTodayPunch('OUT')) renderView();
  }

}, 60000);

await loadBranding();
try {
  await refreshSession();
  state.section = state.session.user.role === 'admin' ? 'dashboard' : 'home';
  await go(state.section);
} catch { state.session = null; await loadSignupStatus(); if (!navigator.onLine) { state.message = 'Offline. Attendance cannot be saved until you reconnect; contact admin if you need a backfill.'; state.messageType = 'warn'; } render(); }
