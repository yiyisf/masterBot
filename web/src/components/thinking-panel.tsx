"use client"

import * as React from "react"
import { Brain, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface ThinkingPanelProps {
  content: string
  defaultOpen?: boolean
  className?: string
}

export function ThinkingPanel({ content, defaultOpen = false, className }: ThinkingPanelProps) {
  const [open, setOpen] = React.useState(defaultOpen)

  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30",
        className
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Brain className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium text-muted-foreground">思考过程</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="border-t border-dashed border-muted-foreground/30 px-4 py-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {content}
          </p>
        </div>
      )}
    </div>
  )
}
