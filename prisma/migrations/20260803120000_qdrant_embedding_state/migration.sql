-- AlterTable: rolled-up embedding state per article (read optimization only)
ALTER TABLE "Article" ADD COLUMN     "embeddingStatus" TEXT,
ADD COLUMN     "embeddedAt" TIMESTAMP(3);

-- AlterTable: authoritative, resumable per-page embedding state
ALTER TABLE "ArticlePage" ADD COLUMN     "embeddingStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "chunkCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "embeddedChunks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "embeddingModel" TEXT,
ADD COLUMN     "embeddingError" TEXT,
ADD COLUMN     "embeddedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ArticlePage_embeddingStatus_idx" ON "ArticlePage"("embeddingStatus");

-- AlterTable: make-embedding pipeline settings (singleton row)
ALTER TABLE "AppSettings" ADD COLUMN     "embeddingCollection" TEXT NOT NULL DEFAULT 'fastembed_articles',
ADD COLUMN     "embeddingModel" TEXT NOT NULL DEFAULT 'BAAI/bge-small-en',
ADD COLUMN     "embeddingChunkTokens" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "embeddingChunkOverlap" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "embeddingPageBatch" INTEGER NOT NULL DEFAULT 8;
