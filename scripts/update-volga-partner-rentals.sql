-- Volga Flank event-detail content (data-driven via events.details_json):
--   * partnerRentals: outbound gear rentals on MilSim City's store —
--       PVS-14 Night Vision Rental ($80) + Rental Rifle Package ($25).
--       `partners` carries each partner's brand color so the heading renders
--       "MilSim City" in their logo green (#A8C036) and "RSTS" in their red
--       (#E42A30) — colors sampled from the collab-banner logos.
--   * admissionLabel / admissionNote: BYO-gear admission row label + the
--       "No black gear or clothes allowed" restriction note.
-- json_set sets each path, preserving every other details_json field. The admin
-- event form does not send `details`, so these D1-set fields survive admin saves.
UPDATE events
SET details_json = json_set(
  details_json,
  '$.partnerRentals',
  json('{"heading":"Gear Rentals via our event partners, MilSim City & RSTS","note":"Provided by MilSim City and RSTS, this link opens their site to reserve.","partners":[{"name":"MilSim City","color":"#A8C036"},{"name":"RSTS","color":"#E42A30"}],"items":[{"name":"PVS-14 Night Vision Rental","price":"$80","url":"https://www.milsimcityairsoft.com/store/p/special-event-pvs-14-rental-1"},{"name":"Rental Rifle Package","price":"$25","url":"https://www.milsimcityairsoft.com/store/p/rental-rifle-package"}]}'),
  '$.admissionLabel', 'Individual (BYO Gear)',
  '$.admissionNote', 'No black gear or clothes allowed'
)
WHERE id = 'volga-initiative';
