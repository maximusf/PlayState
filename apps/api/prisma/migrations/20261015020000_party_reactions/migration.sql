-- CreateTable
CREATE TABLE "PartyReaction" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartyReaction_partyId_createdAt_idx" ON "PartyReaction"("partyId", "createdAt");

-- AddForeignKey
ALTER TABLE "PartyReaction" ADD CONSTRAINT "PartyReaction_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
