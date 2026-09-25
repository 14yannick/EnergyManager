import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useElementWidth } from "../lib/useElementWidth";
import type { Granularity } from "../lib/periods";
import { useT } from "../i18n/context";
import { InfoTip } from "./InfoTip";
import { NAME_KEY, kwhFormatter, linksOf, nodeTotals, pct, totalsOf, type Hover, type NodeId } from "./flowModel";
import { SankeyFlow } from "./SankeyFlow";
import { RadialFlow, radialHeightFor, type RadialLink, type RingId } from "./RadialFlow";

/**
 * Where the range's energy went, drawn twice from the same flows: a radial
 * map in the style of a home-energy panel, which says where at a glance,
 * beside a Sankey, whose ribbon widths say how much. The flows themselves
 * live in flowModel.ts; this owns the data and the one hover both drawings
 * report into, so pointing at a flow in either lights it in both.
 */

type Pane = "radial" | "sankey";

export function EnergyFlowChart({
  siteId,
  from,
  to,
  granularity,
}: {
  siteId: string;
  from: string;
  to: string;
  granularity: Granularity;
}) {
  const t = useT();
  const radial = useElementWidth();
  const sankey = useElementWidth();
  const [hover, setHover] = useState<(Hover & { pane: Pane }) | null>(null);

  // The rows the revenue chart draws its bars from, under the same key, so
  // the two can never disagree and react-query serves the second subscriber
  // from the first one's fetch.
  const query = useQuery({
    queryKey: ["savings-revenue", siteId, from, to, granularity],
    queryFn: () => api.savings.daily(siteId, from, to, granularity),
  });

  const links = useMemo(() => linksOf(totalsOf(query.data ?? [])), [query.data]);
  const totals = useMemo(() => nodeTotals(links), [links]);
  const fmt = useMemo(() => kwhFormatter(), []);
  const name = useCallback((id: NodeId) => t(NAME_KEY[id]), [t]);
  const ringNames = {
    sun: name("sun"),
    grid: t("flow.grid"),
    house: name("house"),
    battery: name("battery"),
    vzev: name("vzev"),
  };

  // The same flows, as the radial draws them, in the same order — so the
  // hover index it reports is the Sankey's too.
  const radialLinks: RadialLink[] = links.map((l) => ({ source: l.source, target: l.target, value: l.kwh, color: l.color }));
  const kwhOf = (id: NodeId, side: "inKwh" | "outKwh") => totals.get(id)?.[side] ?? 0;
  /** Two figures for the grid and the battery, one total for the rest. */
  const ringFigures = (ring: RingId): string[] => {
    switch (ring) {
      case "grid":
        return [`← ${fmt(kwhOf("gridExport", "inKwh"))}`, `→ ${fmt(kwhOf("gridImport", "outKwh"))}`];
      case "battery":
        return [`↓ ${fmt(kwhOf("battery", "inKwh"))}`, `↑ ${fmt(kwhOf("battery", "outKwh"))}`];
      case "sun":
        return [`${fmt(kwhOf("sun", "outKwh"))} kWh`];
      default:
        return [`${fmt(kwhOf(ring, "inKwh"))} kWh`];
    }
  };

  const onHover = (pane: Pane) => (index: number, e: MouseEvent<SVGElement>) => {
    const r = (pane === "radial" ? radial : sankey).element?.getBoundingClientRect();
    if (!r) return;
    setHover({ pane, index, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const onLeave = () => setHover(null);
  const hovered = hover ? (links[hover.index] ?? null) : null;
  const ariaLabel = links.map((l) => `${name(l.source)} → ${name(l.target)}: ${fmt(l.kwh)} kWh`).join("; ");

  /** The flow under the pointer, beside whichever drawing it is over. */
  const tooltip = (pane: Pane, width: number) =>
    hovered &&
    hover &&
    hover.pane === pane && (
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
        <p className="mt-0.5 tabular-nums text-slate-900">{fmt(hovered.kwh)} kWh</p>
        {(
          [
            [hovered.source, totals.get(hovered.source)?.outKwh ?? 0],
            [hovered.target, totals.get(hovered.target)?.inKwh ?? 0],
          ] as const
        ).map(([id, whole]) => {
          const share = pct(hovered.kwh, whole);
          return share == null ? null : (
            <p key={id} className="text-slate-500">
              {t("flow.share", { node: name(id), pct: share })}
            </p>
          );
        })}
      </div>
    );

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-slate-700">
        {t("dash.energyFlow")}
        <InfoTip text={t("dash.energyFlowNote")} />
      </h2>
      {links.length === 0 ? (
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-slate-500">{query.isLoading ? t("common.loading") : t("flow.noData")}</p>
        </div>
      ) : (
        // Side by side once there is room for both to be read: at a glance
        // on the left, to the kWh on the right. The Sankey takes the
        // radial's height so the two cards sit level.
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="rounded-lg border bg-white p-4">
            <h3 className="mb-2 text-sm font-medium text-slate-900">{t("flow.view.radial")}</h3>
            <div ref={radial.ref} className="relative w-full">
              {radial.width > 0 && (
                <RadialFlow
                  links={radialLinks}
                  width={radial.width}
                  names={ringNames}
                  format={fmt}
                  ringFigures={ringFigures}
                  hoverIndex={hover?.index ?? null}
                  onHover={onHover("radial")}
                  onLeave={onLeave}
                  ariaLabel={ariaLabel}
                />
              )}
              {tooltip("radial", radial.width)}
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4">
            <h3 className="mb-2 text-sm font-medium text-slate-900">{t("flow.view.sankey")}</h3>
            <div ref={sankey.ref} className="relative w-full">
              {sankey.width > 0 && (
                <SankeyFlow
                  links={links}
                  width={sankey.width}
                  height={radialHeightFor(sankey.width)}
                  name={name}
                  fmt={fmt}
                  hoverIndex={hover?.index ?? null}
                  onHover={onHover("sankey")}
                  onLeave={onLeave}
                  ariaLabel={ariaLabel}
                />
              )}
              {tooltip("sankey", sankey.width)}
            </div>
          </div>
          <table className="sr-only">
            <caption>{t("flow.table")}</caption>
            <tbody>
              {links.map((l) => (
                <tr key={`${l.source}-${l.target}-row`}>
                  <td>{name(l.source)}</td>
                  <td>{name(l.target)}</td>
                  <td>{fmt(l.kwh)} kWh</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
