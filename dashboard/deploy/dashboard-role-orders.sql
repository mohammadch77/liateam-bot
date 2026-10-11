-- Lets the dashboard hand work to the orders service (run once, after `npm run orders` has created the tables):
--   sudo -u postgres psql lia_sync < dashboard/deploy/dashboard-role-orders.sql
-- The dashboard only INSERTs jobs and reads results; orders, items and wallet are written by src/orders.mjs alone.
GRANT SELECT, INSERT ON order_jobs TO lia_dashboard;
GRANT USAGE ON SEQUENCE order_jobs_id_seq TO lia_dashboard;
GRANT SELECT ON shop_orders, shop_order_items, shop_order_events, wallet_ledger TO lia_dashboard;
