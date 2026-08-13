-- wv1-waived-payments.sql — "Approve without charging" (WV-1).
--
-- Adds 'waived' to the payments.status CHECK. A waived payment is one the admin
-- consciously published WITHOUT charging: any live hold is cancelled at Stripe
-- (free release) and the listing goes live anyway.
--
-- Why a distinct status rather than reusing 'cancelled': 'cancelled' means a
-- REJECTED submission whose hold was released, and 'auto_released' means an
-- expired one. Without 'waived' the books can't tell a comped live listing from
-- a rejection, and the analytics "captured revenue" tally has no way to report
-- what was given away. amount is deliberately LEFT AT the tier price so the
-- comped value stays reportable — the status carries the "not charged" meaning.
--
-- An expired submission rescued from the Expired section also lands on 'waived'
-- (overwriting 'auto_released'): the business fact that matters afterwards is
-- "published without charge". The original auto-release is still in the
-- admin_actions audit log, so no history is lost.
--
-- Apply manually (prod is a manual owner/agent step — plan.md):
--   psql "$DATABASE_URL" -f database/migrations/wv1-waived-payments.sql

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;

ALTER TABLE payments
    ADD CONSTRAINT payments_status_check
    CHECK (status IN ('authorised', 'captured', 'cancelled', 'auto_released', 'waived'));
