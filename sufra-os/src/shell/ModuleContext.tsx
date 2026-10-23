import { createContext, useContext } from "react";
import type { ModuleDef, ModuleRoute } from "@/modules/types";

export const ModuleCtx = createContext<{ module: ModuleDef; route: ModuleRoute } | null>(null);
export const useCurrentModule = () => useContext(ModuleCtx);
