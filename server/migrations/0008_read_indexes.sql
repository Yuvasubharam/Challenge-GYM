-- Read-cost indexes (D1 bills and rate-limits by rows read).
-- Dues views sum payments per membership: without this index every lookup scanned all payments.
CREATE INDEX IF NOT EXISTS ix_payments_membership ON payments(membership_id, status, amount);
-- "Current membership" picks the latest active term per member.
CREATE INDEX IF NOT EXISTS ix_memberships_active ON memberships(member_id, status, end_date, id);
-- Agent heartbeat asks for the latest device punch every 15 s.
CREATE INDEX IF NOT EXISTS ix_attendance_source_time ON attendance(source, punched_at);
