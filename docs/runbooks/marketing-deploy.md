# Marketing milestone — deploy + activation runbook

The native Marketing milestone (B1 Segments → B6 close). B1 shipped earlier
(PR #208, on main). **B2–B6 shipped post-M7** as the chained PRs below. This
runbook is the deploy sequence + the operator activation steps.

## What shipped

| Batch | PR | What |
|---|---|---|
| B1 | [#208](https://github.com/bulletbiter99/air-action-sports/pull/208) | Customer Segments (filter engine + admin UI) — already on main |
| B2a | [#234](https://github.com/bulletbiter99/air-action-sports/pull/234) | Campaigns backend — schema (0067) + lib + admin CRUD |
| B2b | [#235](https://github.com/bulletbiter99/air-action-sports/pull/235) | Send pipeline — cron drain + CAN-SPAM unsubscribe |
| B3 | [#236](https://github.com/bulletbiter99/air-action-sports/pull/236) | Campaign composer UI + sidebar entry |
| B4 | [#237](https://github.com/bulletbiter99/air-action-sports/pull/237) | Engagement tracking (0068) — Resend events → recipients + stats |
| B5a | [#238](https://github.com/bulletbiter99/air-action-sports/pull/238) | Automations backend (0069) + cron engine |
| B5b | [#239](https://github.com/bulletbiter99/air-action-sports/pull/239) | Automations UI + sidebar entry |
| B6 | this PR | marketing.* capability seed (0070) + this runbook |

## Migrations — ✅ applied to remote 2026-06-02

- **0067_campaigns** — campaigns + campaign_recipients
- **0068_campaign_recipient_tracking** — delivered/opened/clicked/bounced/complained columns
- **0069_automations** — automations + automation_sends
- **0070_marketing_capabilities** — marketing.* caps + owner/marketing_manager bindings

(Kept as a record. All 0001–0077 are applied; a `migrations apply` finds nothing new.
Only the operator-activation items below remain.)

## Operator activation (to make sends actually fire)

Campaigns + automations send via the 15-min cron, which **no-ops** until BOTH are set:

1. **`MARKETING_POSTAL_ADDRESS`** — the business postal address (CAN-SPAM legal
   requirement; the footer is appended to every marketing email):
   ```bash
   npx wrangler secret put MARKETING_POSTAL_ADDRESS   # e.g. "Air Action Sports, 123 ..., UT 84xxx"
   ```
   (Optional: `PUBLIC_BASE_URL` — defaults to `https://airactionsport.com` for the unsubscribe link.)
2. **Resend** — `RESEND_API_KEY` is already configured for transactional mail, but
   marketing volume needs a **plan upgrade** (free tier = 100/day · 3k/mo). A
   dedicated **marketing subdomain** (e.g. `mail.airactionsport.com`) is recommended
   so bulk sends don't drag booking-confirmation deliverability.
3. **Resend webhook** (engagement tracking, B4) — the same `RESEND_WEBHOOK_SECRET`
   + dashboard webhook from the M7 deploy runbook. Subscribe `email.delivered` /
   `email.opened` / `email.clicked` (alongside the `email.bounced` / `email.complained`
   M7 already needs). Until set, sends still go out but stats stay at 0.

## Deferred follow-ups (intentional, documented)

1. ✅ **Route capability swap — DONE 2026-06-02 ([#273](https://github.com/bulletbiter99/air-action-sports/pull/273), deployed)** — segments / campaigns /
   automations routes now enforce a method-aware `requireCapability('marketing.*')`
   (0070's caps + bindings verified on remote; the route tests bind the caps via
   `bindCapabilities`). To grant a non-owner marketing role: set
   `users.role_preset_key='marketing_manager'`.
2. **`date_relative` automation trigger** — "N days before/after an event" needs an
   events→bookings→customers join not yet wired. v1 ships `recurring` + `tag_added`.
3. **Formal "Marketing" sidebar group** — Segments / Campaigns / Automations are
   adjacent standing items in the operational cluster today; a collapsible group is
   a cosmetic follow-up (churns the index-based sidebar tests).
4. ✅ **B3/B5b admin visual baselines — DONE 2026-06-02 ([#248](https://github.com/bulletbiter99/air-action-sports/pull/248))** — populated baselines for
   `/admin/campaigns` + `/admin/automations` landed in the admin visual harness
   (>30-day timestamps used so `formatRelative` renders stable absolute dates).

## Verification (post-deploy)

```bash
npm test -- --run | tail -3   # expect the campaigns/automations suites green
curl -s https://airactionsport.com/api/health   # {"ok":true,...}
```

After migrations + env + Resend are live, smoke once: create a draft campaign to a
small test segment → Preview audience → Send now → confirm the 15-min cron delivers
+ the unsubscribe link in the footer flips `email_marketing=0`.
