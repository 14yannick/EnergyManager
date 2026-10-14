import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { isVzevMember } from "@energy-manager/shared";
import { api } from "../api/client";
import { useT } from "../i18n/context";
import { useIdentity } from "../lib/useIdentity";
import { useCurrentSite } from "../lib/useCurrentSite";
import { pickParty, useChosenParty, useProxy } from "../lib/useViewedParty";

/**
 * A reminder in the header whenever what is on screen is not the signed-in
 * person's own: an admin or a viewer in a member's shoes, or on another
 * site. Nothing at all while they look at their own household on their own
 * site, and never for a participant, who sees only their own.
 *
 * In a member's shoes it links to Account, where the way out is — Site
 * administration is not among the member's tabs. Otherwise to Site
 * administration, where the site is chosen.
 */
export function ViewingAs() {
  const t = useT();
  const me = useIdentity().data;
  const isParticipant = me?.role === "participant";
  const { site } = useCurrentSite({ enabled: me != null && !isParticipant });
  const partiesQuery = useQuery({
    queryKey: ["parties", site?.id],
    queryFn: () => api.parties.list(site!.id),
    enabled: !!site && !isParticipant,
  });
  const chosenId = useChosenParty(site?.id);
  const { proxy } = useProxy();
  if (!me || isParticipant || !site) return null;

  const members = (partiesQuery.data ?? []).filter((p) => isVzevMember(p.role));
  const party = proxy?.party ?? pickParty(members, chosenId, me.homeParty?.id ?? null);
  const otherParty = party != null && party.id !== me.homeParty?.id;
  const otherSite = me.homeSite != null && site.id !== me.homeSite.id;
  if (!otherParty && !otherSite) return null;

  const text = [otherParty ? t("nav.viewingAs", { name: party.name }) : null, otherSite ? t("nav.onSite", { site: site.name }) : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <NavLink
      to={proxy ? "/account" : "/settings"}
      title={proxy ? t("nav.proxyHint") : t("nav.viewingAsHint")}
      className="shrink-0 whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
    >
      {text}
    </NavLink>
  );
}
