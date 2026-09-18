import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  DailySavings,
  SavingsDayDetail,
  SavingsQuery,
  SavingsSlot,
} from "@energy-manager/shared";
import { api } from "../api/client";
import { useDefaultSite } from "../lib/useDefaultSite";

type Granularity = NonNullable<SavingsQuery["granularity"]>;

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date, never via toISOString — that formats in UTC and, east
 *  of Greenwich, turns local midnight into the previous day. */
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function today(): string {
  return isoOf(new Date());
}
function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoOf(new Date(y!, m! - 1, d! + days));
}
function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return isoOf(d);
}
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("en-CH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
function slotTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("en-CH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Zurich",
  });
}

const kwh = (v: number, digits = 2) => v.toFixed(digits);
const chf = (v: number, digits = 2) => v.toFixed(digits);
const rate = (v: number | null) => (v == null ? "—" : v.toFixed(5));

/** Below this a figure is meter noise, not a quantity worth a row of its own. */
const EPSILON = 1e-9;

/** One interval's contribution to a line. */
interface SlotPart {
  kwh: number;
  chf: number;
  rateChfPerKwh: number | null;
}

/**
 * A row of one of the day's blocks: a quantity, what it was worth, and — when
 * there is an average to account for — the intervals it was summed from.
 */
interface Line {
  key: string;
  label: string;
  note?: string;
  kwh: number | null;
  chf: number | null;
  /** The interval-level detail behind the average. Omitted: nothing to expand. */
  slot?: (s: SavingsSlot) => SlotPart;
  /** Detail that isn't per interval — the per-party split. */
  breakdown?: Array<{ key: string; label: string; kwh: number; chf: number }>;
  emphasis?: boolean;
}

/**
 * The rate a line was priced at, as a positive price.
 *
 * Derived from the money and the energy rather than read off any single
 * interval: the tariff can move during the day, so the only honest single
 * figure is the weighted average, and it is exactly what the expansion adds
 * up to. Charging carries a negative value but was still priced at a positive
 * feed-in rate, hence the absolute value.
 */
function avgRate(line: Pick<Line, "kwh" | "chf">): number | null {
  if (line.kwh == null || line.chf == null) return null;
  if (Math.abs(line.kwh) < EPSILON) return null;
  return Math.abs(line.chf / line.kwh);
}

export function CalculationDetailPage() {
  const { site } = useDefaultSite();
  const [date, setDate] = useState(today);

  const dayQuery = useQuery({
    queryKey: ["savings-day", site?.id, date],
    queryFn: () => api.savings.day(site!.id, date),
    enabled: !!site,
  });

  if (!site) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Calculation detail</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          One day, and every figure behind it. Each rate is the average over the day, weighted by
          energy — expand a row to see the intervals it was built from.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3">
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          <button
            onClick={() => setDate(shiftDay(date, -1))}
            className="px-3 py-1.5 text-slate-600 hover:bg-slate-50"
            aria-label="Previous day"
          >
            ‹
          </button>
          <button
            onClick={() => setDate(shiftDay(date, 1))}
            className="border-l border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50"
            aria-label="Next day"
          >
            ›
          </button>
        </div>
        <input
          type="date"
          className="input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <span className="text-sm font-medium text-slate-900">{dayLabel(date)}</span>
        {date !== today() && (
          <button
            onClick={() => setDate(today())}
            className="text-xs text-slate-400 hover:text-slate-900"
          >
            Today
          </button>
        )}
        {dayQuery.isFetching && <span className="text-xs text-slate-400">Loading…</span>}
      </div>

      {dayQuery.isError && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {(dayQuery.error as Error).message}
        </p>
      )}

      {dayQuery.data && <DayBlocks day={dayQuery.data} />}

      <PeriodTable siteId={site.id} />
    </div>
  );
}

