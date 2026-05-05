-- Phase A correction: publish Waiver Document v3.
-- v2 was published with both Exhibit A site statuses set to "Coming Soon"
-- in error. v3 corrects Ghost Town to "Active" (it's the launch event site),
-- leaves Foxtrot Fields as "Coming Soon". Retires v2 atomically.
-- No signers exist on v2 (just published seconds before this), so retiring
-- is clean.
--
-- Phase A: publish Waiver Document v2 (the corporate-wide release of liability).
--
-- Source: Air Action Sport, LLC — Release of Liability, Assumption of Risk,
-- and Participant Agreement, Document Version 1.0, Effective Date April 2026.
--
-- This document supersedes wd_v1 (the simple 6-bullet seed waiver). It is
-- site-agnostic, includes the Utah-specific minor handling (Hawkins v. Peart),
-- a 365-day Claim Period (annual renewal model), jury trial waiver, and
-- electronic signature acknowledgment per Utah Code §46-4-201.
--
-- Atomicity: both UPDATE (retire v1) and INSERT (create v2) execute in this
-- file; D1 wraps multi-statement files in a single transaction so v1 retires
-- at the same instant v2 takes effect.
--
-- Hash placeholder: actual SHA-256 will be computed and patched after
-- the body is finalized. Set to a marker string so the integrity check on
-- /api/waivers/:qrToken refuses to serve until the patch is applied.

UPDATE waiver_documents
SET retired_at = unixepoch() * 1000
WHERE retired_at IS NULL;

INSERT INTO waiver_documents (
    id, version, body_html, body_sha256, effective_from, retired_at, created_by, created_at
)
VALUES (
    'wd_v3',
    3,
    -- Body HTML follows. Edit only via a new migration (immutable rule —
    -- body_sha256 + the snapshot on every signed waivers row depend on this
    -- exact text. Do not "fix typos in place".)
    '<div class="waiver-doc">
<h2>AIR ACTION SPORT, LLC</h2>
<h3>RELEASE OF LIABILITY, ASSUMPTION OF RISK, AND PARTICIPANT AGREEMENT</h3>
<p style="text-align:center;font-size:12px;color:#888;"><em>Document Version: 1.0 — Effective Date: April 2026</em></p>

<div style="border:1px solid #d4541a;padding:14px 16px;margin:16px 0;background:rgba(212,84,26,0.05);">
<p style="margin:0;font-weight:700;text-transform:uppercase;font-size:13px;letter-spacing:0.5px;">INSTRUCTIONS: PLEASE READ THIS ENTIRE AGREEMENT CAREFULLY BEFORE SIGNING.</p>
<p style="margin:10px 0 0;">This Agreement contains a release of liability, assumption of risk, jury trial waiver, and other provisions that significantly affect your legal rights. By signing this Agreement, you are, among other things, expressly waiving your right to sue or seek money damages from Air Action Sport, LLC ("AAS") and its managers, members, employees, independent contractors, agents, and affiliates for negligence if a personal injury is sustained at any AAS Premises or Event. <strong>If you do not agree to any term, provision, or paragraph of this Agreement, do not sign the Agreement and please exit the Premises immediately.</strong></p>
</div>

<h3>Definitions</h3>
<p><strong>"AAS"</strong> means Air Action Sport, LLC, a Utah limited liability company, and all of its managers, members, employees, agents, officers, directors, affiliates, volunteers, participants, clients, customers, invitees, independent contractors, insurers, facility operators, and landowners, together with their respective successors and assigns (collectively, "The Released And Indemnified Parties").</p>
<p><strong>"Premises"</strong> means any and all locations, properties, sites, fields, structures, parking areas, camping zones, staging areas, vendor areas, and surrounding land used by AAS in connection with its events and activities, whether now existing or established in the future, including but not limited to all current operating sites listed in the Site Schedule attached as Exhibit A, any temporary or pop-up event locations, and any privately leased or licensed properties used by AAS for hosted events. The term "Premises" shall apply regardless of whether a specific site address is listed in Exhibit A at the time this Agreement is signed.</p>
<p><strong>"Activities"</strong> means airsoft gaming events, milsim operations, skirmish sessions, scenario games, night operations, private hire events, camping, spectating, and any other recreational or related activities conducted at the Premises, including travel to and from any area of the Premises.</p>
<p><strong>"Claim Period"</strong> means the period beginning on the Effective Date and ending at midnight 365 days after the Effective Date.</p>
<p><strong>"Effective Date"</strong> means the date and time this Agreement is electronically or physically signed by the Participant.</p>
<p><strong>"Releasing Parties"</strong> means the signing participant, their spouse, heir(s), personal representative(s), and their respective successors and assigns.</p>

<h3>Participant Agreement and Release of Liability</h3>
<p>All participants in Activities on the Premises must complete and sign this Agreement prior to participation. This Agreement is effective as of the Effective Date and shall remain valid and effective to release and indemnify AAS from any Claims arising during the Claim Period.</p>

<h3>1. Release and Indemnity</h3>
<p>For myself and on behalf of the Releasing Parties, I hereby agree to release, remise, forever discharge, defend, hold harmless, and indemnify The Released And Indemnified Parties from and against any and all claims, actions, causes of action, proceedings, suits, costs, liabilities, damages, and expenses, whether known or unknown (including but not limited to all direct, special, incidental, exemplary, punitive, and consequential damages, losses of any kind and attorney fees), and however caused, including without limitation by negligent conduct (hereafter collectively, "Claims") of any and all of the Releasing Parties that arise on, are based upon, or result from, any act, event, occurrence, or omission on the Premises during the Claim Period.</p>
<p>I agree not to initiate, prosecute, or aid any other party in prosecuting any Claim of any kind against The Released And Indemnified Parties arising from the Activities, whether based on common law, equity, or any federal, state, or local statute, ordinance, or rule of law. This release expressly includes claims arising from the ordinary negligence of AAS and The Released And Indemnified Parties, but does not extend to claims arising from gross negligence or willful misconduct by AAS.</p>

<h3>2. Acknowledgement of Risks</h3>
<p>I acknowledge that airsoft and related Activities at the Premises are inherently dangerous and hazardous by their very nature. By participating in, observing, or allowing participation in the Activities, I expressly assume all risks associated with the Activities on behalf of myself and the Releasing Parties and expressly contract not to sue for any injury or illness sustained as a result of such participation. Known and foreseeable risks include but are not limited to:</p>
<ul>
<li>Cuts, bruises, welts, burns, and abrasions from projectile impact</li>
<li>Tripping, falling, spraining, or breaking bones including wrists, ankles, necks, backs, and skulls</li>
<li>Eye and facial injuries including from projectiles, debris, and environmental hazards</li>
<li>Head trauma, concussion, muscle pulls, exhaustion, and permanent paralysis</li>
<li>Exposure to bright, colored, or strobe lighting which may induce seizure or disorientation</li>
<li>Collisions with other participants, spectators, fixed objects, structures, and terrain features</li>
<li>Night operations and low-light scenario hazards including reduced visibility, disorientation, and trip hazards</li>
<li>Weather-related risks including extreme heat, cold, lightning, high winds, flooding, and sudden weather changes</li>
<li>Environmental hazards including uneven terrain, wildlife, insects, thorns, dust, allergens, and bodies of water</li>
<li>Infectious disease transmission due to the public nature of the Activities</li>
<li>Risks arising from the actions of third parties, other participants, and spectators</li>
<li>Other serious injuries, permanent disability, or death</li>
</ul>
<p>I understand that no matter how carefully AAS manages the Activities, the risk of serious injury and illness is not eliminated and remains foreseeable.</p>

<h3>3. Assumption of Risk and Loss</h3>
<p style="font-weight:700;text-transform:uppercase;">I knowingly and freely assume all known and unknown risks of injury, illness, damage, and/or death on behalf of myself and the Releasing Parties. My participation is purely voluntary. I agree to pay for the cost of any medical assistance requested by AAS on behalf of any Releasing Party and assume full financial responsibility for any damage, illness, or injury occurring on the Premises. I further assume the risk of aggravation of any preexisting medical or physical condition, whether known or unknown.</p>

<h3>4. Personal Protective Equipment (PPE) Compliance</h3>
<p>I acknowledge and agree that:</p>
<ul>
<li>(a) Full-seal eye protection meeting ANSI Z87.1 or equivalent standard is mandatory at all times on active playing fields. I agree to wear all required PPE throughout gameplay.</li>
<li>(b) AAS and its marshals have the right and authority to inspect my PPE and deny my access to the playing field if PPE is deemed non-compliant or inadequate.</li>
<li>(c) Removing eye protection on an active field is grounds for immediate removal from the event without refund.</li>
<li>(d) I am solely responsible for ensuring that any minor in my care wears appropriate PPE at all times.</li>
</ul>

<h3>5. Velocity (FPS) and Equipment Inspection</h3>
<p>I acknowledge and agree that:</p>
<ul>
<li>(a) AAS enforces velocity limits on all airsoft equipment. I consent to having my equipment chronographed and inspected by AAS staff or marshals before and during any event.</li>
<li>(b) Any firearm or replica exceeding the posted FPS limit will be prohibited from use for the duration of the event. AAS will secure non-compliant equipment and return it to the participant upon departure. AAS assumes no liability for the condition of equipment that was non-compliant at the time of inspection.</li>
<li>(c) I represent that all equipment I bring to the Premises is legal to possess under applicable federal, state, and local law.</li>
<li>(d) I agree not to modify equipment on-site to circumvent velocity limits.</li>
</ul>

<h3>6. Weather and Environmental Conditions</h3>
<p>I acknowledge that outdoor airsoft events are subject to weather and environmental conditions beyond AAS''s control. I understand and agree that:</p>
<ul>
<li>(a) AAS may modify, delay, or cancel events due to weather at its sole discretion.</li>
<li>(b) I am responsible for my own physical preparation for outdoor conditions including heat, cold, sun exposure, and terrain.</li>
<li>(c) I will follow all AAS protocols for weather-related emergencies including lightning protocols, evacuation procedures, and shelter-in-place instructions.</li>
<li>(d) I release AAS from liability for injuries or discomfort arising from weather and environmental conditions.</li>
</ul>

<h3>7. Overnight Camping</h3>
<p>If I have purchased a camping add-on or am otherwise permitted to camp overnight at the Premises, I additionally acknowledge and agree that:</p>
<ul>
<li>(a) Overnight camping involves additional risks including fire hazards, wildlife encounters, carbon monoxide risks, cold exposure, and trip hazards in darkness.</li>
<li>(b) I will comply with all posted camping rules including quiet hours, fire restrictions, and prohibited zones.</li>
<li>(c) I will not enter any active playing field or restricted area during overnight hours.</li>
<li>(d) AAS is not responsible for the security of personal property in the camping zone.</li>
<li>(e) I am responsible for properly extinguishing any fire before sleeping or leaving the camping area.</li>
</ul>

<h3>8. Injuries by and to Third Parties</h3>
<p>I acknowledge that the Releasing Parties may be injured by the actions of other customers or invitees of AAS at the Premises ("Third Parties"). I agree to release, discharge, waive, defend, and indemnify The Released And Indemnified Parties against any Claims arising from acts or omissions of Third Parties during the Claim Period. I also acknowledge that acts or omissions of the Releasing Parties may cause injury to others, and agree to defend and indemnify The Released And Indemnified Parties and any third party against any Claim caused in whole or in part by the Releasing Parties.</p>

<h3>9. Sponsor and Vendor Zone Acknowledgment</h3>
<p>I acknowledge that AAS events may include sponsor booths, vendor tents, product demonstrations, and third-party commercial activity on or adjacent to the Premises. I agree that:</p>
<ul>
<li>(a) AAS is not responsible for the acts, omissions, products, or representations of any sponsor or vendor.</li>
<li>(b) I release AAS from any Claims arising from my interaction with sponsor or vendor activities.</li>
<li>(c) I will comply with all safety requirements in sponsor and vendor zones as directed by AAS staff.</li>
</ul>

<h3>10. Insurance</h3>
<p>I certify that I have adequate personal insurance or sufficient personal assets to fully indemnify The Released And Indemnified Parties against any Claims for which I have an indemnity obligation under this Agreement, including Claims by third parties caused in whole or in part by my acts or omissions.</p>

<h3>11. Rules and Safety Standards</h3>
<p>I acknowledge that I have read, understand, and agree to abide by all posted and presented rules and safety standards for the Activities at the Premises, including field-specific rules, marshal instructions, and any rules communicated at pre-game safety briefings. I acknowledge that failure to comply with rules may result in immediate removal from the event without refund. AAS''s full Cancellation and Refund Policy is posted at airactionsport.com and is incorporated by reference into this Agreement.</p>

<h3>12. Representations and Physical Condition</h3>
<p>I represent that I am physically able to participate in the Activities and have no preexisting physical or medical condition, including allergies, exercise-induced conditions, heart conditions, seizure disorders, or conditions induced by strobe or low lighting, that would endanger me during the Activities. I represent that I will conduct myself in a safe and responsible manner so as not to endanger the lives or property of any persons on the Premises.</p>

<h3>13. Basis of Bargain</h3>
<p>I understand that AAS would not allow use of the Premises without my agreement to the terms and conditions herein.</p>

<h3>14. Choice of Law and Venue</h3>
<p>This Agreement shall be governed by and construed under the laws of the State of Utah, without regard to conflicts of law principles. Venue for any dispute shall be exclusively in the Second Judicial District Court, Davis County, Utah. I agree to indemnify and hold The Released And Indemnified Parties harmless for all attorney fees and costs incurred in enforcing this Agreement.</p>

<h3>15. Photography, Video, and Drone Policy</h3>
<p>I acknowledge and agree that:</p>
<ul>
<li>(a) AAS and its authorized media partners may photograph or video record events on the Premises. I grant AAS the irrevocable right to use my name, face, likeness, voice, and appearance in connection with exhibitions, publicity, advertising, and promotional materials without compensation or limitation.</li>
<li>(b) I will not operate any drone or unmanned aerial vehicle on or over the Premises without prior written approval from AAS management obtained no less than 48 hours prior to the event.</li>
<li>(c) I will not photograph or video record other participants without their consent in a manner that violates their reasonable expectation of privacy.</li>
</ul>

<h3>16. Social Media Release</h3>
<p>I acknowledge that I may post content related to AAS events on social media platforms. I agree not to post content that defames AAS, its staff, or other participants, or that depicts safety violations or rule infractions in a manner designed to harm AAS''s reputation. AAS reserves the right to request removal of content that violates posted rules or applicable law.</p>

<h3>17. Medical Emergency Authorization</h3>
<p>In the event I am incapacitated and unable to communicate, I authorize AAS staff and marshals to:</p>
<ul>
<li>(a) Call 911 and emergency medical services on my behalf</li>
<li>(b) Administer basic first aid</li>
<li>(c) Provide responding emergency personnel with any medical information I have disclosed in my participant profile or booking record</li>
</ul>
<p>I understand that AAS staff are not medical professionals and release AAS from liability for any first aid rendered in good faith.</p>

<h3>18. Data Privacy</h3>
<p>I acknowledge and consent to AAS collecting and storing my personal information (name, date of birth, contact details, emergency contact, and signed waiver) for the purpose of managing event participation, safety records, and legal compliance. AAS will not sell my personal information to third parties. My data will be retained for a minimum of 7 years following the Claim Period for adult participants. Records involving participants who were under 18 at the time of participation will be retained until that participant''s 23rd birthday.</p>

<h3>19. Indemnity</h3>
<p>In addition to and not in lieu of other indemnity provisions herein, I agree on behalf of myself and my spouse to indemnify and hold harmless AAS and all Released And Indemnified Parties from and against any and all losses, liabilities, claims, obligations, costs, damages, and expenses, including attorney fees, directly or indirectly arising out of my or my spouse''s acts or omissions while participating in Activities at the Premises, unless it is determined that such liability resulted from the gross negligence or willful misconduct of AAS.</p>

<h3>20. Miscellaneous / Severability</h3>
<p>This Agreement is intended to be as broad and inclusive as permitted by Utah law. If any clause is determined to be unenforceable, it shall be severed and the remainder shall continue in full legal force and effect. This Agreement represents the entire understanding of the parties. No subsequent modification is binding unless reduced to writing and signed by both parties.</p>

<h3>21. Annual Renewal</h3>
<p>This Agreement is valid for the Claim Period (365 days from the Effective Date). Participants who return to AAS events after expiration of their Claim Period are required to execute a new Agreement prior to participation.</p>

<h3>22. Jury Trial Waiver</h3>
<p>I, on behalf of myself and the Releasing Parties, hereby waive to the full extent permitted by applicable law any right to trial by jury in any proceeding arising out of or relating to this Agreement, the Activities, or any injury sustained in connection with the Activities. I represent that no party has represented that this waiver would not be enforced, and that all parties have been induced to enter this Agreement in part by this jury trial waiver.</p>
<p style="font-style:italic;color:#888;font-size:12px;">Acknowledged via the Jury Trial Waiver initials field on the participant signature block.</p>

<h3>Final Acknowledgment</h3>
<p style="font-weight:700;text-transform:uppercase;">I have read this release agreement in its entirety, fully understand its terms, understand that I am giving up substantial legal rights by signing it, including the right to sue for negligence, and sign it freely and voluntarily without any inducement.</p>

<h3>Minor Participant Notice</h3>
<div style="border:1px solid #d4541a;padding:14px 16px;margin:14px 0;background:rgba(212,84,26,0.05);">
<p style="margin:0;font-weight:700;">NOTICE:</p>
<p style="margin:8px 0 0;">Under <em>Hawkins v. Peart</em>, 37 P.3d 1062 (Utah 2001), reaffirmed in <em>Rutherford v. Talisker Canyons Finance Co.</em>, 445 P.3d 474 (Utah 2019), parental pre-injury liability waivers and indemnity provisions on behalf of minor children are unenforceable as against public policy in Utah. The minor section of this Agreement does NOT constitute a valid liability release for minor participants and must not be relied upon as such. AAS maintains liability insurance explicitly covering minor participants. The minor section serves as parental consent, emergency medical authorization, media release, and age-tier acknowledgment only.</p>
</div>

<h3>Age Participation Policy</h3>
<table style="width:100%;border-collapse:collapse;margin:8px 0 16px;">
<thead>
<tr style="background:rgba(212,84,26,0.08);">
<th style="text-align:left;padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">Age</th>
<th style="text-align:left;padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">Requirement</th>
</tr>
</thead>
<tbody>
<tr><td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);"><strong>Under 12</strong></td><td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">Not permitted to participate in any AAS event under any circumstances.</td></tr>
<tr><td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);"><strong>12–15</strong></td><td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">Permitted with parent or legal guardian physically present and supervising on-site for the full duration of the event. Remote or off-site parental consent is not sufficient for this age group.</td></tr>
<tr><td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);"><strong>16–17</strong></td><td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">Permitted with prior written parental or legal guardian approval. This signed form constitutes that approval. Supervising adult does not need to be present on-site.</td></tr>
<tr><td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);"><strong>18+</strong></td><td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">No parental consent required. Adult participant signs independently.</td></tr>
</tbody>
</table>
<p>AAS reserves the right to require government-issued photo ID to verify participant age at check-in. Participants who cannot provide age verification may be denied entry. AAS reserves the right to deny entry to any participant who does not meet the applicable age requirement or whose supervising adult is not present as required.</p>

