-- Preserve current grants while moving the runtime source to role_menus + menus.auth_code.
INSERT INTO "permissions" ("id", "code", "name")
SELECT gen_random_uuid(), code, code FROM (VALUES
  ('System:User:List'), ('System:Role:List'), ('System:Menu:List'),
  ('System:Dept:List'), ('System:Dict:List'), ('System:User:AssignRole')
) AS additions(code)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" r CROSS JOIN "permissions" p
WHERE r.code IN ('super', 'admin') AND p.code IN (
  'System:User:List', 'System:Role:List', 'System:Menu:List',
  'System:Dept:List', 'System:Dict:List', 'System:User:AssignRole'
) ON CONFLICT DO NOTHING;

INSERT INTO "menus" ("id", "name", "path", "type", "auth_code", "meta", "updated_at")
SELECT gen_random_uuid(), left('Permission_' || p.code, 90) || '_' || md5(p.code),
  '', 'button', p.code, jsonb_build_object('title', p.code, 'hideInMenu', true), now()
FROM "permissions" p
WHERE NOT EXISTS (SELECT 1 FROM "menus" m WHERE m.auth_code = p.code AND m.deleted_at IS NULL);

INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT rp.role_id, m.id FROM "role_permissions" rp
JOIN "permissions" p ON p.id = rp.permission_id
JOIN "menus" m ON m.auth_code = p.code AND m.deleted_at IS NULL AND m.status = 1
ON CONFLICT DO NOTHING;

-- Bind every refresh record to the security version at issuance.
ALTER TABLE "refresh_tokens" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;
UPDATE "refresh_tokens" t SET token_version = u.token_version FROM "users" u WHERE u.id = t.user_id;
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- Rotation keeps a session family so concurrent logout also revokes its replacement.
ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" UUID;
UPDATE "refresh_tokens" SET "family_id" = "id";
ALTER TABLE "refresh_tokens" ALTER COLUMN "family_id" SET NOT NULL;
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");
