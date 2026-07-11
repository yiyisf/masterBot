"use client";

/**
 * ⚠️ PROTOTYPE — 研发流程管理 /projects 页面主流程原型（wayfinder #58）
 *
 * 三个结构互异的变体，`?variant=A|B|C` 切换，底部浮动切换条（←/→ 键循环）。
 * 全部内存假数据，无任何持久化/后端调用。评审完成后整体移到 throwaway 分支。
 *
 * 走查主流程：新建项目 → 同步需求 → 选需求发起研发 → 回答 agent 人工问答 → 查看执行回放
 */

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

// ─────────────────────────── 领域模型（按 #54 决议） ───────────────────────────

type ReqStatus =
  | "synced" | "queued" | "in_progress" | "waiting_input"
  | "implemented" | "merged" | "failed" | "cancelled";

interface Requirement {
  id: string;
  reqKey: string;          // {project_name}#{数字id}
  title: string;
  source: "github" | "manual";
  sourceUrl?: string;
  sourceClosed?: boolean;
  labels: string[];
  status: ReqStatus;
  agent?: string;          // 实施用的编码 agent
  updatedAt: string;
}

interface Project {
  id: string;
  name: string;
  dir: string;
  description: string;
  source: string;
}

type EventKind = "meta" | "thought" | "action" | "observation" | "answer" | "approval_request" | "approval_response";
interface TimelineEvent { kind: EventKind; content: string; toolName?: string; ts: string; }

