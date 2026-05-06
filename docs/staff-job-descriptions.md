# Air Action Sport, LLC — Staff Job Descriptions

**Document Version:** 1.0  
**Effective Date:** May 2026  
**Owner:** Air Action Sport, LLC

---

## About the Company

Air Action Sport, LLC is a Utah-based airsoft event organizer running large-scale milsim and skirmish events across multiple operating sites — currently Ghost Town (Hiawatha, UT) and Foxtrot Fields, with additional locations planned. We host events for up to 350 players, providing professional marshaling, on-site medical, chronograph services, rental gear, and an end-to-end digital booking platform with QR-coded ticketing and waiver management.

We compete on the strength of our event production: well-run safety briefings, fair refereeing, immersive scenarios, and operational reliability. Every role on this team supports that mission.

---

## How to Apply

Email **actionairsport@gmail.com** with:
1. The role title in the subject line
2. A short note explaining your interest
3. A résumé or summary of relevant experience
4. Any certifications, portfolio links, or references applicable to the role

We respond within 5 business days. Per-event roles may be hired on a rolling basis as events approach.

---

## Tier Overview

| Tier | Description | Admin role | Dashboard |
|---|---|---|---|
| **Tier 1** | Primary admin users — full dashboard, desktop-first | `owner` / `manager` | Full-surface |
| **Tier 2** | Operational specialists — scoped views, desktop or tablet | `manager` / `staff` | Narrow / focused |
| **Tier 3** | Event-day field users — mobile/tablet-first, kiosk-like | `staff` | One screen per task |
| **Tier 4** | Occasional / pass-through — light access or no login | none / magic-link | File share, kiosk view, or off-platform |

---

# Tier 1 — Primary Admin Users

These roles log in regularly and need the full surface area of the platform. Each gets a tailored home view on the admin dashboard.

---

## 1. Event Director / Operations Manager

**Department:** Operations  
**Reports to:** Owner  
**Employment Type:** Part-time W-2 OR per-event 1099 (transitions to full-time as event volume grows)  
**Location:** Utah-based; on-site at events, remote between events  
**Compensation:** $40,000–$65,000/year part-time W-2 OR $300–500/event-day as 1099 contractor  
**Admin System Role:** `owner`  
**Dashboard Home:** `/admin` — today's events, paid bookings, revenue, pending tickets, alert summary

### Summary

The Event Director owns the entire event day from setup through pack-out. This is the most operationally demanding role on the team — final say on safety, weather decisions, marshal disputes, and any incident requiring escalation. Between events, this person plans logistics, coordinates with site owners and emergency services, and partners with the Owner on growth strategy.

### Key Responsibilities

- Own end-to-end event-day execution: setup, registration, chronograph, briefing, gameplay flow, teardown
- Make final calls on weather cancellations, refund policy applications, and marshal disputes
- Coordinate with site owners (Ghost Town/Hiawatha leaseholder, Foxtrot Fields, future sites) on access, parking, and site rules
- File event permits with Carbon County Sheriff and notify Castleview Hospital ER for each event
- Manage the marshaling team: hiring, training, briefing, and on-event leadership
- Brief the medic / EMT on day-of contingencies and escalation protocols
- Run post-event debrief with all staff; capture lessons learned
- Reconcile event-day labor with bookkeeping; sign off on contractor payouts
- Liaison with insurance broker on incident reports if injuries occur
- Partner with Owner on strategic decisions: new sites, pricing, event-volume scaling
- Approve all marshal calls publicly; private feedback to marshals afterward
- Maintain a "go-bag" of event-essential supplies (radios, first-aid, tape, power)

### Required Qualifications

- 2+ years organizing or directing large outdoor events (airsoft preferred; comparable: paintball, mountain biking races, large-scale tactical training)
- Demonstrated leadership in high-pressure environments
- Calm, decisive temperament under stress
- Current First Aid and CPR certification
- Strong written communication (post-event debriefs, incident reports, vendor coordination)
- Ability to work 14-hour event days outdoors in variable weather
- Reliable transportation; some sites are 90+ minutes from urban centers
- Physical ability to walk uneven terrain for 8+ hours, lift 50 lbs

### Preferred Qualifications

- Veteran (military), law enforcement, or EMS background
- Stop the Bleed certification
- Familiarity with airsoft FPS limits, weapon classes, and standard milsim ROE
- Previous experience managing 1099 contractor teams
- Comfort with admin dashboards and event-management software

### Physical Requirements

- 14-hour event days standing, walking, and occasionally running across uneven terrain
- Outdoor exposure: heat, cold, dust, sun, wind, occasional rain
- Lift / carry up to 50 lbs (event supplies, water tanks, equipment)

### Schedule

- 1–2 events per month during active season (April–November)
- 4–6 hours/week between events for planning, vendor coordination, marshal recruitment
- On-site presence required for the full event day plus pre-event setup (typically 4:30 AM call time for an 8:00 AM first game)

---

## 2. Booking / Customer Service Coordinator

**Department:** Customer Operations  
**Reports to:** Event Director / Owner  
**Employment Type:** Part-time W-2 OR 1099 retainer  
**Location:** Remote (Utah preferred for occasional event-day attendance)  
**Compensation:** $20–25/hour part-time W-2 OR $35,000–$45,000/year full-time  
**Admin System Role:** `manager`  
**Dashboard Home:** `/admin/bookings` (default filter: most recent, action-required)  
**Secondary surfaces:** `/admin/feedback`, `/admin/new-booking`, `/admin/roster`

### Summary

The Booking & Customer Service Coordinator is the highest-frequency admin user on the platform. They handle every customer touch outside the event itself: refund requests, booking modifications, waiver questions, comp tickets, group reservations, and feedback triage. This is a relationship-and-detail role — players remember the person who fixed their booking better than they remember the marshal who reffed their match.

### Key Responsibilities

- Triage incoming feedback in `/admin/feedback` daily; respond, classify, escalate, or resolve
- Process customer-initiated refunds via `/admin/bookings/:id/refund` (Stripe integration)
- Modify bookings: attendee name changes, ticket-tier swaps, custom-question corrections
- Handle email correspondence at `actionairsport@gmail.com` (booking inquiries, group requests, post-event follow-ups)
- Issue comp tickets and manual cash/Venmo/PayPal bookings via `/admin/new-booking`
- Re-send booking confirmations and waiver-request emails when players misplace them
- Coordinate large-group reservations (corporate teams, birthday parties)
- Pre-event calls/emails to bookings of 4+ players to confirm gear and waiver status
- Monitor waiver compliance: identify attendees who haven't signed by 24h before event, send escalation reminders
- Day-of event: attend as needed for in-person customer-service issues at registration table
- Work with Marketing Manager to flag patterns in feedback (UX issues, copy confusion) for site improvements
- Maintain a customer-service playbook: refund policies, edge cases, escalation triggers

### Required Qualifications

- 2+ years customer service experience, ideally in events, hospitality, or e-commerce
- Strong written communication; clean, friendly, professional email tone
- High attention to detail — bookings, names, and dates must be exact
- Comfort with admin dashboards and ticketing systems
- Ability to handle upset customers with patience and empathy
- Reliable internet connection and quiet workspace for calls

### Preferred Qualifications

- Prior experience with Stripe, Resend, or similar transactional platforms
- Familiarity with airsoft / outdoor-recreation industry
- Spanish or other second language (not required but helpful)
- Sales experience for upsell opportunities (rentals, group packages)

### Physical Requirements

- Sedentary remote work; occasional event attendance (standing for several hours at registration)

### Schedule

- 15–25 hours/week part-time, scaling to 35–40 hours/week as event volume grows
- Flexible hours; expect higher load 1–2 days before each event and the morning after
- Occasional event-day attendance (~1 per month)

---

## 3. Marketing / Social Media Manager

**Department:** Marketing  
**Reports to:** Owner  
**Employment Type:** Part-time W-2 OR 1099 retainer ($1,500–$3,000/month)  
**Location:** Remote  
**Compensation:** $30,000–$50,000/year part-time; $60,000–$80,000/year full-time  
**Admin System Role:** `manager`  
**Dashboard Home:** `/admin/analytics` — sales velocity, conversion data, per-event performance  
**Secondary surfaces:** `/admin/feedback` (sentiment), `/admin/events` (event copy)

### Summary

