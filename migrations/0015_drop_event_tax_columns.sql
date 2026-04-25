-- Drop dead per-event tax/fee columns. The pricing engine has been reading
-- exclusively from the global taxes_fees table since the money/tax unification
-- pass; these columns are write-only with default values.
--
-- Cleanup also fixes a latent bug in /api/admin/bookings/manual which was
-- still using events.tax_rate_bps for tax math (always 0, since the admin
-- editor stopped writing to it). That handler now calls loadActiveTaxesFees()
-- like customer checkout does — same code path was deployed alongside this
-- migration.

ALTER TABLE events DROP COLUMN tax_rate_bps;
ALTER TABLE events DROP COLUMN pass_fees_to_customer;
