"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

type StatusType = 'idle' | 'thinking' | 'executing' | 'waiting' | 'error'

interface StatusIndicatorProps {
  status: StatusType
  label?: string
  className?: string
}

const statusConfig: Record<StatusType, { color: string; pulse: boolean }> = {
  idle: { color: 'bg-muted-foreground', pulse: false },
  thinking: { color: 'bg-blue-500', pulse: true },
  executing: { color: 'bg-green-500', pulse: true },
  waiting: { color: 'bg-yellow-500', pulse: true },
  error: { color: 'bg-destructive', pulse: false },
}

const statusLabel: Record<StatusType, string> = {
  idle: '空闲',
  thinking: '思考中',
  executing: '执行中',
  waiting: '等待中',
  error: '出错',
}

export function StatusIndicator({ status, label, className }: StatusIndicatorProps) {
  const config = statusConfig[status]
  const displayLabel = label ?? statusLabel[status]

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="relative flex h-2.5 w-2.5">
        {config.pulse && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full rounded-full opacity-75",
              config.color,
              "animate-ping"
            )}
          />
        )}
        <span
          className={cn(
            "relative inline-flex h-2.5 w-2.5 rounded-full",
            config.color
          )}
        />
      </span>
      {displayLabel && (
        <span className="text-sm text-muted-foreground">{displayLabel}</span>
      )}
    </div>
  )
}
