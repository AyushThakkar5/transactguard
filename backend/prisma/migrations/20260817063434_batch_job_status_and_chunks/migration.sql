/*
  Warnings:

  - The `status` column on the `batch_jobs` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "BatchJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "batch_jobs" ADD COLUMN     "completed_chunks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_chunks" INTEGER NOT NULL DEFAULT 0,
DROP COLUMN "status",
ADD COLUMN     "status" "BatchJobStatus" NOT NULL DEFAULT 'QUEUED';

-- CreateIndex
CREATE INDEX "batch_jobs_status_idx" ON "batch_jobs"("status");
