import { createContext, useCallback, useContext, type ReactNode } from "react";
import { toast as sonnerToast, Toaster } from "sonner";

const ToastContext = createContext<(message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const toast = useCallback((message: string) => {
    sonnerToast(message);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <Toaster
        position="bottom-center"
        toastOptions={{
          className: "!bg-foreground !text-background !rounded-xl !text-sm !shadow-lg !border-0",
        }}
      />
    </ToastContext.Provider>
  );
}
