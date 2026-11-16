CREATE TABLE "SpringerIssueCrawl" (
    "journalId" TEXT NOT NULL,
    "volume" INTEGER NOT NULL,
    "issue" TEXT NOT NULL,
    "dois" TEXT[] NOT NULL,
    "crawledAt" TIMESTAMP(3) NOT NULL,
    "complete" BOOLEAN NOT NULL,
    CONSTRAINT "SpringerIssueCrawl_pkey" PRIMARY KEY ("journalId", "volume", "issue"),
    CONSTRAINT "SpringerIssueCrawl_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "SpringerJournal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
