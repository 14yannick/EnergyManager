import { useSyncExternalStore } from "react";
import { effectiveSensorProfile, type Party } from "@energy-manager/shared";

/**
 * Whose dashboard an admin or a viewer is looking at.
 *
 * They may look at any member of the site, so the one in front of them is
 * a choice: made in the Participants list under Site administration, next
 * to the site it belongs to, remembered in this browser per site, and read
 * by the dashboard. A participant has no choice to make: the API shows
 * them their own.
 *
 * Kept in `localStorage` like the site (see useCurrentSite): a viewing
 * preference, not data, and losing it only means starting on one's own
 * household again.
 */
const STORAGE_KEY = "em.party";

type Choices = Record<string, string>;

let chosen: Choices = {};
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed: unknown = raw ? JSON.parse(raw) : null;
  if (parsed && typeof parsed === "object") chosen = parsed as Choices;
} catch {
  /* storage unavailable or unreadable: the choice lasts for the tab */
}
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Look at this member of this site from now on. */
export function chooseParty(siteId: string, partyId: string) {
  chosen = { ...chosen, [siteId]: partyId };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chosen));
  } catch {
    /* same */
  }
  for (const listener of listeners) listener();
}

/** The member chosen for this site, if any was. */
export function useChosenParty(siteId: string | null | undefined): string | null {
  const choices = useSyncExternalStore(subscribe, () => chosen);
  return siteId ? (choices[siteId] ?? null) : null;
}

/**
 * The member to show, out of the site's: the chosen one if it is still a
 * member, else the viewer's own household, else the first that feeds in,
 * else the first.
 */
export function pickParty(members: Party[], chosenId: string | null, homeId: string | null): Party | undefined {
  return (
    members.find((p) => p.id === chosenId) ??
    members.find((p) => p.id === homeId) ??
    members.find((p) => effectiveSensorProfile(p).feedIn) ??
    members[0]
  );
}
