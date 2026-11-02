import { useParams } from "react-router";

// The project the page is in: every project page is under /projects/:projectId.
export function useProjectId() {
  const { projectId } = useParams();
  if (!projectId) throw new Error("Not in a project");
  return Number(projectId);
}

// A path in the project, e.g. "/issues/abc" → "/projects/1/issues/abc".
export function useProjectPath() {
  const projectId = useProjectId();
  return (path = "") => `/projects/${projectId}${path}`;
}

// The project's API path, e.g. "project-lead/threads" → "projects/1/project-lead/threads".
export const projectApiPath = (projectId: number, path: string) => `projects/${projectId}/${path}`;
