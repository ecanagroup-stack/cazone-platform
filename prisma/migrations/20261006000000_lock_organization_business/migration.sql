ALTER TABLE "Organization" ADD COLUMN "businessType" TEXT;

-- Preserve the user's chosen business for the two existing mixed organizations.
UPDATE "Organization" AS o
SET "businessType" = (
  SELECT s."type" FROM "Service" AS s
  WHERE s."organizationId" = o."id"
  ORDER BY s."createdAt", s."id" LIMIT 1
);
UPDATE "Organization" SET "businessType" = 'fuel_station'
WHERE "id" = 'cmsvyhfp60001lwf54z5bsoc3'; -- Ecana Family
UPDATE "Organization" SET "businessType" = 'general_store'
WHERE "id" = 'cmsw8qbqw00011fv137wqjye7'; -- Multi Svc QA

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Organization" WHERE "businessType" IS NULL) THEN
    RAISE EXCEPTION 'Every organization must have a registered business type before this migration';
  END IF;
END $$;

ALTER TABLE "Organization" ALTER COLUMN "businessType" SET NOT NULL;

-- Keep all historical service, branch and transaction rows. The other business
-- is no longer available in the organization interface or for new operations.
UPDATE "Service" AS s SET "isActive" = false
FROM "Organization" AS o
WHERE s."organizationId" = o."id" AND s."type" <> o."businessType";

CREATE OR REPLACE FUNCTION prevent_organization_business_change()
RETURNS trigger AS $$
BEGIN
  IF NEW."businessType" IS DISTINCT FROM OLD."businessType" THEN
    RAISE EXCEPTION 'An organization cannot change business type after registration';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organization_business_immutable
BEFORE UPDATE ON "Organization"
FOR EACH ROW EXECUTE FUNCTION prevent_organization_business_change();

CREATE OR REPLACE FUNCTION enforce_service_business_type()
RETURNS trigger AS $$
DECLARE registered_type TEXT;
BEGIN
  SELECT "businessType" INTO registered_type FROM "Organization" WHERE "id" = NEW."organizationId";
  IF registered_type IS NULL THEN
    RAISE EXCEPTION 'Service requires a registered organization business type';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."type" IS DISTINCT FROM OLD."type" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId") THEN
    RAISE EXCEPTION 'A service cannot change business type or organization';
  END IF;
  IF NEW."type" <> registered_type AND (TG_OP = 'INSERT' OR NEW."isActive") THEN
    RAISE EXCEPTION 'Service business type differs from its organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER service_matches_registered_business
BEFORE INSERT OR UPDATE ON "Service"
FOR EACH ROW EXECUTE FUNCTION enforce_service_business_type();