<h3>Electronic Signature Acknowledgment</h3>
<p style="font-weight:700;text-transform:uppercase;">I hereby acknowledge (1) that this document is electronically signed in accordance with Utah Code Ann. §46-4-201 and (2) that this document is valid and may be enforced in the same manner as a hand-signed document. I acknowledge the validity of my electronic signature and waive any right to claim this document is invalid or unenforceable based on its electronic form or electronic signature.</p>

<h3>Exhibit A — Site Schedule</h3>
<p>The following sites are current operating locations of Air Action Sport, LLC. GPS coordinates are provided in place of physical addresses where no formal street address exists, consistent with standard practice for outdoor recreational venues. This list may be updated from time to time. The definition of "Premises" in this Agreement covers all sites listed below as well as any future sites, temporary locations, or privately leased properties used by AAS, regardless of whether listed here.</p>
<table style="width:100%;border-collapse:collapse;margin:8px 0 16px;">
<thead>
<tr style="background:rgba(212,84,26,0.08);">
<th style="text-align:left;padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">Site #</th>
<th style="text-align:left;padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">Site Name</th>
<th style="text-align:left;padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">Description</th>
<th style="text-align:left;padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">GPS Coordinates</th>
<th style="text-align:left;padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">Status</th>
</tr>
</thead>
<tbody>
<tr>
<td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">01</td>
<td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);"><strong>Ghost Town</strong></td>
<td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">Rural Neighborhood — 19 Buildings (Hiawatha, Utah)</td>
<td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);font-family:monospace;font-size:12px;">39.48293758877403, -111.01124896002017</td>
<td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">Active</td>
</tr>
<tr>
<td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">02</td>
<td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);"><strong>Foxtrot Fields</strong></td>
<td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">Open Field Site — 25 acres</td>
<td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);font-family:monospace;font-size:12px;">41.051090238029126, -111.92802720986543</td>
<td style="padding:8px 12px;border:1px solid rgba(200,184,154,0.2);">Coming Soon</td>
</tr>
</tbody>
</table>
<p>Additional sites will be added to this Exhibit as AAS expands operations. The Agreement remains valid and applicable at all sites regardless of the date a site is added to this Schedule.</p>
</div>',
    '525a075a74e6154112add2d9aadcce3045005bf2a1f5194d5160eb3880f45709',
    unixepoch() * 1000,
    NULL,
    NULL,
    unixepoch() * 1000
);

SELECT id, version, retired_at, length(body_html) AS html_len, body_sha256 FROM waiver_documents ORDER BY version;
