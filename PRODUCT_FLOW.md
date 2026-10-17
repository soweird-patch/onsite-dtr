# Online DTR — product flow and PWA build

## 1. Layunin at saklaw

Mobile-first Daily Time Record (DTR) para sa **employee** at **admin**. Ang employee ay magre-record ng AM time in at PM time out, onsite man o offsite. Ang admin ay magve-verify ng attendance at gagawa ng payroll-ready cutoff report. Bawat attendance event ay may malinaw na pinagmulan at audit trail.

Ang reference UI ay ang ipinadalang dark navy/teal mobile dashboard: greeting sa itaas, malalaking attendance at cutoff cards, at simpleng bottom navigation. Sariling pangalan at branding ang gagamitin; hindi kokopyahin ang logo ng sample.

## 2. Mga kailangang i-set ng admin bago gamitin

1. **Payroll cutoff:** start/end day ng dalawang period bawat buwan (sample mula sa screenshot: 11–25 at 26–10). Inclusive ang dates; dapat tama rin ang period na tumatawid ng buwan o taon.
2. **Work schedule:** Standard 8:00 AM–5:00 PM o Custom start/end per employee; excluded ang 12:00–1:00 PM unpaid break, kasama ang configured workdays at Asia/Manila timezone. Time In ay puwede mula 6:00 AM hanggang 4:00 PM. Ang unang 8 actual working hours ay regular; ang sobra ay pending OT kahit bago 5:00 PM. Schedule changes apply immediately from the chosen effective date and reset affected premium reviews. Tingnan ang [regular at premium workflow](PREMIUM_FLOW.md).
3. **Nag-iisang onsite location:** admin ang magse-set at mag-a-update ng site name/address, GPS pin (latitude/longitude), at allowed radius/geofence. Itatala ang history ng pin/radius changes para hindi maiba ang interpretasyon ng lumang punches.
4. **Employee accounts:** full name, employee ID, status, role, at assigned schedule. Admin ang gagawa at magdi-disable ng account.
5. **Verification policy:** sino ang puwedeng mag-approve ng offsite entries at ilang araw bago ma-lock ang cutoff.

## 3. Employee flow

### A. Login

1. Mag-login gamit ang employee account.
2. May **Remember me** para manatiling naka-sign in sa sariling device; may logout at session expiry. Hindi ise-save ang password bilang plain text.
3. Employee-only access: sariling attendance at cutoff lamang ang makikita.
4. Puwedeng mag-login kahit saan. Ang GPS boundary ay para sa **Onsite Time In/Out**, hindi sa account login o pagtingin ng attendance history.

### B. Home dashboard

1. Greeting, pangalan, kasalukuyang petsa at schedule.
2. **Today's attendance:** AM In / PM Out, exact time, onsite/offsite/admin-created source, at estado (not yet recorded, pending verification, verified, invalid, incomplete).
3. **Current cutoff card:** eksaktong date span, present/absence/late/undertime totals, at link sa detalye. Unang bubukas ang *current cutoff*; may selector para sa nakaraang cutoffs.
4. **“Kamusta ka?” card:** gagawing **Aking Attendance / Previous Attendance**. Tap dito para sa listahan at detalye ng mga dating DTR, naka-group ayon sa cutoff. Makikita ang sariling history at verification status.
5. Primary action: **Time In** kung wala pang AM In; **Time Out** kung may AM In at wala pang PM Out; **View Today** kung kumpleto na. Hindi awtomatikong magse-save ng time in/out dahil lang pumasok sa site.

### C. Onsite time in / out

1. Sa pagbukas ng app, humingi ng location permission at tingnan kung nasa **nag-iisang site radius na itinakda ng admin**. Kung nasa site at wala pang AM In, awtomatikong **ipakita** ang Onsite Time In screen/prompt. Kung may AM In pero walang PM Out, ipakita ang Time Out action.
2. Ipakita ang site name, map pin/accuracy, current time, at selfie capture. **Live selfie at device location** ang requirement para sa employee-submitted punch.
3. Employee ang pipindot ng **Confirm Time In/Out**. Server ang magtatakda ng official timestamp; makikita agad ang saved receipt.
4. I-enable lang ang **Onsite Time In** kapag nasa admin-set radius at pasado ang GPS accuracy. Ang Onsite Time Out ay dapat ding nasa radius; kung nasa field na, gagamitin ang Offsite Time Out. Itatala sa event ang `onsite`, site pin/radius version, coordinates, accuracy, selfie, at capture time. Kung nasa labas ng radius o hindi sapat ang accuracy, ialok ang offsite flow o admin help; hindi tahimik na maglalabel ng onsite.

