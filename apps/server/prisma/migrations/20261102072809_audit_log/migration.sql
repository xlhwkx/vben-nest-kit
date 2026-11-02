-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "username" VARCHAR(64),
    "action" VARCHAR(128) NOT NULL,
    "module" VARCHAR(64),
    "method" VARCHAR(16),
    "path" VARCHAR(512),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "request_id" VARCHAR(128),
    "status" INTEGER,
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");