The Marketing & Social Media Manager owns top-of-funnel customer acquisition. They convert outsiders into players through Instagram, Facebook, TikTok, email campaigns, and the company website. Photo and video assets from each event drive the next event's signups — this role is the connective tissue between event production and revenue growth.

### Key Responsibilities

- Maintain consistent presence across Instagram, Facebook, TikTok, and any future channels
- Curate and post event-day photos and video within 48–72 hours of each event
- Manage the photo/video asset library (organize by event, tag participants where appropriate)
- Plan and execute email campaigns: pre-event hype, post-event recaps, off-season "next event coming" pushes
- Coordinate with Photographers and Videographers (1099 contractors) on shot lists, deliverables, and turnaround
- Write event copy: descriptions, social posts, email subject lines, ad creative
- Optimize event cover images per the multi-aspect-ratio system (Card 2:1, Hero 3.2:1, Banner 4:1, OG 1.91:1)
- Track conversion: clicks → signups → paid bookings via the analytics dashboard
- Run paid promotion when budget allows (Meta Ads, TikTok Ads, Google Ads)
- Monitor brand mentions and reviews; respond to public comments; flag negative ones to Booking Coordinator
- Collaborate with Game Designer / Scenario Writer to package narrative content (faction lore, mission backstories) for marketing
- Identify and recruit micro-influencers within the airsoft community for event coverage
- Maintain the company brand voice: gritty, military-influenced, but inclusive and welcoming to first-time players

### Required Qualifications

- 3+ years social media or content marketing experience
- Demonstrated ability to grow a small-business audience on at least one platform
- Strong written copy skills: short-form social, long-form email, ad creative
- Basic photo and video editing (Lightroom / Photoshop / CapCut / Premiere or equivalents)
- Familiarity with Meta Business Suite, TikTok Business, Mailchimp / Resend / Klaviyo or similar
- Comfortable with brand-voice consistency and style guides

### Preferred Qualifications

- Existing audience or experience in airsoft, outdoor recreation, military lifestyle, or tactical gear
- Photography or videography skills (reduces contractor cost)
- Paid-ads experience with conversion tracking
- Familiarity with SEO, keyword research, Google Search Console
- Graphic design skills (Canva / Figma minimum, Adobe Creative Cloud preferred)

### Physical Requirements

- Sedentary remote work; occasional event attendance for content capture

### Schedule

- 15–25 hours/week part-time
- Workload spikes immediately before and after each event
- Some weekend work expected for event-day content
- Quarterly in-person planning meetings with Owner

---

## 4. Bookkeeper / Finance Coordinator

**Department:** Finance  
**Reports to:** Owner  
**Employment Type:** 1099 contractor, monthly engagement  
**Location:** Remote  
**Compensation:** $300–$600/month for small-business bookkeeping (volume-dependent)  
**Admin System Role:** Read-only access via analytics + booking exports (no full admin)  
**Dashboard Home:** `/admin/analytics/overview` — gross/net/refunded totals, payment-method breakdown

### Summary

The Bookkeeper owns financial accuracy. They reconcile every event's revenue against Stripe payouts and contractor labor costs, prepare monthly P&L statements, file required taxes, and ensure 1099 issuance at year-end. This is a behind-the-scenes role with high stakes — clean books are the difference between profitable growth and unpleasant surprises at tax time.

### Key Responsibilities

- Reconcile monthly Stripe payouts against `/admin/analytics` revenue reporting
- Maintain books in QuickBooks Online, Wave, or comparable platform
- Track event-by-event profitability: gross revenue minus marshal labor, EMT, port-a-potties, generators, water, etc.
- Issue 1099-NEC forms to per-event contractors at year-end
- Track and file Utah sales tax if/when applicable to the business model
- Maintain a vendor / contractor master list with 1099 thresholds
- Reconcile refunds against Stripe transactions
- Prepare monthly P&L statements for the Owner
- Track insurance, business license, and domain renewals — alert Owner 30 days before each
- Coordinate with the Owner's tax preparer at year-end for the company tax return
- Maintain receipts and expense documentation per IRS requirements (digital photos acceptable)
- Track contractor classification compliance (W-2 vs 1099 boundaries per Utah and federal rules)

### Required Qualifications

- 3+ years bookkeeping experience for small businesses
- Proficient in at least one major bookkeeping platform (QuickBooks, Wave, Xero)
- Familiarity with 1099 issuance, Schedule C / partnership returns, sales tax filing
- Strong attention to detail
- Comfort working with payment platforms (Stripe knowledge a plus)
- Discretion with financial information

### Preferred Qualifications

- Bookkeeping certification (QBO Pro Advisor, AIPB CB, or comparable)
- Experience with event-based or seasonal businesses
- Familiarity with Utah-specific tax requirements
- Experience with multi-site / multi-entity accounting (relevant as AAS expands)

### Physical Requirements

- Sedentary remote work

### Schedule

- 5–10 hours/month typical; 10–15 hours during tax season (Jan–April)
- Monthly check-ins with Owner
- Year-end close requires availability through January

---

## 5. HR Coordinator

**Department:** People Operations  
**Reports to:** Owner  
**Employment Type:** 1099 monthly retainer OR part-time W-2  
**Location:** Remote (Utah preferred for occasional event-day attendance)  
**Compensation:** $20–30/hour part-time W-2 OR $1,500–$2,500/month 1099 retainer OR $35,000–$50,000/year part-time  
**Admin System Role:** `manager` (with selective `owner` access for invitation issuance and revocation)  
**Dashboard Home:** `/admin/users` — team roster, invitation pipeline, role / active management  
**Secondary surfaces:** `/admin/audit-log` (compliance review), `/admin/feedback` (staff-submitted internal tickets)

### Summary

The HR Coordinator handles the people side of a 1099-heavy, seasonal contractor team: candidate intake, invitation issuance, onboarding paperwork, classification compliance (W-2 vs 1099 boundaries), pay-cycle coordination with the Bookkeeper, and offboarding. With most of the team being per-event contractors, this role's main job is keeping the contractor pool well-staffed, properly classified, and paid on time. Between events the work is steady but light; in the lead-up to a new event it spikes around marshal recruitment and contractor confirmations.

### Key Responsibilities

- Run the candidate pipeline: intake from `actionairsport@gmail.com`, screening calls, reference checks
- Issue platform invitations via `/admin/users` for any candidate who needs admin access; revoke access promptly when contractors finish their engagement
- Maintain the contractor master list with role, classification (W-2 / 1099), tax forms on file, certifications, and last-event date
- Collect and store W-9s, direct-deposit forms, IDs, and required certifications (CPR, First Aid, EMT, Stop the Bleed) in a secure off-platform store (encrypted cloud drive)
- Track expiration of certifications; alert role-holders 30 days before lapse
- Coordinate with the Bookkeeper on contractor payouts, 1099-NEC issuance at year-end, and W-2 wage calculations for hourly staff
- Maintain compliance with Utah and federal contractor classification rules — particularly the IRS 20-factor test boundary on per-event marshal roles
- Run quarterly contractor-classification reviews to ensure no role has drifted into de-facto employment status
- Coordinate marshal recruitment with the Lead Marshal 30+ days before each event; confirm headcount 14 days out
- Author and maintain the staff handbook, code of conduct, and event-day expectations document
- Handle interpersonal issues, complaints, and disciplinary documentation
- Conduct exit conversations with departing contractors; capture feedback for retention improvements
- Manage `/admin/audit-log` reviews for any access-control concerns (former contractor accounts, role escalations)
- Coordinate with the Attorney on any HR matter requiring legal review (terminations, complaints, accommodations)

### Required Qualifications

- 3+ years HR coordinator, recruiter, or talent operations experience
- Working knowledge of W-2 vs 1099 classification rules — IRS, Utah Department of Workforce Services
- Familiarity with onboarding paperwork: I-9, W-4, W-9, direct deposit, state new-hire reporting
- Strong organizational skills; able to maintain the contractor master list without it drifting out of date
- Discretion with personnel information
- Comfortable with admin software, spreadsheets, secure cloud-document handling

### Preferred Qualifications

- SHRM-CP, SHRM-SCP, PHR, or comparable certification
- Experience with contractor-heavy or event-industry staffing
- Familiarity with seasonal / per-event labor classification edge cases
- Experience authoring staff handbooks and policies for small businesses
- Bilingual

### Physical Requirements

- Sedentary remote work
- Optional event attendance (encouraged once or twice a year for relationship-building with the contractor pool)

### Schedule

