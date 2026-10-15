import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('employee, admin, GPS, selfie, verification and backfill flow', { timeout: 30000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onsite-dtr-test-'));
  const port = 34000 + crypto.randomInt(10000);
  const adminEmail = 'admin@example.test', adminPassword = `A!${crypto.randomBytes(12).toString('hex')}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, DTR_DATA_DIR: dataDir, PORT: String(port), ADMIN_EMAIL: adminEmail, ADMIN_PASSWORD: adminPassword }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stderr.on('data', data => { logs += data.toString(); });
  const base = `http://127.0.0.1:${port}`;
  async function request(url, { method = 'GET', input, cookie } = {}) {
    const response = await fetch(base + url, { method, headers: { ...(input ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: input ? JSON.stringify(input) : undefined });
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
    return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  try {
    let ready = false;
    for (let n = 0; n < 100; n++) {
      if (child.exitCode !== null) throw new Error(`Server exited: ${logs}`);
      try { await request('/manifest.webmanifest'); ready = true; break; } catch { await pause(100); }
    }
    assert.ok(ready, `Server did not start: ${logs}`);
    assert.equal((await request('/api/session')).response.status, 401);
    const adminLogin = await request('/api/login', { method: 'POST', input: { email: adminEmail, password: adminPassword, remember: true } });
    assert.equal(adminLogin.response.status, 200);
    const adminCookie = adminLogin.cookie;
    assert.ok(adminCookie?.startsWith('dtr_session='));

    const settings = await request('/api/admin/settings', { method: 'PUT', cookie: adminCookie, input: { siteName: 'Main Office', siteLat: 14.6, siteLng: 121, radiusM: 150, maxAccuracyM: 100, cutoffDays: [11, 26] } });
    assert.equal(settings.response.status, 200);
    assert.equal(settings.data.settings.site_version, 2);
    const employeePassword = `E!${crypto.randomBytes(12).toString('hex')}`;
    const created = await request('/api/admin/employees', { method: 'POST', cookie: adminCookie, input: { name: 'Test Employee', email: 'employee@example.test', password: employeePassword, scheduleStart: '08:30', scheduleEnd: '17:30', workdays: [1,2,3,4,5,6], graceMinutes: 5 } });
    assert.equal(created.response.status, 201);
    const employeeId = created.data.employee.id;
    const login = await request('/api/login', { method: 'POST', input: { email: 'employee@example.test', password: employeePassword, remember: false } });
    assert.equal(login.response.status, 200);
    const employeeCookie = login.cookie;
    assert.equal((await request('/api/admin/settings', { cookie: employeeCookie })).response.status, 403);
    const session = await request('/api/session', { cookie: employeeCookie });
    const date = session.data.today;
    const selfie = `data:image/png;base64,${fs.readFileSync(path.join(root, 'public', 'icon-192.png')).toString('base64')}`;
    const outside = await request('/api/punch', { method: 'POST', cookie: employeeCookie, input: { slot: 'IN', method: 'ONSITE', latitude: 14.61, longitude: 121, accuracyM: 10, selfie } });
    assert.equal(outside.response.status, 403);
    const withoutSelfie = await request('/api/punch', { method: 'POST', cookie: employeeCookie, input: { slot: 'IN', method: 'ONSITE', latitude: 14.6, longitude: 121, accuracyM: 10 } });
    assert.equal(withoutSelfie.response.status, 400);
    const timeIn = await request('/api/punch', { method: 'POST', cookie: employeeCookie, input: { slot: 'IN', method: 'ONSITE', latitude: 14.6, longitude: 121, accuracyM: 10, selfie } });
    assert.equal(timeIn.response.status, 201);
    assert.equal(timeIn.data.punch.verification, 'APPROVED');
    assert.equal(timeIn.data.punch.hasSelfie, true);
    assert.equal((await request('/api/punch', { method: 'POST', cookie: employeeCookie, input: { slot: 'IN', method: 'ONSITE', latitude: 14.6, longitude: 121, accuracyM: 10, selfie } })).response.status, 409);
    assert.equal((await request('/api/punch', { method: 'POST', cookie: employeeCookie, input: { slot: 'OUT', method: 'OFFSITE', latitude: 14.61, longitude: 121, accuracyM: 10, note: 'Client visit' } })).response.status, 400);
    await pause(20);
    const timeOut = await request('/api/punch', { method: 'POST', cookie: employeeCookie, input: { slot: 'OUT', method: 'OFFSITE', latitude: 14.61, longitude: 121, accuracyM: 10, selfie, note: 'Client visit' } });
    assert.equal(timeOut.response.status, 201);
    assert.equal(timeOut.data.punch.verification, 'PENDING');
    const verify = await request(`/api/admin/punches/${timeOut.data.punch.id}/verify`, { method: 'POST', cookie: adminCookie, input: { verification: 'APPROVED' } });
    assert.equal(verify.response.status, 200);
    const records = await request(`/api/admin/attendance?from=${date}&to=${date}`, { cookie: adminCookie });
    assert.equal(records.data.punches.length, 2);
    assert.equal(records.data.punches.find(p => p.slot === 'OUT').verification, 'APPROVED');

    const prior = new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const backfill = await request('/api/admin/attendance', { method: 'POST', cookie: adminCookie, input: { employeeId, workDate: prior, timeIn: '08:31', timeOut: '17:30', overtimeMinutes: 60, reason: 'No mobile signal at field site' } });
    assert.equal(backfill.response.status, 201);
    const history = await request(`/api/attendance?from=${prior}&to=${date}`, { cookie: employeeCookie });
    assert.equal(history.data.punches.filter(p => p.method === 'ADMIN').length, 2);
    assert.equal(history.data.overtime[0].minutes, 60);
    const photo = await request(`/api/selfie/${timeIn.data.punch.id}`, { cookie: employeeCookie });
    assert.equal(photo.response.status, 200);
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
