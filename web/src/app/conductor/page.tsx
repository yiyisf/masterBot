"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import "reactflow/dist/style.css";
import "@yiyi_zhang/reactflow-ui/style.css";
import { fetchApi } from "@/lib/api";
import { WorkflowIDE, WorkflowDef, WorkflowIDERef } from "@yiyi_zhang/reactflow-ui";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Edit3, ArrowLeft, Download, RotateCcw, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SavedWorkflow {
    id: string;
    name: string;
    description?: string;
    version: number;
    definition: WorkflowDef;
    createdAt: string;
    updatedAt: string;
}

export default function ConductorPage() {
    const [workflows, setWorkflows] = useState<SavedWorkflow[]>([]);
    const [loading, setLoading] = useState(true);

    // View state: 'list' | 'edit'
    const [view, setView] = useState<'list' | 'edit'>('list');
    const [editingWorkflow, setEditingWorkflow] = useState<SavedWorkflow | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const ideRef = useRef<WorkflowIDERef>(null);
    const { resolvedTheme } = useTheme();
    const ideTheme = resolvedTheme === 'dark' ? 'dark' : 'light';

    const loadWorkflows = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchApi<SavedWorkflow[]>('/api/conductor-workflows');
            setWorkflows(data);
        } catch (error) {
            console.error('Failed to load Conductor workflows:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (view === 'list') {
            loadWorkflows();
        }
    }, [view, loadWorkflows]);

    const handleDelete = async (id: string) => {
        if (!confirm('确定删除此工作流吗？')) return;
        try {
            await fetchApi(`/api/conductor-workflows/${id}`, { method: 'DELETE' });
            setWorkflows(prev => prev.filter(w => w.id !== id));
        } catch (error) {
            console.error('Failed to delete workflow:', error);
            alert('删除失败');
        }
    };

    const handleCreateNew = () => {
        const emptyDef: WorkflowDef = {
            name: 'New_Workflow',
            description: '',
            version: 1,
            tasks: [],
            schemaVersion: 2
        };
        setEditingWorkflow({
            id: '',
            name: emptyDef.name,
            version: 1,
            definition: emptyDef,
            createdAt: '',
            updatedAt: ''
        });
        setView('edit');
    };

    const handleEdit = (w: SavedWorkflow) => {
        setEditingWorkflow(w);
        setView('edit');
    };

    const handleSave = async (def: WorkflowDef) => {
        if (!editingWorkflow) return;
        setIsSaving(true);
        try {
            const payload = {
                name: def.name,
                description: def.description,
                version: def.version,
                definition: def
            };

            if (editingWorkflow.id) {
                // Update
                await fetchApi(`/api/conductor-workflows/${editingWorkflow.id}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload)
                });
            } else {
                // Create
                const res = await fetchApi<{ id: string }>('/api/conductor-workflows', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                editingWorkflow.id = res.id;
            }
            alert('保存成功');
        } catch (error) {
            console.error('Failed to save workflow:', error);
            alert('保存失败');
        } finally {
            setIsSaving(false);
        }
    };

    const handleExport = (def: WorkflowDef) => {
        const blob = new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${def.name || 'workflow'}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    if (view === 'edit' && editingWorkflow) {
        return (
            <div className="flex flex-col h-full w-full overflow-hidden bg-background">
                {/* Header Navbar */}
                <div className="h-14 shrink-0 flex items-center justify-between px-6 border-b z-10 bg-card">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="sm" onClick={() => setView('list')} className="text-muted-foreground mr-2">
                            <ArrowLeft className="w-4 h-4 mr-1" /> 返回列表
                        </Button>
                        <div>
                            <h2 className="text-[15px] font-semibold flex items-center gap-2">
                                {editingWorkflow.id ? '编辑工作流' : '新建工作流'}
                                <Badge variant="secondary" className="font-mono text-[10px]">{editingWorkflow.definition.name}</Badge>
                            </h2>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleExport(editingWorkflow.definition)}
                        >
                            <Download className="w-4 h-4 mr-2" /> 导出 JSON
                        </Button>
                        <Button
                            size="sm"
                            disabled={isSaving}
                            onClick={async () => {
                                const def = ideRef.current?.getWorkflowDef();
                                if (def) await handleSave(def);
                            }}
                        >
                            <Save className="w-4 h-4 mr-2" /> {isSaving ? "保存中..." : "保存"}
                        </Button>
                    </div>
                </div>

                {/* Workflow IDE Area */}
                <div className="flex-1 min-h-0 relative">
                    <WorkflowIDE
                        ref={ideRef}
                        workflowDef={editingWorkflow.definition}
                        theme={ideTheme}
                        onSave={handleSave}
                        aiConfig={{ baseUrl: '/api/conductor', model: 'assistant', apiKey: 'local' }}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="p-8 max-w-7xl mx-auto w-full h-full overflow-y-auto">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Conductor 编排</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        管理和编辑企业级 Conductor OSS 工作流定义
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="outline" onClick={loadWorkflows} disabled={loading}>
                        <RotateCcw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        刷新
                    </Button>
                    <Button onClick={handleCreateNew}>
                        <Plus className="w-4 h-4 mr-2" />
                        新建工作流
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>
            ) : workflows.length === 0 ? (
                <div className="flex flex-col justify-center items-center h-64 border-2 border-dashed rounded-xl border-border bg-card/50 text-muted-foreground">
                    <p>暂无 Conductor 工作流</p>
                    <Button variant="link" onClick={handleCreateNew} className="mt-2">立即创建一个</Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {workflows.map(w => (
                        <Card key={w.id} className="group hover:shadow-md transition-shadow relative overflow-hidden flex flex-col">
                            <CardHeader className="pb-3 break-words relative z-10">
                                <CardTitle className="text-[16px] leading-snug line-clamp-1 flex justify-between items-start" title={w.name}>
                                    <span className="font-mono text-[14px]">{w.name}</span>
                                </CardTitle>
                                <CardDescription className="line-clamp-2 min-h-[40px] text-xs">
                                    {w.description || '无描述'}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex-1 pb-2">
                                <div className="flex flex-wrap gap-2">
                                    <Badge variant="secondary" className="font-normal">v{w.version}</Badge>
                                    <Badge variant="outline" className="font-normal border-primary/20 text-primary">
                                        {w.definition?.tasks?.length || 0} 个节点
                                    </Badge>
                                </div>
                            </CardContent>
                            <CardFooter className="pt-2 pb-4 flex items-center justify-between border-t border-border/40 bg-muted/20">
                                <div className="text-[11px] text-muted-foreground">
                                    更新于 {new Date(w.updatedAt).toLocaleDateString()}
                                </div>
                                <div className="flex gap-1 h-8">
                                    <Button variant="ghost" size="icon" className="h-7 w-7 rounded-sm" onClick={() => handleExport(w.definition)} title="导出 JSON">
                                        <Download className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 rounded-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/40" onClick={() => handleEdit(w)} title="编辑">
                                        <Edit3 className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 rounded-sm text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/40" onClick={() => handleDelete(w.id)} title="删除">
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
