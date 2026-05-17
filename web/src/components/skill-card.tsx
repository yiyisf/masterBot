"use client"

import * as React from "react"
import { Star, Download, Eye } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"

interface SkillCardProps {
  name: string
  description: string
  category: string
  icon?: React.ReactNode
  usageCount?: number
  rating?: number
  onInstall?: () => void
  onView?: () => void
  className?: string
}

export function SkillCard({
  name,
  description,
  category,
  icon,
  usageCount,
  rating,
  onInstall,
  onView,
  className,
}: SkillCardProps) {
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
            </div>
            <Badge variant="secondary" className="mt-1 text-xs">
              {category}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 pb-3">
        <p className="line-clamp-2 text-sm text-muted-foreground">{description}</p>

        {(usageCount !== undefined || rating !== undefined) && (
          <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
            {usageCount !== undefined && (
              <span className="flex items-center gap-1">
                <Download className="h-3.5 w-3.5" />
                {usageCount.toLocaleString()}
              </span>
            )}
            {rating !== undefined && (
              <span className="flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                {rating.toFixed(1)}
              </span>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex gap-2 pt-0">
        {onView && (
          <Button variant="outline" size="sm" className="flex-1" onClick={onView}>
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            查看
          </Button>
        )}
        {onInstall && (
          <Button size="sm" className="flex-1" onClick={onInstall}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            安装
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
