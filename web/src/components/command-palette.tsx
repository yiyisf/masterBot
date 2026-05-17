"use client"

import * as React from "react"
import { Search, ArrowRight, Clock, Terminal, Puzzle } from "lucide-react"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

interface CommandItem {
  id: string
  label: string
  description?: string
  href?: string
  action?: () => void
  group: 'recent' | 'command' | 'skill'
  keywords?: string[]
}

const defaultCommands: CommandItem[] = [
  { id: 'chat', label: '前往聊天', description: '打开 AI 聊天界面', href: '/chat', group: 'command', keywords: ['chat', '聊天', 'ai'] },
  { id: 'skills', label: '技能管理', description: '查看和管理已安装技能', href: '/skills', group: 'command', keywords: ['skill', '技能'] },
  { id: 'memory', label: '记忆库', description: '查看和管理记忆数据', href: '/memory', group: 'command', keywords: ['memory', '记忆'] },
  { id: 'settings', label: '设置', description: '应用配置和偏好设置', href: '/settings', group: 'command', keywords: ['settings', '设置', 'config'] },
  { id: 'admin', label: '管理面板', description: '系统管理和监控', href: '/admin', group: 'command', keywords: ['admin', '管理'] },
  { id: 'dashboard', label: '仪表板', description: '查看系统概览', href: '/', group: 'command', keywords: ['dashboard', '首页', '仪表板'] },
]

function groupLabel(group: CommandItem['group']) {
  if (group === 'recent') return '最近使用'
  if (group === 'command') return '命令'
  return '技能'
}

function groupIcon(group: CommandItem['group']) {
  if (group === 'recent') return <Clock className="h-3.5 w-3.5" />
  if (group === 'command') return <Terminal className="h-3.5 w-3.5" />
  return <Puzzle className="h-3.5 w-3.5" />
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  extraItems?: CommandItem[]
}

export function CommandPalette({ open, onOpenChange, extraItems = [] }: CommandPaletteProps) {
  const router = useRouter()
  const [query, setQuery] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const allItems = React.useMemo(
    () => [...defaultCommands, ...extraItems],
    [extraItems]
  )

  const filtered = React.useMemo(() => {
    if (!query.trim()) return allItems
    const q = query.toLowerCase()
    return allItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.keywords?.some((k) => k.toLowerCase().includes(q))
    )
  }, [query, allItems])

  const groups = React.useMemo(() => {
    const map = new Map<CommandItem['group'], CommandItem[]>()
    for (const item of filtered) {
      const g = map.get(item.group) ?? []
      g.push(item)
      map.set(item.group, g)
    }
    return map
  }, [filtered])

  React.useEffect(() => {
    setActiveIndex(0)
  }, [query])

  React.useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const executeItem = React.useCallback(
    (item: CommandItem) => {
      onOpenChange(false)
      if (item.action) {
        item.action()
      } else if (item.href) {
        router.push(item.href)
      }
    },
    [onOpenChange, router]
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[activeIndex]) executeItem(filtered[activeIndex])
    }
  }

  let globalIndex = 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 max-w-lg overflow-hidden" aria-label="命令面板">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入命令或搜索..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="搜索命令"
          />
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground sm:inline-block">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div
          className="max-h-80 overflow-y-auto py-2"
          role="listbox"
          aria-label="命令列表"
        >
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">未找到匹配的命令</p>
          ) : (
            Array.from(groups.entries()).map(([group, items]) => (
              <div key={group}>
                <div className="flex items-center gap-2 px-4 py-1.5">
                  <span className="text-muted-foreground">{groupIcon(group)}</span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {groupLabel(group)}
                  </span>
                </div>
                {items.map((item) => {
                  const idx = globalIndex++
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={idx === activeIndex}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                        idx === activeIndex
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-muted/50"
                      )}
                      onClick={() => executeItem(item)}
                      onMouseEnter={() => setActiveIndex(idx)}
                    >
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{item.label}</span>
                        {item.description && (
                          <span className="block text-xs text-muted-foreground">
                            {item.description}
                          </span>
                        )}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 border-t px-4 py-2.5">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <kbd className="rounded border bg-muted px-1 py-0.5 text-[10px]">↑↓</kbd>
            导航
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <kbd className="rounded border bg-muted px-1 py-0.5 text-[10px]">Enter</kbd>
            执行
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
