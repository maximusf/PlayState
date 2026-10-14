-- AlterTable
ALTER TABLE "Party" ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "extended" BOOLEAN NOT NULL DEFAULT false;

-- Existing parties keep the one day they were promised when they started.
UPDATE "Party" SET "expiresAt" = "createdAt" + INTERVAL '1 day';

ALTER TABLE "Party" ALTER COLUMN "expiresAt" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Party_expiresAt_idx" ON "Party"("expiresAt");
