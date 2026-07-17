---
name: test-chat-endpoint
description: Test the AI chat route and its searchArticles tool by sending requests to the local api/chat endpoint using curl.
---

# test-chat-endpoint

This skill describes how an AI agent can test the AI chat route (`/api/chat`). The endpoint uses the Vercel AI SDK to stream text and supports the `searchArticles` tool to ground responses in indexed research papers.

## Pre-requisites
1. The Next.js dev server must be running (`npm run dev`).
2. `OPENAI_API_KEY` and `OPENAI_BASE_URL` must be correctly configured in `.env`.

## Test Commands

To simulate a user message and see the streamed AI response (including tool calls if the query matches indexed papers), execute:

```bash
curl -X POST -H "Content-Type: application/json" -d "{\"messages\": [{\"role\": \"user\", \"content\": \"What papers do we have on CRISPR?\"}]}" http://localhost:3000/api/chat
```

If the database has papers indexed on the topic, the agent will call the `searchArticles` tool, query SQLite, and use the results to construct its final answer. The streamed response will contain the tool execution log and final message chunks.
