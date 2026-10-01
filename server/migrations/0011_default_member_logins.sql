-- Every member gets a member-app login whose user ID and starting password are their member (device) ID.
-- Such logins, and any password set by the front desk, must be changed by the member after signing in.
ALTER TABLE accounts ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
