-- Barona Mobile Detailing — booking database schema
-- Run this once in the Cloudflare dashboard: your D1 database -> Console
-- (or "Query"/"Execute SQL" tab) -> paste this whole file -> Run.

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,              -- 'YYYY-MM-DD'
  time_slot TEXT NOT NULL,         -- start time 'HH:MM' (24h)
  end_time TEXT NOT NULL,          -- end time 'HH:MM', = time_slot + duration
  duration_minutes INTEGER NOT NULL,
  service TEXT,                    -- 'exterior' / 'interior' / 'full' / 'unsure'
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  vehicle TEXT,
  location TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',   -- 'confirmed' or 'cancelled'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Appointments can now be different lengths (3 hrs, 6 hrs, etc.), so instead
-- of a simple "same exact slot" uniqueness rule, this trigger blocks any new
-- CONFIRMED booking whose time range overlaps an existing CONFIRMED booking
-- on the same day. Cancelling a booking (status = 'cancelled') frees its
-- time back up automatically.
--
-- Each existing booking is padded by 60 minutes on both ends before the
-- overlap check, so a new booking can't be placed less than an hour before
-- or after an existing one — that's the driving-time buffer between jobs.
-- This is the authoritative check (also mirrored in worker.js so the
-- calendar shown to customers already reflects it) — this is what actually
-- prevents a double-booking at INSERT time, including from the admin tool.
CREATE TRIGGER IF NOT EXISTS trg_bookings_no_overlap
BEFORE INSERT ON bookings
WHEN NEW.status = 'confirmed'
BEGIN
  SELECT RAISE(ABORT, 'slot_taken')
  FROM bookings
  WHERE status = 'confirmed'
    AND date = NEW.date
    AND NEW.time_slot < strftime('%H:%M', bookings.end_time, '+60 minutes')
    AND strftime('%H:%M', bookings.time_slot, '-60 minutes') < NEW.end_time
  LIMIT 1;
END;

-- Add a row here to close a specific day (vacation, holiday, etc.) even if
-- it would otherwise be a normal business day. "date" = 'YYYY-MM-DD'.
CREATE TABLE IF NOT EXISTS closed_days (
  date TEXT PRIMARY KEY,
  reason TEXT
);

-- --------------------------------------------------------------------------
-- Unified social inbox — one row per Facebook/Instagram conversation, so the
-- admin dashboard can show "everyone you're talking to" in one list instead
-- of switching apps. platform_thread_id is whatever Meta calls that
-- conversation (a PSID for Messenger, an IGSID for Instagram) — the pairing
-- with platform is what's actually unique, not the id alone.
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,                 -- 'facebook' | 'instagram'
  platform_thread_id TEXT NOT NULL,
  customer_name TEXT,
  last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_preview TEXT,
  unread INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(platform, platform_thread_id)
);

-- Every message in every thread, both directions. An AI-drafted reply that's
-- waiting on a human is just a row here with status = 'pending_approval' —
-- approving it (as written or edited) is what actually calls Meta's Send API
-- and flips it to 'sent'. Nothing here means the customer received it until
-- that flip happens, so a draft sitting unapproved is always safe.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  direction TEXT NOT NULL,                -- 'inbound' | 'outbound'
  sender TEXT NOT NULL,                   -- 'customer' | 'ai' | 'admin'
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',    -- 'sent' | 'pending_approval' | 'discarded'
  platform_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

-- Small key/value table for admin-toggleable settings — starts with just
-- the auto-send switch (off by default: every AI reply queues for approval
-- until you flip this on from the dashboard).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_send_replies', 'false');
