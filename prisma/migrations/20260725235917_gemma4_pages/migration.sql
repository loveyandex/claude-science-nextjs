-- AlterTable
ALTER TABLE "Article" DROP COLUMN "firstPage",
ADD COLUMN     "gemmaError" TEXT,
ADD COLUMN     "gemmaStatus" TEXT;

-- CreateTable
CREATE TABLE "ArticlePage" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticlePage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArticlePage_articleId_pageNumber_key" ON "ArticlePage"("articleId", "pageNumber");

-- AddForeignKey
ALTER TABLE "ArticlePage" ADD CONSTRAINT "ArticlePage_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

