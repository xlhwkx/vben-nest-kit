-- Keep invalidation in the same PostgreSQL transaction as every dictionary writer,
-- including seed/import scripts and FK cascades. Redis loss must not freeze clients.
CREATE TABLE "dictionary_revision" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "version" BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT "dictionary_revision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dictionary_revision_singleton" CHECK ("id" = 1),
  CONSTRAINT "dictionary_revision_safe_number" CHECK ("version" BETWEEN 1 AND 9007199254740991)
);

-- Change away from the previous Redis counter on upgrade, invalidating old caches.
INSERT INTO "dictionary_revision" ("id", "version")
VALUES (1, floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint);

CREATE FUNCTION bump_dictionary_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "dictionary_revision" SET "version" = "version" + 1 WHERE "id" = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dictionary revision state is missing';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER dict_types_revision
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "dict_types"
FOR EACH STATEMENT EXECUTE FUNCTION bump_dictionary_revision();

CREATE TRIGGER dict_items_revision
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "dict_items"
FOR EACH STATEMENT EXECUTE FUNCTION bump_dictionary_revision();