- 8–15 hours/week typical; spikes to 20–25 hours/week in the 30 days before each event
- Quarterly classification review cycle (1–2 days each quarter)
- Year-end 1099 / W-2 coordination (5–10 hours in January)

---

# Tier 2 — Operational Specialists

These roles log in occasionally for specific workflows and get a narrower navigation surface focused on their domain.

---

## 6. Equipment / Rental Manager

**Department:** Operations  
**Reports to:** Event Director  
**Employment Type:** Part-time W-2 (when rental program is active)  
**Location:** Utah-based; on-site at events, possibly storage facility access between events  
**Compensation:** $18–22/hour part-time  
**Admin System Role:** `staff`  
**Dashboard Home:** `/admin/rentals` — inventory levels, maintenance log, current assignments  
**Secondary surfaces:** `/admin/scan` (assignment workflow), `/admin/rentals/qr-sheet` (QR labels for inventory)

### Summary

The Equipment / Rental Manager owns the company's gear inventory: rental rifles, sniper packages, BBs, vests, eye protection, and any consumable add-ons. Between events, they clean, repair, and quality-check every unit. On event day, they run the rental fitting process and reconcile returns. This role becomes essential whenever AAS offers rentals (paused for current event but planned for future events).

### Key Responsibilities

- Maintain rental gear inventory: track every unit via the rental QR system
- Pre-event quality control: inspect, test, and chrono every rental rifle before it goes on-field
- Coordinate with players at registration to fit rental gear (sizing, eye protection, magazines)
- Run the rental return desk at end of event: collect, inspect, log damage
- Maintain a maintenance log per unit: cleaning, lubrication, hop-up adjustments, internal repairs
- Track consumable inventory: BBs, batteries, lubricant, replacement parts
- Order replacement parts and new units as needed; stay within budget
- Assess and bill for damaged or missing rental units (per the Waiver §9 Rental Equipment Agreement)
- Maintain storage facility cleanliness and organization
- Coordinate with Field Marshals on rental gear that fails during play

### Required Qualifications

- 2+ years airsoft hands-on experience
- Comfortable disassembling, repairing, and reassembling AEG and gas-powered airsoft platforms
- Familiarity with chronograph operation
- Mechanical aptitude; comfortable with hand tools
- Inventory tracking experience (any system)
- Reliable transportation; ability to lift 30 lbs

### Preferred Qualifications

- Airsoft tech certifications or formal training
- Experience with Polarstar, HPA, gas blowback systems
- 3D printing or fabrication skills for replacement parts

### Physical Requirements

- Lift / carry 30 lbs regularly
- Stand for 6+ hours during event-day fittings
- Fine-motor control for small-parts work

### Schedule

- 5–10 hours/week between events for maintenance and ordering
- Full event-day presence at every event
- Some pre-event days for QC and prep

---

## 7. Game Designer / Scenario Writer

**Department:** Product / Operations  
**Reports to:** Event Director  
**Employment Type:** 1099 contractor, paid per-event or per-scenario  
**Location:** Remote for design; on-site for execution at the events they design  
**Compensation:** $200–$500/event for custom scenario design  
**Admin System Role:** `manager`  
**Dashboard Home:** `/admin/events` — event templates, scenarios, schedule builder

### Summary

The Game Designer / Scenario Writer creates the product. Each event's narrative arc, faction backstory, mission objectives, and game-mode mechanics come from this role. They turn a 14-hour day at an abandoned ghost town into a coherent story players want to retell — and recruit their friends to attend the next one. Designs hand off cleanly to the Lead Marshal for in-field execution.

### Key Responsibilities

- Design themed milsim scenarios: faction backstory, mission objectives, narrative arcs, win conditions
- Build a day-of schedule of 6–10 games covering the warmup-to-finale arc
- Write briefing documents: faction packets, mission packets, command structures
- Coordinate with Lead Marshal on game-mode mechanics: respawn rules, objective hold times, capture mechanics
- Design objectives: capture points, intel drops, hostage scenarios, defusal targets
- Create or specify props: faction flags, intel briefcases, hostage markers
- Document each game's victory conditions clearly enough that any marshal can ref it
- Iterate from event to event based on player feedback and marshal observations
- Build a library of reusable scenarios applicable across multiple sites
- Coordinate with Marketing Manager to package scenario lore as pre-event content
- Attend events they design to observe execution and gather firsthand feedback

### Required Qualifications

- Demonstrated tabletop / video game / live-action scenario design experience
- 3+ years airsoft or paintball field experience
- Familiarity with major milsim event formats (American Milsim, MilSim West, Other World Milsim)
- Strong writing skills — both worldbuilding and clear technical instructions
- Ability to translate creative vision into actionable rules
- Reliable internet for remote design collaboration

### Preferred Qualifications

- Military, law enforcement, or tactical training background
- Tabletop RPG / wargame design experience
- Familiarity with branching narratives, faction balance, asymmetric victory conditions
- Experience designing for different player skill levels in a single event

### Physical Requirements

- Sedentary remote work
- Optional event attendance (encouraged for the events they design)

### Schedule

- Project-based: typically 8–20 hours of design work per event
- Tighter timeline 4–6 weeks before event
- Optional 14-hour event day for observation and feedback

---

## 8. Site Coordinator / Permits Manager

**Department:** Operations  
**Reports to:** Event Director  
**Employment Type:** Part-time W-2 OR 1099 contractor  
**Location:** Utah-based; on-site visits to each operating location regularly  
**Compensation:** $20–30/hour  
**Admin System Role:** `staff`  
**Dashboard Home:** Site notes / venue calendar (custom internal view)  
**Secondary surfaces:** `/admin/events` (site assignments), `/admin/vendors` (port-a-potty, water, generator vendors)

### Summary

The Site Coordinator owns the relationships with each venue's leaseholder, the county sheriff, EMS dispatch, and the rotating list of vendors needed to make a remote site event-ready. This is a logistics-and-relationships role. Most of the work happens before the event arrives: filing permits, ordering port-a-potties, scheduling water delivery, and walking the site to confirm boundaries.

### Key Responsibilities

- Maintain primary relationships with site owners (Hiawatha Ghost Town leaseholder, Foxtrot Fields owner, future site owners)
- File event permits with Carbon County Sheriff (or relevant county) per event
- Notify Castleview Hospital ER (or appropriate hospital for the site) before each event
- Arrange port-a-potty rental, drinking water delivery, generator rental for each event
- Maintain a master vendor list with contact info, lead times, costs, and quality history
- Conduct site walkthroughs 1–7 days before each event to verify boundaries, parking, hazards
- File insurance certificates per site as required by venue agreements
- Maintain digital site maps and update them as site conditions change
- Document on-site hazards: collapsing structures, mine shafts, off-limits zones
- Coordinate with Event Director on parking flow, registration tent placement, marshal staging areas
- Track and file mileage for tax purposes (significant for remote sites)
- Liaise with utility providers if power is needed for events (rare but possible)

### Required Qualifications

- 2+ years logistics, event planning, or facilities coordination experience
- Comfortable with permitting and bureaucratic processes
- Strong written communication for permit applications and vendor coordination
- Reliable transportation suitable for remote sites (4WD highly preferred for Hiawatha)
- Comfortable advocating with site owners, sheriffs, and vendors

### Preferred Qualifications

- Existing relationships in Carbon County / rural Utah
- Familiarity with Utah county-level permit processes
- Experience with outdoor / remote-site event production
- Construction or property-maintenance background (helpful for site improvement projects)

### Physical Requirements

- Site walks across uneven, sometimes hazardous terrain
- Driving long distances on rural roads
- Lift 30 lbs occasionally

### Schedule

- 5–15 hours/week depending on event volume
- Site visits typically once per event minimum
- Less work in off-season months (December–March)

---

## 9. Compliance / Waiver Reviewer

**Department:** Legal / Operations  
**Reports to:** Owner (with dotted-line to Event Director on event-day issues)  
**Employment Type:** 1099 retainer; very part-time  
**Location:** Remote  
**Compensation:** $25–$40/hour, ~10–20 hours/month average; spikes during incident response  
**Admin System Role:** `staff` (read access scoped to waivers, roster, audit log)  
**Dashboard Home:** Waiver review queue + roster waiver-status filter  
**Secondary surfaces:** `/admin/audit-log` (waiver / signature events), `/admin/roster` (per-event waiver completeness), waiver-document admin views

### Summary

