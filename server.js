import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { cutoffFor, distanceMeters, localDateTime, clockMinutes, safeDate } from './rules.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const dataDir = process.env.DTR_DATA_DIR ? path.resolve(process.env.DTR_DATA_DIR) : path.join(root, 'data');
const uploadDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'dtr.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','employee')),
  active INTEGER NOT NULL DEFAULT 1, schedule_start TEXT NOT NULL DEFAULT '08:30',
  schedule_end TEXT NOT NULL DEFAULT '17:30', workdays TEXT NOT NULL DEFAULT '[1,2,3,4,5,6]',
  grace_minutes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK(id=1), site_name TEXT NOT NULL DEFAULT 'Main site',
  site_lat REAL, site_lng REAL, radius_m INTEGER NOT NULL DEFAULT 150,
  max_accuracy_m INTEGER NOT NULL DEFAULT 100, cutoff_days TEXT NOT NULL DEFAULT '[11,26]',
  site_version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS punches (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL, slot TEXT NOT NULL CHECK(slot IN ('IN','OUT')),
  method TEXT NOT NULL CHECK(method IN ('ONSITE','OFFSITE','ADMIN')),
  time_utc TEXT NOT NULL, submitted_at TEXT NOT NULL,
  latitude REAL, longitude REAL, accuracy_m REAL, distance_m REAL,
  selfie_file TEXT, note TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL CHECK(verification IN ('PENDING','APPROVED','REJECTED')),
  rejection_reason TEXT, created_by INTEGER REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id), reviewed_at TEXT,
  site_version INTEGER, active INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_punch ON punches(user_id,work_date,slot) WHERE active=1;
CREATE INDEX IF NOT EXISTS punches_by_date ON punches(work_date,user_id);
CREATE TABLE IF NOT EXISTS overtime (
  user_id INTEGER NOT NULL REFERENCES users(id), work_date TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
  set_by INTEGER NOT NULL REFERENCES users(id), updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,work_date)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
  target_type TEXT NOT NULL, target_id TEXT NOT NULL, details TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);
db.prepare('INSERT OR IGNORE INTO settings(id,updated_at) VALUES(1,?)').run(new Date().toISOString());

const now = () => new Date().toISOString();
const timezone = 'Asia/Manila';
const activeSessions = new Map();
const loginFailures = new Map();

