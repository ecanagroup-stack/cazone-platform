-- New Petrol Station subscriptions start as live services and use the normal
-- opening-tank setup. Clear the abandoned historical-review state left by the
-- stopped fuel migration so existing development organizations are usable again.
UPDATE "Service"
SET "isActive" = TRUE,
    "config" = COALESCE("config", '{}'::jsonb) - 'migrationStockPending'
FROM "Organization" o
WHERE "Service"."organizationId" = o."id"
  AND "Service"."type" = o."businessType"
  AND "Service"."type" = 'fuel_station'
  AND (
    "Service"."isActive" = FALSE
    OR COALESCE("Service"."config", '{}'::jsonb) ? 'migrationStockPending'
  );
