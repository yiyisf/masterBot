"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare, Slash, Command, Puzzle, History, ChevronRight, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "cmaster_onboarding_done";

const STEPS = [
  {
    icon: <MessageSquare className="h-8 w-8" />,
    title: "欢迎使用 CMaster Bot",
    description: "您好！我是 CMaster Bot，您的企业 AI 工作助手。我能查询企业数据、检索内部知识、自动化重复流程，并在工作中持续学习新技能。",
    hint: "点击「下一步」开始了解核心功能",
  },
  {
    icon: <Slash className="h-8 w-8" />,
    title: "/ 触发技能",
    description: "在输入框中输入 / 可以快速选择并触发已安装的技能。例如：/查询数据、/生成报告。技能让 AI 获得更强的专项能力。",
    hint: "尝试在聊天框里输入 / 看看有哪些技能",
  },
  {
    icon: <Command className="h-8 w-8" />,
    title: "⌘K 命令面板",
    description: "随时按 ⌘K（macOS）或 Ctrl+K（Windows）打开命令面板，快速跳转页面、搜索技能、执行常用命令，无需鼠标导航。",
    hint: "试试按 ⌘K 打开命令面板",
  },
  {
    icon: <Puzzle className="h-8 w-8" />,
    title: "创建你的第一个技能",
    description: "前往技能页面的 Skill Factory，用自然语言描述你需要的功能，AI 会自动生成、测试并安装技能。无需编程基础。",
    hint: "前往「技能」→「Skill Factory」创建技能",
  },
  {
    icon: <History className="h-8 w-8" />,
    title: "历史对话与设置",
    description: "所有对话记录保存在「历史」页面，可按时间查看、搜索、导出。在「设置」中可以切换主题（亮色/暗色/高对比度）、配置模型和通知。",
    hint: "您已准备好开始使用了！",
  },
];

interface OnboardingTourProps {
  onComplete?: () => void;
}

export function OnboardingTour({ onComplete }: OnboardingTourProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      const t = setTimeout(() => setOpen(true), 800);
      return () => clearTimeout(t);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
    onComplete?.();
  };

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      handleClose();
      router.push("/chat");
    }
  };

  const current = STEPS[step];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <div className="h-1 w-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        <div className="p-6">
          <button
            onClick={handleClose}
            className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">跳过引导</span>
          </button>

          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {current.icon}
          </div>

          <div className="mb-6 space-y-2">
            <h3 className="text-lg font-semibold">{current.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {current.description}
            </p>
          </div>

          <p className="mb-6 text-xs text-muted-foreground/70 italic">
            {current.hint}
          </p>

          <div className="mb-4 flex justify-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === step ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30",
                )}
              />
            ))}
          </div>

          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={handleClose}>
              跳过
            </Button>
            <Button size="sm" onClick={handleNext}>
              {step === STEPS.length - 1 ? "开始使用" : "下一步"}
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
