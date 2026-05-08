#!/usr/bin/env node
//
// M5 completeness verification script.
//
// Programmatic gate that ensures every file the M5 prompt required is
// present, every claimed-active UI tab is genuinely active (not "coming
// soon"), every cron sweep is wired into worker/index.js, and every
// email template seed migration exists.
//
// Usage:
//   node scripts/verify-m5-completeness.js                    # full audit
//   node scripts/verify-m5-completeness.js --batch=R8         # one rework batch
//   node scripts/verify-m5-completeness.js --json             # machine-readable
//
// Exit code:
//   0 — all checks pass
//   1 — at least one gap remaining
//
// This script is **mandatory** before declaring any rework batch
// complete. The next session must run it and include output in the
// rework PR description.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ────────────────────────────────────────────────────────────────────
// Check definitions per rework batch
// ────────────────────────────────────────────────────────────────────

/**
 * Each rework batch defines an array of checks. A check is one of:
 *   { type: 'file', path }
 *   { type: 'dir', path }                     (directory exists + non-empty)
 *   { type: 'grep', file, pattern, must: 'exist'|'absent' }
 *   { type: 'tab-active', file, tabKey }      (AdminStaffDetail tab not "coming soon")
 *   { type: 'route-mounted', pattern }        (worker/index.js mounts a route)
 *   { type: 'cron-sweep', name }              (worker/index.js declares the sweep)
 *   { type: 'email-template', slug }          (seeded in any migrations/*.sql)
 */
