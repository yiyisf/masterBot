"use client"

import * as React from "react"
import { Search } from "lucide-react"
import { ModeToggle } from "@/components/mode-toggle"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface HeaderProps {
  title?: string
  actions?: React.ReactNode
  onCommandPaletteOpen?: () => void
  className?: string
}

export function Header({ title, actions, onCommandPaletteOpen, className }: HeaderProps) {
  return (
    <header
      className={cn(
        "flex h-14 items-center gap-4 border-b bg-background px-6",
        className
      )}
    >
      {/* Logo / Title */}
      <div className="flex flex-1 items-center gap-3">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-primary">
          <span className="text-xs font-bold text-primary-foreground">M</span>
        </div>
        {title && (
          <h1 className="text-sm font-semibold truncate">{title}</h1>
        )}
      </div>

      {/* Command palette trigger */}
      {onCommandPaletteOpen && (
        <Button
          variant="outline"
          size="sm"
          className="hidden gap-2 text-muted-foreground sm:flex"
          onClick={onCommandPaletteOpen}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="text-xs">搜索命令...</span>
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px]">⌘K</kbd>
        </Button>
      )}

      {/* Actions slot */}
      {actions && <div className="flex items-center gap-2">{actions}</div>}

      {/* Theme toggle */}
      <ModeToggle />
    </header>
  )
}
