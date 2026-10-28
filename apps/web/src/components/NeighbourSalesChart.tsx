import { useQuery } from "@tanstack/react-query";
import { formatChf, formatKwh, formatNumber } from "../lib/format";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { NeighbourSale } from "@energy-manager/shared";
import { api } from "../api/client";
import { PALETTE, type Tone } from "../lib/palette";
import { useT } from "../i18n/context";
import { InfoTip } from "./InfoTip";
import { StatCard } from "./StatCard";
import { axisTick } from "../lib/periods";

/**
 * What selling to each participant was really worth: the revenue beside what
 * the same energy would have earned exported, one pair of bars per
 * participant over the dashboard's range.
 *
 * Per participant rather than over time: the question it answers is who the
 * local sales pay off with, and a stack of participants per period would bury
 * the comparison it exists for. The table carries the gain itself.
 *
 * Two figures head the section: what the vZEV earned net over the range,
 * and what participants still owe — the result of these sales, and the
 * money from them that has not yet come in.
 */

// The dashboard's own colours for the two flows being compared: neighbour
// sales, and direct export. Validated as a pair; the export bar is hatched as
// well, so it reads as the alternative rather than as money received.
const SALE_COLOR = PALETTE.local;
const EXPORT_COLOR = PALETTE.grid;
const EXPORT_HATCH = "neighbourExportHatch";

const chf = (v: number) => `${formatChf(v)} CHF`;
const ctPerKwh = (chfPerKwh: number, unit: string) => `${formatNumber(chfPerKwh * 100, 1)} ${unit}`;

