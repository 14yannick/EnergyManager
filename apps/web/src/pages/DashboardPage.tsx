import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { effectiveSensorProfile, isVzevMember } from "@energy-manager/shared";
import { api } from "../api/client";
import { useT } from "../i18n/context";
import { useIdentity } from "../lib/useIdentity";
import { useCurrentSite } from "../lib/useCurrentSite";
import { pickParty, useChosenParty } from "../lib/useViewedParty";
import { PlantDashboard } from "./PlantDashboard";
import { ConsumptionDashboard } from "./ConsumptionDashboard";

/**
 * The one dashboard, for whoever is looking.
 *
 * It is always some member's: a party that feeds in gets the plant's
 * figures — live, revenue, payback — with their own consumption underneath;
 * a party that only draws gets their consumption and what the vZEV saved
 * them. The party's options decide the rest (see PlantDashboard).
 *
 * A participant sees their own and nobody else's; the API knows who they
 * are. An admin or a viewer may look at any member of the site in view: the
 * one picked under Site administration (see useViewedParty), starting on
 * their own household where they have one, else on the first that feeds in.
 */
export function DashboardPage() {
  const t = useT();
  const identity = useIdentity();
  const me = identity.data;
  const isParticipant = me?.role === "participant";
  // A participant is told their site by /api/me; everyone else reads the
  // site list, to which a participant has no access.
  const { site } = useCurrentSite({ enabled: identity.isSuccess && !isParticipant });
  const siteId = isParticipant ? me?.siteId : site?.id;

  const partiesQuery = useQuery({
    queryKey: ["parties", siteId],
    queryFn: () => api.parties.list(siteId!),
    enabled: !!siteId && !isParticipant,
  });
  // Only parties with a meter in the vZEV: an admin-only or viewer party has
  // nothing to show.
  const members = useMemo(() => (partiesQuery.data ?? []).filter((p) => isVzevMember(p.role)), [partiesQuery.data]);

  const chosenId = useChosenParty(siteId);
  const party = pickParty(members, chosenId, me?.homeParty?.id ?? null);

  if (identity.isLoading) return <p className="text-slate-500">{t("common.loading")}</p>;

  if (isParticipant) {
    if (!me?.siteId || !me.partyId) return <p className="text-slate-500">{t("common.loading")}</p>;
    return <ConsumptionDashboard siteId={me.siteId} partyId={me.partyId} partyName={me.partyName ?? ""} ownerView={false} />;
  }

  if (!site) return <p className="text-slate-500">{t("common.loading")}</p>;
  if (partiesQuery.isSuccess && members.length === 0) {
    return <p className="text-sm text-slate-500">{t("party.none")}</p>;
  }
  if (!party) return <p className="text-slate-500">{t("common.loading")}</p>;

  const plant = effectiveSensorProfile(party).feedIn;

  return (
    <div className="space-y-6">
      {plant ? (
        <PlantDashboard site={site} party={party} />
      ) : (
        <ConsumptionDashboard siteId={site.id} partyId={party.id} partyName={party.name} ownerView />
      )}
    </div>
  );
}
