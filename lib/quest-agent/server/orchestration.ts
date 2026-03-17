import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { roleSchemas, workflowScaffolds } from "@/lib/quest-agent/roles/scaffold";
import type { AgentRole, WorkflowKind, WorkflowScaffold } from "@/lib/quest-agent/types";

const promptFiles: Record<AgentRole, string> = {
  scout: "scout_system.md",
  realist: "realist_system.md",
  skeptic: "skeptic_system.md",
  router: "router_system.md",
  archivist: "archivist_system.md",
};

async function loadPrompt(role: AgentRole): Promise<string> {
  const filePath = path.join(process.cwd(), "prompts", promptFiles[role]);
  return readFile(filePath, "utf8");
}

export function getWorkflowScaffold(kind: WorkflowKind): WorkflowScaffold {
  return workflowScaffolds[kind];
}

export async function buildWorkflowInstructions(kind: WorkflowKind): Promise<string> {
  const workflow = getWorkflowScaffold(kind);
  const prompts = await Promise.all(
    workflow.roles.map(async (role) => {
      const prompt = await loadPrompt(role);
      const schemaName = roleSchemas[role].name;
      return `## ${role}\n${prompt.trim()}\nRequired output contract: ${schemaName}.`;
    }),
  );

  return [
    `You are the internal Quest Agent scaffold for workflow: ${kind}.`,
    "This is scaffold mode only. Do not pretend each role is fully autonomous. Use the role prompts as internal guidance and return only the endpoint's final JSON output.",
    `Workflow loop: ${workflow.loop}.`,
    ...prompts,
  ].join("\n\n");
}