-- Lets the dashboard read the bot's change events (run once, after the bot has run once with change_events):
--   sudo -u postgres psql lia_sync < dashboard/deploy/dashboard-role-events.sql
-- change_events holds no purchase price (only selling price in toman and stock).
GRANT SELECT ON change_events TO lia_dashboard;
