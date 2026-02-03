"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Puzzle, Box, Code, Server, Plus, Trash2, Terminal, Globe } from "lucide-react";
import { fetchApi } from "@/lib/api";

type McpServerConfig = {
    id: string;
    name: string;
    type: 'stdio' | 'sse';
    command?: string;
    args?: string[];
    url?: string;
    enabled: boolean;
};

export default function SkillsPage() {
    const [skills, setSkills] = useState<any[]>([]);
    const [mcpConfigs, setMcpConfigs] = useState<McpServerConfig[]>([]);
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [newConfig, setNewConfig] = useState<Partial<McpServerConfig>>({
        type: 'stdio',
        enabled: true,
        args: []
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = () => {
        fetchApi("/api/skills")
            .then((data: any) => setSkills(Array.isArray(data) ? data : []))
            .catch(console.error);

        fetchApi("/api/mcp/config")
            .then((data: any) => setMcpConfigs(Array.isArray(data) ? data : []))
            .catch(console.error);
    };

    const handleAddServer = async () => {
        if (!newConfig.name || (!newConfig.command && !newConfig.url)) return;

        try {
            await fetchApi("/api/mcp/config", {
                method: "POST",
                body: JSON.stringify(newConfig)
            });
            setIsAddOpen(false);
            setNewConfig({ type: 'stdio', enabled: true, args: [] });
            loadData();
        } catch (e) {
            console.error("Failed to add server", e);
        }
    };

    const handleDeleteServer = async (id: string) => {
        if (!confirm("Confirm delete?")) return;
        try {
            await fetchApi(`/api/mcp/config/${id}`, { method: "DELETE" });
            loadData();
        } catch (e) {
            console.error("Failed to delete server", e);
        }
    };

    return (
        <div className="h-full overflow-y-auto w-full max-w-5xl mx-auto p-6 space-y-8 pb-10">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Skill & MCP Management</h1>
                <p className="text-muted-foreground mt-1">Configure capabilities and external MCP server connections.</p>
            </div>

            <Tabs defaultValue="available">
                <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
                    <TabsTrigger value="available">Active Skills</TabsTrigger>
                    <TabsTrigger value="mcp">MCP Servers</TabsTrigger>
                </TabsList>

                <TabsContent value="available" className="mt-6">
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
                        {skills.map((skill) => (
                            <Card key={skill.name}>
                                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                                    <div className="space-y-1">
                                        <CardTitle className="flex items-center gap-2">
                                            <Puzzle className="w-4 h-4 text-primary" />
                                            {skill.name}
                                            <Badge variant="secondary" className="text-[10px]">{skill.version}</Badge>
                                        </CardTitle>
                                        <CardDescription>{skill.description}</CardDescription>
                                    </div>
                                    <Switch checked={true} disabled />
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        <div className="flex flex-wrap gap-2">
                                            {skill.actions.map((action: string) => (
                                                <Badge key={action} variant="outline" className="font-mono text-[10px] flex gap-1 items-center">
                                                    <Code className="w-3 h-3" />
                                                    {action}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                        {skills.length === 0 && (
                            <div className="col-span-full py-20 text-center border-2 border-dashed rounded-xl space-y-4">
                                <Box className="w-12 h-12 text-muted-foreground mx-auto" />
                                <p className="text-muted-foreground italic">No active skills found.</p>
                            </div>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="mcp" className="mt-6 space-y-6">
                    <div className="flex justify-end">
                        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                            <DialogTrigger asChild>
                                <Button className="gap-2">
                                    <Plus className="w-4 h-4" /> Add MCP Server
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Connect New MCP Server</DialogTitle>
                                    <DialogDescription>
                                        Add a local (stdio) or remote (SSE) MCP server to extend capabilities.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <div className="grid gap-2">
                                        <Label>Name</Label>
                                        <Input
                                            placeholder="e.g. GitHub, PostgreSQL"
                                            value={newConfig.name || ''}
                                            onChange={e => setNewConfig({ ...newConfig, name: e.target.value })}
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>Type</Label>
                                        <div className="flex gap-4">
                                            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setNewConfig({ ...newConfig, type: 'stdio' })}>
                                                <div className={`w-4 h-4 rounded-full border ${newConfig.type === 'stdio' ? 'bg-primary border-primary' : 'border-muted-foreground'}`} />
                                                <span>Stdio (Local)</span>
                                            </div>
                                            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setNewConfig({ ...newConfig, type: 'sse' })}>
                                                <div className={`w-4 h-4 rounded-full border ${newConfig.type === 'sse' ? 'bg-primary border-primary' : 'border-muted-foreground'}`} />
                                                <span>SSE (Remote)</span>
                                            </div>
                                        </div>
                                    </div>

                                    {newConfig.type === 'stdio' ? (
                                        <div className="grid gap-2">
                                            <Label>Command</Label>
                                            <Input
                                                placeholder="e.g. npx"
                                                value={newConfig.command || ''}
                                                onChange={e => setNewConfig({ ...newConfig, command: e.target.value })}
                                            />
                                            <Label>Args (JSON Array, optional)</Label>
                                            <Input
                                                placeholder='["-y", "@modelcontextprotocol/server-github"]'
                                                onChange={e => {
                                                    try {
                                                        const args = JSON.parse(e.target.value);
                                                        setNewConfig({ ...newConfig, args: Array.isArray(args) ? args : [] });
                                                    } catch { }
                                                }}
                                            />
                                        </div>
                                    ) : (
                                        <div className="grid gap-2">
                                            <Label>URL</Label>
                                            <Input
                                                placeholder="http://localhost:8000/sse"
                                                value={newConfig.url || ''}
                                                onChange={e => setNewConfig({ ...newConfig, url: e.target.value })}
                                            />
                                        </div>
                                    )}
                                </div>
                                <DialogFooter>
                                    <Button onClick={handleAddServer}>Save Connection</Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>

                    <div className="grid gap-4">
                        {mcpConfigs.map(config => (
                            <Card key={config.id} className="flex flex-row items-center justify-between p-6">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                                        {config.type === 'stdio' ? <Terminal className="w-5 h-5" /> : <Globe className="w-5 h-5" />}
                                    </div>
                                    <div>
                                        <h3 className="font-semibold flex items-center gap-2">
                                            {config.name}
                                            <Badge variant={config.enabled ? "default" : "outline"} className="text-[10px]">
                                                {config.enabled ? "Enabled" : "Disabled"}
                                            </Badge>
                                        </h3>
                                        <p className="text-sm text-muted-foreground font-mono mt-0.5">
                                            {config.type === 'stdio'
                                                ? `${config.command} ${(config.args || []).join(' ')}`
                                                : config.url}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Switch checked={config.enabled} />
                                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDeleteServer(config.id)}>
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </Card>
                        ))}
                        {mcpConfigs.length === 0 && (
                            <div className="py-20 text-center border-2 border-dashed rounded-xl space-y-4">
                                <Server className="w-12 h-12 text-muted-foreground mx-auto" />
                                <p className="text-muted-foreground italic">No MCP servers configured.</p>
                            </div>
                        )}
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}
