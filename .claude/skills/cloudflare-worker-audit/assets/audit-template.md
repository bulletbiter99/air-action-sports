# Security Audit — {{DATE}}

**Target:** {{PROJECT_NAME}}
**Scope:** Full codebase ({{DIRS}}) + live deploy at {{LIVE_URL}}
**Stack:** {{STACK}}
**Auditor:** 5 parallel specialist agents (secrets/deps, auth, injection, infra, business logic)
**Context:** {{CUTOVER_CONTEXT}}

---

## Executive summary

| Severity | Count |
|---|---|
| Critical | {{N}} |
| High | {{N}} |
| Medium | {{N}} |
| Low | {{N}} |
| Informational | {{N}} |

### Go/no-go recommendation

**{{🔴 NO-GO | 🟢 GO | 🟡 CONDITIONAL}}.** {{one-paragraph reasoning}}

**Minimum remediation set before launch:**
1. {{fix}} ({{effort}})
2. {{fix}} ({{effort}})
...

Estimated total effort: **{{X focused workdays}}**.

---

## CRITICAL findings

### CRIT-1 — {{title}}
- **Location:** [{{file}}:{{line}}]({{file}}:{{line}})
- **Evidence:** {{code excerpt or grep result}}
- **Impact:** {{what attacker can do}}
- **Fix:** {{specific remediation}}
- **Effort:** {{XS/S/M/L}}

### CRIT-2 — {{title}}
...

---

## HIGH findings

### HIGH-1 — {{title}}
- **Location:** ...
- **Evidence:** ...
- **Impact:** ...
- **Fix:** ...
- **Effort:** ...

...

---

## MEDIUM findings

### MED-1 — {{title}}
...

---

## LOW findings

### LOW-1 — {{title}}
...

---

## INFORMATIONAL

- **INFO-1** {{title}} — {{brief}}
...

---

## Clean checks (audited and found fine)

- {{area}} — {{specific thing verified}}
...

---

## Out-of-scope / Deferred to user verification

1. **Live curl probes** — if audit sandbox blocked curl, user should run:
   ```
   curl -I {{LIVE_URL}}/
   curl -I {{LIVE_URL}}/admin/login
   curl -H "Origin: https://evil.example.com" -I {{LIVE_URL}}/api/admin/bookings
   ```
2. **`npm audit`** — run locally and report runtime-dep High/Critical CVEs.
3. **Cloudflare API token scope** — verify in dashboard (least-privilege, not Global API Key).
4. **R2 bucket public access** — verify disabled in dashboard.
5. **Stripe live cutover** — key rotation + webhook re-target.

---

## Appendix: Fix-ordering checklist (pre-launch)

**Block launch until done:**
- [ ] {{id}} {{title}} ({{effort}})
...

**Strongly recommended before real customers:**
- [ ] {{id}} {{title}} ({{effort}})
...

**Post-launch hardening:**
- [ ] {{id}} {{title}} ({{effort}})
...
