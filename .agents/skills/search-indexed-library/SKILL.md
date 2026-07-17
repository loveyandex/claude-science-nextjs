---
name: search-indexed-library
description: Search the indexed research papers library (SQLite database) using a keyword query to inspect paper titles, abstracts, and metadata.
---

# search-indexed-library

This skill describes how an AI agent can search the indexed research articles in the local SQLite database (`dev.db`) using the `sqlite3` command-line utility.

## Search Commands

Run these commands from the project root. Replace `query` with the term you wish to search for (e.g., `CRISPR`, `immunogenicity`).

### 1. Simple Keyword Search
Search across both titles and abstracts and return matching papers:

```bash
sqlite3 dev.db "SELECT title, url, pdfUrl FROM Article WHERE status = 'indexed' AND (title LIKE '%query%' OR abstract LIKE '%query%') LIMIT 5;"
```

### 2. View Abstract Detail
To view the abstract details of matching papers (using `.mode line` for readable vertical formatting):

```bash
sqlite3 dev.db ".mode line" "SELECT title, url, abstract FROM Article WHERE status = 'indexed' AND (title LIKE '%query%' OR abstract LIKE '%query%') LIMIT 3;"
```
