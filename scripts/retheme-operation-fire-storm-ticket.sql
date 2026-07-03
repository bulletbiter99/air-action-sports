-- Post-publish polish for Operation Fire Storm (operator decisions 2026-07-01,
-- after the operator published the event and consolidated tickets themselves:
-- they deleted the 4 seeded ticket rows and re-activated the original
-- `tt_NBVUMAr6EnUb` "Standard Ticket" at $80 / capacity 350).
--
--   * Capacity: operator chose to KEEP 350 -> the events row's total_slots is
--     raised 150 -> 350 to match (avoids a broken "spots left" display once
--     bookings pass 150).
--   * Ticket retheme: name + description updated to the event (same row/id,
--     price $80 and capacity 350 unchanged).

UPDATE ticket_types
SET
  name = 'Operation Fire Storm - Entry',
  description = 'The full 16-hour overnight operation: Saturday 7:45 PM check-in through the Sunday noon ENDEX.',
  updated_at = strftime('%s','now') * 1000
WHERE id = 'tt_NBVUMAr6EnUb';

UPDATE events
SET total_slots = 350, updated_at = strftime('%s','now') * 1000
WHERE id = 'ghost-town-18hr-milsim';
