import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isVzevMember, swissDate, type Party, type PartyRole } from "@energy-manager/shared";
import { api } from "../api/client";
import { useT, type MessageKey } from "../i18n/context";
import { PartyInvestment } from "./PartyInvestment";
import { PartyPlant } from "./PartyPlant";
import { PartySensors } from "./PartySensors";

/**
 * The site's parties: who is in it, in which role, and under which
 * addresses they sign in. Lived on the readings page while a CSV import was
 * the only thing that created parties; it is administration of the site,
 * so it sits with the rest of it now.
 */

const EMPTY_PARTY = {
  reference: "",
  name: "",
  emails: "",
  // Postal address, for the QR-bill's "payable by" half.
  address: "",
  buildingNumber: "",
  zip: "",
  city: "",
  // The operator is the party that bills the others; their IBAN is what the
  // QR-bill is payable to.
  role: "rcp_party" as PartyRole,
  // Whether the member has a plant, and how much of it is mapped (see Party).
  feedIn: false,
  detailedRevenue: false,
  detailedLiveView: false,
  iban: "",
  // Membership bounds — a tenant moving in or out mid-period, say. Blank
  // means no bound either way, which is what almost every party has.
  startDate: "",
  endDate: "",
};

/**
 * What a participant can be, in the order somebody picks from — `rcp_party`
 * first because it is what almost every row is.
 *
 * Six choices over two stored things: the role, and whether the member
 * feeds in. They are kept apart in the database (see `parties.feedIn`) and
 * offered together here, because "a member with feed-in" is how the person
 * filling in the form thinks of it.
 */
type RoleChoice = "party" | "partyFeedIn" | "admin" | "adminFeedIn" | "adminOnly" | "viewer";
const ROLE_CHOICES: Array<{ choice: RoleChoice; role: PartyRole; feedIn: boolean; label: MessageKey; hint: MessageKey }> = [
  { choice: "party", role: "rcp_party", feedIn: false, label: "parties.role.party", hint: "parties.role.partyHint" },
  { choice: "partyFeedIn", role: "rcp_party", feedIn: true, label: "parties.role.partyFeedIn", hint: "parties.role.partyFeedInHint" },
  { choice: "admin", role: "rcp_admin", feedIn: false, label: "parties.role.admin", hint: "parties.role.adminHint" },
  { choice: "adminFeedIn", role: "rcp_admin", feedIn: true, label: "parties.role.adminFeedIn", hint: "parties.role.adminFeedInHint" },
  { choice: "adminOnly", role: "rcp_admin_only", feedIn: false, label: "parties.role.adminOnly", hint: "parties.role.adminOnlyHint" },
  { choice: "viewer", role: "viewer", feedIn: false, label: "parties.role.viewer", hint: "parties.role.viewerHint" },
];
const choiceOf = (v: { role: PartyRole; feedIn: boolean }) =>
  ROLE_CHOICES.find((c) => c.role === v.role && c.feedIn === (v.feedIn && isVzevMember(v.role))) ?? ROLE_CHOICES[0]!;

/**
 * The role, and under it the two options a plant opens. One control for the
 * add form and the edit row, so the two cannot offer different choices.
 */
function RoleFields<V extends { role: PartyRole; feedIn: boolean; detailedRevenue: boolean; detailedLiveView: boolean }>({
  value,
  onChange,
  selectClass,
}: {
  value: V;
  onChange: (next: V) => void;
  selectClass: string;
}) {
  const t = useT();
  return (
    <>
      <select
        className={selectClass}
        value={choiceOf(value).choice}
        onChange={(e) => {
          const picked = ROLE_CHOICES.find((c) => c.choice === e.target.value)!;
          // Leaving feed-in takes the two options with it: they describe a plant.
          onChange({
            ...value,
            role: picked.role,
            feedIn: picked.feedIn,
            detailedRevenue: picked.feedIn && value.detailedRevenue,
            detailedLiveView: picked.feedIn && value.detailedLiveView,
          });
        }}
      >
        {ROLE_CHOICES.map((o) => (
          <option key={o.choice} value={o.choice} title={t(o.hint)}>
            {t(o.label)}
          </option>
        ))}
      </select>
      {value.feedIn && (
        <span className="flex flex-col gap-1 pt-1 text-xs font-normal text-slate-700">
          <label className="flex items-center gap-2" title={t("parties.detailedRevenueHint")}>
            <input
              type="checkbox"
              checked={value.detailedRevenue}
              onChange={(e) => onChange({ ...value, detailedRevenue: e.target.checked })}
            />
            {t("parties.detailedRevenue")}
          </label>
          <label className="flex items-center gap-2" title={t("parties.detailedLiveViewHint")}>
            <input
              type="checkbox"
              checked={value.detailedLiveView}
              onChange={(e) => onChange({ ...value, detailedLiveView: e.target.checked })}
            />
            {t("parties.detailedLiveView")}
          </label>
        </span>
      )}
    </>
  );
}

