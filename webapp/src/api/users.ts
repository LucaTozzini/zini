import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "shared";
import { HTTPError } from "ky";
import { api } from "./client.ts";

export const userKey = ["user"];

export function useUserMe() {
  return useQuery({
    queryKey: userKey,
    queryFn: async ({ signal }) => {
      try {
        return await api.get("users/me", { signal }).json<User>();
      } catch (error) {
        if (error instanceof HTTPError && error.response.status === 401) return null;
        throw error;
      }
    },
  });
}

export function useUserLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      api.post("users/login", { json: { username, password }, timeout: false }).json<User>(),
    onSuccess: async (data) => {
      await queryClient.cancelQueries({ queryKey: userKey });
      queryClient.setQueryData(userKey, data);
    },
  });
}

export function useUserLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("users/logout", { timeout: false }),
    onSuccess: async () => {
      await queryClient.cancelQueries();
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== userKey[0] });
      queryClient.setQueryData(userKey, null);
    },
  });
}
