import test from 'node:test';
import assert from 'node:assert/strict';
import { appHarness } from './helpers/appHarness.js';

function captureApp() {
  const app = appHarness();
  app.state.session = { today: '2026-10-19', user: { id: 'worker', name: 'Juan Dela Cruz', role: 'employee' },
    settings: { holidays: [], maxAccuracyM: 100, configured: true, siteLat: 14.5, siteLng: 121, radiusM: 100, siteName: 'Office' } };
  return app;
}

test('attendance review shows photo, work date and time, with Retake and Proceed', () => {
  const app = captureApp(), c = app.newCapture('IN', { latitude: 14.5, longitude: 121, accuracyM: 10 });
  c.selfie = 'data:image/jpeg;base64,preview'; c.previewAt = '2026-10-19T00:00:00.000Z';
  app.state.capture = c;
  const html = app.renderCapture();
  assert.ok(html.includes('alt="Time In photo preview"'));
  assert.ok(html.includes('Juan Dela Cruz'));
  assert.match(html, /8:00\s*AM/);
  assert.ok(html.includes('Retake photo'));
  assert.ok(html.includes('>Proceed</button>'));
  assert.ok(!/Open camera|Device camera fallback|camera-start|camera-snap|<video/.test(html));
  assert.equal(app.captureReady(), true);
});

test('Proceed stays unavailable without a photo, valid GPS, or while work is in progress', () => {
  const app = captureApp(), c = app.newCapture('IN');
  app.state.capture = c;
  assert.equal(app.captureReady(), false);
  c.selfie = 'photo'; assert.equal(app.captureReady(), false);
  c.location = { accuracyM: 101 }; assert.equal(app.captureReady(), false);
  c.location.accuracyM = 100; assert.equal(app.captureReady(), true);
  for (const flag of ['cameraOpen', 'photoProcessing', 'locationPending', 'locationError', 'submitting']) {
    c[flag] = flag === 'locationError' ? 'Location denied' : true;
    assert.equal(app.captureReady(), false, flag);
    assert.match(app.renderCapture(), /data-action="submit-punch" disabled/);
    c[flag] = flag === 'locationError' ? '' : false;
  }
});

test('Time Out review preserves the overnight starting work date and original attendance', () => {
  const app = captureApp(), first = { id: 'in', slot: 'IN', workDate: '2026-10-18', timeUtc: '2026-10-18T00:00:00Z' };
  app.state.employeeData.openShift = { workDate: '2026-10-18', inPunch: first, extension: null };
  const c = app.newCapture('OUT'); app.state.capture = c;
  assert.equal(c.workDate, '2026-10-18');
  assert.ok(app.renderCapture().includes('Time Out'));
  assert.equal(app.state.employeeData.openShift.inPunch, first);
  assert.equal(app.captureReady(), false);
});
