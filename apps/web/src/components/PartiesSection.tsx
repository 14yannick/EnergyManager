import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { swissDate, type PartyRole } from "@energy-manager/shared";
import { api } from "../api/client";
import { useT, type MessageKey } from "../i18n/context";

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
  iban: "",
  // Membership bounds — a tenant moving in or out mid-period, say. Blank
  // means no bound either way, which is what almost every party has.
  startDate: "",
  endDate: "",
};

/**
 * Why each role exists, in the order somebody picks from. `rcp_party` first
 * because it is what almost every row is.
 */
const ROLE_OPTIONS: Array<{ role: PartyRole; label: MessageKey; hint: MessageKey }> = [
  { role: "rcp_party", label: "parties.role.party", hint: "parties.role.partyHint" },
  { role: "rcp_admin", label: "parties.role.admin", hint: "parties.role.adminHint" },
  { role: "rcp_admin_only", label: "parties.role.adminOnly", hint: "parties.role.adminOnlyHint" },
  { role: "viewer", label: "parties.role.viewer", hint: "parties.role.viewerHint" },
];
const ROLE_LABEL = Object.fromEntries(
  ROLE_OPTIONS.map((o) => [o.role, o.label]),
) as Record<PartyRole, MessageKey>;

/** One address per line, or comma-separated — whichever the user finds natural. */
function parseEmails(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((e) => e.trim())
    .filter((e) => e !== "");
}

export function PartiesSection({ siteId }: { siteId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({ ...EMPTY_PARTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ ...EMPTY_PARTY });
  const [error, setError] = useState<string | null>(null);

  const partiesQuery = useQuery({
    queryKey: ["parties", siteId],
    queryFn: () => api.parties.list(siteId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["parties", siteId] });
    void queryClient.invalidateQueries({ queryKey: ["billing-invoices", siteId] });
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
          <select
            className="input w-40"
            value={draft.role}
            onChange={(e) => setDraft({ ...draft, role: e.target.value as PartyRole })}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.role} value={o.role} title={t(o.hint)}>
                {t(o.label)}
              </option>
            ))}
          </select>
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
              return (
                <tr key={p.id} className="border-t align-top">
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
                        <select
                          className="input w-40"
                          value={edit.role}
                          onChange={(e) => setEdit({ ...edit, role: e.target.value as PartyRole })}
                        >
                          {ROLE_OPTIONS.map((o) => (
                            <option key={o.role} value={o.role} title={t(o.hint)}>
                              {t(o.label)}
                            </option>
                          ))}
                        </select>
                        <input
                          className="input w-52"
                          placeholder="IBAN"
                          value={edit.iban}
                          onChange={(e) => setEdit({ ...edit, iban: e.target.value })}
                        />
                      </div>
                    ) : (
                      <span className={p.role === "rcp_party" ? "text-slate-400" : "text-slate-900"}>
                        {t(ROLE_LABEL[p.role])}
                        {p.role === "rcp_admin" || p.role === "rcp_admin_only" ? (
                          <span className="ml-2 font-mono text-xs text-slate-500">
                            {p.iban ?? t("parties.noIban")}
                          </span>
                        ) : null}
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
              );
            })}
            {parties.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-slate-400">
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
