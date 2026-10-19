# Regular hours, overtime, and night differential

The DTR records hours for payroll review; it does not calculate pay rates or deductions. All times use Asia/Manila.

## Employee time clock

Tap **Time In** or **Time Out** to open the front camera directly in the app. Allow camera access, tap **Take photo**, then review the photo, work date, time preview, and onsite/offsite status. The camera request requires the front lens; if it is unavailable or permission is denied, the screen explains how to retry. **Retake photo** replaces the picture; canceling a retake keeps the existing picture. **Proceed** becomes available after the photo and GPS check are ready. It refreshes GPS and uploads the proof with the punch, then confirms the official time recorded by Convex. Canceling before Proceed does not save attendance. Failed uploads keep the photo for another attempt, and repeated taps cannot submit a second punch while a save is in progress. The camera stops after taking a photo, canceling, or leaving the app.

## Actual working hours

Employees sign in with their **username and password**. Admins set usernames and planned schedules in Employees; admin login uses email. Existing employee accounts receive a unique username based on their name, while passwords and attendance remain intact.

Employees can clock in between **6:00 AM and 5:00 PM**, inclusive. Admins can record exceptional work outside that window.

The first **480 actual working minutes from 6:00 AM up to 10:00 PM** in the workday are regular time. The company **12:00-1:00 PM unpaid lunch** and gaps between recorded intervals are excluded. Overlapping intervals never count twice. Less than 480 minutes creates undertime; additional daytime working minutes **up to 10:00 PM** are remaining OT, including time before 5:00 PM. Night differential counts actual work from **10:00 PM to 6:00 AM**, including exceptional work before 6:00 AM on the work date. A workday closes no later than 6:00 AM the next day.

**OT total = remaining daytime OT + ND**, after daytime work has filled as much of the eight-hour regular requirement as possible. ND is never transferred into regular time or used to offset undertime. It remains intact in the OT total even if daytime OT is zero and regular hours are still short. The ND column identifies the night portion already included in that total. For payroll, each component enters the combined total only after its own admin approval.

For example, 7:40 AM to 4:50 PM, excluding lunch, gives **8 regular hours and 10 minutes pending OT**. Expected Time Out is **4:40 PM**. A 7:00 AM arrival completes at 4:00 PM after lunch; staying to 5:00 PM creates one hour of pending OT. A 4:00 PM arrival can earn at most 6 regular hours before 10:00 PM; later night work is recorded separately. Expected Time Out accounts for completed daytime intervals and projects the rest assuming no further unpaid gaps. It is shown only if the eight regular hours can be completed by 10:00 PM.

## Returning to work in another interval

Multiple Time In/Time Out intervals belong to one work date. A later interval before 10:00 PM first fills the remaining regular-hour shortage. Its remaining minutes become pending daytime OT. A night interval from 10:00 PM to 6:00 AM retains its full ND contribution and adds it to the OT total, even when regular time is still short. An interval crossing 10:00 PM is split at the boundary.

Example: 8:00 AM-3:00 PM gives 6 regular hours after lunch. Returning from 5:00-8:00 PM adds 2 regular hours to complete eight, plus 1 pending daytime OT hour. A third interval from 10:00 PM-midnight adds 2 pending ND hours, making **3 hours of total OT**, including the 2 ND hours. If the second daytime interval is absent, total OT is 2 hours and regular shortage remains 2 hours.

Ten-minute shortage example: 8:10 AM-3:00 PM gives 5h 50m regular after lunch. A second interval from 8:00 PM-midnight contributes 2 regular hours before 10:00 PM and 2 ND hours afterward. The day has **7h 50m regular, 10m undertime, 0 remaining daytime OT, and 2h ND**. After ND approval, **OT total is 2h**; the 10-minute undertime remains.

The admin editor previews each interval's regular hours, contribution to the regular shortage, calculated OT, night differential, and remaining shortage. The preview updates when times change. The approval screen shows the same interval allocation. Saving an interval recalculates payroll and the PDF summary with the same rules.

## Overnight work dates

Select the date the shift started. Midnight through **6:00 AM the next day** remains part of that work date, including across a month, year, or payroll cutoff. For example, October 25 at 10:00 PM through October 26 at 6:00 AM records eight pending ND hours against **October 25**. It does not create a second attendance day on October 26.

