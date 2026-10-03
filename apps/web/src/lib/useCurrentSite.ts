import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Site } from "@energy-manager/shared";
import { api } from "../api/client";
import { useIdentity } from "./useIdentity";

/**
 * Which site an admin or a viewer is looking at.
 *
 * They may see every site, so the one in front of them is a choice: made in
 * the Sites list under Site administration, remembered in this browser, and
 * shared by every page —
 * each query is keyed by the site's id, so changing it refetches what is on
 * screen and nothing else. A participant has no choice to make: their site
 * is the one their party belongs to, and the API confines them to it.
 *
 * The choice lives in `localStorage` on purpose. It is a viewing
 * preference, not data: it decides nothing about what anyone may see, and
 * losing it only means starting on the home site again.
 */
const STORAGE_KEY = "em.site";

let chosen: string | null = null;
try {
  chosen = localStorage.getItem(STORAGE_KEY);
} catch {
  /* storage unavailable: the choice lasts for the tab */
}
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Look at another site from now on. */
export function chooseSite(siteId: string) {
  chosen = siteId;
  try {
    localStorage.setItem(STORAGE_KEY, siteId);
  } catch {
    /* same */
  }
  for (const listener of listeners) listener();
}

/**
 * The site to show, out of those the caller may see: the one they chose if
 * it still exists, else the one they are assigned to, else the first.
 */
export function pickSite(sites: Site[], chosenId: string | null, homeId: string | null): Site | undefined {
  return (
    sites.find((s) => s.id === chosenId) ?? sites.find((s) => s.id === homeId) ?? sites[0]
  );
}

export function useCurrentSite({ enabled = true }: { enabled?: boolean } = {}) {
  // `enabled: false` for a participant, to whom the site list is closed.
  const query = useQuery({ queryKey: ["sites"], queryFn: api.sites.list, enabled });
  const identity = useIdentity();
  const chosenId = useSyncExternalStore(subscribe, () => chosen);
  const sites = query.data ?? [];
  return {
    site: pickSite(sites, chosenId, identity.data?.homeSite?.id ?? null),
    sites,
    isLoading: query.isLoading,
    error: query.error,
  };
}
