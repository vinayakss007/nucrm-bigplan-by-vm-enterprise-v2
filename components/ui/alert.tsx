/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative w-full rounded-xl border p-4 text-sm [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground border-border",
        info: "border-blue-500/30 bg-blue-500/10 text-blue-900 dark:text-blue-100 dark:border-blue-500/30 dark:bg-blue-950/30 [&>svg]:text-blue-600 dark:[&>svg]:text-blue-400",
        destructive:
          "border-destructive/50 bg-destructive/10 text-destructive dark:border-destructive [&>svg]:text-destructive",
        warning:
          "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100 dark:border-amber-500/30 dark:bg-amber-950/30 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400",
        success:
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-950/30 [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-400",
        tip:
          "border-violet-500/30 bg-violet-500/10 text-violet-900 dark:text-violet-100 dark:border-violet-500/30 dark:bg-violet-950/30 [&>svg]:text-violet-600 dark:[&>svg]:text-violet-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-xs md:text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription, alertVariants }
