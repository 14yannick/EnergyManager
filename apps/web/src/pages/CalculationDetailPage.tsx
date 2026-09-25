import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  DailySavings,
  SavingsDayDetail,
  SavingsQuery,
  SavingsSlot,
} from "@energy-manager/shared";
import { api } from "../api/client";
import { formatNumber } from "../lib/format";
import { useI18n, useT, type MessageKey } from "../i18n/context";
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
function dayLabel(iso: string, tag: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(tag, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
function slotTime(ts: string, tag: string): string {
  return new Date(ts).toLocaleTimeString(tag, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Zurich",
  });
}

const kwh = (v: number, digits = 2) => formatNumber(v, digits);
const chf = (v: number, digits = 2) => formatNumber(v, digits);
const rate = (v: number | null) => (v == null ? "—" : formatNumber(v, 5));

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
  label: MessageKey;
  note?: MessageKey;
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
  const { t, tag } = useI18n();
  const [date, setDate] = useState(today);

  const dayQuery = useQuery({
    queryKey: ["savings-day", site?.id, date],
    queryFn: () => api.savings.day(site!.id, date),
    enabled: !!site,
  });

  if (!site) return <p className="text-slate-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t("calc.title")}</h1>
        <p className="max-w-3xl text-sm text-slate-500">{t("calc.intro")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3">
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          <button
            onClick={() => setDate(shiftDay(date, -1))}
            className="px-3 py-1.5 text-slate-600 hover:bg-slate-50"
            aria-label={t("calc.prevDay")}
          >
            ‹
          </button>
          <button
            onClick={() => setDate(shiftDay(date, 1))}
            className="border-l border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50"
            aria-label={t("calc.nextDay")}
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
        <span className="text-sm font-medium text-slate-900">{dayLabel(date, tag)}</span>
        {date !== today() && (
          <button
            onClick={() => setDate(today())}
            className="text-xs text-slate-400 hover:text-slate-900"
          >
            {t("common.today")}
          </button>
        )}
        {dayQuery.isFetching && <span className="text-xs text-slate-400">{t("common.loading")}</span>}
      </div>

      {dayQuery.isError && (
        <p className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4 text-sm text-red-800 dark:text-red-200">
          {(dayQuery.error as Error).message}
        </p>
      )}

      {dayQuery.data && <DayBlocks day={dayQuery.data} />}

      <PeriodTable siteId={site.id} />
    </div>
  );
}

function DayBlocks({ day }: { day: SavingsDayDetail }) {
  const t = useT();
  const totals = day.totals;

  const solar = useMemo<Line[]>(() => {
    if (!totals) return [];
    return [
      {
        key: "produced",
        label: "calc.production",
        note: "calc.productionNote",
        kwh: totals.producedKwh,
        chf: null,
      },
      {
        key: "direct",
        label: "calc.directUse",
        note: "calc.directUseNote",
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
        label: "calc.partyDraw",
        note: "calc.partyDrawNote",
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
        // The mirror of the battery's "export forgone": these kWh were sold to
        // participants instead of the grid, so the feed-in the grid would have
        // paid is what the sale had to beat. Shown, never summed — the sale
        // above is the revenue, and the export row below already excludes
        // these kWh.
        key: "party-forgone",
        label: "calc.partyForgone",
        note: "calc.partyForgoneNote",
        kwh: totals.neighborConsumptionKwh,
        chf: -totals.neighborExportForgoneChf,
        slot: (s) => ({
          kwh: s.neighborConsumptionKwh,
          chf: -s.neighborExportForgoneChf,
          rateChfPerKwh: s.sellRateChfPerKwh,
        }),
      },
      {
        key: "export",
        label: "calc.exportGrid",
        note: "calc.exportGridNote",
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
        label: "calc.charged",
        note: "calc.chargedNote",
        kwh: totals.batteryChargeKwh,
        chf: null,
      },
      {
        key: "forgone",
        label: "calc.forgone",
        note: "calc.forgoneNote",
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
        label: "calc.toHouse",
        note: "calc.toHouseNote",
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
        label: "calc.toGrid",
        note: "calc.toGridNote",
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
        label: "calc.net",
        note: "calc.netNote",
        kwh: null,
        chf: totals.batteryRevenueChf,
        emphasis: true,
      },
    ];
  }, [totals, day.slots]);

  if (!totals) {
    return (
      <p className="rounded-lg border bg-white p-6 text-center text-sm text-slate-400">
        {t("calc.nothingToday")}
      </p>
    );
  }

  // `items-start`: the two cards hold different numbers of flows, and
  // stretching the shorter one to match left a band of empty card under its
  // last row that read as a missing figure.
  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <Block title="calc.solar" subtitle="calc.solarSub" lines={solar} slots={day.slots} />
      <Block title="calc.battery" subtitle="calc.batterySub" lines={battery} slots={day.slots} />
    </div>
  );
}