function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function passwordMatches(password, stored) {
  try {
    const [, salt, digest] = stored.split('$');
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(digest, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}
function settings() {
  const row = db.prepare('SELECT * FROM settings WHERE id=1').get();
  return { ...row, cutoffDays: JSON.parse(row.cutoff_days), configured: row.site_lat !== null && row.site_lng !== null };
}
function userView(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role, active: !!row.active,
    scheduleStart: row.schedule_start, scheduleEnd: row.schedule_end,
    workdays: JSON.parse(row.workdays), graceMinutes: row.grace_minutes };
}
function punchView(row) {
  return { id: row.id, userId: row.user_id, employeeName: row.employee_name,
    workDate: row.work_date, slot: row.slot, method: row.method, timeUtc: row.time_utc,
    submittedAt: row.submitted_at, latitude: row.latitude, longitude: row.longitude,
    accuracyM: row.accuracy_m, distanceM: row.distance_m, hasSelfie: !!row.selfie_file,
    note: row.note, verification: row.verification, rejectionReason: row.rejection_reason,
    createdBy: row.created_by, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at,
    siteVersion: row.site_version, active: !!row.active };
}
function audit(actorId, action, type, id, details = {}) {
  db.prepare('INSERT INTO audit(actor_id,action,target_type,target_id,details,created_at) VALUES(?,?,?,?,?,?)')
    .run(actorId, action, type, String(id), JSON.stringify(details), now());
}
function json(res, status, data, extra = {}) {
  const payload = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store', ...extra });
  res.end(payload);
}
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
async function body(req, limit = 5_000_000) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'JSON request required.');
  let chunks = [], total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) fail(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(400, 'Invalid JSON.'); }
}
function auth(req) {
  const raw = /(?:^|;\s*)dtr_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
  const key = crypto.createHash('sha256').update(raw).digest('hex');
  const cached = activeSessions.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  const row = db.prepare(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(key, now());
  if (!row) return null;
  const user = userView(row);
  activeSessions.set(key, { user, expiresAt: Date.parse(row.expires_at) });
  return user;
}
function requireUser(req, role) {
  const user = auth(req);
  if (!user) fail(401, 'Please sign in.');
  if (role && user.role !== role) fail(403, 'Not allowed.');
  return user;
}
function cookie(value, req, maxAge = 0) {
  const secure = process.env.NODE_ENV === 'production' || !!req.socket.encrypted;
  return `dtr_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function validEmail(email) { return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200; }
function validateEmployeeInput(input, creating) {
  if (!input || typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.length > 120) fail(400, 'Employee name must have 2–120 characters.');
  if (!validEmail(input.email)) fail(400, 'Valid email is required.');
  if (creating && (typeof input.password !== 'string' || input.password.length < 12)) fail(400, 'Temporary password must have at least 12 characters.');
  clockMinutes(input.scheduleStart); clockMinutes(input.scheduleEnd);
  if (clockMinutes(input.scheduleEnd) <= clockMinutes(input.scheduleStart)) fail(400, 'Shift end must be after shift start.');
  if (!Array.isArray(input.workdays) || !input.workdays.length || input.workdays.some(n => !Number.isInteger(n) || n < 0 || n > 6)) fail(400, 'Choose valid workdays.');
  if (!Number.isInteger(input.graceMinutes) || input.graceMinutes < 0 || input.graceMinutes > 120) fail(400, 'Grace must be 0–120 minutes.');
}
function selfieToFile(value) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value || '');
  if (!match) fail(400, 'A selfie photo is required.');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length < 1000 || buffer.length > 3_000_000) fail(400, 'Selfie must be 1 KB–3 MB.');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const filename = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(uploadDir, filename), buffer, { flag: 'wx' });
  return filename;
}
function punchRows(from, to, userId = null, includeInactive = false) {
  const where = ['p.work_date BETWEEN ? AND ?'];
  const args = [from, to];
  if (userId) { where.push('p.user_id=?'); args.push(userId); }
  if (!includeInactive) where.push('p.active=1');
  return db.prepare(`SELECT p.*,u.name AS employee_name FROM punches p JOIN users u ON u.id=p.user_id
    WHERE ${where.join(' AND ')} ORDER BY p.work_date DESC,u.name,p.slot`).all(...args).map(punchView);
}
function dateRange(url) {
  const current = cutoffFor(localDateTime(now(), timezone).date, settings().cutoffDays);
  const from = url.searchParams.get('from') || current.start;
  const to = url.searchParams.get('to') || current.end;
  if (!safeDate(from) || !safeDate(to) || from > to || (Date.parse(to) - Date.parse(from)) > 1000 * 86400 * 370) fail(400, 'Invalid date range.');
  return { from, to };
}
function localTimeToUtc(date, time) {
  clockMinutes(time);
  const value = new Date(`${date}T${time}:00+08:00`);
  if (Number.isNaN(value.getTime())) fail(400, 'Invalid date/time.');
  return value.toISOString();
}
function mutate(req) {
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) fail(403, 'Invalid request origin.');
}

async function api(req, res, url) {
  const route = url.pathname;
  if (!['GET', 'HEAD'].includes(req.method)) mutate(req);

  if (route === '/api/login' && req.method === 'POST') {
    const input = await body(req, 20_000);
    const email = String(input.email || '').trim().toLowerCase();
    const key = `${req.socket.remoteAddress}|${email}`;
    let attempts = loginFailures.get(key) || { count: 0, until: 0 };
    if (attempts.until && attempts.until <= Date.now()) attempts = { count: 0, until: 0 };
    if (attempts.count >= 5 && attempts.until > Date.now()) fail(429, 'Too many attempts. Try again later.');
    const row = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
    if (!row || !passwordMatches(String(input.password || ''), row.password_hash)) {
      loginFailures.set(key, { count: attempts.count + 1, until: Date.now() + 15 * 60000 });
      fail(401, 'Invalid email or password.');
    }
    loginFailures.delete(key);
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const maxAge = input.remember ? 30 * 86400 : 12 * 3600;
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
      .run(hash, row.id, new Date(Date.now() + maxAge * 1000).toISOString(), now());
    audit(row.id, 'login', 'user', row.id);
    return json(res, 200, { user: userView(row) }, { 'Set-Cookie': cookie(token, req, maxAge) });
  }
  if (route === '/api/logout' && req.method === 'POST') {
    const token = /(?:^|;\s*)dtr_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    if (token) {
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash); activeSessions.delete(hash);
    }
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('', req, 0) });
  }
  if (route === '/api/session' && req.method === 'GET') {
    const user = requireUser(req);
    const config = settings();
    const today = localDateTime(now(), timezone).date;
    return json(res, 200, { user, today, timezone, cutoff: cutoffFor(today, config.cutoffDays), settings: {
      siteName: config.site_name, siteLat: config.site_lat, siteLng: config.site_lng,
      radiusM: config.radius_m, maxAccuracyM: config.max_accuracy_m,
      cutoffDays: config.cutoffDays, siteVersion: config.site_version, configured: config.configured
    } });
  }
  if (route === '/api/password' && req.method === 'POST') {
    const user = requireUser(req), input = await body(req, 20_000);
    if (typeof input.newPassword !== 'string' || input.newPassword.length < 12) fail(400, 'New password must have at least 12 characters.');
    const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id);
    if (!passwordMatches(String(input.currentPassword || ''), row.password_hash)) fail(403, 'Current password is incorrect.');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash(input.newPassword), user.id);
    audit(user.id, 'password_change', 'user', user.id);
    return json(res, 200, { ok: true });
  }
  if (route === '/api/attendance' && req.method === 'GET') {
    const user = requireUser(req, 'employee');
    const { from, to } = dateRange(url);
    const overtime = db.prepare('SELECT work_date,minutes,note FROM overtime WHERE user_id=? AND work_date BETWEEN ? AND ?').all(user.id, from, to);
    return json(res, 200, { punches: punchRows(from, to, user.id), overtime });
  }
  if (route === '/api/punch' && req.method === 'POST') {
    const user = requireUser(req, 'employee');
    const input = await body(req);
    if (!['IN', 'OUT'].includes(input.slot) || !['ONSITE', 'OFFSITE'].includes(input.method)) fail(400, 'Choose a valid punch.');
    const latitude = Number(input.latitude), longitude = Number(input.longitude), accuracy = Number(input.accuracyM);
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(accuracy) || accuracy < 0) fail(400, 'Current device location is required.');
    const config = settings();
    if (accuracy > config.max_accuracy_m) fail(400, `Location accuracy must be ${config.max_accuracy_m} m or better. Please retry outdoors.`);
    let distance = null;
    if (input.method === 'ONSITE') {
      if (!config.configured) fail(409, 'Admin has not set the site GPS pin yet.');
      distance = distanceMeters(latitude, longitude, config.site_lat, config.site_lng);
      if (distance > config.radius_m) fail(403, `Outside the onsite radius (${Math.round(distance)} m away). Use Offsite DTR.`);
    } else if (String(input.note || '').trim().length < 3) fail(400, 'Enter the offsite work location or assignment.');
    const today = localDateTime(now(), timezone).date;
    if (db.prepare('SELECT id FROM punches WHERE user_id=? AND work_date=? AND slot=? AND active=1').get(user.id, today, input.slot)) fail(409, 'This punch is already recorded.');
    const inPunch = db.prepare("SELECT time_utc FROM punches WHERE user_id=? AND work_date=? AND slot='IN' AND active=1").get(user.id, today);
    if (input.slot === 'OUT' && !inPunch) fail(409, 'Time In is required before Time Out. Ask admin for a correction.');
    const time = now();
    if (input.slot === 'OUT' && Date.parse(time) <= Date.parse(inPunch.time_utc)) fail(409, 'Time Out must be after Time In.');
    const selfie = selfieToFile(input.selfie);
    try {
      const result = db.prepare(`INSERT INTO punches(user_id,work_date,slot,method,time_utc,submitted_at,latitude,longitude,accuracy_m,distance_m,selfie_file,note,verification,site_version)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(user.id, today, input.slot, input.method, time, time, latitude, longitude, accuracy, distance,
        selfie, String(input.note || '').trim().slice(0, 300), input.method === 'ONSITE' ? 'APPROVED' : 'PENDING', config.site_version);
      audit(user.id, 'punch', 'punch', result.lastInsertRowid, { slot: input.slot, method: input.method });
      return json(res, 201, { punch: punchView(db.prepare('SELECT p.*,u.name AS employee_name FROM punches p JOIN users u ON u.id=p.user_id WHERE p.id=?').get(result.lastInsertRowid)) });
    } catch (error) { fs.rmSync(path.join(uploadDir, selfie), { force: true }); throw error; }
  }
  const selfieMatch = /^\/api\/selfie\/(\d+)$/.exec(route);
  if (selfieMatch && req.method === 'GET') {
    const user = requireUser(req);
    const punch = db.prepare('SELECT user_id,selfie_file FROM punches WHERE id=?').get(Number(selfieMatch[1]));
    if (!punch || !punch.selfie_file) fail(404, 'Photo not found.');
    if (user.role !== 'admin' && punch.user_id !== user.id) fail(403, 'Not allowed.');
    const file = path.join(uploadDir, punch.selfie_file);
    const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' });
    return fs.createReadStream(file).pipe(res);
  }

  if (route.startsWith('/api/admin/')) {
    const admin = requireUser(req, 'admin');
    if (route === '/api/admin/settings' && req.method === 'GET') return json(res, 200, { settings: settings() });
    if (route === '/api/admin/settings' && req.method === 'PUT') {
      const input = await body(req, 30_000);
      if (input.siteLat === '' || input.siteLat == null || input.siteLng === '' || input.siteLng == null) fail(400, 'Site GPS coordinates are required.');
      const lat = Number(input.siteLat), lng = Number(input.siteLng), radius = Number(input.radiusM), accuracy = Number(input.maxAccuracyM);
      const days = input.cutoffDays;
      if (typeof input.siteName !== 'string' || !input.siteName.trim() || input.siteName.length > 120) fail(400, 'Site name is required.');
      if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) fail(400, 'Valid site GPS coordinates are required.');
      if (!Number.isInteger(radius) || radius < 25 || radius > 2000) fail(400, 'Site radius must be 25–2000 m.');
      if (!Number.isInteger(accuracy) || accuracy < 10 || accuracy > 500) fail(400, 'Maximum accuracy must be 10–500 m.');
      if (!Array.isArray(days) || days.length !== 2 || days.some(n => !Number.isInteger(n) || n < 1 || n > 28) || days[0] === days[1]) fail(400, 'Use two different cutoff start days (1–28).');
      const previous = settings();
      db.prepare(`UPDATE settings SET site_name=?,site_lat=?,site_lng=?,radius_m=?,max_accuracy_m=?,cutoff_days=?,site_version=site_version+1,updated_at=? WHERE id=1`)
        .run(input.siteName.trim(), lat, lng, radius, accuracy, JSON.stringify(days.sort((a,b)=>a-b)), now());
      audit(admin.id, 'settings_update', 'settings', 1, { before: previous, after: settings() });
      return json(res, 200, { settings: settings() });
    }
    if (route === '/api/admin/employees' && req.method === 'GET') {
      return json(res, 200, { employees: db.prepare("SELECT * FROM users WHERE role='employee' ORDER BY name").all().map(userView) });
    }
    if (route === '/api/admin/employees' && req.method === 'POST') {
      const input = await body(req, 30_000); validateEmployeeInput(input, true);
      const email = input.email.trim().toLowerCase();
      if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) fail(409, 'Email is already in use.');
      const result = db.prepare(`INSERT INTO users(name,email,password_hash,role,schedule_start,schedule_end,workdays,grace_minutes,created_at)
        VALUES(?,?,?,'employee',?,?,?,?,?)`).run(input.name.trim(), email, passwordHash(input.password), input.scheduleStart,
        input.scheduleEnd, JSON.stringify(input.workdays), input.graceMinutes, now());
      audit(admin.id, 'employee_create', 'user', result.lastInsertRowid, { email });
      return json(res, 201, { employee: userView(db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid)) });
    }
    const employeeMatch = /^\/api\/admin\/employees\/(\d+)$/.exec(route);
    if (employeeMatch && req.method === 'PUT') {
      const id = Number(employeeMatch[1]);
      const old = db.prepare("SELECT * FROM users WHERE id=? AND role='employee'").get(id);
      if (!old) fail(404, 'Employee not found.');
      const input = await body(req, 30_000); validateEmployeeInput(input, false);
      const email = input.email.trim().toLowerCase();
      if (db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email, id)) fail(409, 'Email is already in use.');
      if (input.password && input.password.length < 12) fail(400, 'New password must have at least 12 characters.');
      db.prepare(`UPDATE users SET name=?,email=?,schedule_start=?,schedule_end=?,workdays=?,grace_minutes=?,active=?,password_hash=? WHERE id=?`)
        .run(input.name.trim(), email, input.scheduleStart, input.scheduleEnd, JSON.stringify(input.workdays), input.graceMinutes,
          input.active ? 1 : 0, input.password ? passwordHash(input.password) : old.password_hash, id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      activeSessions.clear();
      audit(admin.id, 'employee_update', 'user', id, { before: userView(old), after: userView(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
      return json(res, 200, { employee: userView(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
    }
    if (route === '/api/admin/attendance' && req.method === 'GET') {
      const { from, to } = dateRange(url);
      const userId = url.searchParams.get('employeeId') ? Number(url.searchParams.get('employeeId')) : null;
      const overtime = db.prepare('SELECT * FROM overtime WHERE work_date BETWEEN ? AND ?').all(from, to);
      return json(res, 200, { punches: punchRows(from, to, userId), overtime, range: { from, to } });
    }
    if (route === '/api/admin/attendance' && req.method === 'POST') {
      const input = await body(req, 30_000);
      const target = db.prepare("SELECT * FROM users WHERE id=? AND role='employee'").get(Number(input.employeeId));
      if (!target) fail(404, 'Employee not found.');
      if (!safeDate(input.workDate)) fail(400, 'Valid work date is required.');
      const reason = String(input.reason || '').trim();
      if (reason.length < 5 || reason.length > 300) fail(400, 'Reason must have 5–300 characters.');
      const entries = [];
      if (input.timeIn) entries.push({ slot: 'IN', time: localTimeToUtc(input.workDate, input.timeIn) });
      if (input.timeOut) entries.push({ slot: 'OUT', time: localTimeToUtc(input.workDate, input.timeOut) });
      const ot = input.overtimeMinutes === '' || input.overtimeMinutes == null ? null : Number(input.overtimeMinutes);
      if (ot !== null && (!Number.isInteger(ot) || ot < 0 || ot > 1440)) fail(400, 'Overtime must be 0–1440 minutes.');
      if (!entries.length && ot === null) fail(400, 'Enter a Time In, Time Out, or overtime.');
      const existingIn = db.prepare("SELECT time_utc FROM punches WHERE user_id=? AND work_date=? AND slot='IN' AND active=1").get(target.id, input.workDate);
      const existingOut = db.prepare("SELECT time_utc FROM punches WHERE user_id=? AND work_date=? AND slot='OUT' AND active=1").get(target.id, input.workDate);
      const finalIn = entries.find(e => e.slot === 'IN')?.time || existingIn?.time_utc;
      const finalOut = entries.find(e => e.slot === 'OUT')?.time || existingOut?.time_utc;
      if (finalOut && !finalIn) fail(400, 'Time In is required before Time Out.');
      if (finalIn && finalOut && Date.parse(finalOut) <= Date.parse(finalIn)) fail(400, 'Time Out must be after Time In.');
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const entry of entries) {
          const old = db.prepare('SELECT * FROM punches WHERE user_id=? AND work_date=? AND slot=? AND active=1').get(target.id, input.workDate, entry.slot);
          if (old && !input.replaceExisting) fail(409, `${entry.slot} exists. Tick Replace existing to preserve it and create a correction.`);
          if (old) {
            db.prepare('UPDATE punches SET active=0 WHERE id=?').run(old.id);
            audit(admin.id, 'punch_replaced', 'punch', old.id, { reason, replacementTime: entry.time });
          }
          const result = db.prepare(`INSERT INTO punches(user_id,work_date,slot,method,time_utc,submitted_at,note,verification,created_by)
            VALUES(?,?,?,'ADMIN',?,? ,?,'APPROVED',?)`).run(target.id, input.workDate, entry.slot, entry.time, now(), reason, admin.id);
          audit(admin.id, 'admin_punch_create', 'punch', result.lastInsertRowid, { reason, slot: entry.slot });
        }
        if (ot !== null) {
          db.prepare(`INSERT INTO overtime(user_id,work_date,minutes,note,set_by,updated_at) VALUES(?,?,?,?,?,?)
            ON CONFLICT(user_id,work_date) DO UPDATE SET minutes=excluded.minutes,note=excluded.note,set_by=excluded.set_by,updated_at=excluded.updated_at`)
            .run(target.id, input.workDate, ot, reason, admin.id, now());
          audit(admin.id, 'overtime_set', 'overtime', `${target.id}:${input.workDate}`, { minutes: ot, reason });
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 201, { ok: true });
    }
    const verifyMatch = /^\/api\/admin\/punches\/(\d+)\/verify$/.exec(route);
    if (verifyMatch && req.method === 'POST') {
      const input = await body(req, 20_000);
      if (!['APPROVED', 'REJECTED'].includes(input.verification)) fail(400, 'Choose Approve or Reject.');
      const reason = String(input.reason || '').trim();
      if (input.verification === 'REJECTED' && reason.length < 5) fail(400, 'A rejection reason is required.');
      const punch = db.prepare('SELECT * FROM punches WHERE id=? AND active=1').get(Number(verifyMatch[1]));
      if (!punch) fail(404, 'Punch not found.');
      if (punch.method !== 'OFFSITE') fail(400, 'Only offsite punches need verification.');
      db.prepare('UPDATE punches SET verification=?,rejection_reason=?,reviewed_by=?,reviewed_at=? WHERE id=?')
        .run(input.verification, input.verification === 'REJECTED' ? reason : null, admin.id, now(), punch.id);
      audit(admin.id, 'offsite_verify', 'punch', punch.id, { verification: input.verification, reason });
      return json(res, 200, { ok: true });
    }
    if (route === '/api/admin/audit' && req.method === 'GET') {
      return json(res, 200, { items: db.prepare(`SELECT a.*,u.name AS actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100`).all() });
    }
  }
  fail(404, 'Not found.');
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
function staticFile(req, res, url) {
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  if (relative.includes('..') || relative.includes('\\') || path.isAbsolute(relative)) fail(404, 'Not found.');
  const file = path.join(publicDir, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(404, 'Not found.');
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': ['.html', '.js', '.css', '.webmanifest'].includes(path.extname(file)) ? 'no-cache' : 'public, max-age=3600' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET') fail(405, 'Method not allowed.');
    return staticFile(req, res, url);
  } catch (error) {
    if (res.headersSent) return res.destroy();
    const status = error.status || (error.code?.startsWith('SQLITE_CONSTRAINT') ? 409 : 500);
    if (status === 500) console.error(error);
    return json(res, status, { error: status === 500 ? 'Server error.' : error.message });
  }
});

if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!validEmail(email) || !password || password.length < 12) {
    console.error('First run: set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) to create the initial admin.');
    process.exit(1);
  }
  const result = db.prepare("INSERT INTO users(name,email,password_hash,role,created_at) VALUES(?,?,?,'admin',?)")
    .run(process.env.ADMIN_NAME?.trim() || 'Administrator', email, passwordHash(password), now());
  audit(result.lastInsertRowid, 'admin_bootstrap', 'user', result.lastInsertRowid);
  console.log(`Initial admin created: ${email}`);
}
db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now());
const port = Number(process.env.PORT || 3000);
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Onsite DTR PWA: http://${process.env.HOST || '127.0.0.1'}:${port}`));
