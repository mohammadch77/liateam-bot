-- Lets the dashboard edit the sync schedule (sync_settings: intervals, window start times, pause) and read the
-- schedule, banners and change events. Run once as the database owner, after the bot has run once with the window
-- schedule:
--   sudo -u postgres psql lia_sync < dashboard/deploy/dashboard-role-schedule.sql
-- Safe to rerun. None of these tables holds a price.
GRANT SELECT, INSERT, UPDATE ON sync_settings TO lia_dashboard;
GRANT SELECT ON sync_schedule, hero_slides, change_events TO lia_dashboard;
