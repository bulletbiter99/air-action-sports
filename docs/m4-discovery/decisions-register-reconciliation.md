# M4 Batch 0 — Decisions Register Reconciliation

The M4 milestone prompt cited four prior decisions by number — `#23`, `#26`, `#29`, `#30` — but [docs/decisions.md](../decisions.md) at the time of M4 kickoff held only D01–D03. The cited numbers refer to an internal counter the operator had been keeping in conversation, not committed to the file.

This batch captures the substance of each cited decision as **D04 through D07** so subsequent batches reference a single durable register instead of chasing conversational context.

## Mapping table

| M4 prompt cite | D## | Substance | Lands in batch |
|---|---|---|---|
| `#23` | **D04** | Legacy `AdminDashboard` removed entirely after `new_admin_dashboard` reaches `on`; no opt-in retention path. | B10 (legacy degradation) → B12 (full removal + flag-row delete) |
| `#26` | **D05** | Customer PII (full email, phone) on the booking detail view is gated by capability `bookings.read.pii`. Marketing role sees masked. Every PII unmask writes an audit-log row. | B3 (booking detail view) |
| `#29` | **D06** | External / out-of-band refund flow always notifies the customer via the `refund_recorded_external` email template. No "skip notification" checkbox. | B3 (refund flows) |
| `#30` | **D07** | New email template `refund_recorded_external` seeded via migration 0027; subject "Refund issued for your AAS booking"; body fields: amount, method (cash/Venmo/PayPal/comp/waived), reference, contact-us-if-discrepancy. | B3 (template seed in same migration as schema fields) |

## Verbatim source — M4 prompt language

For traceability, here are the M4 prompt's literal statements (paraphrased only where the prompt itself paraphrased its own decision):

- **D04 (#23):** *"Per decision register #23, this is a breaking UX change for any user still on legacy. The Owner has signed off (decision register #23 is 'Removed entirely (no opt-in retention)'). But this batch makes the legacy still navigable, just without the table."*
- **D05 (#26):** *"PII masking: per decision register #26, customer PII on the detail view (full email, phone) is gated by `bookings.read.pii`. Marketing role sees masked. Audit log records every PII unmask."*
- **D06 (#29):** *"External refund modal — Always notifies customer per decision register #29."*
- **D07 (#30):** *"New email template seed: `refund_recorded_external` (carry-forward from Surface 2 #5 / Phase 4 decision register #30). Seeded via migration 0027; subject 'Refund issued for your AAS booking'; body specifies amount, method, reference, contact-us-if-discrepancy."*

## Consequence for the durable register

[docs/decisions.md](../decisions.md) is appended in this batch with D04–D07 entries citing the M4 prompt as source. The newest-at-top convention from D03 is preserved (D07 lands at the top, D04 below it).

After this batch, any future reference to the `#23 / #26 / #29 / #30` numbering is officially deprecated in favor of D04 / D05 / D06 / D07.

## What this batch does NOT do

- Does not implement the decisions (B3 / B10 / B12 do that).
- Does not invent decisions not stated by the operator. If the operator's recollection of `#23 / #26 / #29 / #30` differs from the M4 prompt's wording above, **stop-and-ask trigger**: confirm the substance before B3 / B10 / B12 begin.
- Does not retroactively renumber D01–D03.

## Open — gap notice

The numbering `#23 / #26 / #29 / #30` implies that `#1` through `#22` and `#24 / #25 / #27 / #28` exist somewhere. They are not in [docs/decisions.md](../decisions.md) and were not surfaced in any reviewed M3 batch doc. The most plausible interpretations:

1. **Loose conversational counter** — the operator counted decisions across conversation turns, not a formal register. Numbers below 22 may correspond to design conversations from before this codebase existed (Phase 0 / Surface 1 / Surface 2 design work).
2. **Surface-numbered references** — `Surface 2 #5` is mentioned alongside `#30` in the M4 prompt, suggesting some `#N` numbers may refer to surface-design line items rather than the decisions register.

No action this batch beyond capturing D04–D07. If a future batch hits a `#NN` reference that doesn't resolve, it'll land here for further reconciliation.
