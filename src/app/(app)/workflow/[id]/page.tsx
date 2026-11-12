"use client";

import { WorkflowDetail } from "@/components/workflows/workflow-detail";

export default function WorkflowPage({ params }: { params: { id: string } }) {
  return <WorkflowDetail id={params.id} />;
}
