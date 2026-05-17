"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"

interface ConnectorCardProps {
  name: string
  description: string
  type: string
  icon?: React.ReactNode
  connected: boolean
  onConnect?: () => void
  onDisconnect?: () => void
  className?: string
}

export function ConnectorCard({
  name,
  description,
  type,
  icon,
  connected,
  onConnect,
  onDisconnect,
  className,
}: ConnectorCardProps) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          {icon && (
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-semibold">{name}</h3>
              <Badge
                variant={connected ? "default" : "secondary"}
                className={cn(
                  "ml-auto flex-shrink-0 text-xs",
                  connected && "bg-green-600 hover:bg-green-700"
                )}
              >
                {connected ? "已连接" : "未连接"}
              </Badge>
            </div>
            <Badge variant="outline" className="mt-1 text-xs">
              {type}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 pb-3">
        <p className="line-clamp-2 text-sm text-muted-foreground">{description}</p>
      </CardContent>

      <CardFooter className="pt-0">
        {connected ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-destructive hover:text-destructive"
            onClick={onDisconnect}
          >
            断开连接
          </Button>
        ) : (
          <Button size="sm" className="w-full" onClick={onConnect}>
            连接
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
