-- Sprint 4 B5 — seed the first site-use agreement template.
--
-- The SUA library (site_use_agreement_documents, migration 0048) shipped
-- EMPTY: no template was ever seeded and no management UI exists, so every
-- kind=agreement document upload 409'd ('No active site-use agreement
-- template') and the field-rental agreement flow was dead on arrival.
--
-- This seeds version 1: a PLACEHOLDER agreement whose body opens with a
-- prominent NOT-ATTORNEY-REVIEWED banner. The operator replaces it with
-- counsel-approved text via the SQL recipe in docs/runbooks/sua-template.md
-- (retire this row + insert version 2 — versions are immutable by design;
-- signed rentals snapshot body_sha256, so never UPDATE a live row's body).
--
-- body_sha256 is the hex sha256 of body_html EXACTLY as stored — computed at
-- authoring time from the byte-identical string below. created_by is NULL
-- (seeded by migration, not a user).

INSERT INTO site_use_agreement_documents
  (id, version, title, body_html, body_sha256, effective_from, retired_at, retired_by, created_by, created_at)
VALUES (
  'sua_seed_v1_placeholder',
  1,
  'Site Use Agreement (PLACEHOLDER - needs attorney review)',
  '<div class="sua-document">
<p style="border: 2px solid #b00; padding: 12px; font-weight: bold;">PLACEHOLDER TEMPLATE — THIS AGREEMENT HAS NOT BEEN REVIEWED BY AN ATTORNEY. Have qualified legal counsel review and replace this template (see docs/runbooks/sua-template.md) before relying on it for a real rental.</p>

<h1>Site Use Agreement</h1>
<p>This Site Use Agreement (the "Agreement") is entered into between <strong>Air Action Sports</strong> ("AAS") and the undersigned renter (the "Renter") for the temporary use of the airsoft facility identified in the associated rental record (the "Site").</p>

<h2>1. Grant of Use</h2>
<p>AAS grants the Renter a limited, non-exclusive, revocable license to use the Site solely for the airsoft event described in the rental record, during the scheduled times recorded there. No other use, and no access outside those times, is authorized.</p>

<h2>2. Insurance</h2>
<p>The Renter shall maintain commercial general liability insurance covering the rental period and shall provide AAS a certificate of insurance (COI) naming AAS as an additional insured before the rental begins. Failure to provide a current COI is grounds for cancellation.</p>

<h2>3. Assumption of Risk and Waivers</h2>
<p>Airsoft is a physical activity involving projectiles and uneven outdoor terrain. The Renter acknowledges these risks and agrees that every participant attending under this Agreement must complete AAS''s liability waiver before taking the field. The Renter is responsible for ensuring no participant plays without one.</p>

<h2>4. Site Rules and Safety</h2>
<p>The Renter and all participants shall comply with AAS''s posted site rules, FPS limits, eye-protection requirements, and the directions of any AAS staff present. AAS may suspend or terminate the event without refund for safety violations.</p>

<h2>5. Condition of the Site</h2>
<p>The Renter accepts the Site as-is, shall not modify structures or terrain, and shall leave the Site in the condition received. The Renter is responsible for the cost of repairing damage beyond normal wear caused by the Renter or participants.</p>

<h2>6. Indemnification</h2>
<p>The Renter shall indemnify, defend, and hold harmless AAS, its owners, employees, and agents from claims, damages, and expenses (including reasonable attorney fees) arising out of the Renter''s use of the Site, except to the extent caused by AAS''s gross negligence or willful misconduct.</p>

<h2>7. Cancellation and Refunds</h2>
<p>Cancellation terms, deposits, and refund treatment are as recorded in the rental record and AAS''s then-current rental terms.</p>

<h2>8. Governing Law</h2>
<p>This Agreement is governed by the laws of the State of Utah. Any dispute shall be brought in the state or federal courts located in Utah.</p>

<h2>9. Entire Agreement</h2>
<p>This Agreement, together with the rental record it accompanies, is the entire agreement between the parties regarding the Site use and supersedes prior discussions.</p>

<p>By typing their name below, the signer represents they are authorized to bind the Renter and agrees to this Agreement.</p>
</div>
',
  'f98ef33a472ed633a58b350413ccfea8124269edad895da63b9757f44001f15b',
  strftime('%s','now') * 1000,
  NULL,
  NULL,
  NULL,
  strftime('%s','now') * 1000
);