const REWORK_BATCHES = {
    'R0-structural': {
        title: 'B0 visual refresh structural completion',
        checks: [
            // FilterBar adoption on the 4 hand-built filter pages
            { type: 'grep', file: 'src/admin/AdminEvents.jsx',           pattern: /FilterBar/, must: 'exist' },
            { type: 'grep', file: 'src/admin/AdminRentals.jsx',          pattern: /FilterBar/, must: 'exist' },
            { type: 'grep', file: 'src/admin/AdminRoster.jsx',           pattern: /FilterBar/, must: 'exist' },
            { type: 'grep', file: 'src/admin/AdminRentalAssignments.jsx', pattern: /FilterBar/, must: 'exist' },
            // Header-pattern consistency: each admin page top-level has a
            // breadcrumb (or back-link) + h1 + primary-action element.
            // Verified via a grep for a marker class added during the rework.
            { type: 'grep', file: 'src/admin/AdminEvents.jsx',           pattern: /admin-page-header|page-header|breadcrumb/i, must: 'exist' },
            { type: 'grep', file: 'src/admin/AdminVendors.jsx',          pattern: /admin-page-header|page-header|breadcrumb/i, must: 'exist' },
            // Typography hierarchy: pages use --font-size-* tokens, not raw px.
            // We accept passing if at least 1 font-size-* token reference exists per file.
            // (Rework adds these; baseline is none.)
            { type: 'grep', file: 'src/admin/AdminEvents.jsx',           pattern: /font-size-(xs|sm|base|md|lg|xl|2xl|3xl)/, must: 'exist' },
            { type: 'grep', file: 'src/admin/AdminFeedback.jsx',         pattern: /font-size-(xs|sm|base|md|lg|xl|2xl|3xl)/, must: 'exist' },
        ],
    },

    'R4-tests-split': {
        title: 'B4 staff route tests split into 5 files',
        checks: [
            { type: 'file', path: 'tests/unit/admin/staff/list.test.js' },
            { type: 'file', path: 'tests/unit/admin/staff/detail.test.js' },
            { type: 'file', path: 'tests/unit/admin/staff/typeahead.test.js' },
            { type: 'file', path: 'tests/unit/admin/staff/roles.test.js' },
            { type: 'file', path: 'tests/unit/admin/staff/notes.test.js' },
        ],
    },

    'R5-tests': {
        title: 'B5 staff document route tests',
        checks: [
            { type: 'dir', path: 'tests/unit/admin/staffDocuments' },
            { type: 'file', path: 'tests/unit/admin/staffDocuments/list.test.js' },
            { type: 'file', path: 'tests/unit/admin/staffDocuments/create.test.js' },
            { type: 'file', path: 'tests/unit/admin/staffDocuments/retire.test.js' },
            { type: 'file', path: 'tests/unit/admin/staffDocuments/role-tag.test.js' },
        ],
    },

    'R6-strict-separation': {
        title: 'B6 strict /admin vs /portal cookie separation',
        checks: [
            // requireAuth should reject portal cookies with explicit 403
            { type: 'grep', file: 'worker/lib/auth.js', pattern: /aas_portal_session|portal_cookie/, must: 'exist' },
            { type: 'file', path: 'tests/unit/auth/strict-separation.test.js' },
        ],
    },

    'R8-cert-cron-and-templates': {
        title: 'B8 certifications — lib + cron + templates + editor + tests',
        checks: [
            { type: 'file', path: 'worker/lib/certifications.js' },
            { type: 'file', path: 'src/admin/AdminStaffCertEditor.jsx' },
            { type: 'cron-sweep', name: 'runCertExpirationSweep' },
            { type: 'email-template', slug: 'cert_expiration_60d' },
            { type: 'email-template', slug: 'cert_expiration_30d' },
            { type: 'email-template', slug: 'cert_expiration_7d' },
            { type: 'file', path: 'tests/unit/cron/cert-expiration-sweep.test.js' },
            { type: 'file', path: 'tests/unit/lib/certifications.test.js' },
        ],
    },

    'R9-staffing-completion': {
        title: 'B9 event staffing — UI + lib + cron + templates + tests',
        checks: [
            { type: 'file', path: 'src/admin/AdminEventStaffing.jsx' },
            { type: 'file', path: 'worker/lib/eventStaffing.js' },
            { type: 'cron-sweep', name: 'runEventStaffingReminderSweep' },
            { type: 'email-template', slug: 'event_staff_invite' },
            { type: 'email-template', slug: 'event_staff_reminder' },
            { type: 'dir', path: 'tests/unit/admin/eventStaffing' },
            { type: 'file', path: 'tests/unit/cron/event-staffing-reminder-sweep.test.js' },
            { type: 'file', path: 'tests/unit/lib/eventStaffing.test.js' },
        ],
    },

    'R10-labor-completion': {
        title: 'B10 labor log — Schedule tab activated + lib + tests',
        checks: [
            { type: 'file', path: 'worker/lib/laborEntries.js' },
            { type: 'tab-active', file: 'src/admin/AdminStaffDetail.jsx', tabKey: 'schedule' },
            { type: 'dir', path: 'tests/unit/admin/laborEntries' },
            { type: 'file', path: 'tests/unit/lib/laborEntries.test.js' },
        ],
    },

    'R11-1099-completion': {
        title: 'B11 1099 thresholds — UI page + lib + auto-lock cron + template + tests',
        checks: [
            { type: 'file', path: 'src/admin/AdminStaff1099Thresholds.jsx' },
            { type: 'file', path: 'worker/lib/thresholds1099.js' },
            { type: 'cron-sweep', name: 'runTaxYearAutoLockSweep' },
            { type: 'email-template', slug: 'w9_reminder' },
            { type: 'dir', path: 'tests/unit/admin/thresholds1099' },
            { type: 'file', path: 'tests/unit/lib/thresholds1099.test.js' },
        ],
    },

    'R12-event-day-foundations': {
        title: 'B12 event-day foundations — Context, CSS, routes dir, session lib',
        checks: [
            { type: 'file', path: 'src/event-day/EventDayContext.jsx' },
            { type: 'file', path: 'src/event-day/styles/event-day.css' },
            { type: 'dir', path: 'worker/routes/event-day' },
            { type: 'file', path: 'worker/lib/eventDaySession.js' },
            { type: 'dir', path: 'tests/unit/event-day' },
            { type: 'file', path: 'tests/unit/lib/eventDaySession.test.js' },
        ],
    },

    'R13-checkin-full': {
        title: 'B13 check-in — full components + camera explainer + walkup + routes',
        checks: [
            { type: 'file', path: 'src/event-day/AttendeeDetail.jsx' },
            { type: 'file', path: 'src/event-day/WalkUpBooking.jsx' },
            { type: 'file', path: 'src/event-day/CameraPermissionExplainer.jsx' },
            { type: 'file', path: 'worker/routes/event-day/checkin.js' },
            { type: 'file', path: 'worker/routes/event-day/walkup.js' },
            { type: 'route-mounted', pattern: /\/api\/event-day\/checkin/ },
            { type: 'route-mounted', pattern: /\/api\/event-day\/walkup/ },
            { type: 'dir', path: 'tests/unit/event-day/checkin' },
            { type: 'file', path: 'tests/unit/event-day/checkin/offline-queue.test.js' },
        ],
    },

    'R14-event-day-routes': {
        title: 'B14 event-day backend routes — incidents + roster + equipment-return',
        checks: [
            { type: 'file', path: 'worker/routes/event-day/incidents.js' },
            { type: 'file', path: 'worker/routes/event-day/roster.js' },
            { type: 'file', path: 'worker/routes/event-day/equipment-return.js' },
            { type: 'route-mounted', pattern: /\/api\/event-day\/incidents/ },
            { type: 'route-mounted', pattern: /\/api\/event-day\/roster/ },
            { type: 'route-mounted', pattern: /\/api\/event-day\/equipment-return/ },
            { type: 'file', path: 'tests/unit/event-day/incidents/route.test.js' },
        ],
    },

    'R15-checklists-persistence': {
        title: 'B15 event-day checklists — persistence + auto-instantiate hook',
        checks: [
            { type: 'file', path: 'worker/routes/event-day/checklists.js' },
            { type: 'file', path: 'worker/routes/event-day/hq.js' },
            { type: 'route-mounted', pattern: /\/api\/event-day\/checklists/ },
            { type: 'route-mounted', pattern: /\/api\/event-day\/hq/ },
            // Migration with event_checklists + event_checklist_items tables
            { type: 'grep', file: 'migrations', pattern: /CREATE TABLE event_checklists/, must: 'exist', dirGlob: true },
            { type: 'grep', file: 'migrations', pattern: /CREATE TABLE event_checklist_items/, must: 'exist', dirGlob: true },
            // Auto-instantiate hook in worker/routes/admin/events.js
            { type: 'grep', file: 'worker/routes/admin/events.js', pattern: /event_checklists|instantiateChecklists/, must: 'exist' },
            // EventChecklist.jsx must POST to backend (not just local state)
            { type: 'grep', file: 'src/event-day/EventChecklist.jsx', pattern: /\/api\/event-day\/checklists/, must: 'exist' },
            { type: 'file', path: 'tests/unit/event-day/checklists/route.test.js' },
        ],
    },

    'R16-charges-completion': {
        title: 'B16 damage-charge fast-path — UI + routes + lib + templates',
        checks: [
            { type: 'file', path: 'src/admin/AdminBookingChargeQueue.jsx' },
            { type: 'file', path: 'worker/routes/event-day/damageCharge.js' },
            { type: 'file', path: 'worker/routes/admin/bookingCharges.js' },
            { type: 'file', path: 'worker/lib/bookingCharges.js' },
            { type: 'route-mounted', pattern: /\/api\/event-day\/damage-charge|\/api\/admin\/booking-charges/ },
            { type: 'email-template', slug: 'additional_charge_notice' },
            { type: 'email-template', slug: 'additional_charge_paid' },
            { type: 'email-template', slug: 'additional_charge_waived' },
            // booking_confirmation template should reference charges
            { type: 'grep', file: 'migrations', pattern: /booking_confirmation[\s\S]+(charges|additional)/i, must: 'exist', dirGlob: true },
            // EquipmentReturn.jsx damage-charge UI extension
            { type: 'grep', file: 'src/event-day/EquipmentReturn.jsx', pattern: /damage-charge|damageCharge|booking-charges/i, must: 'exist' },
            { type: 'dir', path: 'tests/unit/event-day/damageCharge' },
            { type: 'dir', path: 'tests/unit/admin/bookingCharges' },
        ],
    },

    'R17-decommission': {
        title: 'B17 decommission AdminUsersLegacy + redirect',
        checks: [
            // AdminUsers.jsx should be GONE; legacy is deleted
            { type: 'grep', file: 'src/App.jsx', pattern: /lazy.*AdminUsers/, must: 'absent' },
            // /admin/users should redirect to /admin/staff
            { type: 'grep', file: 'src/App.jsx', pattern: /Navigate to="\/admin\/staff"|users.*Navigate/, must: 'exist' },
            // The legacy file should not exist
            { type: 'grep', file: 'src/admin/AdminUsers.jsx', pattern: /./, must: 'absent', isFileExistsCheck: true },
        ],
    },

    'R18-final-docs': {
        title: 'B18 final docs — CLAUDE.md + HANDOFF.md M5 sections',
        checks: [
            // CLAUDE.md must mention M5 closed
            { type: 'grep', file: 'CLAUDE.md', pattern: /Milestone 5.*[Cc]losed|M5.*[Cc]losed/, must: 'exist' },
            // HANDOFF.md must reference M5 close
            { type: 'grep', file: 'HANDOFF.md', pattern: /Milestone 5|M5.*close/, must: 'exist' },
            // Updated baseline coverage reflects post-rework counts
            { type: 'file', path: 'docs/runbooks/m5-baseline-coverage.txt' },
        ],
    },
};

