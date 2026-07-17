---
name: trigger-indexing-pipeline
description: Trigger the paper indexing pipeline by calling the local Next.js API route using curl.
---

# trigger-indexing-pipeline

This skill describes how an AI agent can trigger the paper indexing pipeline on the local development server. The server runs at `http://localhost:3000` (or whichever port Next.js starts on).

## Steps to Trigger Indexing

### 1. Ensure the Local Server is Running
Start the Next.js dev server:

```bash
npm run dev
```

### 2. Check Pending Articles Count
Check how many new articles are available in the repository manifest but not yet indexed:

```bash
curl http://localhost:3000/api/articles/pending
```

This returns a JSON list of pending articles.

### 3. Trigger Indexing Batch
Start indexing the next batch of articles (default limit is 20, but you can request a custom limit like 5). This endpoint streams NDJSON events in real-time, detailing the download, OCR/extraction, and database upsert operations.

```bash
curl -N -X POST -H "Content-Type: application/json" -d "{\"limit\": 5}" http://localhost:3000/api/articles/index
```

### 4. Verify Database
After running the command, check the database status to verify that the articles were processed successfully:

```bash
sqlite3 dev.db "SELECT status, COUNT(*) FROM Article GROUP BY status;"
```
