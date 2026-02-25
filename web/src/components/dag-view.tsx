"use client";

import React, { useMemo } from "react";
import { Mermaid } from "@/components/mermaid";

interface DagStep {
  taskId?: string;
  type: string;
  content: string;
}

interface DagViewProps {
  steps: DagStep[];
}

/**
 * Renders a Mermaid flowchart from task_created/task_completed/task_failed steps
 */
export function DagView({ steps }: DagViewProps) {
  const mermaidCode = useMemo(() => {
    const taskSteps = steps.filter(s => s.taskId && (s.type === 'task_created' || s.type === 'task_completed' || s.type === 'task_failed'));
    if (taskSteps.length === 0) return null;

    // Build task map
    const tasks = new Map<string, { content: string; status: string }>();
    for (const step of taskSteps) {
      if (!step.taskId) continue;
      if (step.type === 'task_created') {
        tasks.set(step.taskId, { content: step.content.replace(/Task created:\s*/, '').substring(0, 40), status: 'pending' });
      } else if (step.type === 'task_completed') {
        const existing = tasks.get(step.taskId);
        if (existing) tasks.set(step.taskId, { ...existing, status: 'completed' });
      } else if (step.type === 'task_failed') {
        const existing = tasks.get(step.taskId);
        if (existing) tasks.set(step.taskId, { ...existing, status: 'failed' });
      }
    }

    if (tasks.size === 0) return null;

    const lines: string[] = ['flowchart TD'];

    // Style classes
    lines.push('  classDef pending fill:#334155,stroke:#64748b,color:#e2e8f0');
    lines.push('  classDef completed fill:#14532d,stroke:#22c55e,color:#dcfce7');
    lines.push('  classDef failed fill:#7f1d1d,stroke:#ef4444,color:#fee2e2');
    lines.push('  classDef running fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe');

    for (const [id, task] of tasks) {
      const safeLabel = task.content.replace(/"/g, "'").replace(/[<>{}]/g, '');
      const shortId = id.substring(0, 8);
      lines.push(`  ${shortId}["${safeLabel}"]`);
      lines.push(`  class ${shortId} ${task.status}`);
    }

    return lines.join('\n');
  }, [steps]);

  if (!mermaidCode) return null;

  return (
    <div className="mt-3 w-full">
      <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
        <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
        任务 DAG
      </div>
      <Mermaid code={mermaidCode} />
    </div>
  );
}
