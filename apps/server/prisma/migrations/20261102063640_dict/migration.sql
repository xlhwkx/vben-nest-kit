-- CreateTable
CREATE TABLE "dict_types" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "remark" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dict_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dict_items" (
    "id" UUID NOT NULL,
    "dict_code" VARCHAR(64) NOT NULL,
    "label" VARCHAR(128) NOT NULL,
    "value" JSONB NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 1,
    "color" VARCHAR(64),
    "remark" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dict_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dict_types_code_key" ON "dict_types"("code");

-- CreateIndex
CREATE INDEX "dict_types_status_idx" ON "dict_types"("status");

-- CreateIndex
CREATE INDEX "dict_items_dict_code_idx" ON "dict_items"("dict_code");

-- CreateIndex
CREATE INDEX "dict_items_status_idx" ON "dict_items"("status");

-- AddForeignKey
ALTER TABLE "dict_items" ADD CONSTRAINT "dict_items_dict_code_fkey" FOREIGN KEY ("dict_code") REFERENCES "dict_types"("code") ON DELETE CASCADE ON UPDATE CASCADE;
