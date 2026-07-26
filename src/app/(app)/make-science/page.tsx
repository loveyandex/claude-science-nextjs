"use client";

import { Database } from "lucide-react";
import { IndexingPanel } from "@/components/indexing-panel";

export default function MakeSciencePage() {
  return (
    <IndexingPanel
      icon={Database}
      heading="make / science"
      description="Pulls PDFs from your article repo, reads the first page, asks the model for a clean title + abstract, and saves it as an Article."
      pendingEndpoint="/api/articles/pending"
      indexEndpoint="/api/articles/index"
    />
  );
}
