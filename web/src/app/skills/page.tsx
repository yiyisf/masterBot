"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Puzzle, Box, Code } from "lucide-react";
import { fetchApi } from "@/lib/api";

export default function SkillsPage() {
    const [skills, setSkills] = useState<any[]>([]);

    useEffect(() => {
        fetchApi("/api/skills")
            .then((data: any) => setSkills(Array.isArray(data) ? data : []))
            .catch(console.error);
    }, []);

    return (
        <div className="h-full overflow-y-auto space-y-8 pb-10">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">技能管理</h1>
                <p className="text-muted-foreground">查看并配置已加载的辅助技能，它们赋予了 AI 助手操作系统的能力。</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
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
                            <Switch checked={true} />
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

                                <div className="bg-muted p-3 rounded-md text-[11px] font-mono text-muted-foreground">
                                    <span className="text-blue-500">path:</span> /skills/built-in/{skill.name}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}

                {skills.length === 0 && (
                    <div className="col-span-full py-20 text-center border-2 border-dashed rounded-xl space-y-4">
                        <Box className="w-12 h-12 text-muted-foreground mx-auto" />
                        <p className="text-muted-foreground italic">未发现已加载的技能</p>
                    </div>
                )}
            </div>
        </div>
    );
}
