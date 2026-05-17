import * as React from "react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

interface AuthLayoutProps {
  children: React.ReactNode
  title?: string
  className?: string
}

export function AuthLayout({ children, title, className }: AuthLayoutProps) {
  return (
    <div
      className={cn(
        "flex min-h-screen items-center justify-center bg-background p-4",
        className
      )}
    >
      <Card className="w-full max-w-sm shadow-md">
        <CardHeader className="pb-4 text-center">
          {/* Logo */}
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <span className="text-lg font-bold text-primary-foreground">M</span>
          </div>
          {title && (
            <h1 className="text-xl font-semibold">{title}</h1>
          )}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}
