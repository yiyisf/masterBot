"use client"

import * as React from "react"
import { ExternalLink } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface CitationSource {
  title: string
  url?: string
  content?: string
}

interface CitationLinkProps {
  index: number
  source: CitationSource
  className?: string
}

export function CitationLink({ index, source, className }: CitationLinkProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
            "align-super",
            className
          )}
          aria-label={`来源 ${index}: ${source.title}`}
        >
          {index}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold leading-tight">{source.title}</p>
            {source.url && (
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="在新标签页打开"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          {source.url && (
            <p className="truncate text-xs text-muted-foreground">{source.url}</p>
          )}
          {source.content && (
            <p className="line-clamp-4 text-xs leading-relaxed text-muted-foreground border-t pt-2">
              {source.content}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
