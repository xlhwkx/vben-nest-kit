-- CreateTable
CREATE TABLE "menus" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(128) NOT NULL,
    "path" VARCHAR(255) NOT NULL,
    "component" VARCHAR(255),
    "redirect" VARCHAR(255),
    "type" VARCHAR(32) NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "auth_code" VARCHAR(128),
    "meta" JSONB NOT NULL DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_menus" (
    "role_id" UUID NOT NULL,
    "menu_id" UUID NOT NULL,

    CONSTRAINT "role_menus_pkey" PRIMARY KEY ("role_id","menu_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "menus_name_key" ON "menus"("name");

-- CreateIndex
CREATE INDEX "menus_parent_id_idx" ON "menus"("parent_id");

-- CreateIndex
CREATE INDEX "menus_status_idx" ON "menus"("status");

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_menus" ADD CONSTRAINT "role_menus_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_menus" ADD CONSTRAINT "role_menus_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
