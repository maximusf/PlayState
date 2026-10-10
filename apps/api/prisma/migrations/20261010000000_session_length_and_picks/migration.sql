-- CreateEnum
CREATE TYPE "SessionLength" AS ENUM ('SHORT', 'MEDIUM', 'LONG');

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "timeToBeatHours" INTEGER;

-- AlterTable
ALTER TABLE "UserGame" ADD COLUMN     "sessionLength" "SessionLength";

-- CreateTable
CREATE TABLE "Pick" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userGameId" TEXT NOT NULL,
    "availableTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pick_userId_idx" ON "Pick"("userId");

-- CreateIndex
CREATE INDEX "Pick_userGameId_idx" ON "Pick"("userGameId");

-- AddForeignKey
ALTER TABLE "Pick" ADD CONSTRAINT "Pick_userGameId_fkey" FOREIGN KEY ("userGameId") REFERENCES "UserGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Supabase exposes the public schema through its Data API. Keep the new table closed.
ALTER TABLE "Pick" ENABLE ROW LEVEL SECURITY;
