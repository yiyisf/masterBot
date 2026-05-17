"use client"

import * as React from "react"
import { ChevronDown, ChevronRight, Copy, CheckCircle, XCircle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface ToolCallCardProps {
  toolName: string
  status: 'loading' | 'success' | 'error'
  input?: object
  output?: unknown
  onCopy?: () => void
  className?: string
}

const statusIcon = {
  loading: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />,
  success: <CheckCircle className="h-4 w-4 text-green-500" />,
  error: <XCircle className="h-4 w-4 text-destructive" />,
}

const statusBadge = {
  loading: <Badge variant="secondary">运行中</Badge>,
  success: <Badge variant="secondary" className="text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-400">成功</Badge>,
  error: <Badge variant="destructive">失败</Badge>,
}

export function ToolCallCard({
  toolName,
  status,
  input,
  output,
  onCopy,
  className,
}: ToolCallCardProps) {
  const [expanded, setExpanded] = React.useState(false)

  const handleCopy = () => {
    if (onCopy) {
      onCopy()
    } else {
      const text = JSON.stringify({ input, output }, null, 2)
      navigator.clipboard.writeText(text).catch(() => {})
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground shadow-xs",
        className
      )}
    >
      <div
        className="flex cursor-pointer items-center gap-3 px-4 py-3"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="flex-shrink-0">{statusIcon[status]}</span>
        <span className="flex-1 font-mono text-sm font-medium">{toolName}</span>
        {statusBadge[status]}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation()
            handleCopy()
          }}
          title="复制内容"
          aria-label="复制工具调用内容"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3">
          {input !== undefined && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">输入</p>
              <pre className="overflow-x-auto rounded bg-muted p-3 text-xs leading-relaxed">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {output !== undefined && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">输出</p>
              <pre className="overflow-x-auto rounded bg-muted p-3 text-xs leading-relaxed">
                {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
