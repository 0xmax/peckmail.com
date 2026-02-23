import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { AuthProvider } from "./context/AuthContext.js";
import { ToastProvider } from "./context/ToastContext.js";
import { ThemeProvider } from "./context/ThemeContext.js";

const root = document.getElementById("root")!;
createRoot(root).render(
  <ThemeProvider>
    <AuthProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AuthProvider>
  </ThemeProvider>
);
