import { useQuery } from "@tanstack/react-query";
import type { ConductorStatus } from "shared";
import { api } from "./client.ts";

export function useConductorStatus() {
  return useQuery({
    queryKey: ["conductorStatus"],
    queryFn: () => api.get("/conductor/status").json<ConductorStatus>(),
  });
}
