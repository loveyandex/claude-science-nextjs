"use client";

import { ScanEye } from "lucide-react";
import { IndexingPanel } from "@/components/indexing-panel";

export default function MakeScienceGemma4Page() {
  return (
    <IndexingPanel
      icon={ScanEye}
      heading="make / science · gemma4"
      description="Renders every PDF page to an image and asks Cerebras' gemma-4-31b vision model to transcribe it to markdown, page by page — captures figures/equations/tables that plain text extraction misses. Requires the backend/ FastAPI service to be running (see backend/README.md)."
      pendingEndpoint="/api/articles-gemma4/pending"
      indexEndpoint="/api/articles-gemma4/index"
    />
  );
}