const STATUS_META: Record<ReqStatus, { label: string; cls: string }> = {
  synced:        { label: "已同步",   cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  queued:        { label: "已排队",   cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  in_progress:   { label: "实施中",   cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 animate-pulse" },
  waiting_input: { label: "等待回答", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  implemented:   { label: "待核验",   cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
  merged:        { label: "已完成",   cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  failed:        { label: "失败",     cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  cancelled:     { label: "已取消",   cls: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
};

const AGENTS = ["claude-code", "codex", "opencode", "pi"];

// ─────────────────────────── Mock 数据 ───────────────────────────

const MOCK_PROJECTS: Project[] = [
  { id: "p1", name: "cmasterBot", dir: "~/Yiyi/ai/cmasterBot", description: "企业级 AI 助手系统", source: "github:yiyisf/masterBot" },
  { id: "p2", name: "data-pipeline", dir: "~/work/data-pipeline", description: "数据管道服务", source: "github:yiyisf/data-pipeline" },
];

const MOCK_REQS: Requirement[] = [
  { id: "r1", reqKey: "cmasterBot#61", title: "支持导出会话为 Markdown", source: "github", sourceUrl: "#", labels: ["enhancement"], status: "waiting_input", agent: "claude-code", updatedAt: "3 分钟前" },
  { id: "r2", reqKey: "cmasterBot#60", title: "技能页面增加批量启用/禁用", source: "github", sourceUrl: "#", labels: ["ui"], status: "in_progress", agent: "claude-code", updatedAt: "12 分钟前" },
  { id: "r3", reqKey: "cmasterBot#58", title: "修复长会话下 SSE 断流后无法恢复", source: "github", sourceUrl: "#", labels: ["bug", "P1"], status: "implemented", agent: "codex", updatedAt: "2 小时前" },
  { id: "r4", reqKey: "cmasterBot#55", title: "记忆页支持按类型过滤", source: "github", sourceUrl: "#", labels: ["enhancement"], status: "merged", agent: "claude-code", updatedAt: "昨天" },
  { id: "r5", reqKey: "cmasterBot#M10001", title: "内部：升级 fastify 到 5.x 并回归", source: "manual", labels: ["chore"], status: "synced", updatedAt: "昨天" },
  { id: "r6", reqKey: "cmasterBot#52", title: "工作流页面拖拽节点偶发丢失连线", source: "github", sourceUrl: "#", labels: ["bug"], status: "failed", agent: "opencode", updatedAt: "2 天前" },
  { id: "r7", reqKey: "cmasterBot#50", title: "增加 /api/usage token 用量统计端点", source: "github", sourceUrl: "#", labels: ["api"], status: "synced", sourceClosed: true, updatedAt: "3 天前" },
  { id: "r8", reqKey: "cmasterBot#49", title: "Dashboard 增加近 7 日活跃会话曲线", source: "github", sourceUrl: "#", labels: ["ui"], status: "queued", agent: "claude-code", updatedAt: "刚刚" },
];

const MOCK_TIMELINE: TimelineEvent[] = [
  { kind: "meta", content: "🚀 claude-code 会话启动（worktree: feature/export-markdown）", ts: "14:02:11" },
  { kind: "thought", content: "需要先了解现有会话数据结构，查看 repository.ts 中消息的存储格式…", ts: "14:02:15" },
  { kind: "action", content: "调用 Grep", toolName: "Grep", ts: "14:02:18" },
  { kind: "observation", content: "src/core/repository.ts:88 getMessages(sessionId) → MessageRow[]…", ts: "14:02:19" },
  { kind: "action", content: "调用 Write", toolName: "Write", ts: "14:03:40" },
  { kind: "observation", content: "created src/gateway/routes/export.ts", ts: "14:03:41" },
  { kind: "approval_request", content: "导出的 Markdown 中，工具调用(action/observation)是否也要包含？包含会让文件较大但过程完整；不包含则只保留对话文本。请选择。", ts: "14:04:02" },
];

const REPLAY_TIMELINE: TimelineEvent[] = [
  { kind: "meta", content: "🚀 claude-code 会话启动（worktree: feature/memory-filter）", ts: "10:20:01" },
  { kind: "thought", content: "记忆页在 web/src/app/memory/page.tsx，先看现有列表渲染…", ts: "10:20:05" },
  { kind: "action", content: "调用 Read", toolName: "Read", ts: "10:20:07" },
  { kind: "observation", content: "memory/page.tsx: 174 行，列表无过滤器…", ts: "10:20:08" },
  { kind: "approval_request", content: "过滤器 UI 用下拉选择还是 tab 切换？", ts: "10:22:30" },
  { kind: "approval_response", content: "用 tab 切换，和技能页保持一致", ts: "10:25:12" },
  { kind: "action", content: "调用 Edit", toolName: "Edit", ts: "10:26:02" },
  { kind: "observation", content: "memory/page.tsx 更新完成，新增 TypeTabs 组件", ts: "10:26:03" },
  { kind: "answer", content: "已完成记忆页类型过滤，PR #57 已创建，含 tab 切换与空态处理。", ts: "10:31:44" },
  { kind: "meta", content: "✅ 会话完成（turns: 14, cost: $0.42）", ts: "10:31:45" },
];

// ─────────────────────────── 共享小组件 ───────────────────────────

function StatusBadge({ s }: { s: ReqStatus }) {
  const m = STATUS_META[s];
  return <Badge variant="outline" className={`border-transparent ${m.cls}`}>{m.label}</Badge>;
}

function SourceTag({ r }: { r: Requirement }) {
  return (
    <span className="text-xs text-muted-foreground">
      {r.source === "github" ? "GitHub" : "手动"}
      {r.sourceClosed && <span className="ml-1 text-red-500">（远程已关闭）</span>}
    </span>
  );
}

const KIND_ICON: Record<EventKind, string> = {
  meta: "ⓘ", thought: "💭", action: "⚙", observation: "👁", answer: "✅",
  approval_request: "❓", approval_response: "💬",
};

function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="space-y-2">
      {events.map((e, i) => (
        <li key={i} className={`flex gap-2 rounded-md border p-2 text-sm ${e.kind === "approval_request" ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" : e.kind === "approval_response" ? "border-blue-300 bg-blue-50 dark:bg-blue-950/30" : "border-border"}`}>
          <span className="shrink-0">{KIND_ICON[e.kind]}</span>
          <div className="min-w-0 flex-1">
            <div className="break-words">{e.toolName ? <span className="font-mono text-xs bg-muted px-1 rounded mr-1">{e.toolName}</span> : null}{e.content}</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{e.ts}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function QuestionCard({ question, onAnswer }: { question: string; onAnswer: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/30">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
        ❓ Agent 需要你的回答
      </div>
      <p className="mb-2 text-sm">{question}</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="输入你的回答…" className="mb-2 bg-background" rows={2} />
      <Button size="sm" disabled={!text.trim()} onClick={() => { onAnswer(text); setText(""); }}>提交回答，继续执行</Button>
    </div>
  );
}

// ─────────────────────────── 共享状态与操作 ───────────────────────────

interface Ctx {
  projects: Project[];
  activeProject: Project;
  setActiveProject: (p: Project) => void;
  reqs: Requirement[];
  syncing: boolean;
  onSync: () => void;
  onStart: (id: string, agent: string) => void;
  onAnswer: (id: string) => void;
  onMerge: (id: string) => void;
  onNewProject: () => void;
}

function useProjectsState(): Ctx {
  const [projects, setProjects] = useState(MOCK_PROJECTS);
  const [activeProject, setActiveProject] = useState(MOCK_PROJECTS[0]);
  const [reqs, setReqs] = useState(MOCK_REQS);
  const [syncing, setSyncing] = useState(false);

  const onSync = () => {
    setSyncing(true);
    setTimeout(() => {
      setReqs((rs) => [
        { id: `r${Date.now()}`, reqKey: "cmasterBot#62", title: "（新同步）支持自定义快捷键", source: "github", sourceUrl: "#", labels: ["enhancement"], status: "synced", updatedAt: "刚刚" },
        ...rs,
      ]);
      setSyncing(false);
    }, 900);
  };
  const onStart = (id: string, agent: string) =>
    setReqs((rs) => rs.map((r) => (r.id === id ? { ...r, status: "queued" as const, agent, updatedAt: "刚刚" } : r)));
  const onAnswer = (id: string) =>
    setReqs((rs) => rs.map((r) => (r.id === id ? { ...r, status: "in_progress" as const, updatedAt: "刚刚" } : r)));
  const onMerge = (id: string) =>
    setReqs((rs) => rs.map((r) => (r.id === id ? { ...r, status: "merged" as const, updatedAt: "刚刚" } : r)));
  const onNewProject = () => {
    const name = `new-project-${projects.length + 1}`;
    const p = { id: `p${Date.now()}`, name, dir: `~/work/${name}`, description: "（原型：新建项目示意）", source: "github:yiyisf/" + name };
    setProjects((ps) => [...ps, p]);
    setActiveProject(p);
  };

  return { projects, activeProject, setActiveProject, reqs, syncing, onSync, onStart, onAnswer, onMerge, onNewProject };
}

function StartButton({ r, onStart, size = "sm" }: { r: Requirement; onStart: Ctx["onStart"]; size?: "sm" | "default" }) {
  const [agent, setAgent] = useState(AGENTS[0]);
  if (!["synced", "failed"].includes(r.status)) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <select value={agent} onChange={(e) => setAgent(e.target.value)} className="h-8 rounded-md border bg-background px-1 text-xs">
        {AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <Button size={size} variant="default" onClick={() => onStart(r.id, agent)}>{r.status === "failed" ? "重试" : "发起研发"}</Button>
    </span>
  );
}

// ─────────────────────────── 变体 A：三栏主从 Console ───────────────────────────

function VariantA(ctx: Ctx) {
  const [selectedId, setSelectedId] = useState<string | null>("r1");
  const selected = ctx.reqs.find((r) => r.id === selectedId) ?? null;
  const groups: ReqStatus[] = ["waiting_input", "in_progress", "queued", "implemented", "synced", "failed", "merged", "cancelled"];

  return (
    <div className="grid h-[calc(100vh-3rem)] grid-cols-[230px_340px_1fr]">
      {/* 左：项目列表 */}
      <div className="border-r p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">项目</h2>
          <Button size="sm" variant="outline" onClick={ctx.onNewProject}>+ 新建</Button>
        </div>
        {ctx.projects.map((p) => (
          <button key={p.id} onClick={() => ctx.setActiveProject(p)}
            className={`mb-1 w-full rounded-md p-2 text-left text-sm hover:bg-accent ${p.id === ctx.activeProject.id ? "bg-accent font-medium" : ""}`}>
            <div>{p.name}</div>
            <div className="truncate text-xs text-muted-foreground">{p.dir}</div>
          </button>
        ))}
      </div>

      {/* 中：需求清单（按状态分组） */}
      <div className="flex flex-col border-r">
        <div className="flex items-center justify-between border-b p-3">
          <h2 className="text-sm font-semibold">需求清单</h2>
          <Button size="sm" variant="outline" disabled={ctx.syncing} onClick={ctx.onSync}>{ctx.syncing ? "同步中…" : "⟳ 同步"}</Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2">
            {groups.map((g) => {
              const items = ctx.reqs.filter((r) => r.status === g);
              if (!items.length) return null;
              return (
                <div key={g} className="mb-3">
                  <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">{STATUS_META[g].label} · {items.length}</div>
                  {items.map((r) => (
                    <button key={r.id} onClick={() => setSelectedId(r.id)}
                      className={`mb-1 w-full rounded-md border p-2 text-left hover:bg-accent ${selectedId === r.id ? "border-primary bg-accent" : "border-transparent"}`}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{r.reqKey}</span>
                        <StatusBadge s={r.status} />
                      </div>
                      <div className="mt-0.5 truncate text-sm">{r.title}</div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* 右：详情 + 执行时间线 */}
      <div className="flex flex-col">
        {selected ? (
          <>
            <div className="border-b p-4">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">{selected.reqKey}</span>
                <StatusBadge s={selected.status} />
                <SourceTag r={selected} />
              </div>
              <h2 className="mt-1 text-lg font-semibold">{selected.title}</h2>
              <div className="mt-2 flex items-center gap-2">
                <StartButton r={selected} onStart={ctx.onStart} />
                {selected.status === "implemented" && (
                  <Button size="sm" variant="outline" onClick={() => ctx.onMerge(selected.id)}>✓ 核验通过，合并 PR</Button>
                )}
                {selected.agent && <span className="text-xs text-muted-foreground">agent: {selected.agent}</span>}
              </div>
            </div>
            <ScrollArea className="flex-1 p-4">
              {selected.status === "waiting_input" && (
                <div className="mb-3"><QuestionCard question={MOCK_TIMELINE.at(-1)!.content} onAnswer={() => ctx.onAnswer(selected.id)} /></div>
              )}
              {["in_progress", "waiting_input"].includes(selected.status) && <Timeline events={MOCK_TIMELINE} />}
              {["merged", "implemented"].includes(selected.status) && <Timeline events={REPLAY_TIMELINE} />}
              {["synced", "queued", "failed", "cancelled"].includes(selected.status) && (
                <p className="text-sm text-muted-foreground">{selected.status === "queued" ? "已排队，等待执行…" : selected.status === "failed" ? "上次执行失败，可点击重试。历史记录：" : "尚未发起研发。"}</p>
              )}
              {selected.status === "failed" && <div className="mt-2"><Timeline events={REPLAY_TIMELINE.slice(0, 4)} /></div>}
            </ScrollArea>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">选择一条需求查看详情</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── 变体 B：状态看板 Kanban ───────────────────────────

function VariantB(ctx: Ctx) {
  const [sheetReq, setSheetReq] = useState<Requirement | null>(null);
  const cols: ReqStatus[] = ["synced", "queued", "in_progress", "waiting_input", "implemented", "merged", "failed"];

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      {/* 顶栏：项目切换 + 同步 */}
      <div className="flex items-center gap-3 border-b p-3">
        <select value={ctx.activeProject.id} onChange={(e) => ctx.setActiveProject(ctx.projects.find((p) => p.id === e.target.value)!)}
          className="h-9 rounded-md border bg-background px-2 text-sm font-medium">
          {ctx.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{ctx.activeProject.dir} · {ctx.activeProject.source}</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={ctx.onNewProject}>+ 新建项目</Button>
          <Button size="sm" disabled={ctx.syncing} onClick={ctx.onSync}>{ctx.syncing ? "同步中…" : "⟳ 同步需求"}</Button>
        </div>
      </div>

      {/* 看板列 */}
      <div className="flex flex-1 gap-3 overflow-x-auto p-3">
        {cols.map((c) => {
          const items = ctx.reqs.filter((r) => r.status === c);
          return (
            <div key={c} className="flex w-60 shrink-0 flex-col rounded-lg bg-muted/40">
              <div className="flex items-center gap-2 p-2 text-sm font-medium">
                <StatusBadge s={c} /><span className="text-muted-foreground">{items.length}</span>
              </div>
              <ScrollArea className="flex-1 px-2 pb-2">
                {items.map((r) => (
                  <Card key={r.id} className="mb-2 cursor-pointer py-3 hover:border-primary" onClick={() => setSheetReq(r)}>
                    <CardContent className="px-3">
                      <div className="font-mono text-xs text-muted-foreground">{r.reqKey}</div>
                      <div className="mt-1 text-sm leading-snug">{r.title}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        {r.labels.map((l) => <Badge key={l} variant="secondary" className="text-[10px]">{l}</Badge>)}
                        {r.agent && <span className="text-[10px] text-muted-foreground">{r.agent}</span>}
                      </div>
                      {r.status === "waiting_input" && <div className="mt-2 rounded bg-amber-100 px-2 py-1 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">❓ 有问题等你回答</div>}
                    </CardContent>
                  </Card>
                ))}
              </ScrollArea>
            </div>
          );
        })}
      </div>

      {/* 侧滑抽屉：详情/时间线/问答 */}
      <Sheet open={!!sheetReq} onOpenChange={(o) => !o && setSheetReq(null)}>
        <SheetContent className="w-[480px] overflow-y-auto sm:max-w-[480px]">
          {sheetReq && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <span className="font-mono text-sm text-muted-foreground">{sheetReq.reqKey}</span>
                  <StatusBadge s={sheetReq.status} />
                </SheetTitle>
              </SheetHeader>
              <div className="space-y-3 px-4 pb-6">
                <h3 className="font-medium">{sheetReq.title}</h3>
                <div className="flex items-center gap-2">
                  <StartButton r={sheetReq} onStart={(id, a) => { ctx.onStart(id, a); setSheetReq(null); }} />
                  {sheetReq.status === "implemented" && (
                    <Button size="sm" variant="outline" onClick={() => { ctx.onMerge(sheetReq.id); setSheetReq(null); }}>✓ 核验通过，合并 PR</Button>
                  )}
                </div>
                {sheetReq.status === "waiting_input" && (
                  <QuestionCard question={MOCK_TIMELINE.at(-1)!.content} onAnswer={() => { ctx.onAnswer(sheetReq.id); setSheetReq(null); }} />
                )}
                <Separator />
                <div className="text-sm font-medium">执行过程</div>
                {["in_progress", "waiting_input"].includes(sheetReq.status)
                  ? <Timeline events={MOCK_TIMELINE} />
                  : ["merged", "implemented", "failed"].includes(sheetReq.status)
                    ? <Timeline events={REPLAY_TIMELINE} />
                    : <p className="text-sm text-muted-foreground">尚未发起研发。</p>}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─────────────────────────── 变体 C：工作台 Focus ───────────────────────────

function VariantC(ctx: Ctx) {
  const needsYou = ctx.reqs.filter((r) => ["waiting_input", "implemented"].includes(r.status));
  const [filter, setFilter] = useState("");
  const list = useMemo(
    () => ctx.reqs.filter((r) => (r.title + r.reqKey).toLowerCase().includes(filter.toLowerCase())),
    [ctx.reqs, filter]
  );

  return (
    <div className="mx-auto max-w-5xl p-4">
      {/* 顶部项目 tabs */}
      <div className="mb-4 flex items-center gap-1 border-b">
        {ctx.projects.map((p) => (
          <button key={p.id} onClick={() => ctx.setActiveProject(p)}
            className={`px-3 py-2 text-sm ${p.id === ctx.activeProject.id ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}>
            {p.name}
          </button>
        ))}
        <button onClick={ctx.onNewProject} className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">+ 新建项目</button>
        <Button size="sm" variant="outline" className="ml-auto mb-1" disabled={ctx.syncing} onClick={ctx.onSync}>
          {ctx.syncing ? "同步中…" : "⟳ 同步需求"}
        </Button>
      </div>

      {/* 上区：需要你处理 */}
      <h2 className="mb-2 text-sm font-semibold">🔔 需要你处理（{needsYou.length}）</h2>
      <div className="mb-6 grid gap-3 md:grid-cols-2">
        {needsYou.length === 0 && <p className="text-sm text-muted-foreground">没有等待你的事项 🎉</p>}
        {needsYou.map((r) => (
          <Card key={r.id} className="py-3">
            <CardHeader className="px-4 pb-0">
              <CardTitle className="flex items-center gap-2 text-sm font-normal">
                <span className="font-mono text-xs text-muted-foreground">{r.reqKey}</span>
                <StatusBadge s={r.status} />
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pt-2">
              <div className="mb-2 text-sm font-medium">{r.title}</div>
              {r.status === "waiting_input"
                ? <QuestionCard question={MOCK_TIMELINE.at(-1)!.content} onAnswer={() => ctx.onAnswer(r.id)} />
                : (
                  <div className="rounded-lg border border-purple-300 bg-purple-50 p-3 dark:bg-purple-950/30">
                    <p className="mb-2 text-sm">实施完成，PR 已创建，等待人工核验合并。</p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => ctx.onMerge(r.id)}>✓ 核验通过，合并</Button>
                      <ReplayDialog req={r} trigger={<Button size="sm" variant="outline">查看执行过程</Button>} />
                    </div>
                  </div>
                )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 下区：完整需求表格 */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">全部需求（{list.length}）</h2>
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="筛选…" className="h-8 w-48" />
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2 font-medium">需求</th><th className="p-2 font-medium">状态</th>
              <th className="p-2 font-medium">来源</th><th className="p-2 font-medium">agent</th>
              <th className="p-2 font-medium">更新</th><th className="p-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-t hover:bg-accent/50">
                <td className="p-2"><span className="mr-2 font-mono text-xs text-muted-foreground">{r.reqKey}</span>{r.title}</td>
                <td className="p-2"><StatusBadge s={r.status} /></td>
                <td className="p-2"><SourceTag r={r} /></td>
                <td className="p-2 text-xs text-muted-foreground">{r.agent ?? "—"}</td>
                <td className="p-2 text-xs text-muted-foreground">{r.updatedAt}</td>
                <td className="p-2">
                  <div className="flex items-center gap-1">
                    <StartButton r={r} onStart={ctx.onStart} />
                    {["in_progress", "waiting_input", "implemented", "merged", "failed"].includes(r.status) && (
                      <ReplayDialog req={r} trigger={<Button size="sm" variant="ghost">回放</Button>} />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReplayDialog({ req, trigger }: { req: Requirement; trigger: React.ReactNode }) {
  const events = ["in_progress", "waiting_input"].includes(req.status) ? MOCK_TIMELINE : REPLAY_TIMELINE;
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{req.reqKey}</span>
            执行记录回放
          </DialogTitle>
        </DialogHeader>
        <Timeline events={events} />
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── 浮动切换条 + 页面入口 ───────────────────────────

const VARIANTS = [
  { key: "A", name: "三栏主从 Console" },
  { key: "B", name: "状态看板 Kanban" },
  { key: "C", name: "工作台 Focus" },
] as const;

function PrototypeSwitcher({ current, onSwitch }: { current: string; onSwitch: (k: string) => void }) {
  if (process.env.NODE_ENV === "production") return null;
  const idx = VARIANTS.findIndex((v) => v.key === current);
  const prev = VARIANTS[(idx + VARIANTS.length - 1) % VARIANTS.length].key;
  const next = VARIANTS[(idx + 1) % VARIANTS.length].key;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border bg-zinc-900 px-4 py-2 text-white shadow-xl dark:bg-zinc-100 dark:text-zinc-900">
      <button onClick={() => onSwitch(prev)} className="text-lg leading-none hover:opacity-70">←</button>
      <span className="text-sm font-medium">{current} — {VARIANTS[idx]?.name}</span>
      <button onClick={() => onSwitch(next)} className="text-lg leading-none hover:opacity-70">→</button>
    </div>
  );
}

export default function PrototypeProjectsPage() {
  const [variant, setVariant] = useState("A");
  const ctx = useProjectsState();

  // 初始从 URL 读取；切换时写回（replaceState，可分享、可刷新保持）
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("variant");
    if (v && VARIANTS.some((x) => x.key === v)) setVariant(v);
  }, []);
  const switchTo = (k: string) => {
    setVariant(k);
    const url = new URL(window.location.href);
    url.searchParams.set("variant", k);
    window.history.replaceState(null, "", url.toString());
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) return;
      const idx = VARIANTS.findIndex((v) => v.key === variant);
      if (e.key === "ArrowLeft") switchTo(VARIANTS[(idx + VARIANTS.length - 1) % VARIANTS.length].key);
      if (e.key === "ArrowRight") switchTo(VARIANTS[(idx + 1) % VARIANTS.length].key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  return (
    <div className="relative min-h-screen">
      <div className="border-b bg-amber-100 px-4 py-1 text-center text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
        ⚠️ PROTOTYPE（wayfinder #58）— 全部假数据，评审后丢弃
      </div>
      {variant === "A" && <VariantA {...ctx} />}
      {variant === "B" && <VariantB {...ctx} />}
      {variant === "C" && <VariantC {...ctx} />}
      <PrototypeSwitcher current={variant} onSwitch={switchTo} />
    </div>
  );
}
