-- AlterTable
ALTER TABLE "Party" ADD COLUMN "removedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
