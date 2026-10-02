-- Shareable receipt links: the desk sends a member's receipt straight into their WhatsApp chat as
-- https://challengegym.in/r/<share_token> (wa.me can open a chat with text only, not an image).
-- The token is random and unguessable; it is created the first time the receipt is shared.
ALTER TABLE payments ADD COLUMN share_token TEXT;
CREATE UNIQUE INDEX ux_payments_share_token ON payments(share_token) WHERE share_token IS NOT NULL;
