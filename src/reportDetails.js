import { groupPunches } from '../rules.js';

// Legacy notes are included so older field records also appear in PDF reports.
export function attendanceDetails(rows) {
  const details = [];
  const metadata = punch => ({ reason: punch?.reason ?? punch?.note ?? '',
    fieldAssignment: punch?.fieldAssignment || '' });
  for (const row of rows) {
    for (const { inPunch, outPunch } of groupPunches(row.punches)) {
      const first = metadata(inPunch), last = metadata(outPunch);
      const same = !inPunch || !outPunch ||
        (first.reason === last.reason && first.fieldAssignment === last.fieldAssignment);
      if (same) {
        const info = inPunch ? first : last;
        if (info.reason || info.fieldAssignment)
          details.push({ date: row.date, inUtc: inPunch?.timeUtc, outUtc: outPunch?.timeUtc,
            punches: [inPunch, outPunch].filter(Boolean), ...info });
      } else {
        for (const punch of [inPunch, outPunch].filter(Boolean)) {
          const info = metadata(punch);
          if (info.reason || info.fieldAssignment) details.push({ date: row.date,
            inUtc: punch.slot === 'IN' ? punch.timeUtc : null,
            outUtc: punch.slot === 'OUT' ? punch.timeUtc : null, punches: [punch], ...info });
        }
      }
    }
  }
  return details;
}
