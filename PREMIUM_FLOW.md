# Regular, overtime, and Differential hours

This is the DTR's recording and approval workflow. It records time for payroll review; it does not calculate pay rates or deductions. All clock times below use Asia/Manila.

## One shift, three windows

| Window | Recorded rule | Approval |
| --- | --- | --- |
| 8:00 AM–5:00 PM | Up to 9 regular hours; the break is included. A Time Out before 5:00 PM creates undertime. | Actual Time In/Out and proof status remain visible. |
| 5:00–10:00 PM | Offsite overtime starts when the employee taps **Continue overtime**. The counted interval begins no earlier than that tap. Less than 60 minutes is regular-day exit only. | Admin grants or denies eligible overtime after reviewing offsite punch proof. |
| 10:00 PM–6:00 AM | Differential is recorded separately and never counts toward the eight regular hours. | Early Differential is included when the daily attendance is approved. Differential attached to an offsite continuation is reviewed after overtime is granted. |

## Employee flow

1. Time In as usual with selfie and GPS. The shift belongs to that work date even when it crosses midnight.
2. From 5:00 to 10:00 PM, when still working offsite, tap **Continue overtime**. The app captures current GPS with one tap and schedules a 6:00 AM cutoff. This is a request, not an automatic payroll grant.
3. Finish with **Time Out offsite**, which still needs selfie, GPS, and the field assignment. If no Time Out arrives, the server makes a clearly marked **SYSTEM** Time Out at 6:00 AM. That automatic exit has no exit selfie or GPS; the continuation GPS and earlier punch proof remain available.
4. Attendance history always shows the actual punch times, calculated candidate minutes, and each approval state. A 5:13 PM exit never becomes credited overtime.

## Admin flow

1. In **Records**, inspect the offsite Time In and Time Out proof and approve or reject each offsite punch.
2. In **Overtime & Differential review**, grant or deny eligible overtime. A reason is optional and saved in the audit trail. Granting requires both punch proofs to be approved.
3. If Differential minutes exist on an offsite continuation, grant or deny them separately. Differential grant requires overtime grant. Rejecting a punch or overtime removes that continuation's premium credit.
4. For a no-signal assignment, **Add attendance** takes employee, work date, In/Out, an offsite checkbox, and a required reason. Check “next day” for an exit after midnight. The app calculates eligible extra hours and opens Records for approval. No manual minute math or selfie is required for admin-created attendance.
5. **Reports** prints or saves a PDF for the selected cutoff. Each employee has dated actual punches, regular hours, late and undertime, granted overtime and Differential, review states, and totals. Pending and denied premium minutes are excluded from granted totals; the exceptions remain visible for review.

Corrections retain the old punch in the audit history and reset extra-hour approvals. Existing administrator-entered overtime from the previous version remains visible as already granted in reports.