function DayBlocks({ day }: { day: SavingsDayDetail }) {
  const totals = day.totals;

  const solar = useMemo<Line[]>(() => {
    if (!totals) return [];
    return [
      {
        key: "produced",
        label: "Production",
        note: "PV's share of the inverter's AC output",
        kwh: totals.producedKwh,
        chf: null,
      },
      {
        key: "direct",
        label: "Direct consumption",
        note: "Production the house used as it was made, worth the import it avoided",
        kwh: totals.directUseKwh,
        chf: totals.directConsumptionRevenueChf,
        slot: (s) => ({
          kwh: s.directUseKwh,
          chf: s.directConsumptionRevenueChf,
          rateChfPerKwh: s.purchaseRateChfPerKwh,
        }),
      },
      {
        key: "parties",
        label: "Consumed by parties",
        note: "Drawn from the local pool by the other parties, at the RCP rate",
        kwh: totals.neighborConsumptionKwh,
        chf: totals.neighborSellRevenueChf,
        breakdown: day.parties.map((p) => ({
          key: p.partyId,
          label: p.name,
          kwh: p.kwh,
          chf: p.chf,
        })),
      },
      {
        key: "export",
        label: "Export to grid",
        note: "What was left over, at the feed-in rate",
        kwh: totals.exportedKwh,
        chf: totals.exportRevenueChf,
        slot: (s) => ({
          kwh: s.exportedKwh,
          chf: s.exportRevenueChf,
          rateChfPerKwh: s.sellRateChfPerKwh,
        }),
      },
    ];
  }, [totals, day.parties]);

  const battery = useMemo<Line[]>(() => {
    if (!totals) return [];
    const chargeAcKwh = day.slots.reduce((sum, s) => sum + s.batteryChargeAcKwh, 0);
    return [
      {
        key: "charge",
        label: "Charged",
        note: "Metered on the DC side, before conversion loss",
        kwh: totals.batteryChargeKwh,
        chf: null,
      },
      {
        key: "forgone",
        label: "Export forgone",
        note: "The charge as AC, which is the export it displaced, priced at the feed-in rate of the moment it was stored",
        kwh: chargeAcKwh,
        chf: -totals.batteryChargingCostChf,
        slot: (s) => ({
          kwh: s.batteryChargeAcKwh,
          chf: -s.batteryChargingCostChf,
          rateChfPerKwh: s.sellRateChfPerKwh,
        }),
      },
      {
        key: "to-house",
        label: "Discharged to the house",
        note: "Covered load, so worth the import it avoided",
        kwh: totals.batteryDischargeConsumedKwh,
        chf: totals.batteryDischargeConsumedValueChf,
        slot: (s) => ({
          kwh: s.batteryDischargeConsumedKwh,
          chf: s.batteryDischargeConsumedValueChf,
          rateChfPerKwh: s.purchaseRateChfPerKwh,
        }),
      },
      {
        key: "to-grid",
        label: "Discharged to the grid",
        note: "More left the house than the panels could have made, so the remainder came out of the battery",
        kwh: totals.batteryDischargeExportedKwh,
        chf: totals.batteryDischargeExportedValueChf,
        slot: (s) => ({
          kwh: s.batteryDischargeExportedKwh,
          chf: s.batteryDischargeExportedValueChf,
          rateChfPerKwh: s.sellRateChfPerKwh,
        }),
      },
      {
        key: "net",
        label: "Net",
        note: "What the battery earned, less what storing it cost",
        kwh: null,
        chf: totals.batteryRevenueChf,
        emphasis: true,
      },
    ];
  }, [totals, day.slots]);

  if (!totals) {
    return (
      <p className="rounded-lg border bg-white p-6 text-center text-sm text-slate-400">
        Nothing recorded on this day.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Block title="Solar" subtitle="Where the day's production went, and what it was worth" lines={solar} slots={day.slots} />
      <Block
        title="Battery"
        subtitle="What storing energy cost, and what giving it back earned"
        lines={battery}
        slots={day.slots}
      />
    </div>
  );
}

function Block({
  title,
  subtitle,
  lines,
  slots,
}: {
  title: string;
  subtitle: string;
  lines: Line[];
  slots: SavingsSlot[];
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="rounded-lg border bg-white">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-medium text-slate-700">{title}</h2>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Flow</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-medium">kWh</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-medium">ø CHF/kWh</th>
            <th className="whitespace-nowrap px-4 py-2 text-right font-medium">CHF</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const expandable = !!line.slot || !!line.breakdown;
            const isOpen = open === line.key;
            return (
              <Fragment key={line.key}>
                <tr
                  className={`border-t ${expandable ? "cursor-pointer hover:bg-slate-50" : ""} ${
                    line.emphasis ? "bg-slate-50 font-semibold" : ""
                  }`}
                  onClick={() => expandable && setOpen(isOpen ? null : line.key)}
                >
                  <td className="px-4 py-2 text-left">
                    <span className="flex items-center gap-1.5 text-slate-900">
                      {expandable && (
                        <span className="w-3 text-xs text-slate-400">{isOpen ? "▾" : "▸"}</span>
                      )}
                      {!expandable && <span className="w-3" />}
                      {line.label}
                    </span>
                    {line.note && <span className="block pl-[1.125rem] text-xs text-slate-500">{line.note}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700">
                    {line.kwh == null ? "—" : kwh(line.kwh)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-500">
                    {rate(avgRate(line))}
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-2 text-right tabular-nums ${
                      line.chf != null && line.chf < 0 ? "text-red-700" : "text-slate-900"
                    }`}
                  >
                    {line.chf == null ? "—" : chf(line.chf)}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-t bg-slate-50">
                    <td colSpan={4} className="px-4 py-3">
                      {line.slot ? (
                        <SlotDetail line={line} slots={slots} />
                      ) : (
                        <BreakdownDetail line={line} />
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/**
 * The intervals an average was built from.
 *
 * Only those that contributed: a day is 96 intervals and export happens in
 * perhaps 40 of them, so listing the silent ones would bury the ones that
 * explain the number. The footer repeats the sums so the division that
 * produced the average is visible rather than asserted.
 */
function SlotDetail({ line, slots }: { line: Line; slots: SavingsSlot[] }) {
  const parts = slots
    .map((s) => ({ ts: s.ts, ...line.slot!(s) }))
    .filter((p) => Math.abs(p.kwh) > EPSILON);

  if (parts.length === 0) {
    return <p className="text-xs text-slate-500">No interval contributed to this figure.</p>;
  }

  const sumKwh = parts.reduce((a, p) => a + p.kwh, 0);
  const sumChf = parts.reduce((a, p) => a + p.chf, 0);

  return (
    <div className="max-h-80 overflow-y-auto rounded-md border bg-white">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-white text-slate-500 shadow-[0_1px_0_0_rgb(226,232,240)]">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">Interval</th>
            <th className="px-3 py-1.5 text-right font-medium">kWh</th>
            <th className="px-3 py-1.5 text-right font-medium">CHF/kWh</th>
            <th className="px-3 py-1.5 text-right font-medium">CHF</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p) => (
            <tr key={p.ts} className="border-t">
              <td className="px-3 py-1 text-left tabular-nums text-slate-600">{slotTime(p.ts)}</td>
              <td className="px-3 py-1 text-right tabular-nums text-slate-700">{kwh(p.kwh, 3)}</td>
              <td className="px-3 py-1 text-right tabular-nums text-slate-500">
                {rate(p.rateChfPerKwh)}
              </td>
              <td className="px-3 py-1 text-right tabular-nums text-slate-700">{chf(p.chf, 4)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 bg-slate-50 font-medium text-slate-900">
          <tr>
            <td className="px-3 py-1.5 text-left">{parts.length} intervals</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{kwh(sumKwh, 3)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">
              {rate(avgRate({ kwh: sumKwh, chf: sumChf }))}
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums">{chf(sumChf, 4)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** The per-party split behind a line — detail that isn't per interval. */
function BreakdownDetail({ line }: { line: Line }) {
  const rows = line.breakdown ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No party consumption recorded on this day. Per-party readings arrive with the vZEV import.
      </p>
    );
  }
  return (
    <div className="rounded-md border bg-white">
      <table className="w-full text-xs">
        <thead className="bg-white text-slate-500">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">Party</th>
            <th className="px-3 py-1.5 text-right font-medium">kWh</th>
            <th className="px-3 py-1.5 text-right font-medium">ø CHF/kWh</th>
            <th className="px-3 py-1.5 text-right font-medium">CHF</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              <td className="px-3 py-1 text-left text-slate-700">{r.label}</td>
              <td className="px-3 py-1 text-right tabular-nums text-slate-700">{kwh(r.kwh, 3)}</td>
              <td className="px-3 py-1 text-right tabular-nums text-slate-500">
                {rate(avgRate(r))}
              </td>
              <td className="px-3 py-1 text-right tabular-nums text-slate-700">{chf(r.chf, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every quantity the engine produces, over a range — the view that predates
 * the day blocks above. Kept for tracing a run of days and for the CSV, but
 * folded away: it answers "did this month add up", not "what happened today".
 */
const ENERGY: Array<{ key: keyof DailySavings; label: string; unit: string }> = [
  { key: "producedKwh", label: "Production", unit: "kWh" },
  { key: "directUseKwh", label: "Direct use", unit: "kWh" },
  { key: "exportedKwh", label: "Export (grid)", unit: "kWh" },
  { key: "exportLocalKwh", label: "Export (total)", unit: "kWh" },
  { key: "neighborConsumptionKwh", label: "Party draw", unit: "kWh" },
  { key: "batteryChargeKwh", label: "Battery charge", unit: "kWh" },
  { key: "batteryDischargeKwh", label: "Battery discharge", unit: "kWh" },
  { key: "batteryDischargeConsumedKwh", label: "…of which used", unit: "kWh" },
  { key: "batteryDischargeExportedKwh", label: "…of which exported", unit: "kWh" },
  { key: "purchaseRateChfPerKwh", label: "Purchase rate", unit: "CHF/kWh" },
  { key: "sellRateChfPerKwh", label: "Feed-in rate", unit: "CHF/kWh" },
  { key: "neighborSellRateChfPerKwh", label: "Party rate", unit: "CHF/kWh" },
  { key: "directConsumptionRevenueChf", label: "Direct consumption", unit: "CHF" },
  { key: "directExportRevenueChf", label: "Direct export", unit: "CHF" },
  { key: "batteryDischargeConsumedValueChf", label: "Battery → house", unit: "CHF" },
  { key: "batteryDischargeExportedValueChf", label: "Battery → grid", unit: "CHF" },
  { key: "batteryChargingCostChf", label: "Charging cost", unit: "CHF" },
  { key: "batteryRevenueChf", label: "Battery net", unit: "CHF" },
  { key: "neighborSellRevenueChf", label: "Party sales", unit: "CHF" },
  { key: "selfConsumptionValueChf", label: "Self-consumption value", unit: "CHF" },
  { key: "exportRevenueChf", label: "Export revenue", unit: "CHF" },
  { key: "savingsWithBatteryChf", label: "Total (with battery)", unit: "CHF" },
  { key: "savingsWithoutBatteryChf", label: "Total (no battery)", unit: "CHF" },
  { key: "batteryOnlySavingsChf", label: "Battery-only saving", unit: "CHF" },
];

function fmtCell(v: number | null | undefined, unit: string): string {
  if (v == null) return "—";
  return unit === "kWh" ? v.toFixed(2) : unit === "CHF" ? v.toFixed(3) : v.toFixed(5);
}

function PeriodTable({ siteId }: { siteId: string }) {
  const [from, setFrom] = useState(monthsAgo(1));
  const [to, setTo] = useState(today());
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey: ["savings-detail", siteId, from, to, granularity],
    queryFn: () => api.savings.daily(siteId, from, to, granularity),
    enabled: open,
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);

  function exportCsv() {
    const head = ["period", ...ENERGY.map((c) => `${c.label} (${c.unit})`)];
    const body = rows.map((r) => [
      r.date,
      ...ENERGY.map((c) => {
        const v = r[c.key];
        return typeof v === "number" ? String(v) : "";
      }),
    ]);
    // Semicolon-separated: Excel in a de-CH locale splits on ; and would
    // otherwise put every row in one cell.
    const csv = [head, ...body].map((line) => line.join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `energymanager-detail-${from}_${to}_${granularity}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-lg border bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <span className="text-xs text-slate-400">{open ? "▾" : "▸"}</span>
        Every figure, over a range
        <span className="font-normal text-slate-500">— the full engine output, and the CSV</span>
      </button>

      {open && (
        <div className="space-y-3 border-t p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              From
              <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              To
              <input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Period
              <select
                className="input"
                value={granularity}
                onChange={(e) => setGranularity(e.target.value as Granularity)}
              >
                {(["hourly", "daily", "monthly", "quarterly", "yearly", "overall"] as const).map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Export CSV
            </button>
            <span className="text-xs text-slate-500">{rows.length} periods</span>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="sticky left-0 bg-slate-100 px-3 py-2 text-left font-medium">Period</th>
                  {ENERGY.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium">
                      {c.label}
                      <span className="block font-normal text-slate-400">{c.unit}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.date} className="border-t">
                    <td className="sticky left-0 bg-white px-3 py-1.5 text-left font-medium text-slate-700">
                      {r.date}
                    </td>
                    {ENERGY.map((c) => (
                      <td key={c.key} className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-700">
                        {fmtCell(r[c.key] as number | null, c.unit)}
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={ENERGY.length + 1} className="px-3 py-6 text-center text-slate-400">
                      Nothing in this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
