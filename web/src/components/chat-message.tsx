"use client"

import * as React from "react"
import { Copy, RefreshCw, ThumbsDown, User, Bot } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: React.ReactNode
  timestamp?: Date
  avatar?: string
  streaming?: boolean
  onCopy?: () => void
  onRegenerate?: () => void
  onDislike?: () => void
  className?: string
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function ChatMessage({
  role,
  content,
  timestamp,
  avatar,
  streaming = false,
  onCopy,
  onRegenerate,
  onDislike,
  className,
}: ChatMessageProps) {
  const [showActions, setShowActions] = React.useState(false)
  const isUser = role === 'user'

  const handleCopy = () => {
    if (onCopy) {
      onCopy()
    } else if (typeof content === 'string') {
      navigator.clipboard.writeText(content).catch(() => {})
    }
  }

  return (
    <div
      className={cn(
        "group flex gap-3 px-4 py-2",
        isUser && "flex-row-reverse",
        className
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-medium",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        )}
      >
        {avatar ? (
          <img src={avatar} alt={isUser ? "用户" : "助手"} className="h-full w-full rounded-full object-cover" />
        ) : isUser ? (
          <User className="h-4 w-4" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>

      {/* Content area */}
      <div className={cn("flex min-w-0 max-w-[80%] flex-col gap-1", isUser && "items-end")}>
        {/* Bubble */}
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "rounded-tr-sm bg-primary text-primary-foreground"
              : "rounded-tl-sm bg-muted text-foreground"
          )}
        >
          {typeof content === 'string' ? (
            <p className="whitespace-pre-wrap">{content}</p>
          ) : (
            content
          )}
          {streaming && (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current" aria-hidden="true" />
          )}
        </div>

        {/* Timestamp + Actions */}
        <div className={cn("flex items-center gap-1", isUser && "flex-row-reverse")}>
          {timestamp && (
            <span className="text-xs text-muted-foreground px-1">
              {formatTime(timestamp)}
            </span>
          )}
          {!isUser && (
            <div
              className={cn(
                "flex items-center gap-0.5 transition-opacity",
                showActions && !streaming ? "opacity-100" : "opacity-0"
              )}
            >
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleCopy}
                title="复制"
                aria-label="复制消息"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              {onRegenerate && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={onRegenerate}
                  title="重新生成"
                  aria-label="重新生成回答"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              )}
              {onDislike && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={onDislike}
                  title="不满意"
                  aria-label="标记为不满意"
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