The admin editor automatically resolves a Time Out earlier than Time In to the next calendar day and resolves a later interval starting after midnight after the preceding interval. No after-midnight checkbox is needed. The admin editor shows actual Time In/Out dates. Attendance, review confirmations, and PDF reports show plain clock times without a next-day suffix, while the work remains assigned to the starting work date. Adjacent intervals may share a boundary, such as a midnight Time Out followed by a midnight Time In, without counting a minute twice. Next-day times after 6:00 AM and overlapping intervals are rejected. Employee Time Out at midnight or exactly 6:00 AM also closes the previous open workday. Saving unchanged overnight times preserves the existing punches and premium approvals.

## Schedule and attendance edits

When editing an employee, choose **Apply schedule from** (today by default, or an earlier date). Saving updates all active attendance intervals on that date and later dates, including today's open shift, in the same transaction. Actual hours are recalculated using the shared rules. Scheduled start/end times are planning metadata; they do not truncate actual work. Original punch timestamps, selfies, GPS, and verification remain intact. Sources identify who supplied each time: **Employee · Onsite**, **Employee · Offsite**, or **Admin** for a manually created or corrected time. Field assignments and admin verification do not change an employee punch into an admin punch. If the admin edits only Time Out, only Time Out shows Admin. Each schedule adjustment records the previous and new schedule in the audit log. A schedule-only edit keeps the employee signed in.

In **Add attendance**, select an employee and work date to load active punches. Each interval has its own **Reason** and **Field Assignment**. Reason and Field Assignment are both optional and limited to 300 characters each. New intervals, time corrections, and admin review or rejection can be saved without a reason; the admin actor, timestamps, and changes are still audited. Changing interval details is audited and preserves the original proof. Editing a time retires the old active punch and creates an admin correction, keeping the original record. Add another interval for a return to work; the intervening gap is unpaid.

## Review before payroll

Saving Time Out, correcting intervals, applying schedule edits, and approving a workday synchronize pending premiums. Opening Records or Reports also synchronizes older records, including night-only work. Existing reviews from the former calculation rules return to pending once.

The admin approves the complete daily attendance first, then reviews calculated **remaining daytime OT** and **Night differential** independently. Both can be approved or rejected, with optional audit reasons. Rejecting attendance proof excludes its workday from payroll. OT rejection does not automatically reject night differential. Approved ND remains in the combined OT total when daytime OT is pending, rejected, or zero. The first eight actual daytime working hours, including top-ups from later intervals, become regular time automatically; the former OT-to-regular transfer stage is no longer needed.

Approvals are bound to the exact intervals and saved schedule. Changes reopen affected premium reviews and clear their previous review details while retaining the audit history. An open review form cannot approve a changed calculation. Pending, rejected, stale, and legacy manual OT grants do not enter premium payroll totals. An unchanged synchronization does not reset an approval. Changes to interval notes alone preserve approvals because the worked time is unchanged.

Attendance, approval screens, and reports receive live changes from Convex. Combining the existing daytime OT and ND components does not reset unchanged approvals; their calculations and separate review decisions are preserved.

## PDF report

**Print / Save PDF** includes the attendance summary followed by a **Reasons and Field Assignments** table with **Day, Date, Time In, Time Out, Status, Reason, Field Assignment**. Every annotated interval appears, including pending and incomplete records; missing times display a dash. Older punch notes also appear, and punches with different notes are listed separately so neither note is lost. Text wraps, headers repeat across pages, and rows stay together. The attendance summary has separate **Day** (full weekday), **Date**, **Source**, and **Status** columns. Source lists Employee, Admin, or System once per workday; Status lists Onsite or Offsite separately, showing both for mixed-location days. Admin entries use their saved onsite/offsite assignment; records without a known location show a dash. The details table uses the same Day, Date, and Status layout for each annotated interval. **Overtime** shows approved remaining daytime OT plus approved ND. The ND column is the night portion already included in OT total. Pending OT includes pending ND; pending amounts remain excluded from payroll. Regular hours and undertime are unchanged by adding ND to OT total. Approved totals use the same calculation and approval checks as the review workflow.
