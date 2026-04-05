# Pike13 Investigator v1.13

Diagnostic and reporting tool for Pike13 admin. Runs as a browser console script with a GUI overlay. Five reports for investigating unpaid visits, auditing plan punch allocation, scanning price mismatches, checking event roster coverage, and running full account diagnostics.

## Installation

1. Navigate to any page on your Pike13 admin site (e.g., `musicplace.pike13.com`)
2. Open browser DevTools (F12 or Ctrl+Shift+J)
3. Paste the contents of `pike13-investigator-v1.13.js` into the console and press Enter
4. The panel appears in the top-right corner

Run the script again to remove the panel. Reloading the page also removes it.

The script detects context from the current URL and auto-selects the most relevant tab with fields pre-filled:

| URL pattern | Tab selected | Pre-fills |
|---|---|---|
| `/people/{id}/memberships/{plan_id}?aspect=visits` | Plan Punch Audit | Person ID + Plan ID |
| `/people/{id}/visits` | Unpaid Visits | Person ID |
| `/e/{id}` | Event Roster | Event Occurrence ID |
| `/people/{id}` (dashboard or any other subpage) | Account Diagnostic | Person ID |
| Any other page | Account Diagnostic | (nothing) |

Person ID populates across all tabs that have it, not just the active one — so you can switch tabs without re-entering it. The console log confirms what was detected (e.g., `detected person:9988355, plan:49394781 → punches`).

## Reports

### 1. Account Diagnostic

Quick health check for a single account. Enter a Person ID and click **Run Diagnostic**.

**Pulls:**
- Person basics (name, email, guardian with ID, both stored and account guardian emails if they differ, dependents, hidden status)
- Account balance (from autocomplete endpoint)
- Payment methods with card type, last four, expiry, and autobill status
- All active plans with billing schedule, remaining count, limit period, and next invoice date
- Recently inactive plans (ended 2025+)
- 3-month visit history with paid/unpaid counts
- All-time visit summary

**Use when:** A client or parent reports billing issues, you need a quick overview before digging deeper, or you want to verify payment method and plan status at a glance.

**Slack Summary:** A copy-paste-ready sentence appears at the bottom describing any issues found — no payment method, expired card, autobill off, no active plan, or recent unpaid visits. If everything looks healthy, it says so explicitly.

### 2. Unpaid Visit Investigator

Automated version of the diagnostic workflow for tracking down why visits are unpaid. Enter a Person ID and date range.

**Checks:**
- All visits in range, separated by paid/unpaid
- Whether the person is a parent account (flags dependents — the student may have the unpaid visits)
- Active plan coverage: loads plan product templates and checks each unpaid visit for service ID match and date range coverage
- Identifies plans that *should* cover visits but have `remaining_count: 0` (suggests running Plan Punch Audit)
- Service mismatch detection: flags visits on services that no active plan covers (common after lesson duration switches like 30m → 45m)
- Payment method check on both the person and their guardian/parent account, including expiry validation. Uses `find_by_ids` to reliably look up the guardian's ID (falls back to name-based search if needed)
- Multiple service ID detection: shows when visits span different services, indicating a mid-range service change

**Use when:** A client shows unpaid visits and you need to figure out why — is it a service mismatch, missing plan, exhausted punches, expired card, or something else.

**Slack Summary:** A copy-paste-ready paragraph appears at the bottom with one sentence per distinct problem found. Issues stack — so if a client has both a service mismatch and an expired card, both are explained. Visits still in `registered` state (attendance never recorded) are flagged separately with guidance to mark them complete or no-show from the event roster. Visits marked complete but never deducted from a plan are flagged with guidance to use "Deduct from plan." Falls back to "no clear cause identified" if everything checks out.

### 3. Plan Punch Audit

