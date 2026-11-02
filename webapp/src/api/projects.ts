import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project, ProjectSummary } from "shared";
import { api } from "./client.ts";

export const projectsKey = ["projects"];

export function useProjects() {
  return useQuery({
    queryKey: projectsKey,
    queryFn: () => api.get("projects").json<ProjectSummary[]>(),
  });
}

// One project, from the list.
export function useProject(projectId: number) {
  const projects = useProjects();
  return { ...projects, data: projects.data?.find((project) => project.id === projectId) };
}

// Adds a project; answers once its repo is cloned, which can take a while.
export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (project: { githubRepo: string; linearTeamId: string; name?: string }) =>
      api.post("projects", { json: project, timeout: false }).json<Project>(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectsKey }),
  });
}

export function useRenameProject(projectId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.patch(`projects/${projectId}`, { json: { name } }).json<Project>(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectsKey }),
  });
}

// Deletes the project with its workspaces, Forges and chats.
export function useDeleteProject(projectId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`projects/${projectId}`, { timeout: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectsKey }),
  });
}

// The Linear workspace's teams, for choosing a project's.
export function useLinearTeams(enabled = true) {
  return useQuery({
    queryKey: ["linear", "teams"],
    queryFn: () => api.get("linear/teams").json<{ id: string; key: string; name: string }[]>(),
    enabled,
  });
}
