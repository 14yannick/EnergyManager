import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { effectiveSensorProfile, isVzevMember } from "@energy-manager/shared";
import { api } from "../api/client";
import { useT } from "../i18n/context";
import { useIdentity } from "../lib/useIdentity";
import { useCurrentSite } from "../lib/useCurrentSite";
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
 * are. An admin or a viewer may look at any member of the site in view and
 * picks one here, starting on their own household where they have one, else
 * on the first that feeds in.
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

  // A pick belongs to the site it was made on: switching sites under Site
  // administration must not carry a party id over to a site it is not on.
  const [picked, setPicked] = useState<{ siteId: string; partyId: string } | null>(null);
  const pickedId = picked && picked.siteId === siteId ? picked.partyId : null;
  const defaultId =
    members.find((p) => p.id === me?.homeParty?.id)?.id ??
    members.find((p) => effectiveSensorProfile(p).feedIn)?.id ??
    members[0]?.id;
  const party = members.find((p) => p.id === (pickedId ?? defaultId));

  if (identity.isLoading) return <p className="text-slate-500">{t("common.loading")}</p>;

  if (isParticipant) {
    if (!me?.siteId || !me.partyId) return <p className="text-slate-500">{t("common.loading")}</p>;
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t("dash.title")}</h1>
          <p className="max-w-2xl text-sm text-slate-500">{t("party.intro", { name: me.partyName ?? "" })}</p>
        </div>
        <ConsumptionDashboard siteId={me.siteId} partyId={me.partyId} partyName={me.partyName ?? ""} ownerView={false} />
      </div>
    );
  }

  if (!site) return <p className="text-slate-500">{t("common.loading")}</p>;
  if (partiesQuery.isSuccess && members.length === 0) {
    return <p className="text-sm text-slate-500">{t("party.none")}</p>;
  }
  if (!party) return <p className="text-slate-500">{t("common.loading")}</p>;

  const plant = effectiveSensorProfile(party).feedIn;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t("dash.title")}</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            {plant ? t("dash.intro") : t("party.intro", { name: party.name })}
          </p>
        </div>
        {/* Whose dashboard: the whole page answers to it, so it sits with
            the title rather than down by the period controls. */}
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          {t("dash.viewAs")}
          <select
            className="input w-56 max-w-full"
            value={party.id}
            onChange={(e) => setPicked({ siteId: site.id, partyId: e.target.value })}
          >
            {members.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {plant ? (
        <>
          <PlantDashboard site={site} party={party} />
          {/* A producer draws too — at night, or from another plant — and
              is billed for it like anyone: the same person as a consumer. */}
          <ConsumptionDashboard siteId={site.id} partyId={party.id} partyName={party.name} ownerView embedded />
        </>
      ) : (
        <ConsumptionDashboard siteId={site.id} partyId={party.id} partyName={party.name} ownerView />
      )}
    </div>
  );
}