The Compliance / Waiver Reviewer is the back-stop on the legal posture that the in-platform e-signature system establishes. They periodically review signed waivers for completeness, confirm minor-handling fields are correctly populated by tier (12-15 / 16-17 / 18+), monitor the auto-link logic for false positives or false negatives, audit signed-document integrity (SHA-256 snapshot vs. live document), and own the response when an incident triggers waiver retrieval. This role is the shock absorber between the daily operations team and the Attorney — most weeks it produces a brief "all clear" report; in the rare incident week, it produces the chain of evidence the insurer or court will see.

### Key Responsibilities

- Review the signed-waiver queue weekly: spot-check 10–20 waivers per event for completeness, age-tier accuracy, signature legibility, and supervising-adult fields where required (12-15 tier)
- Audit the auto-link path (`findExistingValidWaiver`) periodically for false positives — confirm matched waivers truly belong to the same individual
- Verify document integrity by triggering the platform's `body_html` SHA-256 check at random intervals; investigate any `waiver_document.integrity_failure` audit row immediately
- Maintain a log of any waiver corrections or admin-side edits to attendee fields after waiver sign — confirm the original signed snapshot is preserved
- Coordinate with the Attorney on waiver-text revisions; manage versioning so retired waivers are properly preserved and never reused
- Author the next waiver document version when policy changes; coordinate with Owner for the `/admin/waivers` retire-and-replace flow
- Pull waiver records on demand for incident response — typically <24 hours from request to a clean PDF package the insurer or attorney can use
- Track the Claim Period (365-day) auto-renewal logic; produce monthly reports on waivers about to expire vs. waivers freshly renewed
- Audit terminal-status transitions in the feedback system to confirm R2 attachment auto-deletion is firing correctly (cross-discipline check on the `attachment_deleted_at` stamp)
- Review every `cron.swept` audit row monthly to confirm reminder cron health and document any missed sweeps for the Owner
- Maintain a list of "policy edge cases" flagged but not yet resolved — feeds into quarterly waiver-text reviews

### Required Qualifications

- Paralegal certification, JD without active bar admission, or 3+ years compliance / legal-ops experience in a contractor-heavy or events business
- Comfort with reading audit logs and database snapshots; basic SQL helpful
- Strong attention to detail; tolerant of repetitive review work
- Familiarity with electronic-signature legal frameworks (ESIGN, UETA, Utah Code §46-4)
- Discretion with personally identifiable information and medical-conditions data
- Reliable secure communications setup (encrypted email or signal)

### Preferred Qualifications

- Active paralegal certification (NALA CP / CLA, NFPA PACE)
- Experience with insurance claims, incident response, or premises-liability matters
- Familiarity with Utah recreational immunity statutes and outdoor-event liability framework
- Prior exposure to airsoft, paintball, or other contact-sport waiver regimes

### Physical Requirements

- Sedentary remote work

### Schedule

- 10–20 hours/month average; mostly self-directed
- Real-time response required if an incident triggers a waiver retrieval (target: <24 hours from request)
- Quarterly deeper-audit weeks (1 full day each)

---

## 10. Read-only Auditor

