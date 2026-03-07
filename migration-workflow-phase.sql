-- Migration: Two-phase workflow support for applications
-- Adds columns for reception/approval workflow tracking

-- Reception completion timestamp
ALTER TABLE applications ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ DEFAULT NULL;

-- Reception completed by (email)
ALTER TABLE applications ADD COLUMN IF NOT EXISTS reviewed_by TEXT DEFAULT NULL;

-- Reception staff ID (preserved after assigned_to switches to approval staff)
ALTER TABLE applications ADD COLUMN IF NOT EXISTS reception_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL;
