# Regular hours, overtime, and night differential

The DTR records hours for payroll review; it does not calculate pay rates or deductions. All times use Asia/Manila.

## Actual working hours

Employees can clock in between **6:00 AM and 4:00 PM**, inclusive. Admins can record exceptional work outside that window.

The first **480 actual working minutes** in the workday are regular time. The company **12:00-1:00 PM unpaid lunch** and gaps between recorded intervals are excluded. Overlapping intervals never count twice. Less than 480 minutes creates undertime; every additional working minute is pending OT, including time before 5:00 PM and time worked overnight. Night differential independently counts actual work from **10:00 PM to 6:00 AM**, including exceptional work before 6:00 AM on the work date. A workday closes no later than 6:00 AM the next day.

For example, 7:40 AM to 4:50 PM, excluding lunch, gives **8 regular hours and 10 minutes pending OT**. Expected Time Out is **4:40 PM**. A 4:00 PM arrival with no further breaks completes eight hours at midnight. Expected Time Out accounts for completed intervals and projects the rest assuming no further unpaid gaps.

## Schedule and attendance edits

When editing an employee, choose **Apply schedule from** (today by default, or an earlier date). Saving updates all active attendance intervals on that date and later dates, including today's open shift, in the same transaction. Actual hours are recalculated using the shared rules. Scheduled start/end times are planning metadata; they do not truncate actual work. Original punch timestamps, selfies, GPS, and verification remain intact. Each schedule adjustment records the previous and new schedule in the audit log. A schedule-only edit keeps the employee signed in.

In **Add attendance**, select an employee and work date to load active punches. Each interval has its own **Reason** and **Field Assignment**. A reason of 5-300 characters is required for new or adjusted times; Field Assignment is optional and limited to 300 characters. Changing interval details is audited and preserves the original proof. Editing a time retires the old active punch and creates an admin correction, keeping the original record. Add another interval for a return to work; the intervening gap is unpaid.

## Review before payroll

Saving Time Out, correcting intervals, applying schedule edits, and approving a workday synchronize pending premiums. Opening Records or Reports also synchronizes older records, including night-only work. Existing reviews from the former calculation rules return to pending once.

The admin approves the complete daily attendance first, then reviews calculated **OT** and **Night differential** independently. Both can be approved or rejected, with optional audit reasons. Rejecting attendance proof excludes its workday from payroll. OT rejection does not automatically reject night differential. The first eight actual working hours become regular time automatically; the former OT-to-regular transfer stage is no longer needed.

Approvals are bound to the exact intervals and saved schedule. Changes reopen affected premium reviews and clear their previous review details while retaining the audit history. An open review form cannot approve a changed calculation. Pending, rejected, stale, and legacy manual OT grants do not enter premium payroll totals. An unchanged synchronization does not reset an approval. Changes to interval notes alone preserve approvals because the worked time is unchanged.

Attendance, approval screens, and reports receive live changes from Convex.

## PDF report

**Print / Save PDF** includes the attendance summary followed by a **Reasons and Field Assignments** table with **Date, Time In, Time Out, Reason, Field Assignment**. Every annotated interval appears, including pending and incomplete records; missing times display a dash. Older punch notes also appear, and punches with different notes are listed separately so neither note is lost. Text wraps, headers repeat across pages, and rows stay together. Approved totals use the same calculation and approval checks as the review workflow.
