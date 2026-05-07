-- One-time: scope customers_entity + new_admin_dashboard to owner role.
-- Reversible via either:
--   UPDATE feature_flags SET state='off' WHERE key='customers_entity';
--   UPDATE feature_flags SET state='off' WHERE key='new_admin_dashboard';
-- or expanded:
--   UPDATE feature_flags SET role_scope='owner,manager' WHERE key=...;
--   UPDATE feature_flags SET state='on', role_scope=NULL WHERE key=...;

UPDATE feature_flags
   SET state = 'role_scoped',
       role_scope = 'owner',
       updated_at = strftime('%s','now') * 1000
 WHERE key = 'customers_entity';

UPDATE feature_flags
   SET state = 'role_scoped',
       role_scope = 'owner',
       updated_at = strftime('%s','now') * 1000
 WHERE key = 'new_admin_dashboard';
