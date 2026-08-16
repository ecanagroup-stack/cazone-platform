-- "Materials" was still generic — the actual business is Construction Material (cement/aggregate/shop)
UPDATE "ServiceCatalog" SET "name" = 'Construction Material' WHERE "key" = 'shop';
UPDATE "Service" SET "name" = 'Construction Material' WHERE "type" = 'shop' AND "name" = 'Materials';
