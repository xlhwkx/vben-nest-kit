-- AlterTable
ALTER TABLE "users" ADD COLUMN "gender" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "users" ADD COLUMN "dept_id" UUID;
ALTER TABLE "users" ADD COLUMN "remark" VARCHAR(512);

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_dept_id_idx" ON "users"("dept_id");