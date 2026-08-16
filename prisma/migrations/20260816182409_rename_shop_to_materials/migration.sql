-- The 'shop' catalog entry was mislabeled "General Store" — it's the cement/aggregate/shop materials
-- business (three modules of one business, matching ecana_shop-app), not a standalone general store.
UPDATE "ServiceCatalog" SET "name" = 'Materials' WHERE "key" = 'shop';
