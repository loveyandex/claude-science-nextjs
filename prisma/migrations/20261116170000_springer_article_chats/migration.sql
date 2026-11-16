ALTER TABLE "Chat" ADD COLUMN "springerArticleId" TEXT;
CREATE INDEX "Chat_springerArticleId_idx" ON "Chat"("springerArticleId");
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_springerArticleId_fkey"
  FOREIGN KEY ("springerArticleId") REFERENCES "SpringerArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
