import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";
import Leads from "./pages/Leads";
import Prospeccao from "./pages/Prospeccao";
import Calendario from "./pages/Calendario";
import Reunioes from "./pages/Reunioes";
import Automacao from "./pages/Automacao";
import NotFound from "./pages/NotFound";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard" element={<Dashboard />} />
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
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
