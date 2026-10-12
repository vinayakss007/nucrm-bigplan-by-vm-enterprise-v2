-- 0105 down: drop the pixel read path, restoring the fail-closed state where
-- /api/track/open and /api/track/click can resolve no tracking row at all.
DROP POLICY IF EXISTS "email_tracking_pixel_lookup" ON "email_tracking";