### D. Offsite / field time in / out

1. Piliin ang **Offsite DTR** at Time In o Time Out. Maglagay ng maikling work location/reason o assignment reference.
2. Obligado ang **live selfie** at **current device location** sa bawat punch. Ipakita ang map pin at accuracy bago i-submit. Hindi sapat ang typed address o lumang image bilang location proof.
3. Pag-submit, itala ang official server time, GPS coordinates, accuracy, selfie, at `offsite` source. Status: **Pending verification** hanggang ma-review ng admin.
4. Hindi mawawala ang entry kapag rejected. Ipapakita ang reason at puwedeng mag-request ng correction sa admin.

### E. Kulang na internet o permission

1. Ipakita nang malinaw kung hindi na-save ang punch; huwag magpakita ng successful receipt kung walang server confirmation.
2. Kung walang internet o hindi makuha ang kinakailangang selfie/location, kontakin ang admin. Puwedeng gumawa ang admin ng attendance backfill na may reason at audit trail.
3. Optional future feature: offline draft/queue na may hiwalay na *device capture time* at *server received time*. Hindi ito ituturing na verified time nang awtomatiko.

## 4. Admin flow (mobile-friendly)

### A. Dashboard

Today counts: present, late, incomplete, offsite pending, at walang record. May searchable/filterable attendance list; puwedeng i-filter sa employee, date, cutoff, source, at verification status.

### B. Gumawa at mag-manage ng account

Create/edit/disable employee; assign employee ID, schedule, at initial login instructions. Sa **Site Settings**, admin ang magpi-pin ng nag-iisang site sa mapa o maglalagay ng latitude/longitude at radius. Hindi buburahin ang lumang attendance kapag disabled ang account o nabago ang site pin.

### C. Tingnan at i-verify ang record

1. Buksan ang attendance row: employee, date, regular window, AM In at PM Out, bawat event's onsite/offsite/admin-created source, timestamp, late/undertime minutes, at current status.
2. Para sa employee punches, makikita ang selfie at map pin kasama ang coordinates, location accuracy, captured time, at site/geofence result. Hiwa-hiwalay ang location ng Time In at Time Out.
3. Sa offsite entry, **Approve** o **Reject with reason**; itala kung sinong admin at kailan nag-review. Puwedeng magkaibang verification status ang in at out. Ang failed proof ay magiging exception, hindi buburahin ang original.

### D. Admin-created attendance / no-internet backfill

1. Piliin ang employee at work date, ilagay ang AM In at/o PM Out, at **required reason** (hal. no signal sa field). Ang source ay laging **Created by admin** para hindi magmukhang GPS-verified employee punch.
2. Para sa offsite backfill, ilagay ang aktuwal na In/Out at piliin kung next day ang Out. Awtomatikong iko-compute ang eligible overtime at Differential; hiwalay na aaprubahan ng admin. Hindi kailangan ng selfie/location para sa admin-created event.
3. Malinaw na label: **Created by admin** sa employee view, admin list, at print/export. Itala ang creator, oras ng pag-create, reason, at history ng anumang edit.
4. Kung may original employee punch sa parehong slot, huwag i-overwrite. Gumawa ng documented correction/replacement na may original record retained.

### E. Cutoff review at payroll print

1. Piliin ang cutoff at employee/all employees. Ipakita ang incomplete, pending verification, rejected, at admin-created exceptions bago i-finalize.
2. Payroll report: app/header, cutoff date span, print date, employee name, per-day actual In/Out source/time, regular hours, late, undertime, granted overtime, Differential, at review status. May totals bawat employee. Below the attendance summary, a paginated table lists Date, Time In, Time Out, Reason, and Field Assignment for every annotated interval.
3. Print-friendly view na maaaring i-save bilang PDF gamit ang browser print dialog. Nasa record detail ang selfie/map proof; hindi ito isinasama sa regular payroll summary.
4. Kapag na-finalize ang cutoff, lock ang edits sa ordinary flow; admin correction lamang na may audit trail at regenerated report version.

## 5. Attendance rules at status

| Sitwasyon | System behavior |
| --- | --- |
| Wala pang AM In | Ipakita ang Time In action. |
| May AM In, wala pang PM Out | Ipakita ang Time Out action; status **Incomplete** hanggang makumpleto. |
| May parehong punches | Status **Present** kung valid; late/undertime ay hiwalay na minutes. |
| Time In mula 6:00 AM hanggang 4:00 PM | Flexible arrival; expected Time Out follows 8 actual working hours, excluding unpaid lunch and gaps. |
| Time Out bago makumpleto ang 8 actual working hours | **Undertime** = 480 minus actual working minutes. Time beyond 8 working hours is pending OT, including before 5:00 PM. |
| Walang punch matapos ang scheduled shift | **No record / possible absence**, para i-review ng admin. Hindi agad payroll-final kung may leave/holiday/exemption. |
| Offsite proof | **Pending verification** hanggang approve/reject ng admin. |
| Admin backfill | **Created by admin**, may required reason; walang selfie requirement. |
| Duplicate tap / retry | Isang active punch bawat employee, work date, at slot; nirereject ang duplicate at puwedeng tingnan ang existing receipt sa history. |