function Block({
  title,
  subtitle,
  lines,
  slots,
}: {
  title: MessageKey;
  subtitle: MessageKey;
  lines: Line[];
  slots: SavingsSlot[];
}) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="rounded-lg border bg-white">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-medium text-slate-700">{t(title)}</h2>
        <p className="text-xs text-slate-500">{t(subtitle)}</p>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2 text-left font-medium">{t("calc.flow")}</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-medium">kWh</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-medium">{t("calc.avgRate")}</th>
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
                      {t(line.label)}
                    </span>
                    {/* Hidden on a phone: squeezed into the width left over
                        by four numeric columns the prose wrapped one word to a
                        line and pushed the figures off the screen. It is the
                        figures somebody checks on a phone; the explanation is
                        there on any wider screen. */}
                    {line.note && (
                      <span className="hidden pl-[1.125rem] text-xs text-slate-500 sm:block">
                        {t(line.note)}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700">
                    {line.kwh == null ? "—" : kwh(line.kwh)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-500">
                    {rate(avgRate(line))}
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-2 text-right tabular-nums ${
                      line.chf != null && line.chf < 0 ? "text-red-700 dark:text-red-300" : "text-slate-900"
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
      </div>
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
  const { t, tag } = useI18n();
  const parts = slots
    .map((s) => ({ ts: s.ts, ...line.slot!(s) }))
    .filter((p) => Math.abs(p.kwh) > EPSILON);

  if (parts.length === 0) {
    return <p className="text-xs text-slate-500">{t("calc.noInterval")}</p>;
  }

  const sumKwh = parts.reduce((a, p) => a + p.kwh, 0);
  const sumChf = parts.reduce((a, p) => a + p.chf, 0);

  return (
    <div className="max-h-80 overflow-y-auto rounded-md border bg-white">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-white text-slate-500 shadow-[0_1px_0_0_rgb(226,232,240)]">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">{t("calc.interval")}</th>
            <th className="px-3 py-1.5 text-right font-medium">kWh</th>
            <th className="px-3 py-1.5 text-right font-medium">CHF/kWh</th>
            <th className="px-3 py-1.5 text-right font-medium">CHF</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p) => (
            <tr key={p.ts} className="border-t">
              <td className="px-3 py-1 text-left tabular-nums text-slate-600">{slotTime(p.ts, tag)}</td>
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
            <td className="px-3 py-1.5 text-left">{t("calc.intervalCount", { count: parts.length })}</td>
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
  const t = useT();
  const rows = line.breakdown ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-xs text-slate-500">{t("calc.noParties")}</p>
    );
  }
  return (
    <div className="rounded-md border bg-white">
      <table className="w-full text-xs">
        <thead className="bg-white text-slate-500">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">{t("calc.party")}</th>
            <th className="px-3 py-1.5 text-right font-medium">kWh</th>
            <th className="px-3 py-1.5 text-right font-medium">{t("calc.avgRate")}</th>
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
const ENERGY: Array<{ key: keyof DailySavings; label: MessageKey; unit: string }> = [
  { key: "producedKwh", label: "calc.col.production", unit: "kWh" },
  { key: "directUseKwh", label: "calc.col.directUse", unit: "kWh" },
  { key: "exportedKwh", label: "calc.col.exportGrid", unit: "kWh" },
  { key: "exportLocalKwh", label: "calc.col.exportTotal", unit: "kWh" },
  { key: "neighborConsumptionKwh", label: "calc.col.partyDraw", unit: "kWh" },
  { key: "batteryChargeKwh", label: "calc.col.batteryCharge", unit: "kWh" },
  { key: "batteryDischargeKwh", label: "calc.col.batteryDischarge", unit: "kWh" },
  { key: "batteryDischargeConsumedKwh", label: "calc.col.ofWhichUsed", unit: "kWh" },
  { key: "batteryDischargeExportedKwh", label: "calc.col.ofWhichExported", unit: "kWh" },
  { key: "purchaseRateChfPerKwh", label: "calc.col.purchaseRate", unit: "CHF/kWh" },
  { key: "sellRateChfPerKwh", label: "calc.col.feedInRate", unit: "CHF/kWh" },
  { key: "neighborSellRateChfPerKwh", label: "calc.col.partyRate", unit: "CHF/kWh" },
  { key: "directConsumptionRevenueChf", label: "calc.col.directConsumption", unit: "CHF" },
  { key: "directExportRevenueChf", label: "calc.col.directExport", unit: "CHF" },
  { key: "batteryDischargeConsumedValueChf", label: "calc.col.batteryToHouse", unit: "CHF" },
  { key: "batteryDischargeExportedValueChf", label: "calc.col.batteryToGrid", unit: "CHF" },
  { key: "batteryChargingCostChf", label: "calc.col.chargingCost", unit: "CHF" },
  { key: "batteryRevenueChf", label: "calc.col.batteryNet", unit: "CHF" },
  { key: "neighborSellRevenueChf", label: "calc.col.partySales", unit: "CHF" },
  // Part of both totals, so it needs its own column for them to add up.
  { key: "rcpFixedAdvantageChf", label: "calc.col.rcpFixed", unit: "CHF" },
  { key: "selfConsumptionValueChf", label: "calc.col.selfConsumption", unit: "CHF" },
  { key: "exportRevenueChf", label: "calc.col.exportRevenue", unit: "CHF" },
  { key: "savingsWithBatteryChf", label: "calc.col.totalWithBattery", unit: "CHF" },
  { key: "savingsWithoutBatteryChf", label: "calc.col.totalWithoutBattery", unit: "CHF" },
  { key: "batteryOnlySavingsChf", label: "calc.col.batteryOnly", unit: "CHF" },
];

function fmtCell(v: number | null | undefined, unit: string): string {
  if (v == null) return "—";
  return unit === "kWh" ? formatNumber(v, 2) : unit === "CHF" ? formatNumber(v, 3) : formatNumber(v, 5);
}

function PeriodTable({ siteId }: { siteId: string }) {
  const t = useT();
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
    const head = [t("common.period"), ...ENERGY.map((c) => `${t(c.label)} (${c.unit})`)];
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
        {t("calc.rangeTable")}
        <span className="font-normal text-slate-500">{t("calc.rangeTableSub")}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              {t("common.from")}
              <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              {t("common.to")}
              <input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              {t("common.period")}
              <select
                className="input"
                value={granularity}
                onChange={(e) => setGranularity(e.target.value as Granularity)}
              >
                {(["hourly", "daily", "monthly", "quarterly", "yearly", "overall"] as const).map((g) => (
                  <option key={g} value={g}>
                    {t(`calc.g.${g}`)}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="btn-primary px-4 py-2 text-sm"
            >
              {t("calc.exportCsv")}
            </button>
            <span className="text-xs text-slate-500">
              {t("calc.periodCount", { count: rows.length })}
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="sticky left-0 bg-slate-100 px-3 py-2 text-left font-medium">
                    {t("common.period")}
                  </th>
                  {ENERGY.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium">
                      {t(c.label)}
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
                      {t("common.nothingInRange")}
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