/** One address per line, or comma-separated — whichever the user finds natural. */
function parseEmails(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((e) => e.trim())
    .filter((e) => e !== "");
}

export function PartiesSection({ siteId, canEdit = true }: { siteId: string; canEdit?: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({ ...EMPTY_PARTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ ...EMPTY_PARTY });
  const [error, setError] = useState<string | null>(null);
  // Whose sensors (and investment) are open below their row — one at a time.
  const [openId, setOpenId] = useState<string | null>(null);

  const partiesQuery = useQuery({
    queryKey: ["parties", siteId],
    queryFn: () => api.parties.list(siteId),
  });
  const sensorsQuery = useQuery({
    queryKey: ["party-sensors", siteId],
    queryFn: () => api.partySensors.list(siteId),
  });
  const sensorsOf = (party: Party) => (sensorsQuery.data ?? []).filter((x) => x.partyId === party.id);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["parties", siteId] });
    void queryClient.invalidateQueries({ queryKey: ["billing-invoices", siteId] });
    // A role or an option changed decides which sensors count.
    void queryClient.invalidateQueries({ queryKey: ["party-sensors", siteId] });
  };
  const toInput = (v: typeof EMPTY_PARTY) => ({
    name: v.name.trim(),
    reference: v.reference.trim(),
    emails: parseEmails(v.emails),
    address: v.address.trim(),
    buildingNumber: v.buildingNumber.trim(),
    zip: v.zip.trim(),
    city: v.city.trim(),
    role: v.role,
    feedIn: v.feedIn,
    detailedRevenue: v.detailedRevenue,
    detailedLiveView: v.detailedLiveView,
    iban: v.iban.trim(),
    startDate: v.startDate,
    endDate: v.endDate,
  });

  const createMutation = useMutation({
    mutationFn: () => api.parties.create(siteId, toInput(draft)),
    onSuccess: () => {
      setError(null);
      setDraft({ ...EMPTY_PARTY });
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });
  const updateMutation = useMutation({
    mutationFn: () => api.parties.update(editingId!, toInput(edit)),
    onSuccess: () => {
      setError(null);
      setEditingId(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.parties.remove(id),
    onSuccess: invalidate,
  });

  const parties = partiesQuery.data ?? [];

  return (
    <div className="space-y-4 rounded-lg border bg-white p-4">
      <div>
        <h2 className="text-sm font-medium text-slate-700">{t("parties.title")}</h2>
        <p className="mt-1 max-w-4xl text-xs text-slate-500">{t("parties.note")}</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
          {t("parties.number")}
          <input
            type="text"
            className="input w-32"
            placeholder="592971"
            value={draft.reference}
            onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
          />
        </label>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
          {t("parties.name")}
          <input
            type="text"
            className="input w-56"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
          {t("parties.street")}
          <input
            type="text"
            className="input w-48"
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
          />
        </label>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
          {t("parties.buildingNo")}
          <input
            type="text"
            className="input w-16"
            value={draft.buildingNumber}
            onChange={(e) => setDraft({ ...draft, buildingNumber: e.target.value })}
          />
        </label>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
          {t("parties.postcode")}
          <input
            type="text"
            className="input w-20"
            value={draft.zip}
            onChange={(e) => setDraft({ ...draft, zip: e.target.value })}
          />
        </label>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
          {t("parties.town")}
          <input
            type="text"
            className="input w-40"
            value={draft.city}
            onChange={(e) => setDraft({ ...draft, city: e.target.value })}
          />
        </label>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
          {t("parties.emails")}
          <textarea
            rows={2}
            className="input w-80"
            value={draft.emails}
            onChange={(e) => setDraft({ ...draft, emails: e.target.value })}
          />
        </label>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
          {t("parties.iban")}
          <input
            type="text"
            className="input w-56"
            value={draft.iban}
            onChange={(e) => setDraft({ ...draft, iban: e.target.value })}
          />
        </label>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
          {t("parties.role")}
          <RoleFields value={draft} onChange={setDraft} selectClass="input w-56" />
        </label>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
          {t("parties.startDate")}
          <input
            type="date"
            className="input w-40"
            value={draft.startDate}
            onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
          />
        </label>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
          {t("parties.endDate")}
          <input
            type="date"
            className="input w-40"
            value={draft.endDate}
            onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
          />
        </label>
        <button
          type="submit"
          disabled={createMutation.isPending || draft.name.trim() === ""}
          className="btn-primary px-4 py-2 text-sm"
        >
          {t("parties.addParticipant")}
        </button>
      </form>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Scrolls on a narrow screen instead of widening the page. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 pr-3 font-medium">{t("parties.numberShort")}</th>
              <th className="py-1 pr-3 font-medium">{t("parties.name")}</th>
              <th className="py-1 pr-3 font-medium">{t("parties.address")}</th>
              <th className="py-1 pr-3 font-medium">{t("parties.emailsShort")}</th>
              <th className="py-1 pr-3 font-medium">{t("parties.roleIban")}</th>
              <th className="py-1 pr-3 font-medium">{t("parties.membership")}</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {parties.map((p) => {
              const isEditing = editingId === p.id;
              const open = openId === p.id && isVzevMember(p.role);
              return (
                <Fragment key={p.id}>
                <tr className="border-t align-top">
                  <td className="py-2 pr-3">
                    {isEditing ? (
                      <input
                        className="input w-28"
                        value={edit.reference}
                        onChange={(e) => setEdit({ ...edit, reference: e.target.value })}
                      />
                    ) : (
                      <span className="tabular-nums text-slate-600">{p.reference ?? "—"}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {isEditing ? (
                      <input
                        className="input w-52"
                        value={edit.name}
                        onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                      />
                    ) : (
                      <span className="text-slate-900">{p.name}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {isEditing ? (
                      <div className="flex flex-wrap gap-1">
                        <input
                          className="input w-36"
                          placeholder={t("parties.street")}
                          value={edit.address}
                          onChange={(e) => setEdit({ ...edit, address: e.target.value })}
                        />
                        <input
                          className="input w-14"
                          placeholder={t("parties.buildingNo")}
                          value={edit.buildingNumber}
                          onChange={(e) => setEdit({ ...edit, buildingNumber: e.target.value })}
                        />
                        <input
                          className="input w-20"
                          placeholder={t("parties.postcode")}
                          value={edit.zip}
                          onChange={(e) => setEdit({ ...edit, zip: e.target.value })}
                        />
                        <input
                          className="input w-32"
                          placeholder={t("parties.town")}
                          value={edit.city}
                          onChange={(e) => setEdit({ ...edit, city: e.target.value })}
                        />
                      </div>
                    ) : p.address || p.city ? (
                      <span className="text-slate-600">
                        {[p.address, p.buildingNumber].filter(Boolean).join(" ")}
                        {(p.address || p.buildingNumber) && (p.zip || p.city) ? ", " : ""}
                        {[p.zip, p.city].filter(Boolean).join(" ")}
                      </span>
                    ) : (
                      <span className="text-slate-400">{t("parties.noAddress")}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {isEditing ? (
                      <textarea
                        rows={2}
                        className="input w-80"
                        value={edit.emails}
                        onChange={(e) => setEdit({ ...edit, emails: e.target.value })}
                      />
                    ) : p.emails.length > 0 ? (
                      <ul className="space-y-0.5">
                        {p.emails.map((mail) => (
                          <li key={mail} className="text-slate-600">
                            {mail}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-slate-400">{t("parties.noEmail")}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {isEditing ? (
                      <div className="flex flex-col gap-1">
                        <RoleFields value={edit} onChange={setEdit} selectClass="input w-52" />
                        <input
                          className="input w-52"
                          placeholder="IBAN"
                          value={edit.iban}
                          onChange={(e) => setEdit({ ...edit, iban: e.target.value })}
                        />
                      </div>
                    ) : (
                      <span className={p.role === "rcp_party" && !p.feedIn ? "text-slate-400" : "text-slate-900"}>
                        {t(choiceOf(p).label)}
                        {p.role === "rcp_admin" || p.role === "rcp_admin_only" ? (
                          <span className="ml-2 font-mono text-xs text-slate-500">
                            {p.iban ?? t("parties.noIban")}
                          </span>
                        ) : null}
                        {(p.detailedRevenue || p.detailedLiveView) && (
                          <span className="block text-xs text-slate-500">
                            {[
                              p.detailedRevenue ? t("parties.detailedRevenue") : null,
                              p.detailedLiveView ? t("parties.detailedLiveView") : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {isEditing ? (
                      <div className="flex flex-col gap-1">
                        <input
                          type="date"
                          className="input w-36"
                          value={edit.startDate}
                          onChange={(e) => setEdit({ ...edit, startDate: e.target.value })}
                        />
                        <input
                          type="date"
                          className="input w-36"
                          value={edit.endDate}
                          onChange={(e) => setEdit({ ...edit, endDate: e.target.value })}
                        />
                      </div>
                    ) : p.startDate || p.endDate ? (
                      <span className="text-slate-600">
                        {p.startDate ? swissDate(p.startDate) : "…"} – {p.endDate ? swissDate(p.endDate) : "…"}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => updateMutation.mutate()}
                          disabled={updateMutation.isPending || edit.name.trim() === ""}
                          className="mr-3 font-medium text-slate-900 disabled:opacity-50"
                        >
                          {t("common.save")}
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-700">
                          {t("common.cancel")}
                        </button>
                      </>
                    ) : (
                      <>
                        {/* Only a member of the vZEV has a meter to put a sensor on. */}
                        {isVzevMember(p.role) && (
                          <button
                            onClick={() => setOpenId(openId === p.id ? null : p.id)}
                            aria-expanded={openId === p.id}
                            className={`mr-3 ${openId === p.id ? "font-medium text-slate-900" : "text-slate-500 hover:text-slate-900"}`}
                          >
                            {t("parties.sensors", { count: sensorsOf(p).length })}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setError(null);
                            setEditingId(p.id);
                            setEdit({
                              reference: p.reference ?? "",
                              name: p.name,
                              emails: p.emails.join("\n"),
                              address: p.address ?? "",
                              buildingNumber: p.buildingNumber ?? "",
                              zip: p.zip ?? "",
                              city: p.city ?? "",
                              role: p.role,
                              feedIn: p.feedIn,
                              detailedRevenue: p.detailedRevenue,
                              detailedLiveView: p.detailedLiveView,
                              iban: p.iban ?? "",
                              startDate: p.startDate ?? "",
                              endDate: p.endDate ?? "",
                            });
                          }}
                          className="mr-3 text-slate-500 hover:text-slate-900"
                        >
                          {t("common.edit")}
                        </button>
                        <button
                          onClick={() => deleteMutation.mutate(p.id)}
                          className="text-slate-400 hover:text-red-600"
                        >
                          {t("common.delete")}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={7} className="pb-4">
                      {/* The participant's own configuration, under their row:
                          sensors for every member; with detailed revenue the
                          plant's own figures; with feed-in what it cost. */}
                      <div className="space-y-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <PartySensors siteId={siteId} party={p} sensors={sensorsOf(p)} canEdit={canEdit} />
                        {p.feedIn && p.detailedRevenue && <PartyPlant siteId={siteId} party={p} canEdit={canEdit} />}
                        {p.feedIn && <PartyInvestment siteId={siteId} party={p} canEdit={canEdit} />}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {parties.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-400">
                  {t("parties.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
