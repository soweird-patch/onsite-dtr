# Regular hours, overtime, and night differential

The DTR records hours for payroll review; it does not calculate pay rates or deductions. All times use Asia/Manila.

## Actual working hours

Employees sign in with their **username and password**. Admins set usernames and planned schedules in Employees; admin login uses email. Existing employee accounts receive a unique username based on their name, while passwords and attendance remain intact.

Employees can clock in between **6:00 AM and 5:00 PM**, inclusive. Admins can record exceptional work outside that window.

The first **480 actual working minutes from 6:00 AM up to 10:00 PM** in the workday are regular time. The company **12:00-1:00 PM unpaid lunch** and gaps between recorded intervals are excluded. Overlapping intervals never count twice. Less than 480 minutes creates undertime; additional working minutes **up to 10:00 PM** are pending OT, including time before 5:00 PM. OT stops at 10:00 PM; later time is not added to OT. Night-window time is recorded **only as night differential**: it never fills regular shortage or earns OT. Night differential counts actual work from **10:00 PM to 6:00 AM**, including exceptional work before 6:00 AM on the work date. A workday closes no later than 6:00 AM the next day.

For example, 7:40 AM to 4:50 PM, excluding lunch, gives **8 regular hours and 10 minutes pending OT**. Expected Time Out is **4:40 PM**. A 7:00 AM arrival completes at 4:00 PM after lunch; staying to 5:00 PM creates one hour of pending OT. A 4:00 PM arrival can earn at most 6 regular hours before 10:00 PM; later night work is recorded separately. Expected Time Out accounts for completed daytime intervals and projects the rest assuming no further unpaid gaps. It is shown only if the eight regular hours can be completed by 10:00 PM.

## Returning to work in another interval

Multiple Time In/Time Out intervals belong to one work date. A later interval before 10:00 PM first fills the remaining regular-hour shortage. Only its remaining minutes become pending OT. A night interval from 10:00 PM to 6:00 AM counts solely toward pending night differential, even when regular time is still short. An interval crossing 10:00 PM is split at the boundary.

Example: 8:00 AM-3:00 PM gives 6 regular hours after lunch. Returning from 5:00-8:00 PM adds 2 regular hours to complete eight, plus 1 pending OT hour. A third interval from 10:00 PM-midnight adds 2 pending night differential hours. If the second daytime interval is absent, those night hours leave the regular shortage at 2 hours.

The admin editor previews each interval's regular hours, contribution to the regular shortage, calculated OT, night differential, and remaining shortage. The preview updates when times or next-day flags change. The approval screen shows the same interval allocation. Saving an interval recalculates payroll and the PDF summary with the same rules.

## Schedule and attendance edits

When editing an employee, choose **Apply schedule from** (today by default, or an earlier date). Saving updates all active attendance intervals on that date and later dates, including today's open shift, in the same transaction. Actual hours are recalculated using the shared rules. Scheduled start/end times are planning metadata; they do not truncate actual work. Original punch timestamps, selfies, GPS, and verification remain intact. Sources identify who supplied each time: **Employee · Onsite**, **Employee · Offsite**, or **Admin** for a manually created or corrected time. Field assignments and admin verification do not change an employee punch into an admin punch. If the admin edits only Time Out, only Time Out shows Admin. Each schedule adjustment records the previous and new schedule in the audit log. A schedule-only edit keeps the employee signed in.

In **Add attendance**, select an employee and work date to load active punches. Each interval has its own **Reason** and **Field Assignment**. Reason and Field Assignment are both optional and limited to 300 characters each. New intervals, time corrections, and admin review or rejection can be saved without a reason; the admin actor, timestamps, and changes are still audited. Changing interval details is audited and preserves the original proof. Editing a time retires the old active punch and creates an admin correction, keeping the original record. Add another interval for a return to work; the intervening gap is unpaid.

## Review before payroll

Saving Time Out, correcting intervals, applying schedule edits, and approving a workday synchronize pending premiums. Opening Records or Reports also synchronizes older records, including night-only work. Existing reviews from the former calculation rules return to pending once.

The admin approves the complete daily attendance first, then reviews calculated **OT** and **Night differential** independently. Both can be approved or rejected, with optional audit reasons. Rejecting attendance proof excludes its workday from payroll. OT rejection does not automatically reject night differential. The first eight actual daytime working hours, including top-ups from later intervals, become regular time automatically; the former OT-to-regular transfer stage is no longer needed.

Approvals are bound to the exact intervals and saved schedule. Changes reopen affected premium reviews and clear their previous review details while retaining the audit history. An open review form cannot approve a changed calculation. Pending, rejected, stale, and legacy manual OT grants do not enter premium payroll totals. An unchanged synchronization does not reset an approval. Changes to interval notes alone preserve approvals because the worked time is unchanged.

Attendance, approval screens, and reports receive live changes from Convex.

## PDF report

**Print / Save PDF** includes the attendance summary followed by a **Reasons and Field Assignments** table with **Date, Time In, Time Out, Reason, Field Assignment**. Every annotated interval appears, including pending and incomplete records; missing times display a dash. Older punch notes also appear, and punches with different notes are listed separately so neither note is lost. Text wraps, headers repeat across pages, and rows stay together. The attendance summary identifies employee/admin sources separately for Time In and Time Out. OT and night differential show approved amounts with a separate pending-hours label, so calculated hours remain visible before approval. Pending hours are excluded from payroll totals. Approved totals use the same calculation and approval checks as the review workflow.
