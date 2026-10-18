-- CreateTable
CREATE TABLE "PartyNomination" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "igdbId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyNomination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartyNomination_partyId_idx" ON "PartyNomination"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyNomination_partyId_userId_igdbId_key" ON "PartyNomination"("partyId", "userId", "igdbId");

-- AddForeignKey
ALTER TABLE "PartyNomination" ADD CONSTRAINT "PartyNomination_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
