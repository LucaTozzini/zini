import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.ts";

export type Profile = {
  username: string;
};

export const profileKey = ["profile"];

export function useProfile() {
  return useQuery({
    queryKey: profileKey,
    queryFn: () => api.get(`profile`).json<Profile>(),
  });
}

export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profile: Profile) =>
      api.post("profile", { json: profile }).json<Profile>(),
    onSuccess: (data) => {
      queryClient.setQueryData(profileKey, data);
    },
  });
}
