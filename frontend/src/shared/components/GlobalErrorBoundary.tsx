import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="flex min-h-[400px] w-full flex-col items-center justify-center p-6 text-center">
      <div className="mx-auto flex max-w-md flex-col items-center justify-center space-y-4 rounded-xl border bg-background p-8 shadow-sm">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="h-8 w-8" />
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-semibold tracking-tight">ระบบเกิดข้อผิดพลาด</h3>
          <p className="text-sm text-muted-foreground">
            ขออภัย มีบางอย่างผิดพลาดในการทำงานของระบบ กรุณาลองใหม่อีกครั้ง
          </p>
        </div>
        {import.meta.env.DEV && (
          <div className="mt-4 w-full rounded-md bg-muted p-4 text-left text-xs text-muted-foreground overflow-auto">
            <p className="font-mono">{error instanceof Error ? error.message : String(error)}</p>
          </div>
        )}
        <Button onClick={resetErrorBoundary} className="mt-6 gap-2">
          <RefreshCw className="h-4 w-4" />
          ลองใหม่อีกครั้ง
        </Button>
      </div>
    </div>
  );
}

export function GlobalErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onReset={() => {
        // Reset state or reload page if needed
        window.location.reload();
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

export function RouteErrorBoundary() {
  const error = useRouteError() as any;
  const message = isRouteErrorResponse(error)
    ? error.statusText
    : error?.message || "Unknown error";

  return (
    <div className="flex min-h-[400px] w-full flex-col items-center justify-center p-6 text-center">
      <div className="mx-auto flex max-w-md flex-col items-center justify-center space-y-4 rounded-xl border bg-background p-8 shadow-sm">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="h-8 w-8" />
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-semibold tracking-tight">เกิดข้อผิดพลาดในการโหลดหน้า</h3>
          <p className="text-sm text-muted-foreground">
            ขออภัย ไม่สามารถโหลดข้อมูลหน้าที่คุณต้องการได้ กรุณาลองใหม่อีกครั้ง
          </p>
        </div>
        {import.meta.env.DEV && (
          <div className="mt-4 w-full rounded-md bg-muted p-4 text-left text-xs text-muted-foreground overflow-auto">
            <p className="font-mono">{message}</p>
          </div>
        )}
        <Button onClick={() => window.location.reload()} className="mt-6 gap-2">
          <RefreshCw className="h-4 w-4" />
          โหลดหน้าใหม่
        </Button>
      </div>
    </div>
  );
}
