import React from "react";
import { FolderX } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title = "ไม่มีข้อมูล",
  description = "ยังไม่มีข้อมูลที่จะแสดงในขณะนี้",
  icon = <FolderX className="h-10 w-10 text-muted-foreground" />,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-[300px] flex-col items-center justify-center rounded-md border border-dashed p-8 text-center animate-in fade-in-50",
        className
      )}
    >
      <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center space-y-4">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
          {icon}
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}