Root cause analysis for plans with exhausted weekly/monthly slots. Enter a Person ID and Plan ID (leave Plan ID blank to see a list of the person's plans first).

**Does:**
- Fetches all visits in a configurable date range
- Looks up every `punch_id` via `GET /api/v2/desk/punches/{id}` to find which plan each punch belongs to
- Identifies all punches belonging to the target plan
- Flags punches on visits that occurred *before the plan's start date* — these are old visits consuming current weekly/monthly slots
- Shows week-by-week slot allocation: which visit fills each slot, with old-visit punches marked
- Outputs the exact punch IDs to remove and a direct `/e/{occId}` link for each old visit's event occurrence

**Use when:** The Unpaid Visit Investigator reports a plan with `remaining_count: 0` that should be covering visits. This is the tool that diagnosed the Meera Rao case — 8 old visits from 2024–2025 had been retroactively applied to a new plan, eating all the weekly slots.

**How the fix works:** There is no Remove button on the plan visits page (`/people/{id}/memberships/{plan_id}?aspect=visits`). To remove a punch, navigate to the event occurrence using the `/e/{occId}` links in the output, click the gear ⚙ icon next to the student, and choose **Reset attendance**. This removes the punch and frees the weekly slot. Repeat for each old visit listed.

**Slack Summary:** A copy-paste-ready paragraph appears at the bottom with one of four conclusions: no punches found on this plan; old pre-plan visits are consuming slots (names the dates, points at the fix); plan is at zero remaining but no old visits are to blame (breaks down the unpaid visits by state and gives targeted fix guidance — mark complete or no-show for `registered` visits, use "Deduct from plan" for completed visits with no punch); or no slot allocation problems found.

### 4. Price Mismatch Scanner

Compares client subscription prices to current plan product template prices. Useful after template price updates to find clients still on old pricing.

**Modes:**
- **Single person** — Quick check for one account
- **Bulk (all people)** — Scans up to N people with configurable batch size. Uses concurrent requests with adaptive delays.

**Options:**
- **Plan Product ID** — Leave blank to scan all billing templates, or enter a specific ID to filter
- **Batch size** — Number of concurrent API requests (default 5; lower if hitting rate limits)
- **Max people** — Cap for bulk mode (default 500)

**Output:** Groups mismatches by plan template, shows each client's current price vs. template price with the difference, and a summary with underpaying/overpaying counts and net dollar difference per billing cycle.

**Use when:** After updating plan template prices, to identify which clients need their subscription price updated to match. The output feeds directly into the bulk price update workflow.

### 5. Event Roster Check

Starts from an event occurrence (a specific class or lesson) and checks every enrolled student's plan coverage. Enter an Event Occurrence ID — you can grab this from the URL when viewing a class (e.g., `/e/286765341`).

**Does:**
- Fetches the event occurrence details (name, service ID, location, time)
- Pulls all enrolled students from the event's visit list
- For each student, fetches their active plans and checks whether any plan covers the event's service
- Flags students whose plans don't cover the service (e.g., enrolled on a "Family EMA" plan but attending an "EMA 1" class)
- Flags students with a covering plan but `remaining_count: 0` (exhausted slots)
- Flags price mismatches between client plan price and template price
- If a visit is already paid, looks up the punch to verify it was covered by the correct plan
- Lists all plan product templates that DO cover this event's service, for reference

**Use when:** A class has multiple kids showing as unpaid and you want to check them all at once rather than investigating each person individually. Especially useful when the root cause is a plan/service mismatch affecting a whole class — like kids enrolled on the wrong plan type for the service they're actually attending.

**Slack Summary:** When issues are found, a plain-English summary appears at the bottom that you can copy straight into Slack. Students are grouped by which wrong plan they're on (since not everyone in the class is necessarily on the same plan). The summary explains the problem and presents both possible resolutions in a parallel "wrong plan / wrong class" format. For 1–2 suggestions, names are listed inline; for 3+, the first is shown with a count of alternatives. Passes are excluded from suggestions by default (checkbox to include). Students with a valid covering plan but visits still unpaid (i.e. `registered` state, attendance not yet recorded) get their own paragraph explaining the mark-complete-or-no-show decision. Example output:

> Clara Bailey, Hope Bailey, Hendrik Landolt, and Olivia Wiesner are showing as unpaid, because all of them are enrolled in the "EMA Family Group; 30m, 4x/mo" ($95.00) plan, which does not cover this class. There are two ways to resolve this, depending on whether the plan is wrong or the class is wrong.
>
> • If they have the wrong plan but are in the right class, then they'll need to be switched to a plan that covers "EMA Level 1 Group" services, such as "EMA Level 1 Group; 45m, 2x/mo" ($70.00) (3 other options also cover this service).
>
> • If they have the right plan but are in the wrong class, then they'll need to be switched to an event that is covered by their "EMA Family Group; 30m, 4x/mo" plan, such as "EMA Family Group" (their plan also covers 2 other services).

## UI Features

- **Drag to move** — Grab the header bar to reposition
- **Minimize to pill** — Click the `─` button to collapse to a small "🔍 Investigator" pill; click the pill to restore
- **Stop button** — Appears during long-running operations; aborts the current scan cleanly
- **Copy** — Copies the current report output as plain text for pasting into Slack, notes, etc.
- **Auto-detect Person ID** — If you're on any `/people/{id}` page, the ID fields pre-fill automatically across all tabs
- **Auto-detect Event Occurrence ID** — If you're on an `/e/{id}` page, the Event Roster tab pre-fills and activates
- **Smart tab selection** — The most relevant tab activates based on the page you're on (plan visits → Punch Audit, client visits → Unpaid Visits, event → Event Roster, client page → Diagnostic)
- **Dark theme** — Designed to overlay cleanly on Pike13's admin UI without clashing

## API Endpoints Used

| Endpoint | Used By |
|----------|---------|
| `/api/v2/desk/people/search/autocomplete.json?q=` | All reports (person lookup, balance, guardian detection) |
| `/api/v2/desk/people/find_by_ids.json?ids=` | Diagnostic, Unpaid Investigator (reliable guardian ID + email via `providers[]`) |
| `/api/v2/desk/people/{id}` | All reports (direct person lookup, dependents) |
| `/api/v2/desk/people/{id}/form_of_payments` | Diagnostic, Unpaid Investigator |
| `/api/v2/desk/people/{id}/plans` | All reports |
| `/api/v2/desk/people/{id}/plans?filter=active` | All reports |
| `/api/v2/desk/people/{id}/visits?from=&to=` | All reports except Price Mismatch |
| `/api/v2/desk/people/{id}/visits/summary` | Diagnostic |
| `/api/v2/desk/punches/{id}` | Plan Punch Audit, Event Roster Check |
| `/api/v2/desk/plan_products?per_page=100` | Unpaid Investigator, Price Mismatch, Event Roster Check |
| `/api/v2/desk/people?per_page=100` | Price Mismatch (bulk mode) |
| `/api/v2/desk/event_occurrences/{id}` | Event Roster Check |
| `/e/{id}.json` | Event Roster Check (fallback) |
| `/api/v2/desk/event_occurrences/{id}/visits` | Event Roster Check |

## Rate Limiting

The script uses 120ms delays between sequential API calls. The Plan Punch Audit can make many calls (one per punched visit), so expect it to take a minute or two for clients with long visit histories. The Price Mismatch bulk scanner shows a live rate (requests/min) and ETA in the status bar. Use the Stop button if you need to abort.

## Known Limitations

- The plan visits page (`/people/{id}/memberships/{plan_id}?aspect=visits`) is Angular-rendered and cannot be scraped — that's why the Plan Punch Audit traces punches individually via the API instead
- There is no Remove button on the plan visits page. Removing a punch (freeing a weekly slot) requires going to the event occurrence roster, clicking the gear icon next to the student, and choosing "Reset attendance"
- No punch list endpoint exists — punches must be looked up one at a time using `punch_id` values from visit records
- Visit filters other than `?from`/`?to` are silently ignored by Pike13's API — all filtering (by state, paid status, service) is done client-side
- The Price Mismatch bulk scanner can only check people it can paginate through the `/people` endpoint — there's no way to pre-filter to only people with active plans
- Invoice data is not included in these reports because Pike13's invoice endpoint doesn't support `?person_id` filtering — invoices must be accessed through the admin UI or scraped from person invoice pages
- `guardian_email` (stored on the dependent's record) and `providers[0].email` (from the provider's own account record) are independent fields that can differ — the Diagnostic report shows both when they don't match

## Version History

### v1.13 (2026-03-26)
- **Solution-aware summaries throughout** — tools now distinguish between visit *states* and give targeted fix guidance rather than generic billing-reset language, motivated by diagnosing Anay Vasireddi's plan (unpaid visits were `registered` / attendance not taken on holidays, not a billing problem)
- **Unpaid Visit Investigator — state annotations:** Visits in `registered` state are now flagged inline with `← attendance not taken` in the unpaid visits list
- **Unpaid Visit Investigator — Slack summary:** Two new state-based blocks: one for `registered` visits (mark complete from the event roster to trigger auto-deduction, or no-show/late-cancel to clear without using a slot); one for `completed` visits with no punch (use "Deduct from plan" from the event roster). Both only surface when they add new information not already explained by a service mismatch or missing plan
- **Plan Punch Audit — Slack summary:** The "no old punches, remaining=0" branch now breaks down unpaid visits by state and gives a targeted fix for each combination (all registered, all completed-no-punch, or mixed), replacing the previous vague "billing may not be resetting" message
- **Event Roster Check — Slack summary:** `UNPAID_WITH_PLAN` (has a covering plan with visits remaining, still unpaid) now has its own Slack paragraph explaining the `registered` state diagnosis and the complete-vs-no-show decision

### v1.12 (2026-03-26)
- **Bugfix — slot allocation table capped at today:** `planVisits` now filters `<= today`, so the slot table stops at the current date rather than rendering every future pre-booked visit as "unpaid" through the end of the scan range
- **Bugfix — Punch Audit Slack summary capped at today:** `unpaidInActivePeriod` also now caps at today, preventing future pre-booked visits from inflating the unpaid count and incorrectly triggering the "billing reset issue" branch when the plan is actually working fine (confirmed against Anay Vasireddi's data: count correctly drops from 45 → 4 past missed visits, summary correctly resolves to "no issues found")

### v1.11 (2026-03-26)
- **Slack Summary added to Account Diagnostic** — compiles flags throughout the run (no payment method, expired card, autobill off, no active plans, recent unpaid visits) and produces a single-sentence plain-English summary at the end, ready to paste into Slack
- **Slack Summary added to Unpaid Visit Investigator** — one paragraph per distinct problem found (service mismatch, exhausted plan slots, payment issues, no plans); issues stack when multiple causes are present; falls back to "no clear cause identified" if everything looks intact
- **Slack Summary added to Plan Punch Audit** — four branches: no punches found; old pre-plan visits consuming slots (names dates, points at Reset attendance fix); plan at zero remaining with no old visits (names first unpaid date — further diagnosis needed); no issues found
- **Bugfix:** `oldPunches` hoisted from `const` inside the `else` block to `let` before the `if/else`, so the Punch Audit Slack summary can reference it regardless of which branch ran

### v1.10 (2026-03-26)
- **Bugfix:** `getWeekStart()` now returns `null` for missing or invalid date strings instead of throwing `Invalid time value` — prevents crash in SLOT ALLOCATION section
- **Bugfix:** Week slot map loop now derives `vDate` from `visit.event_occurrence?.start_at` directly; it was never stored on `planPunches` items, so destructuring always gave `undefined` (root cause of the crash)
- **Plan Punch Audit — fix guidance corrected:** There is no Remove button on the plan visits page (confirmed via API ref v6.3). Output now explains the correct procedure — navigate to the event occurrence and use gear ⚙ → Reset attendance — and emits a direct `/e/{occId}` link for each old punch
- **Guardian lookup via `find_by_ids`:** Added `fetchPersonWithProviders()` using `GET /api/v2/desk/people/find_by_ids.json?ids={pid}` to reliably obtain the guardian's person ID via `providers[]`. Used in the Unpaid Investigator (payment method check) and Account Diagnostic. Replaces name-based autocomplete search which could return wrong results. Falls back to name search if `find_by_ids` returns no provider
- **Account Diagnostic — dual guardian emails:** Now surfaces both `guardian_email` (stored on the dependent) and `providers[0].email` (from the provider's account record) when they differ, since these are independent fields per API ref v5.9/v6.1

### v1.09 (2026-03-24)
- Resolution paragraphs now use bullet points (`•`) for Slack-friendly formatting
- Blank line between the two resolution bullets so they don't run together when pasted

### v1.08 (2026-03-24)
- Rewrote Slack summary to match preferred parallel style: "If they have the wrong plan but are in the right class…" / "If they have the right plan but are in the wrong class…"
- Passes (packs) omitted from suggestions by default; "Include passes in suggestions" checkbox on Event Roster tab to include them
- When passes excluded, a note shows how many pass templates also cover the service
- For 3+ suggestions, shows the top one with a count of alternatives instead of a full list
- Covering templates section header adapts: "PLANS COVERING SERVICE" or "PLANS & PASSES COVERING SERVICE" based on checkbox

### v1.07 (2026-03-23)
- Restructured Slack summary into numbered "Wrong plan" / "Wrong class" format matching the preferred output style
- Lists of 3+ items use bullet points; 1–2 items stay inline ("such as X" or "such as X or Y")
- Opening paragraph uses natural count words ("Both are," "All three are," "All four are," "All 7 are")
- Plans and Passes properly distinguished in suggestions (uses "plan," "pass," or "plan or pass" as appropriate)

### v1.06 (2026-03-23)
- Smart context-aware tab selection — script detects the current page and auto-selects the most relevant tab with fields pre-filled
- Plan visits page (`/people/{id}/memberships/{plan_id}`) → Plan Punch Audit with both Person ID and Plan ID pre-filled
- Client visits page (`/people/{id}/visits`) → Unpaid Visits with Person ID pre-filled
- Event occurrence page (`/e/{id}`) → Event Roster with Event Occurrence ID pre-filled
- Client dashboard or any `/people/{id}` subpage → Account Diagnostic with Person ID pre-filled
- Person ID populates across all tabs, not just the active one
- Console log now reports what was detected from the URL

### v1.05 (2026-03-23)
- Plans and Passes (Packs) are now properly separated in the "covering this service" output — no longer conflated
- Slack summary uses the correct term ("plan," "pass," or "plan or pass") depending on what's available
- Rewrote the solution paragraph: "Alternatively, they may have been booked into the wrong class — their plan covers X, Y, or Z, so they would need to be moved to a class that uses one of those services instead."

### v1.04 (2026-03-23)
- Slack summary now names the specific services each student's plan covers when suggesting they may be in the wrong class
- Solution paragraph is now per-plan-group, so if students are on different wrong plans, each group gets its own specific explanation and suggestion

### v1.03 (2026-03-23)
- Added Oxford comma formatting to all human-readable lists via `oxList()` helper
- Students grouped by plan in Slack summary — different wrong plans get separate paragraphs
- Solution paragraph now presents both possibilities: wrong plan sold, or scheduled for wrong service

### v1.02 (2026-03-23)
- Reformatted per-student mismatch output (cleaner multi-line layout instead of dense one-liner)
- Added Slack Summary section to Event Roster Check — plain-English, copy-paste-ready explanation with problem description and proposed solutions

### v1.01 (2026-03-23)
- Added **Event Roster Check** report — enter an event occurrence ID, checks all enrolled students' plan coverage against that event's service
- Flags plan/service mismatches, exhausted plan slots, price discrepancies, and visits covered by the wrong plan
- Auto-detects Event Occurrence ID from `/e/{id}` URLs
- Lists all plan product templates that cover the event's service for reference

### v1.00 (2026-03-20)
- Initial release
- Four reports: Account Diagnostic, Unpaid Visit Investigator, Plan Punch Audit, Price Mismatch Scanner
- Draggable panel with minimize-to-pill, stop/abort, copy output
- Auto-detects Person ID from URL