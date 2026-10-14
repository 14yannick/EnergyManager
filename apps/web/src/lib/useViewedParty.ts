import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { effectiveSensorProfile, isVzevMember, type Party } from "@energy-manager/shared";
import { api } from "../api/client";
import { useIdentity } from "./useIdentity";
import { useCurrentSite } from "./useCurrentSite";

/**
 * Whose view an admin or a viewer is in.
 *
 * They may step into any member of the site's shoes: chosen in the
 * Participants list under Site administration, next to the site it
 * belongs to, remembered in this browser per site. While a member other
 * than their own household is chosen, the app is that member's — their
 * dashboard, their account, their tabs and nothing more — until they come
 * back out under Account (see `useProxy`). A participant has no choice to
 * make: the API shows them their own.
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

/** Back to one's own view of this site. */
export function clearParty(siteId: string) {
  if (!(siteId in chosen)) return;
  const rest = { ...chosen };
  delete rest[siteId];
  chosen = rest;
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

/** A member's view an admin or a viewer has stepped into. */
export interface ProxyView {
  siteId: string;
  party: Party;
}

/**
 * Whether the signed-in admin or viewer is in a member's shoes: a member
 * of the site in view is chosen, and it is not their own household.
 *
 * `pending` while a member is chosen but the site's parties have not
 * loaded yet, so the shell shows the member's tabs from the first paint
 * rather than the admin's for a moment. A chosen member who has since left
 * the site ends the view by itself. Never for a participant.
 */
export function useProxy(): { proxy: ProxyView | null; pending: boolean } {
  const identity = useIdentity();
  const me = identity.data;
  const isParticipant = me?.role === "participant";
  const { site } = useCurrentSite({ enabled: identity.isSuccess && !isParticipant });
  const partiesQuery = useQuery({
    queryKey: ["parties", site?.id],
    queryFn: () => api.parties.list(site!.id),
    enabled: !!site && !isParticipant,
  });
  const chosenId = useChosenParty(site?.id);
  const chosenOther = me != null && !isParticipant && site != null && chosenId != null && chosenId !== me.homeParty?.id;
  const party = chosenOther
    ? partiesQuery.data?.find((p) => p.id === chosenId && isVzevMember(p.role))
    : undefined;
  const gone = chosenOther && partiesQuery.isSuccess && party == null;
  useEffect(() => {
    if (gone && site) clearParty(site.id);
  }, [gone, site]);
  return {
    proxy: party && site ? { siteId: site.id, party } : null,
    pending: chosenOther && !partiesQuery.isSuccess,
  };
}
