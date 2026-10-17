# Regular, overtime, and Differential hours

This is the DTR's recording and approval workflow. It records time for payroll review; it does not calculate pay rates or deductions. All clock times below use Asia/Manila.

## One shift, three windows

| Window | Recorded rule | Approval |
| --- | --- | --- |
| Assigned Standard or Custom schedule | Up to 8 actual regular hours. The 12:00–1:00 PM unpaid break and gaps between punch intervals do not count. | Admin approves the complete daily attendance before it enters payroll. |
| 5:00–10:00 PM outside the assigned schedule | Actual OT is calculated without duplicating scheduled regular minutes. The system reserves only the amount needed to complete 8 regular hours, then shows the remaining OT. | Admin separately approves the regular-time adjustment and the remaining OT. |
| After 10:00 PM–6:00 AM | The worked portion is also recorded separately as Night differential. | Admin reviews Night differential after overtime is approved. |

## Employee flow

1. Time In as usual with selfie and GPS. The shift belongs to that work date even when it crosses midnight.
2. Time Out automatically creates a review when eligible work exists in the 5:00–10:00 PM window. No separate overtime button is needed.
3. Finish with **Time Out**, which still needs a selfie and GPS. The saved server Time Out determines the exact automatic OT and Night differential candidates; an incomplete day does not enter payroll.
4. Attendance history always shows the actual punch times, calculated candidate minutes, and each approval state. A 5:13 PM exit creates 13 minutes of pending overtime.

## Admin flow

1. In **Records**, inspect the offsite Time In and Time Out proof and approve or reject each offsite punch.
2. In **Overtime & Differential review**, first approve or reject the proposed OT-to-regular transfer, then separately approve or reject the remaining OT. A reason is optional and saved in the audit trail. Approval requires all punch proofs to be approved.
3. If Night differential minutes exist after 10:00 PM, approve or reject them separately. Night differential approval requires overtime approval. Rejecting a punch or overtime removes that premium credit.
4. In **Add attendance**, selecting an employee and work date loads that day's active punches into editable fields. Unchanged times keep their original selfie, GPS, and verification. An edited time becomes an audited admin correction. Use **Add another Time In / Time Out** when the employee returns to work after an earlier Time Out; mark an overnight punch as next day and any new field interval as offsite. The gaps between intervals are excluded from worked hours. A reason is required, while selfie and GPS are optional for admin-created punches.
5. **Reports** prints or saves a PDF for the selected cutoff. Each employee has dated actual punches, regular hours, late and undertime, granted overtime and Differential, review states, and totals. Pending and denied premium minutes are excluded from granted totals; the exceptions remain visible for review.

Corrections retain the old punch in the audit history and reset extra-hour approvals. Existing administrator-entered overtime from the previous version remains visible as already granted in reports.
