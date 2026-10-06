-- Rename the public business label without changing the stable `shop` service key.
UPDATE "ServiceCatalog"
SET "name" = 'Building Material', "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'shop';

-- Preserve any organization-specific service name; update only earlier default labels.
UPDATE "Service"
SET "name" = 'Building Material'
WHERE "type" = 'shop'
  AND "name" IN ('Materials', 'Construction Material', 'Construction Materials');
