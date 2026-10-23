import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { createRepo } from "@/data";
import type { Repo } from "@/data/repo";
import { DataProvider } from "@/data/hooks";
import { SessionProvider } from "@/auth/session";
import { ApprovalProvider } from "@/auth/approval";
import { LangProvider, useT } from "@/i18n/i18n";
import { ThemeProvider } from "@/theme/theme";
import { CommandProvider, ToastProvider } from "@/ui";
import { modules } from "@/modules/registry";
import type { ModuleDef, ModuleRoute } from "@/modules/types";
import { AppShell, BareLayout } from "@/shell/AppShell";
import { ComingSoon } from "@/shell/ComingSoon";
import { ModuleCtx } from "@/shell/ModuleContext";
import { ErrorBoundary } from "@/shell/ErrorBoundary";
import { LoginPage } from "@/pages/LoginPage";
import { PinLoginPage } from "@/pages/PinLoginPage";
import { NotFound } from "@/pages/NotFound";
import { BootScreen, RequirePermission, RequireStaff, RoleHome } from "./guards";

function ModuleElement({ module, route }: { module: ModuleDef; route: ModuleRoute }) {
  const El = route.element;
  const body = El ? <El /> : <ComingSoon />;
  return (
    <ModuleCtx.Provider value={{ module, route }}>
      {route.layout === "guest" ? body : <RequirePermission permission={route.permission ?? module.permission}>{body}</RequirePermission>}
    </ModuleCtx.Provider>
  );
}

const routesFor = (layout: "shell" | "bare" | "guest") =>
  modules.flatMap((m) => m.routes.filter((r) => (r.layout ?? "shell") === layout).map((r) => <Route key={`${m.id}:${r.path}`} path={r.path} element={<ModuleElement module={m} route={r} />} />));

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/pin" element={<PinLoginPage />} />
      {routesFor("guest")}
      <Route
        element={
          <RequireStaff>
            <BareLayout />
          </RequireStaff>
        }
      >
        {routesFor("bare")}
      </Route>
      <Route
        element={
          <RequireStaff>
            <AppShell />
          </RequireStaff>
        }
      >
        <Route index element={<RoleHome />} />
        {routesFor("shell")}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function Boot({ children }: { children: (repo: Repo) => ReactNode }) {
  const [repo, setRepo] = useState<Repo | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  useEffect(() => {
    createRepo().then(setRepo, setErr);
  }, []);
  if (err) throw err;
  return repo ? <>{children(repo)}</> : <BootScreen />;
}

function Root() {
  const { lang } = useT();
  return (
    <ErrorBoundary lang={lang}>
      <Boot>
        {(repo) => (
          <DataProvider repo={repo}>
            <SessionProvider>
              <ApprovalProvider>
                <CommandProvider>
                  <AppRoutes />
                </CommandProvider>
              </ApprovalProvider>
            </SessionProvider>
          </DataProvider>
        )}
      </Boot>
    </ErrorBoundary>
  );
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <ThemeProvider>
        <LangProvider>
          <ToastProvider>
            <Root />
          </ToastProvider>
        </LangProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
