"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Search, Plus, Copy, Check, Sparkles, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fetchApi } from "@/lib/api";

type PromptTemplate = {
    id: string;
    title: string;
    description: string;
    prompt: string;
    category: string;
    is_builtin: number;
    use_count: number;
    created_at: string;
};

const CATEGORIES = ["全部", "HR", "数据", "运维", "文档", "流程", "general"];

const CATEGORY_COLORS: Record<string, string> = {
    HR: "bg-blue-500/10 text-blue-700 border-blue-200",
    数据: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
    运维: "bg-orange-500/10 text-orange-700 border-orange-200",
    文档: "bg-purple-500/10 text-purple-700 border-purple-200",
    流程: "bg-cyan-500/10 text-cyan-700 border-cyan-200",
    general: "bg-muted text-muted-foreground border-border",
};

function TemplateCard({ template, onUse, onDelete }: { template: PromptTemplate; onUse: (t: PromptTemplate) => void; onDelete: (id: string) => void }) {
    const [copied, setCopied] = useState(false);
    const catColor = CATEGORY_COLORS[template.category] ?? CATEGORY_COLORS.general;

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(template.prompt);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast.success("已复制到剪贴板");
    };

    return (
        <Card className="flex flex-col hover:shadow-md transition-shadow group">
            <CardContent className="pt-5 flex-1">
                <div className="flex items-start justify-between mb-2 gap-2">
                    <h3 className="font-semibold text-sm leading-tight">{template.title}</h3>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${catColor}`}>
                        {template.category}
                    </Badge>
                </div>
                {template.description && (
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{template.description}</p>
                )}
                <div className="bg-muted/50 rounded p-2 text-xs text-muted-foreground line-clamp-3 font-mono">
                    {template.prompt.slice(0, 150)}{template.prompt.length > 150 ? "..." : ""}
                </div>
            </CardContent>
            <CardFooter className="pt-0 pb-4 flex items-center justify-between">
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Sparkles className="w-3 h-3" />
                    使用 {template.use_count} 次
                    {template.is_builtin ? <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-1">内置</Badge> : null}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="sm" variant="ghost" onClick={handleCopy} title="复制">
                        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </Button>
                    {!template.is_builtin && (
                        <Button
                            size="sm" variant="ghost"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => onDelete(template.id)}
                            title="删除"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                    )}
                    <Button size="sm" variant="default" onClick={() => onUse(template)}>
                        使用
                    </Button>
                </div>
            </CardFooter>
        </Card>
    );
}

export default function PromptsPage() {
    const router = useRouter();
    const [templates, setTemplates] = useState<PromptTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeCategory, setActiveCategory] = useState("全部");
    const [search, setSearch] = useState("");

    // New template dialog
    const [dialogOpen, setDialogOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [newDesc, setNewDesc] = useState("");
    const [newPrompt, setNewPrompt] = useState("");
    const [newCategory, setNewCategory] = useState("general");

    const loadTemplates = useCallback((category?: string, q?: string) => {
        setLoading(true);
        const params = new URLSearchParams();
        if (category && category !== "全部") params.set("category", category);
        if (q) params.set("q", q);
        fetchApi<PromptTemplate[]>(`/api/prompts?${params}`)
            .then(data => {
                setTemplates(Array.isArray(data) ? data : []);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, []);

    useEffect(() => {
        loadTemplates();
    }, [loadTemplates]);

    const handleCategoryChange = (cat: string) => {
        setActiveCategory(cat);
        loadTemplates(cat === "全部" ? undefined : cat, search || undefined);
    };

    const handleSearchChange = (q: string) => {
        setSearch(q);
        if (q.length === 0 || q.length >= 2) {
            loadTemplates(activeCategory === "全部" ? undefined : activeCategory, q || undefined);
        }
    };

    const handleUse = async (template: PromptTemplate) => {
        // Track usage
        fetchApi(`/api/prompts/${template.id}/use`, { method: "POST" }).catch(() => {});
        router.push(`/chat?prompt=${encodeURIComponent(template.prompt)}`);
    };

    const handleDelete = async (id: string) => {
        try {
            await fetchApi(`/api/prompts/${id}`, { method: "DELETE" });
            toast.success("模板已删除");
            setTemplates(prev => prev.filter(t => t.id !== id));
        } catch (err: any) {
            toast.error(`删除失败: ${err.message}`);
        }
    };

    const handleCreate = async () => {
        if (!newTitle.trim() || !newPrompt.trim()) {
            toast.error("标题和提示词不能为空");
            return;
        }
        setCreating(true);
        try {
            await fetchApi("/api/prompts", {
                method: "POST",
                body: JSON.stringify({ title: newTitle, description: newDesc, prompt: newPrompt, category: newCategory }),
            });
            toast.success("模板已创建");
            setDialogOpen(false);
            setNewTitle(""); setNewDesc(""); setNewPrompt(""); setNewCategory("general");
            loadTemplates(activeCategory === "全部" ? undefined : activeCategory, search || undefined);
        } catch (err: any) {
            toast.error(`创建失败: ${err.message}`);
        } finally {
            setCreating(false);
        }
    };

    const existingCategories = [...new Set(templates.map(t => t.category))].filter(Boolean);
    const displayCategories = [...new Set(["全部", ...CATEGORIES.filter(c => c !== "全部"), ...existingCategories.filter(c => !CATEGORIES.includes(c))])];

    return (
        <div className="h-full overflow-y-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Prompt 模板库</h1>
                    <p className="text-muted-foreground">企业员工常用提示词，一键复用，无需重复输入。</p>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="w-4 h-4 mr-2" />
                            新建模板
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>新建 Prompt 模板</DialogTitle>
                            <DialogDescription>创建常用提示词，方便后续快速使用</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-2">
                            <div className="space-y-1.5">
                                <Label>标题 *</Label>
                                <Input placeholder="例如：生成季度报告" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>描述</Label>
                                <Input placeholder="简短说明此模板的用途" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>提示词内容 *</Label>
                                <Textarea
                                    placeholder="输入完整的提示词，可使用 [占位符] 标记需要填写的部分"
                                    rows={5}
                                    value={newPrompt}
                                    onChange={e => setNewPrompt(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>分类</Label>
                                <div className="flex flex-wrap gap-2">
                                    {["general", "HR", "数据", "运维", "文档", "流程"].map(cat => (
                                        <button
                                            key={cat}
                                            onClick={() => setNewCategory(cat)}
                                            className={`text-xs px-3 py-1 rounded-full border transition-colors ${newCategory === cat ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted/50"}`}
                                        >
                                            {cat}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
                            <Button onClick={handleCreate} disabled={creating}>
                                {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                创建模板
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Search + Category Tabs */}
            <div className="flex items-center gap-3">
                <div className="relative max-w-xs">
                    <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                    <Input
                        className="pl-9"
                        placeholder="搜索模板..."
                        value={search}
                        onChange={e => handleSearchChange(e.target.value)}
                    />
                </div>
                <span className="text-sm text-muted-foreground">{templates.length} 个模板</span>
            </div>

            <Tabs value={activeCategory} onValueChange={handleCategoryChange}>
                <TabsList className="flex-wrap h-auto gap-1">
                    {displayCategories.map(cat => (
                        <TabsTrigger key={cat} value={cat} className="text-xs">
                            {cat}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <TabsContent value={activeCategory} className="mt-6">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : templates.length > 0 ? (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {templates.map(template => (
                                <TemplateCard
                                    key={template.id}
                                    template={template}
                                    onUse={handleUse}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="py-20 text-center text-muted-foreground border-2 border-dashed rounded-xl">
                            <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-20" />
                            <p>没有找到模板</p>
                            <p className="text-xs mt-1">尝试创建一个自定义模板</p>
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}
