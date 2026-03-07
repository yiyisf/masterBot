import React, { useState, useRef } from "react";
import "reactflow/dist/style.css";
import "reactflow-ui/style.css";
import { WorkflowIDE, WorkflowDef, WorkflowIDERef } from "reactflow-ui";
import { useTheme } from "next-themes";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PlaySquare, Save } from "lucide-react";
import { fetchApi } from "@/lib/api";

interface ConductorWorkflowDialogProps {
    workflowDef: WorkflowDef;
    explanation?: string;
    onSaveSuccess?: () => void;
}

export function ConductorWorkflowCard({ workflowDef, explanation, onSaveSuccess }: ConductorWorkflowDialogProps) {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const ideRef = useRef<WorkflowIDERef>(null);
    const { resolvedTheme } = useTheme();
    const ideTheme = resolvedTheme === 'dark' ? 'dark' : 'light';

    const handleSave = async (def: WorkflowDef) => {
        setSaving(true);
        try {
            await fetchApi('/api/conductor-workflows', {
                method: 'POST',
                body: JSON.stringify({
                    name: def.name || 'Untitled_Workflow',
                    description: def.description || '',
                    version: def.version || 1,
                    definition: def
                }),
            });
            if (onSaveSuccess) onSaveSuccess();
        } catch (error) {
            console.error('Failed to save workflow', error);
            alert('保存工作流失败');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="my-4 p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 max-w-2xl">
            <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400">
                    <PlaySquare className="w-5 h-5" />
                </div>
                <div>
                    <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                        {workflowDef.name || "生成的 Conductor 工作流"}
                    </h3>
                    <p className="text-xs text-blue-700/80 dark:text-blue-300/80">
                        共 {workflowDef.tasks?.length || 0} 个任务节点
                    </p>
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto border-blue-300 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300"
                    onClick={() => setOpen(true)}
                >
                    在 IDE 中查看
                </Button>
            </div>

            {explanation && (
                <div className="text-[13px] text-blue-900/70 dark:text-blue-100/70 border-t border-blue-200/50 dark:border-blue-800/50 pt-3 mt-1">
                    {explanation}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent
                    className="p-0 flex flex-col gap-0 overflow-hidden border-zinc-200 dark:border-zinc-800"
                    style={{ width: '95vw', maxWidth: '95vw', height: '92vh' }}
                >
                    <div className="sr-only">
                        <DialogTitle>Conductor Workflow IDE</DialogTitle>
                        <DialogDescription>可视化编辑您的 Conductor 工作流</DialogDescription>
                    </div>
                    {/* Toolbar header */}
                    <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b bg-background">
                        <h2 className="text-sm font-medium">✨ 工作流预览与编辑</h2>
                        <Button
                            size="sm"
                            onClick={() => {
                                const def = ideRef.current?.getWorkflowDef();
                                if (def) handleSave(def);
                            }}
                            disabled={saving}
                            className="h-8"
                        >
                            <Save className="w-4 h-4 mr-1.5" />
                            {saving ? "保存中..." : "保存到系统"}
                        </Button>
                    </div>
                    {/* IDE viewport */}
                    <div className="flex-1 min-h-0 relative">
                        <WorkflowIDE
                            ref={ideRef}
                            workflowDef={workflowDef}
                            theme={ideTheme}
                            aiConfig={{ baseUrl: '/api/conductor', model: 'assistant', apiKey: 'local' }}
                        />
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