// ────────────────────────────────────────────────────────────────────
// Check runners
// ────────────────────────────────────────────────────────────────────

function runCheck(check) {
    const result = { check, pass: false, detail: '' };

    try {
        if (check.type === 'file') {
            const p = join(ROOT, check.path);
            result.pass = existsSync(p);
            result.detail = result.pass ? 'exists' : `missing: ${check.path}`;
        }
        else if (check.type === 'dir') {
            const p = join(ROOT, check.path);
            if (!existsSync(p)) {
                result.detail = `missing dir: ${check.path}`;
            } else {
                const entries = readdirSync(p);
                const nonHidden = entries.filter((e) => !e.startsWith('.'));
                result.pass = nonHidden.length > 0;
                result.detail = result.pass ? `dir non-empty (${nonHidden.length} entries)` : `dir empty: ${check.path}`;
            }
        }
        else if (check.type === 'grep') {
            if (check.dirGlob) {
                // Glob a directory for any file matching the pattern
                const dirPath = join(ROOT, check.file);
                if (!existsSync(dirPath)) {
                    result.detail = `dir does not exist: ${check.file}`;
                } else {
                    const entries = readdirSync(dirPath);
                    let foundIn = null;
                    for (const e of entries) {
                        const fp = join(dirPath, e);
                        try {
                            const content = readFileSync(fp, 'utf8');
                            if (check.pattern.test(content)) { foundIn = e; break; }
                        } catch { /* ignore */ }
                    }
                    const found = foundIn !== null;
                    result.pass = check.must === 'exist' ? found : !found;
                    result.detail = result.pass
                        ? (check.must === 'exist' ? `found in ${foundIn}` : 'absent (as required)')
                        : (check.must === 'exist' ? `pattern not found in any file under ${check.file}` : `pattern unexpectedly found in ${foundIn}`);
                }
            } else if (check.isFileExistsCheck) {
                // Special case: pattern is a placeholder; we only check file
                // existence. must: 'absent' means the file must NOT exist.
                const exists = existsSync(join(ROOT, check.file));
                result.pass = check.must === 'exist' ? exists : !exists;
                result.detail = result.pass
                    ? (check.must === 'exist' ? 'file exists' : 'file absent (as required)')
                    : (check.must === 'exist' ? `file missing: ${check.file}` : `file should not exist: ${check.file}`);
            } else {
                const p = join(ROOT, check.file);
                if (!existsSync(p)) {
                    result.detail = `file does not exist: ${check.file}`;
                } else {
                    const content = readFileSync(p, 'utf8');
                    const matches = check.pattern.test(content);
                    result.pass = check.must === 'exist' ? matches : !matches;
                    result.detail = result.pass
                        ? (check.must === 'exist' ? 'pattern found' : 'pattern absent (as required)')
                        : (check.must === 'exist' ? `pattern missing in ${check.file}` : `pattern unexpectedly present in ${check.file}`);
                }
            }
        }
        else if (check.type === 'tab-active') {
            // The named tab must NOT render <ComingSoon batch="..." feature="..." />.
            // We grep for the line containing the tabKey -> ComingSoon binding.
            const p = join(ROOT, check.file);
            if (!existsSync(p)) {
                result.detail = `file does not exist: ${check.file}`;
            } else {
                const content = readFileSync(p, 'utf8');
                const stubLine = new RegExp(`activeTab === '${check.tabKey}'.*ComingSoon`, 's');
                const isStub = stubLine.test(content);
                result.pass = !isStub;
                result.detail = result.pass
                    ? `${check.tabKey} tab activated`
                    : `${check.tabKey} tab still renders ComingSoon stub`;
            }
        }
        else if (check.type === 'route-mounted') {
            const p = join(ROOT, 'worker/index.js');
            const content = readFileSync(p, 'utf8');
            const mountPattern = new RegExp(`app\\.route\\(['"]${check.pattern.source.replace(/^\^|\$$/g, '')}`);
            const matches = mountPattern.test(content) || check.pattern.test(content);
            result.pass = matches;
            result.detail = result.pass ? `route mounted: ${check.pattern}` : `route NOT mounted: ${check.pattern}`;
        }
        else if (check.type === 'cron-sweep') {
            const p = join(ROOT, 'worker/index.js');
            const content = readFileSync(p, 'utf8');
            const declared = new RegExp(`(async\\s+)?function\\s+${check.name}\\b|const\\s+${check.name}\\s*=`).test(content);
            const invoked = new RegExp(`${check.name}\\s*\\(`).test(content);
            result.pass = declared && invoked;
            result.detail = result.pass
                ? `cron sweep ${check.name} declared and invoked`
                : `cron sweep ${check.name} ${declared ? 'declared but not invoked' : 'not declared'}`;
        }
        else if (check.type === 'email-template') {
            const dir = join(ROOT, 'migrations');
            const entries = readdirSync(dir).filter((f) => f.endsWith('.sql'));
            let foundIn = null;
            for (const f of entries) {
                const content = readFileSync(join(dir, f), 'utf8');
                const seedPattern = new RegExp(`INSERT INTO email_templates[\\s\\S]*'${check.slug}'`);
                if (seedPattern.test(content)) { foundIn = f; break; }
            }
            result.pass = foundIn !== null;
            result.detail = result.pass
                ? `template ${check.slug} seeded in ${foundIn}`
                : `template ${check.slug} NOT seeded in any migration`;
        }
        else {
            result.detail = `unknown check type: ${check.type}`;
        }
    } catch (err) {
        result.detail = `check error: ${err.message}`;
    }

    return result;
}

