-- CreateTable
CREATE TABLE "fraud_labels" (
    "id" TEXT NOT NULL,
    "txn_id" TEXT NOT NULL,
    "is_fraud" BOOLEAN NOT NULL,
    "is_flagged_fraud" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'PAYSIM',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_labels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fraud_labels_txn_id_key" ON "fraud_labels"("txn_id");

-- CreateIndex
CREATE INDEX "fraud_labels_is_fraud_idx" ON "fraud_labels"("is_fraud");

-- AddForeignKey
ALTER TABLE "fraud_labels" ADD CONSTRAINT "fraud_labels_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "transactions"("txn_id") ON DELETE CASCADE ON UPDATE CASCADE;
