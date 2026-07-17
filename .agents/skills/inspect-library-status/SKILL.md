---
name: inspect-library-status
description: Inspect the SQLite database status to see the number of successfully indexed research papers vs. failed indexing attempts.
---

# inspect-library-status

This skill describes how an AI agent can inspect the state of the SQLite database (`dev.db`) in this project. Since the database is SQLite, you can query it directly using the `sqlite3` command-line utility or any database client.

## SQLite CLI Commands

You can run these commands from the project root directory.

### 1. View Summary Statistics
Get the count of papers grouped by their status (`indexed` or `failed`):

```bash
sqlite3 dev.db "SELECT status, COUNT(*) as count FROM Article GROUP BY status;"
```

### 2. View 5 Most Recently Indexed Articles
Show the titles and paths of the most recently indexed papers:

```bash
sqlite3 dev.db "SELECT url, title, createdAt FROM Article WHERE status = 'indexed' ORDER BY createdAt DESC LIMIT 5;"
```

### 3. View Recent Indexing Failures
Show the paths and error reasons of the most recent indexing failures to troubleshoot OCR or connection issues:

```bash
sqlite3 dev.db "SELECT url, errorReason, createdAt FROM Article WHERE status = 'failed' ORDER BY createdAt DESC LIMIT 5;"
```