**Department:** External / Compliance (engagement-based)  
**Reports to:** Owner (in their AAS capacity); reports to client / insurer / oversight body in their primary capacity  
**Employment Type:** External — engagement-based (annual insurance audit, post-incident review, periodic financial audit)  
**Location:** Remote; engagement-bounded  
**Compensation:** External — billable to the engaging party (insurer, CPA firm, or attorney's office), not paid directly by AAS  
**Admin System Role:** `staff` with read-only profile, time-boxed access (account active during engagement, deactivated by HR Coordinator at engagement close)  
**Dashboard Home:** `/admin/audit-log` (filtered + paginated viewer with full metadata expansion)  
**Secondary surfaces:** `/admin/analytics/overview`, `/admin/bookings` (read), waiver-document review

### Summary

The Read-only Auditor is the temporary external visitor with scoped access — typically an insurance examiner doing the annual COI renewal review, a CPA partner spot-checking books before tax season, or an attorney's investigator pulling records during incident response. They are not paid by AAS payroll. They get a time-boxed `staff` account that the HR Coordinator provisions at engagement start and deactivates at engagement close. Every action they take is captured by the existing `audit_log` so AAS can reconstruct exactly what they viewed and when.

This is not a continuous role. It exists in the org chart so the Owner and HR Coordinator have a defined posture — provisioning, scope, monitoring, and offboarding — for the recurring "external auditor needs to look at our system for a week" scenario.

### Key Responsibilities

- Conduct read-only review per engagement scope (financial audit, insurance compliance, incident-response evidence package)
- Operate exclusively via the read-only `staff` admin account provisioned for the engagement; never request elevated access
- Acknowledge that all actions are audit-logged and that the Owner / HR Coordinator may review the access record at any time
- Produce a written deliverable per engagement (audit memo, compliance letter, evidence package); deliver to the engaging party, not retained inside AAS systems
- Coordinate with the HR Coordinator on engagement start (account provisioning) and end (deactivation, password reset on the shared account if rotated)
- Surface any system / data anomalies discovered during review to the Owner via written communication, not via the platform's feedback system
- Maintain confidentiality per the engagement letter; AAS data does not leave the engaging party's secure environment

### Required Qualifications (varies by engagement type)

- For insurance audit: licensed insurance examiner or qualified broker representative
- For financial audit: licensed CPA or experienced staff auditor at a CPA firm
- For incident response: paralegal, attorney, or investigator engaged by the responding attorney's office
- Familiarity with cloud-hosted admin platforms; able to navigate without hand-holding
- Strong written communication for the audit deliverable
- Discretion with personally identifiable information

### Preferred Qualifications

- Prior exposure to events, recreation, or contractor-heavy industries
- Experience with Stripe data, Cloudflare Workers logging, or comparable lightweight stacks
- Familiarity with electronic-signature legal frameworks (ESIGN, UETA, Utah Code §46-4)

### Physical Requirements

- Sedentary remote work
- Engagement-bounded — typically 4–40 hours per engagement

### Schedule

- Engagement-based, not retainer-based
- Typical engagements: annual insurance audit (~1 week), pre-tax CPA review (~3 days), post-incident review (variable, hours to weeks)
- AAS coordinates start / end with HR Coordinator; auditor account is deactivated within 24 hours of engagement close

---

# Tier 3 — Event-Day Field Users

These roles are on the field, often with gloves on, in variable weather. They get a stripped-down mobile view, ideally one screen per task. All Tier 3 roles are 1099 contractors paid per-event.

---

## 11. Check-In / Registration Staff

**Department:** Operations  
**Reports to:** Event Director  
**Employment Type:** 1099 contractor, paid per-event  
**Location:** On-site at each event; pre-event arrival ~5:30 AM for 6:30 AM check-in start  
**Compensation:** $20–25/hour OR $150–200/event-day flat  
**Admin System Role:** `staff`  
**Dashboard Home:** `/admin/scan` — full-screen QR scanner mode optimized for tablet  
**Secondary surfaces:** `/admin/roster` (paper-fallback view), `/admin/new-booking` (walk-up sales)

### Summary

Check-In Staff are the first faces players see on event day. They scan QR tickets, verify ID, confirm waiver completion, issue color-coded wristbands, hand out event patches, and route players to the chronograph station. Speed and friendliness both matter — 350 players checking in over a 90-minute window means about one player every 15 seconds.

### Key Responsibilities

- Check players in via tablet-based QR scanner at registration tent
- Verify government-issued ID matches the booking name (especially for ages 18–25)
- Confirm waiver status; route unsigned players to a separate waiver-completion table
- Issue color-coded wristbands (waiver status, weapon class, or team — directed by Event Director per event)
- Hand out event patches, lanyards, ticket pouches
- Direct players to chronograph next, then safety briefing
- Process walk-up ticket sales via the manual booking flow when available
- Handle inevitable edge cases: forgotten tickets (look up by email), ID mismatches, name changes, late arrivals
- Maintain a clean, organized registration table throughout the morning rush
- Count and reconcile patches / wristbands at end of check-in window

### Required Qualifications

- Customer service experience, especially in event or hospitality settings
- Comfort with tablets, QR scanners, and basic admin software
- Friendly, calm demeanor under fast-paced conditions
- Ability to read and verify ID accurately
- Willingness to work outdoors in early morning conditions (cold, dim light)

### Preferred Qualifications

- Prior event-staff experience
- Familiarity with airsoft / outdoor-recreation industry
- Spanish or other second-language skills

### Physical Requirements

- Standing for 4–6 hours during the morning check-in window
- Outdoor exposure (cold morning temps, possible rain or wind)
- Light lifting (40 lbs) for setup and teardown of the registration tent

### Schedule

- Per-event: arrive 5:30 AM, work until 11:00 AM (or until the morning check-in window closes)
- Optional: stay through end of event for end-of-day duties (additional pay)

---

## 12. Lead Marshal / Head Referee

**Department:** Operations  
**Reports to:** Event Director  
**Employment Type:** 1099 contractor, paid per-event  
**Location:** On-site at each event; pre-event arrival ~5:00 AM  
**Compensation:** $250–350/event-day  
**Admin System Role:** `manager`  
**Dashboard Home:** Mobile-friendly briefing-and-roster view (per-event command screen)  
**Secondary surfaces:** `/admin/scan` (incident lookup), `/admin/roster` (player headcount)

### Summary

The Lead Marshal runs the field. They train and assign Field Marshals, deliver the safety briefing to all 350 players, run the chronograph station, manage radio comms, and have final authority on ROE interpretation in field. When a dispute escalates, it lands here. Calmness, decisiveness, and crowd-presence are non-negotiable.

### Key Responsibilities

- Train Field Marshals at pre-event briefing (1+ hour before player arrival)
- Deliver the safety briefing to all players using portable PA / megaphone
- Manage chronograph station — train Chrono Officer, spot-check FPS-tampering suspicions
- Coordinate marshal radio comms: assign channels, monitor dispute traffic
- Final authority on ROE calls in field; interpretation standards documented
- Handle ejections for safety violations or repeated cheating
- Coordinate with Event Director on weather decisions, schedule changes
- Run inter-game resets: brief on next game's rules, position objectives, rotate marshal assignments
- Authority to authorize "training knife" admin-approved status per Waiver §3 Knife rules
- Authority to suspend play for safety or weather; coordinate evacuation if needed
- Post-event marshal debrief: what worked, what didn't, who to bring back next time

### Required Qualifications

- 5+ years airsoft field experience including major milsim or large-scale events
- Demonstrated ROE familiarity and willingness to enforce
- Calm under pressure; comfortable making unpopular calls publicly
- Strong public-speaking ability (briefing 350 people)
- Current First Aid and CPR certification
- Reliable transportation
- Willing to commit to the full event day (4:30 AM call, 9:00 PM finish)

### Preferred Qualifications

- Veteran (military), law enforcement, or EMS background
- Stop the Bleed certification
- Prior referee or sports official experience
- Experience with tournament bracket formats
- Familiarity with major milsim event organizations (American Milsim, MilSim West, Other World Milsim, MilSim City)

### Physical Requirements

- 14-hour event days standing, walking, occasionally running across uneven terrain
- Outdoor exposure: heat, cold, dust, sun, wind, rain
- Carry 20+ lbs of marshal kit (radio, water, first-aid, clipboard, megaphone)

### Schedule

- Per-event: arrive 5:00 AM, work through teardown (~9:00 PM)
- Pre-event: 30 minutes weekly during the 4 weeks leading up to a major event
- Post-event: 1-hour debrief

---

## 13. Field Marshal

**Department:** Operations  
**Reports to:** Lead Marshal  
**Employment Type:** 1099 contractor, paid per-event  
**Location:** On-site at each event; pre-event arrival ~5:30 AM  
**Compensation:** $125–200/event-day  
**Admin System Role:** `staff`  
**Dashboard Home:** Mobile roster view + quick incident-log button (one-screen-per-task)  
**Secondary surfaces:** `/admin/scan` (lookup attendee details)

### Summary

Field Marshals are the eyes and authority on the field during play. Each one owns a zone (a building cluster, bunker complex, or play sector) and watches for safety violations, FPS-tampering, blind-fire incidents, and cheating. They settle disputes at the moment they happen, defer to the Lead Marshal for big calls, and reset objectives between games. This is the most numerous role on event day.

### Key Responsibilities

- Patrol assigned game zone during play; maintain visual presence
- Call disputes immediately; defer to Lead Marshal if escalated
- Watch for and enforce: blind-fire violations, off-limits incursions, eye-protection compliance, FPS tampering, ghosting (not calling hits)
- Eject players for repeat safety violations after warning
- Reset objectives, capture points, and props between rounds
- Carry a marshal kit: hi-vis vest, whistle, radio, mini first-aid, gloves, field map
- Use radio per the Lead Marshal's channel plan
- Spot and report injuries to the Medic via radio
- Note any infrastructure issues (collapsed structure, downed tape, missing signage) for between-round repair
- Brief their zone before each game; clarify game-specific rules
- Post-event: contribute to the marshal debrief

### Required Qualifications

- 1+ year airsoft field experience
- Calm under pressure, comfortable enforcing rules with strangers
- Basic radio etiquette (will be trained on the day's channel plan)
- Reliable transportation
- Willing to commit to the full event day

### Preferred Qualifications

- Prior referee, security, or sports-official experience
- First Aid / CPR / Stop the Bleed certifications
- Familiarity with airsoft FPS limits and weapon classes
- Multilingual (Spanish helpful for some player demographics)

### Physical Requirements

- 14-hour event days standing, walking, occasionally running across uneven terrain
- Outdoor exposure: heat, cold, dust, sun, wind, rain
- Carry 15+ lbs of marshal kit
- Comfortable approaching and addressing players in conflict

### Schedule

- Per-event: arrive 5:30 AM, work through end of play (~8:00 PM)
- Optional: stay for teardown (additional pay)

---

## 14. Safety Officer / Chronograph Operator

**Department:** Operations  
**Reports to:** Lead Marshal  
**Employment Type:** 1099 contractor, paid per-event  
**Location:** On-site at each event; pre-event arrival ~5:30 AM  
**Compensation:** $150–250/event-day  
**Admin System Role:** `staff`  
**Dashboard Home:** Mobile chrono log — one record per player, weapon class capture, pass/fail tag  
**Secondary surfaces:** Standalone chrono log via worker API

### Summary

The Safety Officer / Chronograph Operator runs the chronograph station — the gate between check-in and the field. Every replica gets velocity-tested with 0.20g BBs and tagged for its declared weapon class (Rifle 350, DMR 450, LMG 450, Sniper 550). Tampering, even suspected, is grounds for ejection. This is a technical role with high authority — they can stop a player from playing entirely.

### Key Responsibilities

- Operate chronograph (Acetech Lighter S, Xcortech X3300, or similar) for every replica
- Use AAS-supplied 0.20g BBs for chrono testing (don't trust player-supplied BBs)
- Verify each gun against its declared weapon class
- Issue color-coded weapon-class tag / sticker per gun
- Issue "fail tag" for over-FPS guns; player can tune down on-site or sit out
- Spot-check during play (per Lead Marshal request) for FPS-tampering suspicions
- Provide tools (allen keys, hop-up adjusters, spring access) for players to tune down on the spot
- Maintain a digital log of every chrono'd weapon (player ID, weapon class, FPS reading, timestamp)
- Authority to confiscate weapons that exceed limits; secured at HQ until end of day
- Report tampering attempts immediately to Lead Marshal for ejection decision
- Maintain chrono station: power, BBs, replacement parts, sun cover

### Required Qualifications

- 3+ years airsoft hands-on experience including FPS testing
- Familiarity with AEG, gas, and HPA platforms
- Ability to identify and explain FPS issues to players
- Basic mechanical aptitude with hand tools
- Calm under pressure; willing to make unpopular calls
- Reliable transportation

### Preferred Qualifications

- Airsoft tech certifications or formal training
- Familiarity with hop-up tuning, spring swaps, regulator settings
- Prior tournament chrono experience
- Multilingual

### Physical Requirements

- Stand or sit at chrono station for 4–6 hours during morning rush
- Fine-motor work with small parts and tools
- Outdoor exposure (sun cover provided)

### Schedule

- Per-event: arrive 5:30 AM, work through end of check-in window (~11:00 AM)
- Optional: spot-check rotations during play (additional pay if extended hours)

---

## 15. Event EMT / Medic

**Department:** Operations  
**Reports to:** Event Director  
**Employment Type:** 1099 contractor, paid per-event  
**Location:** On-site at each event; pre-event arrival ~6:00 AM  
**Compensation:** $300–500/event-day  
**Admin System Role:** `staff` (read-only attendee lookup for medical-conditions field)  
**Dashboard Home:** Mobile incident-report form + emergency contact lookup  
**Secondary surfaces:** Roster view (filterable by medical-conditions field)

### Summary

The Event EMT / Medic is the on-site medical authority. They handle minor injuries (cuts, sprains, eye irritation, dehydration), decide field-vs-transport for serious cases, and call 911 when needed. They hold final medical authority — even the Event Director defers to medical decisions. With 350 players in remote terrain ~20 minutes from the nearest hospital, this role's competence directly affects player safety.

### Key Responsibilities

- Maintain on-site medical kit (large, stocked) at HQ; visible to all players and staff
- Triage and treat minor injuries on-site: bandaging, splinting, eye-wash, electrolyte management
- Decide field-vs-transport for serious injuries; call 911 when escalation needed
- Authorized to seek emergency medical treatment on player's behalf when player is incapacitated (per Waiver §17 Medical Emergency Authorization)
- Review participant medical-conditions field on roster pre-event for awareness
- Provide responding emergency personnel with relevant medical info from booking record
- Maintain refusal-of-treatment forms; obtain signature when applicable
- Run the eye-wash station (separate from main first-aid)
- Manage AED (if provided) and confirm working condition pre-event
- Coordinate with Lead Marshal on ceasefire calls when injuries occur
- Handle heat / cold / dehydration risks proactively (May UT can hit 90°F by midafternoon)
- File post-event incident reports for any treated injury or transport
- Liaise with insurance broker on incident documentation if needed
- Maintain own malpractice coverage (or confirm coverage under company insurance)

### Required Qualifications

- Active EMT-B certification minimum (EMT-A or higher preferred)
- Valid Utah credentials
- Current AHA / ARC CPR + First Aid certifications
- Own vehicle with reliable transportation to remote sites
- Own malpractice / liability coverage OR willingness to be added to AAS company policy
- Reliable cell phone (or satellite communicator if cell coverage is poor at site)
- Discretion with medical information; HIPAA awareness

### Preferred Qualifications

- Wilderness First Responder (WFR) certification — highly valued for remote sites
- Stop the Bleed certification
- Prior event medic experience (concerts, sports events, conventions)
- Trauma / emergency department clinical hours
- Bilingual

### Physical Requirements

- 14-hour event days outdoors
- Ability to walk to incident scenes across uneven terrain
- Carry 20+ lbs medical kit
- Lift / assist patient transfers up to 200 lbs (with assistance)
- Comfortable making field decisions about medical escalation

### Schedule

- Per-event: arrive 6:00 AM, work through last player departure (~8:30 PM)
- On-call only during event hours; not expected to be available between events
- May be retained for multiple consecutive event days if AAS runs back-to-back events

---

# Tier 4 — Occasional / Pass-through Users

These roles touch the platform infrequently or not at all. They get magic-link views, file shares, or no admin presence — when they need information, the system pushes it to them rather than expecting them to log in. Some roles in this tier are entirely external (Insurance Broker, Attorney) and are included in this document so the org chart is complete and the working relationship is clear.

| Role | Treatment |
|---|---|
| Event Media / Photographer | Asset upload portal or shared cloud folder; no admin dashboard |
| Setup / Teardown Crew | Printable PDF checklist or registration-tent kiosk view; no login |
| Vendor / Sponsor Coordinator | Magic-link to sponsor packet status (existing platform vendor magic-link system) |
| Junior Field Designer / Construction | No admin access; works from printed maps and direct supervisor instruction |
| Graphic Designer | Asset library access only (Dropbox / Google Drive brand folder) |
| Insurance Broker | External — no admin access; data shared via email |
| Attorney | External — no admin access; engagement-bounded record requests |

---

## 16. Event Media / Photographer

**Department:** Marketing  
**Reports to:** Marketing / Social Media Manager (between events) / Event Director (on-site coordination)  
**Employment Type:** 1099 contractor, paid per-event  
**Location:** On-site at each event; ~7:00 AM call time for setup B-roll through end of last game  
**Compensation:** $200–$400/event-day OR $50–$100/hour (deliverable-dependent)  
**Admin System Role:** None — uploads to a dedicated R2 asset folder or shared cloud drive (Dropbox / Google Drive)  
**Dashboard Home:** None — works off a per-event shot list and an upload portal

### Summary

The Event Media / Photographer captures the event for marketing reuse and player keepsakes — gameplay action, candid player moments, faction lineups, scenario set pieces, and short-form vertical video for social. The Marketing Manager publishes a shot list before the event; the photographer executes it, uploads everything to the shared library within 7 days, and tags rough metadata so the Marketing Manager can package content quickly.

### Key Responsibilities

- Arrive on-site for the briefing; understand the day's scenario arc to know which moments matter
- Capture stills (RAW + JPEG) and short-form vertical video per the Marketing Manager's shot list
- Cover the safe-zone candid moments and registration energy in addition to gameplay
- Wear high-visibility marshal vest or media bib supplied by AAS so players know the camera is staff
- Respect the chronograph station and the safety briefing — never block sightlines, never cross active fields
- Comply with AAS photo / drone policy and the player consent posture established by Waiver §15
- Stage and shoot any group / faction lineup photos at end-of-day before player dispersal
- Upload all assets within 7 days to the shared library; tag minimal metadata (event slug, faction or scene, rough timestamp)
- Deliver a shortlist of 30–50 hero images within 48 hours for immediate social use
- Surface any player-flagged "do not photograph" wristband / lanyard markers to the Marketing Manager so those individuals are not used in published content

### Required Qualifications

- Demonstrated event / action / sports photography portfolio
- Own professional camera body + at least one fast zoom lens (24-70 / 70-200 equivalent)
- Comfortable shooting in variable outdoor light, dust, and unpredictable conditions
- Reliable upload-capable internet at home for delivery within 7 days
- Comfortable with field hazards: BB ricochets, smoke grenades, fast-moving players

### Preferred Qualifications

- Experience with paintball, airsoft, or other action-sports photography
- Drone certification (FAA Part 107) — drone footage is permitted under AAS Photo / Drone Policy
- Short-form video editing capability (Reels / TikTok / YouTube Shorts cuts)
- Own backup body or willingness to bring two cameras for a 14-hour day

### Physical Requirements

- 10–14 hour event days outdoors carrying camera kit (15–25 lbs)
- Walking and running across uneven terrain to follow action
- Comfort with BB strikes (eye protection mandatory; full mask recommended when shooting from forward positions)

### Schedule

- Per-event: arrive 7:00 AM, work through end-of-day group photos (~7:00 PM)
- Post-event: upload + tag within 7 days; hero shortlist within 48 hours
- Optional engagement for marketing-only shoots between events (location scouts, gear-feature shots)

---

## 17. Setup / Teardown Crew

**Department:** Operations  
**Reports to:** Site Coordinator / Event Director  
**Employment Type:** 1099 contractor, paid per-event hourly OR per-event flat  
**Location:** On-site at each event; pre-event setup typically the day before; teardown immediately post-event  
**Compensation:** $15–$20/hour OR $100–$200/event-day flat  
**Admin System Role:** None — works from a printable PDF setup-and-teardown checklist or a registration-tent kiosk view of the same checklist  
**Dashboard Home:** Printed checklist OR static kiosk page (no login)

### Summary

The Setup / Teardown Crew does the physical labor that makes a remote site event-ready and then erases the footprint. Pre-event: registration tent, parking signage, faction-zone flags, port-a-potty placement, generator placement, water station setup, marshal radio test. Post-event: full teardown, trash haul-out, lost-and-found collection, prop return to storage. The work is honest physical labor; the value is reliability and not breaking expensive things.

### Key Responsibilities

- Arrive at site per Site Coordinator's pre-event call time (typically the day before for a 4 AM following-day event)
- Work the printed setup checklist top-to-bottom; check off each item; flag missing or damaged supplies to Site Coordinator immediately
- Erect tents, signage, flag poles, parking-flow cones, registration table, chronograph table, safe-zone signage
- Position port-a-potties, water stations, generators, AED station per site map
- Test marshal radios and confirm channel assignments before player arrival
- Help unload and stage rental gear (rifles, magazines, masks) per Equipment Manager's instructions
- Post-event: full reverse — break down everything, sweep registration zones, haul trash to dumpster or take-out service, collect lost-and-found into a labeled bin handed to Booking Coordinator
- Pack-out check: leave the site cleaner than found per the venue agreement
- Help load company truck/trailer for return; secure equipment for transport
- Assist with pre-event field construction prep handed off from Junior Field Designer when applicable

### Required Qualifications

- 18+
- Reliable transportation to remote sites
- Physical capability for sustained outdoor labor across heat, cold, dust, wind
- Willingness to follow a written checklist exactly without skipping items
- Basic hand-tool comfort (drill, hammer, mallet, level)

### Preferred Qualifications

- Construction, landscaping, event-production, or military background
- Forklift / Bobcat / loader experience for sites that have heavy props
- Prior event-staff experience in any field

### Physical Requirements

- 8–12 hour days of physical labor outdoors
- Lift / carry up to 75 lbs (tents, water tanks, prop pieces)
- Bend, kneel, climb ladders for tent and signage rigging
- Tolerance for sun, heat (May UT can hit 90°F), cold, dust, and BB-debris cleanup

### Schedule

- Per-event: pre-event setup day (often the calendar day before; 6–10 hours)
- Event-day teardown immediately post-event (4–6 hours)
- Some events may consolidate setup + teardown into a single 14-hour bookend day on either side

---

## 18. Vendor / Sponsor Coordinator

**Department:** Business Development  
**Reports to:** Owner (with Event Director on-site coordination)  
**Employment Type:** 1099 retainer OR per-event commission  
**Location:** Mostly remote; occasional on-site for marquee events  
**Compensation:** $1,000–$3,000/event for sponsor recruitment OR commission percentage on signed sponsorship deals  
**Admin System Role:** None directly — receives the same magic-link to per-event package status that any vendor receives via the platform's existing Vendor MVP / v1 system  
**Dashboard Home:** None — uses the per-event vendor magic-link page as their working surface

### Summary

The Vendor / Sponsor Coordinator recruits and onboards the sponsors and product vendors that show up at events — energy drink reps, gear brands, food trucks, apparel companies, local businesses interested in airsoft demographics. They negotiate the sponsorship terms, hand the vendor's contact off to the in-house admin team for system onboarding (via `/admin/vendors`), and then use the magic-link they receive as a CC'd contact to track package readiness. Most of their work happens in email, phone, and the occasional in-person meeting; the platform interaction is read-only via the magic-link.

### Key Responsibilities

- Build and maintain a target list of prospective sponsors aligned with AAS player demographics
- Pitch sponsorship tiers and packages; close deals on Owner-approved terms
- Hand off signed sponsors to Owner / Event Director for system onboarding (vendor record creation in `/admin/vendors`, package composition in `/admin/vendor-packages`)
- Follow the per-event vendor packet status via their magic-link CC; nudge vendors who haven't viewed or signed by the Event Director's deadline
- Coordinate booth requirements (footprint, power, water, weight) with the Site Coordinator
- Confirm COI submission per AAS vendor policy; chase missing or expired COIs through the platform's vendor magic-link upload flow
- Coordinate sponsor on-site activation: booth placement, signage rights, social-media call-outs
- Track post-event vendor satisfaction; capture feedback for the next event's pitch
- Work the renewal / upsell motion event-over-event so repeat sponsors compound

### Required Qualifications

- 2+ years sales, business development, or account management experience
- Comfort with cold outreach and multi-month relationship-building cycles
- Strong written communication for proposal / pitch decks
- Discretion with confidential commercial terms
- Reliable internet and phone for remote work

### Preferred Qualifications

- Existing relationships in the airsoft, tactical, outdoor-recreation, or events industries
- Experience selling sponsorships at events / festivals / concerts / sports venues
- CRM proficiency (HubSpot, Salesforce, or comparable)
- Familiarity with sponsorship-tier structures and activation rights

### Physical Requirements

- Sedentary remote work
- Optional event attendance for marquee events (sponsor activation walk-through)

### Schedule

- 10–20 hours/week typical; 5–10 hours additional in the 30 days before each event
- Quarterly business-review cycle with Owner on the sponsorship pipeline
- Per-event activation day (~6 hours) when sponsors require on-site relationship coverage

---

## 19. Junior Field Designer / Construction

**Department:** Operations  
**Reports to:** Site Coordinator (logistics) / Game Designer (creative direction)  
**Employment Type:** 1099 per-project / per-event  
**Location:** On-site at the operating sites — Ghost Town (Hiawatha), Foxtrot Fields, future locations  
**Compensation:** $15–$22/hour OR $200–$500/project flat  
**Admin System Role:** None — works from printed site maps, scenario specs, and direct Game-Designer instruction  
**Dashboard Home:** None

### Summary

The Junior Field Designer / Construction role builds and maintains the physical scenery that turns a piece of land into a believable battlefield: bunkers, sandbag walls, faction-themed buildings, intel-drop boxes, capture-point flag poles, signage, prop weapon caches. The Game Designer specifies what's needed; this role builds it. Skills overlap with carpentry, basic welding, scenic-design, and prop-making.

### Key Responsibilities

- Build to spec from the Game Designer's scenario document — bunkers, walls, signage, props, faction structures
- Source materials within an approved per-project budget (lumber, sandbags, paint, hardware)
- Maintain existing field structures across events: repair damage, replace weather-eroded pieces, repaint faction colors as scenarios change
- Coordinate with Site Coordinator on site-permitted construction (some venues restrict permanent installations)
- Work safely with hand and power tools in remote site conditions
- Tear down or relocate temporary structures post-event when required by the venue agreement
- Document built structures with photos for the Game Designer's prop library
- Flag any structural-integrity concerns on existing builds (rotted wood, rusted hardware, settling) to Site Coordinator before they become safety issues

### Required Qualifications

- Demonstrated carpentry, set-building, prop-making, or comparable hands-on construction skill
- Own basic hand and power tools (drill, saw, drivers, measuring tools)
- Reliable transportation to remote sites; pickup or trailer capacity helpful
- 18+
- Comfortable working independently from written specs

### Preferred Qualifications

- Theater / film set-building experience
- Carpentry or welding training
- Military / law-enforcement background with experience around tactical structures
- Painting, weathering, and faux-finish skills for prop authenticity

### Physical Requirements

- 8–10 hour days of construction labor outdoors
- Lift / carry up to 75 lbs
- Comfortable with ladders, power tools, dust, and intermittent weather exposure
- Eye and ear protection (own preferred; AAS supplies as backup)

### Schedule

- Project-based — typically 2–10 days per scenario / build cycle
- Scheduled before the events that will use the new builds (Game Designer specifies timeline)
- Off-season maintenance pass at each operating site (typically once per off-season)

---

### Specialty / Contractor Roles

The roles below are case-by-case engagements: ad-hoc graphic design for marketing, the external insurance broker who maintains AAS's coverage, and the external attorney consulted on legal matters. Compensation, engagement structure, and access posture vary widely. They are listed here so the org chart is complete; none of them gets a regular admin login.

---

## 20. Graphic Designer

**Department:** Marketing  
**Reports to:** Marketing / Social Media Manager  
**Employment Type:** 1099 contractor, ad-hoc per-project  
**Location:** Remote  
**Compensation:** $50–$100/hour OR $200–$1,500/project (project-dependent)  
**Admin System Role:** None — uses brand asset library access (Dropbox / Google Drive AAS brand folder)  
**Dashboard Home:** None

### Summary

The Graphic Designer turns marketing briefs into shippable visual assets: event flyers, faction logos, social-media templates, ticket art, swag mockups, sponsor-deck templates. They work from briefs the Marketing Manager writes and the existing AAS brand kit (logos, fonts, color palette) stored in the shared brand folder. Engagement is project-by-project — there is no continuous workload between events, but the Marketing Manager has the designer on speed-dial for fast-turn social pieces during pre-event campaigns.

### Key Responsibilities

- Take a written brief from the Marketing Manager and produce print-ready and web-ready assets
- Maintain consistency with the AAS brand kit (logo usage, color palette, typography)
- Deliver source files (Adobe / Figma / Affinity) in addition to flat exports so future edits stay in-house
- Provide multiple ratio exports per asset where consumer surfaces require it (event covers in card 2:1 / hero 3.2:1 / banner 4:1 / social 1.91:1)
- Surface any brand-kit gaps — missing weight of a typeface, undefined secondary color, etc. — to Marketing Manager
- Respect an agreed turnaround time per project; flag scope creep promptly

### Required Qualifications

- Demonstrated portfolio across event marketing, sports, tactical, or outdoor-recreation industries
- Adobe Creative Suite (Photoshop, Illustrator, InDesign), Figma, or Affinity equivalent
- Strong typography and layout fundamentals
- Comfort with multiple output specs (print bleed, web ratios, social platform dimensions)
- Reliable file delivery via shared cloud drive

### Preferred Qualifications

- Familiarity with airsoft, paintball, military, or tactical visual aesthetics
- Motion graphics for short-form video promos
- Experience with print production (banners, flyers, swag mockups)
- Familiarity with the per-surface event cover ratios used by the AAS booking system

### Physical Requirements

- Sedentary remote work

### Schedule

- Project-based; typical project: 4–20 hours
- Spikes around event-launch marketing campaigns (pre-event 30 days)
- Off-season volume is light; no minimum monthly engagement required

---

## 21. Insurance Broker

**Department:** External vendor relationship  
**Reports to:** Owner  
**Employment Type:** External — broker is an employee of an insurance brokerage; AAS pays annual policy premiums to the brokerage, not direct compensation to the broker  
**Location:** External — broker's office (typically Utah-based for state-licensed brokerage)  
**Compensation:** External — broker compensation comes via the insurer's commission structure; AAS pays annual policy premiums  
**Admin System Role:** None — external; data shared via email or phone, never via platform access  
**Dashboard Home:** None — relationship is off-platform

### Summary

The Insurance Broker maintains AAS's general liability + event-specific coverage and is the first call when an injury or property-damage incident occurs. They are not staff and not a contractor in the traditional sense — they are an external vendor whose firm represents AAS to one or more underwriters. This role exists in the org chart so the Owner, Event Director, and Compliance / Waiver Reviewer all know who to call and what the engagement boundaries are.

### Key Responsibilities (broker, not AAS-side)

- Maintain AAS's general liability and event-specific policy through the broker's chosen underwriter
- Issue COI (Certificate of Insurance) on demand for each operating site, sponsor, and venue agreement
- Process incident claims when injuries or property damage occur; coordinate with the underwriter's claims adjuster
- Renew the annual policy; advise on coverage adjustments as event volume scales
- Recommend supplemental coverage as new operating sites or activities are added
- Provide guidance on policy boundaries (what is and isn't covered) when the Owner or Event Director asks

### AAS-side coordination (handled by Owner / Compliance Reviewer)

- Notify the broker within 24 hours of any incident likely to trigger a claim
- Provide the incident report, EMT report, signed waiver of involved parties, and witness statements
- Provide the audit-log evidence package on request (handled by Compliance / Waiver Reviewer or Read-only Auditor)
- Coordinate with the broker on annual COI renewals for each operating site

### Engagement Terms

- Annual policy renewal cycle
- 24-hour response standard for incident notifications
- Broker provides COI within 5 business days of request

### Notes

- This role is included for documentation completeness. If AAS needs to switch brokerages, the Owner is the decision-maker.

---

## 22. Attorney

**Department:** External vendor relationship  
**Reports to:** Owner  
**Employment Type:** External — attorney works at a law firm; engaged hourly OR via a small monthly retainer  
**Location:** External — attorney's office (Utah-licensed for Utah-specific matters; consult with co-counsel for multi-state expansion)  
**Compensation:** External — typically $300–$500/hour billable rate; periodic engagement; small monthly retainer optional ($500–$1,500/month for fast-response posture)  
**Admin System Role:** None — external; record requests handled via email per engagement-bounded scope  
**Dashboard Home:** None — relationship is off-platform

### Summary

The Attorney is the legal counsel of last resort: waiver-text drafting, vendor-contract review, employment-classification advisories, incident-response counsel, and litigation defense if it ever comes to that. This is an external relationship, not an employment relationship. Most months have zero hours; incident-response weeks may have many. AAS engages the attorney through written requests; the attorney bills hourly. The Compliance / Waiver Reviewer is the day-to-day handoff point; the Owner is the decision-maker on any engagement that requires sign-off.

### Key Responsibilities (attorney, not AAS-side)

- Draft and revise the AAS waiver document (the live `wd_v*` row in the platform)
- Review vendor and sponsor contracts on request
- Advise on employment classification (W-2 vs 1099 boundary) when questions arise
- Counsel the Owner on incident response, complaint handling, and any matter likely to escalate to litigation
- Defend AAS in any legal action initiated against the company
- Advise on regulatory compliance for new operating sites, new event types, or expansion into new jurisdictions
- Coordinate with the Insurance Broker when an incident triggers both insurance and legal posture

### AAS-side coordination (handled by Owner, Compliance Reviewer, HR Coordinator)

- Owner approves any engagement above an agreed threshold (e.g., > 4 hours of work)
- Compliance / Waiver Reviewer is the day-to-day point of contact for waiver-text revisions and record requests
- HR Coordinator coordinates classification reviews and any termination-related legal review
- Owner approves new vendor / sponsor contract templates after attorney review

### Engagement Terms

- Hourly billable per engagement; optional small monthly retainer for fast-response posture
- Engagement letter on file with the Owner specifying scope, rate, and confidentiality
- 24-hour response standard for incident-response calls
- Monthly invoice; paid by the Bookkeeper through the regular AP cycle

### Notes

- Utah-licensed attorney for Utah-specific matters (waiver, contractor classification, premises liability)
- Consult with co-counsel licensed in any future expansion state
- This role is included for documentation completeness. The relationship is governed by the engagement letter, not by this document.

---

## Compensation Summary

| # | Role | Tier | Type | Compensation |
|---|---|---|---|---|
| 1 | Event Director / Operations Manager | 1 | Part-time W-2 OR 1099 | $40K–$65K/yr OR $300–500/event |
| 2 | Booking / Customer Service Coordinator | 1 | Part-time W-2 OR 1099 | $20–25/hr OR $35K–$45K/yr |
| 3 | Marketing / Social Media Manager | 1 | Part-time W-2 OR 1099 retainer | $30K–$50K/yr OR $1,500–$3,000/mo |
| 4 | Bookkeeper / Finance Coordinator | 1 | 1099 monthly | $300–$600/mo |
| 5 | HR Coordinator | 1 | 1099 retainer OR PT W-2 | $20–30/hr OR $1,500–$2,500/mo OR $35K–$50K/yr |
| 6 | Equipment / Rental Manager | 2 | Part-time W-2 | $18–22/hr |
| 7 | Game Designer / Scenario Writer | 2 | 1099 per-project | $200–$500/event |
| 8 | Site Coordinator / Permits Manager | 2 | Part-time W-2 OR 1099 | $20–30/hr |
| 9 | Compliance / Waiver Reviewer | 2 | 1099 retainer | $25–$40/hr (~10–20 hr/mo) |
| 10 | Read-only Auditor | 2 | External — engagement-based | Billed to engaging party (insurer / CPA / attorney) |
| 11 | Check-In / Registration Staff | 3 | 1099 per-event | $150–$200/event |
| 12 | Lead Marshal / Head Referee | 3 | 1099 per-event | $250–$350/event |
| 13 | Field Marshal | 3 | 1099 per-event | $125–$200/event |
| 14 | Safety Officer / Chronograph | 3 | 1099 per-event | $150–$250/event |
| 15 | Event EMT / Medic | 3 | 1099 per-event | $300–$500/event |
| 16 | Event Media / Photographer | 4 | 1099 per-event | $200–$400/event OR $50–$100/hr |
| 17 | Setup / Teardown Crew | 4 | 1099 per-event | $15–$20/hr OR $100–$200/day |
| 18 | Vendor / Sponsor Coordinator | 4 | 1099 retainer or commission | $1,000–$3,000/event OR commission |
| 19 | Junior Field Designer / Construction | 4 | 1099 per-project / per-event | $15–$22/hr OR $200–$500/project |
| 20 | Graphic Designer | 4 | 1099 ad-hoc per-project | $50–$100/hr OR $200–$1,500/project |
| 21 | Insurance Broker | 4 | External vendor | Annual policy premium (broker comp via underwriter) |
| 22 | Attorney | 4 | External — hourly + optional retainer | $300–$500/hr billable; optional $500–$1,500/mo retainer |

---

## Equal Opportunity Statement

Air Action Sport, LLC is an equal opportunity employer. We do not discriminate on the basis of race, color, religion, sex, sexual orientation, gender identity or expression, national origin, age, disability, genetic information, marital status, amnesty, or status as a covered veteran. All qualified candidates are encouraged to apply.

---

*Document generated 2026-05-06. Update annually or when role responsibilities change materially.*
