import * as React from "react"
import { cn } from "@/lib/utils"

interface MainLayoutProps {
  children: React.ReactNode
  className?: string
}

export function MainLayout({ children, className }: MainLayoutProps) {
  return (
    <div className={cn("flex h-screen w-full overflow-hidden", className)}>
      {children}
    </div>
  )
}
