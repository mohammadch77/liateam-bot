-- Lets the dashboard manage messenger users and invite codes (run once, after `npm run messenger` has created the tables):
--   sudo -u postgres psql lia_sync < dashboard/deploy/dashboard-role-messenger.sql
GRANT SELECT, UPDATE, DELETE ON messenger_chats TO lia_dashboard;
GRANT SELECT, INSERT ON messenger_invites TO lia_dashboard;
GRANT USAGE ON SEQUENCE messenger_invites_id_seq TO lia_dashboard;
