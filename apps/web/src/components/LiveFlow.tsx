import { useMemo, useState, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { allocateLivePower, type LiveEnergyView } from "@energy-manager/shared";
import { api } from "../api/client";
import { PALETTE } from "../lib/palette";
import { formatNumber } from "../lib/format";
import { useElementWidth } from "../lib/useElementWidth";
import { useT } from "../i18n/context";
import { InfoTip } from "./InfoTip";
import { NAME_KEY, kwhFormatter, linksOf, nodeTotals, pct, totalsOf, type Hover, type NodeId } from "./flowModel";
import { RadialFlow, type RadialLink, type RingId } from "./RadialFlow";

/**
 * The house right now, in the radial's shape: connectors carry the power
 * flowing at this instant, live from Home Assistant, and the rings carry
 * what has flowed so far today, from the readings — with the battery's
 * state of charge in its ring. The two are different data on purpose: the
 * question at a glance is "where is the power going", and the ring answers
 * "and how much has, today".
 *
 * Who fed whom is not something the meters say (see allocateLivePower in
 * the shared package); the readings' side is the same flow model the range
 * views use, applied to one day.
 */

/** Below this a connector is meter noise: a few watts drift across zero all night. */
const MIN_W = 5;
const REFRESH_TODAY_MS = 5 * 60 * 1000;

const fmtW = (w: number) => (w >= 1000 ? `${formatNumber(w / 1000, 1)} kW` : `${formatNumber(w, 0)} W`);

/** Whether there is a live power reading to draw at all. */
export function hasLiveFlow(live: LiveEnergyView): boolean {
  return live.configured && (live.pvW != null || live.exportW != null || live.batteryChargeW != null || live.loadW != null);
}

export function LiveFlow({ siteId, live }: { siteId: string | null | undefined; live: LiveEnergyView }) {
  const t = useT();
  const { ref: wrapRef, element: wrapEl, width } = useElementWidth();
  const [hover, setHover] = useState<Hover | null>(null);

  // Today's rows, as the revenue chart would fetch them for a one-day range
  // — the store lags the inverter by a sync interval, so the rings are
  // "so far" rather than "to the minute".
  const day = live.today?.day;
  const todayQuery = useQuery({
    queryKey: ["savings-revenue", siteId, day, day, "daily"],
    queryFn: () => api.savings.daily(siteId!, day!, day!, "daily"),
    enabled: !!siteId && !!day,
    refetchInterval: REFRESH_TODAY_MS,
  });
  const today = useMemo(() => nodeTotals(linksOf(totalsOf(todayQuery.data ?? []))), [todayQuery.data]);
  const kwh = useMemo(() => kwhFormatter(), []);
  const name = (id: NodeId) => t(NAME_KEY[id]);
  const todayOf = (id: NodeId, side: "inKwh" | "outKwh") => today.get(id)?.[side] ?? 0;

  const flows = allocateLivePower(live);
  const links: RadialLink[] = (
    [
      { source: "gridImport", target: "house", value: flows.gridToHouse, color: PALETTE.grid },
      { source: "gridImport", target: "battery", value: flows.gridToBattery, color: PALETTE.grid },
      { source: "sun", target: "house", value: flows.sunToHouse, color: PALETTE.sun },
      { source: "sun", target: "battery", value: flows.sunToBattery, color: PALETTE.battery },
      { source: "battery", target: "house", value: flows.batteryToHouse, color: PALETTE.battery },
      { source: "battery", target: "gridExport", value: flows.batteryToGrid, color: PALETTE.battery },
      { source: "sun", target: "gridExport", value: flows.sunToGrid, color: PALETTE.grid },
    ] as RadialLink[]
  ).filter((l) => l.value >= MIN_W);

  // The rings stand whether or not anything flows through them right now:
  // the sun at night still made today's kWh. The battery and the
  // participants only once there is something to say about them.
  const hasBattery = live.batteryChargeW != null || todayOf("battery", "inKwh") > 0 || todayOf("battery", "outKwh") > 0;
  const rings: RingId[] = ["sun", "grid", "house", ...(hasBattery ? (["battery"] as const) : []), ...(todayOf("vzev", "inKwh") > 0 ? (["vzev"] as const) : [])];
  const ringFigures = (ring: RingId): string[] => {
    switch (ring) {
      case "sun":
        return [`${kwh(todayOf("sun", "outKwh"))} kWh`];
      case "house":
        return [`${kwh(todayOf("house", "inKwh"))} kWh`];
      case "battery":
        return [
          ...(live.batterySocPct != null ? [`${Math.round(live.batterySocPct)} %`] : []),
          `↓ ${kwh(todayOf("battery", "inKwh"))}`,
          `↑ ${kwh(todayOf("battery", "outKwh"))}`,
        ];
      case "grid":
        return [`← ${kwh(todayOf("gridExport", "inKwh"))}`, `→ ${kwh(todayOf("gridImport", "outKwh"))}`];
      case "vzev":
        return [`${kwh(todayOf("vzev", "inKwh"))} kWh`];
    }
  };
  const ringNames = { sun: name("sun"), grid: t("flow.grid"), house: name("house"), battery: name("battery"), vzev: name("vzev") };

  const onHover = (index: number, e: MouseEvent<SVGElement>) => {
    const r = wrapEl?.getBoundingClientRect();
    if (!r) return;
    setHover({ index, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const hovered = hover ? (links[hover.index] ?? null) : null;
  const houseShare = hovered?.target === "house" ? pct(hovered.value, flows.houseW) : null;

  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="text-sm font-medium text-slate-900">
        {t("flow.liveTitle")}
        <InfoTip text={t("flow.liveNote")} />
      </h3>
      <div ref={wrapRef} className="relative mt-2 w-full">
        {width > 0 && (
          <RadialFlow
            links={links}
            width={width}
            names={ringNames}
            format={fmtW}
            ringFigures={ringFigures}
            rings={rings}
            hoverIndex={hover?.index ?? null}
            onHover={onHover}
            onLeave={() => setHover(null)}
            ariaLabel={links.map((l) => `${name(l.source)} → ${name(l.target)}: ${fmtW(l.value)}`).join("; ")}
          />
        )}
        {hovered && hover && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
            style={{
              top: hover.y + 14,
              ...(hover.x < width / 2 ? { left: hover.x + 14 } : { right: width - hover.x + 14 }),
            }}
          >
            <p className="font-medium text-slate-900">
              {name(hovered.source)} → {name(hovered.target)}
            </p>
            <p className="mt-0.5 tabular-nums text-slate-900">{fmtW(hovered.value)}</p>
            {houseShare != null && (
              <p className="text-slate-500">{t("flow.ofHouse", { pct: houseShare, load: fmtW(flows.houseW) })}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
