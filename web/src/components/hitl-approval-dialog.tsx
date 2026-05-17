"use client"

import * as React from "react"
import { AlertTriangle, ShieldAlert, Shield, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

type RiskLevel = 'low' | 'medium' | 'high'

interface HitLApprovalDialogProps {
  open: boolean
  toolName: string
  input: object
  riskLevel: RiskLevel
  onApprove: (payload: object) => void
  onModify: (modified: object) => void
  onDeny: () => void
}

const riskConfig: Record<RiskLevel, { label: string; icon: React.ReactNode; badgeClass: string }> = {
  low: {
    label: '低风险',
    icon: <ShieldCheck className="h-4 w-4" />,
    badgeClass: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  },
  medium: {
    label: '中等风险',
    icon: <Shield className="h-4 w-4" />,
    badgeClass: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  },
  high: {
    label: '高风险',
    icon: <ShieldAlert className="h-4 w-4" />,
    badgeClass: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
}

export function HitLApprovalDialog({
  open,
  toolName,
  input,
  riskLevel,
  onApprove,
  onModify,
  onDeny,
}: HitLApprovalDialogProps) {
  const [editedInput, setEditedInput] = React.useState(() => JSON.stringify(input, null, 2))
  const [parseError, setParseError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setEditedInput(JSON.stringify(input, null, 2))
    setParseError(null)
  }, [input])

  const handleTextChange = (value: string) => {
    setEditedInput(value)
    try {
      JSON.parse(value)
      setParseError(null)
    } catch {
      setParseError('JSON 格式无效')
    }
  }

  const handleApprove = () => {
    try {
      onApprove(JSON.parse(editedInput))
    } catch {
      onApprove(input)
    }
  }

  const handleModify = () => {
    try {
      const parsed = JSON.parse(editedInput)
      onModify(parsed)
    } catch {
      setParseError('请先修正 JSON 格式错误')
    }
  }

  const risk = riskConfig[riskLevel]

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onDeny()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <DialogTitle>需要人工审批</DialogTitle>
              <DialogDescription>工具调用需要您确认后才能执行</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">工具名称</p>
              <p className="font-mono text-sm font-medium">{toolName}</p>
            </div>
            <Badge
              variant="secondary"
              className={cn("flex items-center gap-1.5", risk.badgeClass)}
            >
              {risk.icon}
              {risk.label}
            </Badge>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              调用参数（可编辑）
            </p>
            <textarea
              value={editedInput}
              onChange={(e) => handleTextChange(e.target.value)}
              className={cn(
                "w-full rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed resize-none outline-none focus:ring-2 focus:ring-ring/50",
                parseError && "border-destructive"
              )}
              rows={8}
              spellCheck={false}
            />
            {parseError && (
              <p className="mt-1 text-xs text-destructive">{parseError}</p>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={onDeny}>
            拒绝
          </Button>
          <Button variant="outline" onClick={handleModify} disabled={!!parseError}>
            修改并执行
          </Button>
          <Button onClick={handleApprove}>
            批准执行
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