export function NeighbourSalesChart({ siteId, from, to }: { siteId: string; from: string; to: string }) {
  const t = useT();
  const query = useQuery({
    queryKey: ["savings-neighbours", siteId, from, to],
    queryFn: () => api.savings.neighbours(siteId, from, to),
  });
  // Deliberately not scoped to the range: an open invoice is a
  // current-balance fact, not a historical one, so this is the same figure
  // whichever range the rest of the page happens to be showing. Shares its
  // key with the Account page's own fetch.
  const invoicesQuery = useQuery({
    queryKey: ["invoices", siteId],
    queryFn: () => api.invoices.list(siteId),
  });
  const data = query.data;
  const parties = data?.parties ?? [];
  const openInvoicesChf = invoicesQuery.data
    ?.filter((inv) => inv.status === "issued")
    .reduce((sum, inv) => sum + inv.totalChf, 0);
  // What selling to participants gained (revenue less the export it displaced)
  // plus the owner's own saving on standing charges from sharing the
  // connection — the vZEV's whole economic point, net of what running it
  // alone would have cost either way.
  const netEarningChf = data == null ? undefined : data.totals.gainChf + (data.owner?.advantageChf ?? 0);
  // A profit-and-loss figure earns its colour: green while it is actually
  // positive, plain at zero or below. Tinting a zero would claim a gain the
  // number does not show.
  const gainTone = (chf: number | undefined): Tone | undefined => (chf != null && chf > 0 ? "local" : undefined);
  const compared = (p: Pick<NeighbourSale, "kwh" | "unpricedKwh">) => p.kwh - p.unpricedKwh;
  const gainPerKwh = (p: NeighbourSale | NonNullable<typeof data>["totals"]) =>
    compared(p) > 0 ? p.gainChf / compared(p) : null;
  const barSize = Math.max(18, Math.min(56, Math.round(360 / Math.max(parties.length, 1))));

  // A range with nobody to sell to — before the neighbours joined — gets no
  // section at all, rather than one saying there was nothing to sell.
  if (data && data.memberCount === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-slate-700">
          {t("dash.neighbours")}
          <InfoTip text={t("dash.neighboursNote")} />
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          tone={gainTone(netEarningChf)}
          label={t("dash.netEarning")}
          hint={t("dash.netEarningHint")}
          value={netEarningChf}
        />
        <StatCard label={t("dash.openInvoices")} hint={t("dash.openInvoicesHint")} value={openInvoicesChf} />
      </div>

      <div className="space-y-4 rounded-lg border bg-white p-4">
        {data && parties.length === 0 && !data.owner?.advantageChf ? (
          <p className="py-6 text-center text-sm text-slate-500">{t("dash.nb.none")}</p>
        ) : (
          <>
            {data && data.totals.unpricedKwh > 0 && (
              <p className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                {t("dash.nb.unpriced", { kwh: formatKwh(data.totals.unpricedKwh) })}
              </p>
            )}

            <div className="h-64 xl:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={parties} barGap={4} barCategoryGap="30%">
                  <defs>
                    <pattern id={EXPORT_HATCH} patternUnits="userSpaceOnUse" width={5} height={5}
                      patternTransform="rotate(45)">
                      <rect width={5} height={5} fill={PALETTE.surface} />
                      <line x1={0} y1={0} x2={0} y2={5} stroke={EXPORT_COLOR} strokeWidth={3} />
                    </pattern>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.gridline} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={axisTick} width={56} />
                  <Tooltip content={<SaleTooltip />} cursor={{ fill: PALETTE.hoverBand }} />
                  {/* Ink-coloured names: the swatch carries the series colour. */}
                  <Legend formatter={(value: string) => <span className="text-slate-700">{value}</span>} />
                  <Bar dataKey="revenueChf" name={t("dash.nb.revenue")} fill={SALE_COLOR}
                    barSize={barSize} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="exportValueChf" name={t("dash.nb.export")} fill={`url(#${EXPORT_HATCH})`}
                    stroke={EXPORT_COLOR} strokeWidth={1} barSize={barSize} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* The figures behind the bars, and the one the bars only imply.
                Kept on one line per cell: on a phone the table scrolls rather
                than breaking an amount across two lines. */}
            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-sm">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">{t("dash.nb.participant")}</th>
                    <th className="py-1 pr-3 text-right font-medium">kWh</th>
                    <th className="py-1 pr-3 text-right font-medium">{t("dash.nb.revenue")}</th>
                    <th className="py-1 pr-3 text-right font-medium">{t("dash.nb.gain")}</th>
                    <th className="py-1 pr-3 text-right font-medium">{t("dash.nb.gainPerKwh")}</th>
                    <th className="py-1 text-right font-medium">{t("dash.nb.participantSaved")}</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {parties.map((p) => (
                    <tr key={p.partyId} className="border-t">
                      <td className="py-1 pr-3 text-slate-900">{p.name}</td>
                      <td className="py-1 pr-3 text-right">{formatKwh(p.kwh)}</td>
                      <td className="py-1 pr-3 text-right">{chf(p.revenueChf)}</td>
                      <td className="py-1 pr-3 text-right font-medium">{compared(p) > 0 ? chf(p.gainChf) : "—"}</td>
                      <td className="py-1 pr-3 text-right">
                        {gainPerKwh(p) == null ? "—" : ctPerKwh(gainPerKwh(p)!, t("billing.centsPerKwh"))}
                      </td>
                      <td className="py-1 text-right">{chf(p.participantSavedChf)}</td>
                    </tr>
                  ))}
                  {data && parties.length > 1 && (
                    <tr className="border-t-2 border-slate-300 font-semibold">
                      <td className="py-1 pr-3 text-slate-900">{t("common.total")}</td>
                      <td className="py-1 pr-3 text-right">{formatKwh(data.totals.kwh)}</td>
                      <td className="py-1 pr-3 text-right">{chf(data.totals.revenueChf)}</td>
                      <td className="py-1 pr-3 text-right">
                        {compared(data.totals) > 0 ? chf(data.totals.gainChf) : "—"}
                      </td>
                      <td className="py-1 pr-3 text-right">
                        {gainPerKwh(data.totals) == null
                          ? "—"
                          : ctPerKwh(gainPerKwh(data.totals)!, t("billing.centsPerKwh"))}
                      </td>
                      <td className="py-1 text-right">{chf(data.totals.participantSavedChf)}</td>
                    </tr>
                  )}
                  {data?.owner && (
                    // The owner's own gain from the RCP: not a sale, so no
                    // energy columns — just what sharing the connection saves.
                    <tr className="border-t text-slate-700">
                      <td className="py-1 pr-3" title={t("dash.nb.ownerHint", {
                        alone: chf(data.owner.aloneChf), rcp: chf(data.owner.rcpChf) })}>
                        {t("dash.nb.owner")}
                        <span className="ml-2 text-xs text-slate-400">
                          {t("dash.nb.ownerDetail", { alone: chf(data.owner.aloneChf), rcp: chf(data.owner.rcpChf) })}
                        </span>
                      </td>
                      <td className="py-1 pr-3 text-right text-slate-400">—</td>
                      <td className="py-1 pr-3 text-right text-slate-400">—</td>
                      <td className="py-1 pr-3 text-right font-medium">{chf(data.owner.advantageChf)}</td>
                      <td className="py-1 pr-3 text-right text-slate-400">—</td>
                      <td className="py-1 text-right text-slate-400">—</td>
                    </tr>
                  )}
                  {data?.owner && (
                    <tr className="border-t-2 border-slate-300 font-semibold text-slate-900">
                      <td className="py-1 pr-3">{t("dash.nb.rcpTotal")}</td>
                      <td className="py-1 pr-3" colSpan={2} />
                      <td className="py-1 pr-3 text-right">
                        {chf((compared(data.totals) > 0 ? data.totals.gainChf : 0) + data.owner.advantageChf)}
                      </td>
                      <td className="py-1 pr-3" />
                      <td className="py-1" />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function SaleTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: NeighbourSale }> }) {
  const t = useT();
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]!.payload;
  const hasComparison = p.kwh - p.unpricedKwh > 0;
  const row = (label: string, value: string, swatch?: string, strong = false) => (
    <div className={`flex items-center justify-between gap-4 ${strong ? "font-semibold" : ""}`}>
      <span className="min-w-0 text-slate-600">
        {swatch && (
          <span className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle" style={{ backgroundColor: swatch }} />
        )}
        {label}
      </span>
      <span className="whitespace-nowrap tabular-nums text-slate-900">{value}</span>
    </div>
  );
  return (
    <div className="w-64 max-w-[calc(100vw-3rem)] space-y-0.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md sm:text-sm">
      <p className="mb-1 font-medium text-slate-900">{p.name}</p>
      {row("kWh", formatKwh(p.kwh))}
      {row(t("dash.nb.revenue"), chf(p.revenueChf), SALE_COLOR)}
      {row(t("dash.nb.export"), hasComparison ? chf(p.exportValueChf) : "—", EXPORT_COLOR)}
      {row(t("dash.nb.gain"), hasComparison ? chf(p.gainChf) : "—", undefined, true)}
    </div>
  );
}
