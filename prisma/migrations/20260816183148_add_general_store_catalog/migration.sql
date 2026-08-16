-- General Retail Store: a genuinely separate service (its own Product catalog via Product.serviceId)
-- from Materials — plain retail goods, no cement/aggregate fields, no ATC allocation concept.
INSERT INTO "ServiceCatalog" ("key", "name", "status", "sortOrder", "updatedAt") VALUES
  ('general_store', 'General Retail Store', 'available', 2, CURRENT_TIMESTAMP);
