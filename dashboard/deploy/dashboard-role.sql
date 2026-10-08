-- Restricted role for the dashboard: reads everything, writes only settings, settings_audit, run_requests.
-- Run once after the bot has created its tables (npm run sync), as the database owner:
--   sudo -u postgres psql lia_sync < dashboard/deploy/dashboard-role.sql   (or: docker compose exec -T postgres psql -U lia lia_sync < ...)
CREATE ROLE lia_dashboard LOGIN PASSWORD 'CHANGE_ME';
GRANT CONNECT ON DATABASE lia_sync TO lia_dashboard;
GRANT USAGE ON SCHEMA public TO lia_dashboard;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lia_dashboard;
GRANT INSERT, UPDATE ON settings TO lia_dashboard;
GRANT INSERT ON settings_audit, run_requests TO lia_dashboard;
GRANT USAGE ON SEQUENCE settings_audit_id_seq, run_requests_id_seq TO lia_dashboard;
GRANT SELECT ON product_catalog TO lia_dashboard;
ALTER DEFAULT PRIVILEGES FOR ROLE lia IN SCHEMA public GRANT SELECT ON TABLES TO lia_dashboard;
