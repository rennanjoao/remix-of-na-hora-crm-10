import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { Suspense, lazy } from "react";
import { Loader2 } from "lucide-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Lazy-loaded routes to reduce initial bundle size
const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Admin = lazy(() => import("./pages/Admin"));
const CommandCenter = lazy(() => import("./pages/CommandCenter"));
const Leads = lazy(() => import("./pages/Leads"));
const Prospeccao = lazy(() => import("./pages/Prospeccao"));
const Calendario = lazy(() => import("./pages/Calendario"));
const Reunioes = lazy(() => import("./pages/Reunioes"));
const Automacao = lazy(() => import("./pages/Automacao"));
const AuditoriaSDR = lazy(() => import("./pages/AuditoriaSDR"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Carregando" />
  </div>
);

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute roles={["admin", "sdr", "gerente", "motorista"]}>
                      <Dashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute roles={["admin"]}>
                      <Admin />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/leads"
                  element={
                    <ProtectedRoute roles={["admin", "sdr", "gerente"]}>
                      <Leads />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/prospeccao"
                  element={
                    <ProtectedRoute roles={["admin", "sdr"]}>
                      <Prospeccao />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/reunioes"
                  element={
                    <ProtectedRoute roles={["admin", "sdr", "gerente"]}>
                      <Reunioes />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/automacao"
                  element={
                    <ProtectedRoute roles={["admin", "sdr"]}>
                      <Automacao />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/calendario"
                  element={
                    <ProtectedRoute roles={["admin", "sdr", "gerente"]}>
                      <Calendario />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/command-center"
                  element={
                    <ProtectedRoute roles={["admin", "gerente"]}>
                      <CommandCenter />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/auditoria-sdr"
                  element={
                    <ProtectedRoute roles={["admin", "gerente"]}>
                      <AuditoriaSDR />
                    </ProtectedRoute>
                  }
                />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
