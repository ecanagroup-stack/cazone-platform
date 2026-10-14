-- New Petrol Station subscriptions start as live services and use the normal
-- opening-tank setup. Clear the abandoned historical-review state left by the
-- stopped fuel migration so existing development organizations are usable again.
UPDATE "Service"
SET "isActive" = TRUE,
    "config" = COALESCE("config", '{}'::jsonb) - 'migrationStockPending'
WHERE "type" = 'fuel_station'
  AND (
    "isActive" = FALSE
    OR COALESCE("config", '{}'::jsonb) ? 'migrationStockPending'
  );
