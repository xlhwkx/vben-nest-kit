-- CreateTable
CREATE TABLE "depts" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(128) NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "remark" VARCHAR(512),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "depts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "depts_parent_id_idx" ON "depts"("parent_id");

-- CreateIndex
CREATE INDEX "depts_status_idx" ON "depts"("status");

-- AddForeignKey
ALTER TABLE "depts" ADD CONSTRAINT "depts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "depts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_dept_id_fkey" FOREIGN KEY ("dept_id") REFERENCES "depts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