Ang oras sa regular, overtime, at Differential windows ay nasa [premium workflow](PREMIUM_FLOW.md). Kasama sa "Incoming Holidays" ng admin at employee ang published nationwide holidays sa 2026–2027. Ang regular at special non-working days ay no-work; ang special working day ay normal na scheduled day. Ang admin ay puwedeng magdagdag ng local/company holidays. Hindi bibilangin ang no-work day bilang missing attendance o late/undertime. Ang bagong proclamation, kasama ang 2027 Eid dates, ay nangangailangan ng calendar update. Hindi magko-compute ng sahod, pay rate, leave, holiday pay, o deduction ang DTR.

## 6. Data na dapat itago

- **Employee:** ID, name, account state, assigned schedule.
- **Site settings:** iisang active site, coordinates, radius, effective dates/version, at admin change history.
- **Schedule:** Asia/Manila timezone, Standard 8:00 AM–5:00 PM o Custom start/end, at workdays; walang grace period.
- **Cutoff:** start/end dates, state (open/finalized), report version.
- **Attendance event:** employee, work date, slot (AM In/PM Out), official timestamp, source (`onsite`/`offsite`/`admin`), device capture time, site settings version/geofence result, coordinates and accuracy, selfie reference, verification state, interval-specific reason and field assignment, creator/reviewer, timestamps.
- **Audit log:** login/session activity as appropriate, punch submission, approval/rejection, admin backfill, correction, cutoff finalization, and export/print.

Selfie at precise location ay sensitive data: role-based access, encrypted storage/transfer, limited retention, at access logging. Sa login at capture screens, ipaliwanag kung bakit kinukuha ang location at image.

## 7. Navigation / screen map

**Employee:** Login → Home → Time In/Out capture → Receipt; Home → Aking Attendance → Cutoff list → Daily detail; Profile → Logout.

**Admin:** Login → Dashboard → Attendance list → Detail/verify; Dashboard → Employees → Create/edit; Dashboard → Add attendance; Dashboard → Cutoff reports → Review exceptions → Print/export.

## 8. Napiling platform: PWA

**Web app / PWA ang napili.** Habang bukas/active ang app, puwedeng mag-check ng location at magpakita ng onsite prompt. Hindi dapat ipangako na kusang bubukas ang saradong web app pagpasok sa geofence. Kailangan ng HTTPS at user permission sa browser location/camera.

Kung kailangan sa hinaharap ang arrival reminder kahit hindi bukas ang app, kailangan ng native mobile geofencing. Arrival reminder pa rin ito; employee confirmation at proof capture ang actual punch.

## 9. Open decisions para ma-lock ang build

1. Final cutoff dates: sample **11–25 at 26–10** o ibang schedule?
2. Actual shifts: **8:30 AM–5:30 PM Mon–Sat** ba (sample screenshot) o per employee?
3. Admin-set single-site coordinates/radius at allowed GPS accuracy.
4. **Confirmed:** selfie at device location ay required sa bawat onsite at offsite Time In at Time Out. Camera capture ang primary flow; device camera fallback ang gagamitin kung hindi available ang browser camera API.
5. Retention period para sa selfies at precise location; kung kailangan ang break-out/break-in at leave sa susunod na release.
6. **Confirmed:** Convex ang backend at file storage; Vercel ang HTTPS host ng PWA frontend. Kailangan pa ng production admin email at account sign-in para sa live deployment.

## 10. Kasalukuyang build

Nagawa ang account/login, first-admin sign-up kapag walang admin, admin profile picture at account deletion, admin employee/schedule/site/cutoff/holiday setup, editable app name at logo, employee AM In/PM Out onsite/offsite with selfie+GPS, employee cutoff/history, admin verification/backfill, printable cutoff summary, at audit trail. Sa admin deletion, nananatili ang employee at attendance records; ang unang susunod na sign-up ay magkakaroon ng admin access. Ang browser Print / Save PDF ang kasalukuyang report output. Ang active PWA ay naka-host sa Vercel at gumagamit ng Convex production backend. Wala pang CSV export, payroll computation, leave module, automatic retention/deletion, at cutoff finalization lock.
