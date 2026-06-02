-- Fill in the Bolotnik (RUSFOR) registration form link (was a "link coming soon"
-- placeholder). The operator supplied the form's /edit (owner) URL; the correct
-- public RESPONDENT link is the canonical published form (verified 200 + public):
--   https://docs.google.com/forms/d/e/1FAIpQLSdEUhkM9oxozyrPxOVmfxIObJuyr-C-3A2xzW_nKAb74UWaVg/viewform
-- Sets it in both the event-page Required Documents list (documents[2]) and the
-- booking-flow inline faction link (factionLinks."Bolotnik (RUSFOR)"), and aligns
-- the faction-link label with Kraken's phrasing. json_set preserves every other
-- details field (collabBannerUrl, rules, schedule, terrain, etc.).

UPDATE events
SET
  details_json = json_set(
    details_json,
    '$.documents[2].url', 'https://docs.google.com/forms/d/e/1FAIpQLSdEUhkM9oxozyrPxOVmfxIObJuyr-C-3A2xzW_nKAb74UWaVg/viewform',
    '$.factionLinks."Bolotnik (RUSFOR)".url', 'https://docs.google.com/forms/d/e/1FAIpQLSdEUhkM9oxozyrPxOVmfxIObJuyr-C-3A2xzW_nKAb74UWaVg/viewform',
    '$.factionLinks."Bolotnik (RUSFOR)".label', 'Complete your Bolotnik (RUSFOR) registration'
  ),
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = 'volga-initiative';
