import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as rules from '../../rules.js';
import { attendanceDetails } from '../../src/reportDetails.js';

// Exercise the actual UI renderers without connecting to a deployed database.
export function appHarness() {
  const source = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '')
    .replace('import.meta.env.VITE_CONVEX_URL', 'null')
    .split('\nawait loadBranding();')[0];
  const context = vm.createContext({ ...rules, attendanceDetails, functions: {}, console,
    openFrontCamera: async () => null, closeFrontCamera() {},
    URL, URLSearchParams, Intl, Date, setInterval() {}, clearTimeout() {}, setTimeout() {},
    document: { getElementById() { return {}; }, addEventListener() {} },
    window: { addEventListener() {}, matchMedia() { return { matches: false }; } },
    navigator: {}, localStorage: { getItem() { return ''; } }, sessionStorage: { getItem() { return ''; } }
  });
  vm.runInContext(`${source}\nglobalThis.app = { state, renderReportEmployee, renderReport, reportRows, renderBackfill, renderEmployees, renderEmployeeForm, renderPremiumQueue, employeeAttendanceDayCardSegments, renderCapture, newCapture, captureReady };`, context);
  return context.app;
}
