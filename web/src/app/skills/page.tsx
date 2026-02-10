"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Puzzle, Box, Code, Server, Plus, Trash2, Terminal, Globe, Search, Download, ExternalLink, Loader2 } from "lucide-react";
import { fetchApi } from "@/lib/api";

type McpServerConfig = {
    id: string;
    name: string;
    type: 'stdio' | 'sse' | 'streamable-http';
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
    enabled: boolean;
};

type RegistryServer = {
    name: string;
    description?: string;
    repository?: { url: string; source: string };
    version_detail?: { version: string };
    packages?: Array<{
        registry_name: string;
        name: string;
        version?: string;
        runtime?: string;
        environment_variables?: Array<{
            name: string;
            description?: string;
            required?: boolean;
        }>;
    }>;
    remotes?: Array<{
        transport_type: string;
        url: string;
    }>;
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

    // Registry state
    const [registryServers, setRegistryServers] = useState<RegistryServer[]>([]);
    const [registrySearch, setRegistrySearch] = useState('');
    const [registryLoading, setRegistryLoading] = useState(false);
    const [installDialogServer, setInstallDialogServer] = useState<RegistryServer | null>(null);
    const [installEnvVars, setInstallEnvVars] = useState<Record<string, string>>({});
    const [installing, setInstalling] = useState(false);

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

    // Registry functions
    const searchRegistry = useCallback(async (query?: string) => {
        setRegistryLoading(true);
        try {
            const endpoint = query
                ? `/api/mcp/registry/search?q=${encodeURIComponent(query)}`
                : '/api/mcp/registry';
            const data: any = await fetchApi(endpoint);
            setRegistryServers(data.servers || []);
        } catch (e) {
            console.error("Registry search failed", e);
        } finally {
            setRegistryLoading(false);
        }
    }, []);

    const handleRegistrySearch = () => {
        searchRegistry(registrySearch || undefined);
    };

    const openInstallDialog = (server: RegistryServer) => {
        setInstallDialogServer(server);
        // Pre-fill env vars
        const envVars: Record<string, string> = {};
        const pkg = server.packages?.find(p => p.registry_name === 'npm');
        if (pkg?.environment_variables) {
            for (const ev of pkg.environment_variables) {
                envVars[ev.name] = '';
            }
        }
        setInstallEnvVars(envVars);
    };

    const handleInstall = async () => {
        if (!installDialogServer) return;
        setInstalling(true);
        try {
            await fetchApi("/api/mcp/registry/install", {
                method: "POST",
                body: JSON.stringify({
                    name: installDialogServer.name,
                    env: Object.keys(installEnvVars).length > 0 ? installEnvVars : undefined,
                }),
            });
            setInstallDialogServer(null);
            setInstallEnvVars({});
            loadData();
        } catch (e) {
            console.error("Install failed", e);
        } finally {
            setInstalling(false);
        }
    };

    const isInstalled = (name: string) => mcpConfigs.some(c => c.name === name);

    return (
        <div className="h-full overflow-y-auto w-full max-w-5xl mx-auto p-6 space-y-8 pb-10">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Skill & MCP Management</h1>
                <p className="text-muted-foreground mt-1">Configure capabilities and external MCP server connections.</p>
            </div>

            <Tabs defaultValue="available">
                <TabsList className="grid w-full grid-cols-3 max-w-[600px]">
                    <TabsTrigger value="available">Active Skills</TabsTrigger>
                    <TabsTrigger value="mcp">MCP Servers</TabsTrigger>
                    <TabsTrigger value="registry">MCP Registry</TabsTrigger>
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
                                        Add a local (stdio), remote (SSE), or streamable HTTP MCP server.
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
                                            {(['stdio', 'sse', 'streamable-http'] as const).map(type => (
                                                <div key={type} className="flex items-center gap-2 cursor-pointer" onClick={() => setNewConfig({ ...newConfig, type })}>
                                                    <div className={`w-4 h-4 rounded-full border ${newConfig.type === type ? 'bg-primary border-primary' : 'border-muted-foreground'}`} />
                                                    <span>{type === 'stdio' ? 'Stdio (Local)' : type === 'sse' ? 'SSE (Remote)' : 'Streamable HTTP'}</span>
                                                </div>
                                            ))}
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
                                                placeholder={newConfig.type === 'sse' ? 'http://localhost:8000/sse' : 'http://localhost:8000/mcp'}
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
                                            <Badge variant="secondary" className="text-[10px]">
                                                {config.type}
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

                <TabsContent value="registry" className="mt-6 space-y-6">
                    <div className="flex gap-2">
                        <Input
                            placeholder="Search MCP servers (e.g. github, postgres, slack...)"
                            value={registrySearch}
                            onChange={e => setRegistrySearch(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleRegistrySearch()}
                            className="max-w-lg"
                        />
                        <Button onClick={handleRegistrySearch} disabled={registryLoading} className="gap-2">
                            {registryLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                            Search
                        </Button>
                        <Button variant="outline" onClick={() => searchRegistry()} disabled={registryLoading}>
                            Browse All
                        </Button>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        {registryServers.map((server) => (
                            <Card key={server.name}>
                                <CardHeader>
                                    <div className="flex items-start justify-between">
                                        <div className="space-y-1">
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <Server className="w-4 h-4 text-primary" />
                                                {server.name}
                                                {server.version_detail?.version && (
                                                    <Badge variant="secondary" className="text-[10px]">{server.version_detail.version}</Badge>
                                                )}
                                            </CardTitle>
                                            <CardDescription className="text-sm line-clamp-2">
                                                {server.description || 'No description'}
                                            </CardDescription>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <div className="flex flex-wrap gap-1">
                                        {server.packages?.map(p => (
                                            <Badge key={p.registry_name} variant="outline" className="text-[10px]">
                                                {p.registry_name}: {p.name}
                                            </Badge>
                                        ))}
                                        {server.remotes?.map((r, i) => (
                                            <Badge key={i} variant="outline" className="text-[10px]">
                                                {r.transport_type}
                                            </Badge>
                                        ))}
                                    </div>
                                </CardContent>
                                <CardFooter className="flex justify-between">
                                    {server.repository?.url && (
                                        <a href={server.repository.url} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground flex items-center gap-1 hover:text-foreground">
                                            <ExternalLink className="w-3 h-3" /> Source
                                        </a>
                                    )}
                                    {isInstalled(server.name) ? (
                                        <Badge variant="default" className="text-[10px]">Installed</Badge>
                                    ) : (
                                        <Button size="sm" onClick={() => openInstallDialog(server)} className="gap-1">
                                            <Download className="w-3 h-3" /> Install
                                        </Button>
                                    )}
                                </CardFooter>
                            </Card>
                        ))}
                    </div>

                    {registryServers.length === 0 && !registryLoading && (
                        <div className="py-20 text-center border-2 border-dashed rounded-xl space-y-4">
                            <Search className="w-12 h-12 text-muted-foreground mx-auto" />
                            <p className="text-muted-foreground italic">Search or browse the MCP Registry to discover servers.</p>
                        </div>
                    )}

                    {/* Install Dialog */}
                    <Dialog open={!!installDialogServer} onOpenChange={(open) => !open && setInstallDialogServer(null)}>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Install {installDialogServer?.name}</DialogTitle>
                                <DialogDescription>
                                    {installDialogServer?.description || 'Configure and install this MCP server.'}
                                </DialogDescription>
                            </DialogHeader>
                            {Object.keys(installEnvVars).length > 0 && (
                                <div className="grid gap-4 py-4">
                                    <p className="text-sm text-muted-foreground">This server requires the following environment variables:</p>
                                    {Object.entries(installEnvVars).map(([key, value]) => {
                                        const envDef = installDialogServer?.packages
                                            ?.find(p => p.registry_name === 'npm')
                                            ?.environment_variables?.find(e => e.name === key);
                                        return (
                                            <div key={key} className="grid gap-1">
                                                <Label className="font-mono text-sm">{key}</Label>
                                                {envDef?.description && (
                                                    <p className="text-xs text-muted-foreground">{envDef.description}</p>
                                                )}
                                                <Input
                                                    type="password"
                                                    value={value}
                                                    onChange={e => setInstallEnvVars({ ...installEnvVars, [key]: e.target.value })}
                                                    placeholder={envDef?.required ? 'Required' : 'Optional'}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setInstallDialogServer(null)}>Cancel</Button>
                                <Button onClick={handleInstall} disabled={installing} className="gap-2">
                                    {installing && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Install
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </TabsContent>
            </Tabs>
        </div>
    );
}
