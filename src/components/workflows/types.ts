import type { UIMessage } from "ai";

export type WorkflowStatus = "draft" | "running" | "completed" | "failed" | "cancelled";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type PlanStep = { title: string; status: "todo" | "doing" | "done" | "skipped"; note?: string };

export type WorkflowSummary = {
  id: string;
  name: string;
  brief: string;
  status: WorkflowStatus;
  createdAt: string;
  lastActivityAt: string;
  runCount: number;
  findingCount: number;
};

export type WorkflowDetail = {
  id: string;
  name: string;
  brief: string;
  status: WorkflowStatus;
  modelWireId: string | null;
  maxSteps: number;
  currentRunId: string | null;
  activeChatRunId: string | null;
  createdAt: string;
  lastActivityAt: string;
  chatMessages: UIMessage[];
  findingCount: number;
  eventCount: number;
};

export type RunRecord = {
  id: string;
  number: number;
  status: RunStatus;
  brief: string;
  modelLabel: string | null;
  maxSteps: number;
  stepCount: number;
  toolCallCount: number;
  plan: PlanStep[];
  report: string | null;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
};

export type WorkflowEvent = {
  id: string;
  runId: string | null;
  type: string;
  title: string;
  detail: string | null;
  data: Record<string, any> | null;
  createdAt: string;
};

export type FindingSource = { doi?: string; url?: string; title?: string; page?: number; quote?: string };

export type Finding = {
  id: string;
  title: string;
  content: string;
  sources: FindingSource[];
  confidence: "high" | "medium" | "low" | null;
  tags: string[];
  runNumber: number | null;
  createdAt: string;
};

export type ProviderOption = {
  id: string;
  label: string;
  type: string;
  baseUrl: string | null;
  models: { wireId: string; modelName: string; label: string }[];
};