// ────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const batchFilter = args.find((a) => a.startsWith('--batch='))?.slice('--batch='.length);
const jsonMode = args.includes('--json');

const batchesToRun = batchFilter
    ? (REWORK_BATCHES[batchFilter] ? { [batchFilter]: REWORK_BATCHES[batchFilter] } : null)
    : REWORK_BATCHES;

if (batchFilter && !batchesToRun) {
    console.error(`Unknown batch: ${batchFilter}`);
    console.error(`Available: ${Object.keys(REWORK_BATCHES).join(', ')}`);
    process.exit(2);
}

const summary = {};
let totalChecks = 0;
let totalPasses = 0;

for (const [batchId, batch] of Object.entries(batchesToRun)) {
    const results = batch.checks.map(runCheck);
    const passes = results.filter((r) => r.pass).length;
    const fails = results.filter((r) => !r.pass);

    summary[batchId] = {
        title: batch.title,
        passes,
        total: results.length,
        complete: fails.length === 0,
        failures: fails.map((r) => ({ check: r.check, detail: r.detail })),
    };

    totalChecks += results.length;
    totalPasses += passes;
}

if (jsonMode) {
    console.log(JSON.stringify(summary, null, 2));
} else {
    console.log('═'.repeat(70));
    console.log(' M5 COMPLETENESS VERIFICATION');
    console.log('═'.repeat(70));

    for (const [batchId, batchSummary] of Object.entries(summary)) {
        const status = batchSummary.complete ? '[ PASS ]' : '[ FAIL ]';
        console.log(`\n${status} ${batchId} — ${batchSummary.title}`);
        console.log(`         ${batchSummary.passes}/${batchSummary.total} checks pass`);
        if (!batchSummary.complete) {
            for (const f of batchSummary.failures) {
                console.log(`         - ${f.detail}`);
            }
        }
    }

    console.log('');
    console.log('─'.repeat(70));
    console.log(`  Overall: ${totalPasses}/${totalChecks} checks pass`);
    console.log(`  Batches complete: ${Object.values(summary).filter((s) => s.complete).length}/${Object.keys(summary).length}`);
    console.log('─'.repeat(70));
}

const allComplete = Object.values(summary).every((s) => s.complete);
process.exit(allComplete ? 0 : 1);
