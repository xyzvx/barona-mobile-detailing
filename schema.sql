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
CREATE TRIGGER IF NOT EXISTS trg_bookings_no_overlap
BEFORE INSERT ON bookings
WHEN NEW.status = 'confirmed'
BEGIN
  SELECT RAISE(ABORT, 'slot_taken')
  FROM bookings
  WHERE status = 'confirmed'
    AND date = NEW.date
    AND NEW.time_slot < bookings.end_time
    AND bookings.time_slot < NEW.end_time
  LIMIT 1;
END;

-- Add a row here to close a specific day (vacation, holiday, etc.) even if
-- it would otherwise be a normal business day. "date" = 'YYYY-MM-DD'.
CREATE TABLE IF NOT EXISTS closed_days (
  date TEXT PRIMARY KEY,
  reason TEXT
);
