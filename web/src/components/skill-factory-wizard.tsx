"use client"

import * as React from "react"
import { CheckIcon, ChevronLeft, ChevronRight, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface SkillFactoryWizardProps {
  steps: string[]
  currentStep: number
  onStepChange: (n: number) => void
  onCancel?: () => void
  children: React.ReactNode
  className?: string
}

export function SkillFactoryWizard({
  steps,
  currentStep,
  onStepChange,
  onCancel,
  children,
  className,
}: SkillFactoryWizardProps) {
  const isFirst = currentStep === 0
  const isLast = currentStep === steps.length - 1

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {/* Step indicator */}
      <nav aria-label="进度" className="flex items-center justify-center">
        <ol className="flex items-center">
          {steps.map((step, index) => {
            const isCompleted = index < currentStep
            const isCurrent = index === currentStep
            const isUpcoming = index > currentStep

            return (
              <li key={step} className="flex items-center">
                <button
                  type="button"
                  onClick={() => index < currentStep && onStepChange(index)}
                  disabled={isUpcoming}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors",
                    isCompleted && "cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90",
                    isCurrent && "border-2 border-primary bg-background text-primary",
                    isUpcoming && "border-2 border-muted bg-background text-muted-foreground cursor-default"
                  )}
                  aria-current={isCurrent ? 'step' : undefined}
                  title={step}
                >
                  {isCompleted ? (
                    <CheckIcon className="h-4 w-4" />
                  ) : (
                    index + 1
                  )}
                </button>

                {/* Step label (hidden on small screens) */}
                <span
                  className={cn(
                    "mx-2 hidden text-xs sm:block",
                    isCurrent ? "font-medium text-foreground" : "text-muted-foreground"
                  )}
                >
                  {step}
                </span>

                {/* Connector line */}
                {index < steps.length - 1 && (
                  <div
                    className={cn(
                      "h-0.5 w-8 transition-colors",
                      index < currentStep ? "bg-primary" : "bg-muted"
                    )}
                    aria-hidden="true"
                  />
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Content */}
      <div className="flex-1">{children}</div>

      {/* Navigation */}
      <div className="flex items-center justify-between border-t pt-4">
        <div className="flex gap-2">
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              <X className="mr-1.5 h-3.5 w-3.5" />
              取消
            </Button>
          )}
          {!isFirst && (
            <Button variant="outline" size="sm" onClick={() => onStepChange(currentStep - 1)}>
              <ChevronLeft className="mr-1.5 h-3.5 w-3.5" />
              上一步
            </Button>
          )}
        </div>

        <div className="flex gap-2">
          {!isLast && (
            <Button variant="ghost" size="sm" onClick={() => onStepChange(currentStep + 1)}>
              跳过
            </Button>
          )}
          <Button size="sm" onClick={() => !isLast && onStepChange(currentStep + 1)}>
            {isLast ? '完成' : (
              <>
                下一步
                <ChevronRight className="ml-1.5 h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
