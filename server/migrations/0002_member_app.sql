-- Member app: a UPI payment submitted by a member can carry a renewal request.
-- When the front desk confirms the payment, the renewal term is created automatically
-- and door access is restored.
ALTER TABLE payments ADD COLUMN request_plan_id INTEGER REFERENCES plans(id);
CREATE INDEX ix_payments_request ON payments(request_plan_id) WHERE request_plan_id IS NOT NULL;
