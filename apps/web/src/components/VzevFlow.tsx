import { useId, useState, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { allocateVzevPower, type VzevLiveView } from "@energy-manager/shared";
import { api } from "../api/client";
import { PALETTE } from "../lib/palette";
import { formatKwhAuto, formatNumber } from "../lib/format";
import { useElementWidth } from "../lib/useElementWidth";
import { useT } from "../i18n/context";
import { InfoTip } from "./InfoTip";
import { HALO } from "./flowModel";
import { usePrefersReducedMotion } from "./RadialFlow";

/**
 * The vZEV right now, as a participant sees it.
 *
 * The producer's own picture (LiveFlow) is of a house: panels, battery,
 * load. None of that is a participant's concern. Theirs is the energy that
 * reaches the vZEV and where it goes — so the plants appear as what they
 * make and what they keep, summed over however many there are, the feed-in
 * stands in the middle, and below it the three places it can go: the
 * viewer, the other participants, the grid. The grid sits between the two
 * consumers because it also supplies what the feed-in does not cover. A
 * producer has a "you" ring as well: their meter draws like anyone's.
 *
 * Connectors carry the instant's watts, live from Home Assistant; rings
 * carry the day's kWh so far, from the readings. Who received which watt is
 * not something a meter says: the feed-in is shared in proportion to the
 * draw, as the vZEV is settled (see allocateVzevPower).
 */

type RingId = "sun" | "owners" | "vzev" | "you" | "grid" | "others";
type LinkId = "sunToOwners" | "sunToVzev" | "vzevToYou" | "vzevToOthers" | "vzevToGrid" | "gridToYou" | "gridToOthers";

const RING_COLOR: Record<RingId, string> = {
  sun: PALETTE.sun,
  owners: PALETTE.house,
  vzev: PALETTE.local,
  you: PALETTE.house,
  grid: PALETTE.grid,
  others: PALETTE.axis,
};
/** Each flow in the colour of the energy it carries: the sun's, the vZEV's own, the grid's. */
const LINKS: Array<{ id: LinkId; source: RingId; target: RingId; color: string }> = [
  { id: "sunToOwners", source: "sun", target: "owners", color: PALETTE.sun },
  { id: "sunToVzev", source: "sun", target: "vzev", color: PALETTE.local },
  { id: "vzevToYou", source: "vzev", target: "you", color: PALETTE.local },
  { id: "vzevToOthers", source: "vzev", target: "others", color: PALETTE.local },
  { id: "vzevToGrid", source: "vzev", target: "grid", color: PALETTE.grid },
  { id: "gridToYou", source: "grid", target: "you", color: PALETTE.grid },
  { id: "gridToOthers", source: "grid", target: "others", color: PALETTE.grid },
];

/** Below this a connector is meter noise: a few watts drift across zero all night. */
const MIN_W = 5;
const REFRESH_MS = 60 * 1000;
const STROKE_MIN = 2;
const STROKE_MAX = 7;
const TRIP_FASTEST_S = 1.6;
const TRIP_SLOWEST_S = 14;
const DOT_R = 4;
const RING = 3;
const MAX_WIDTH = 620;

const fmtW = (w: number) => (w >= 1000 ? `${formatNumber(w / 1000, 1)} kW` : `${formatNumber(w, 0)} W`);

/** The frame: desktop proportions, or as wide as a phone allows with the text kept at size. */
function frameFor(width: number) {
  const wide = width >= 560;
  const W = wide ? 560 : Math.max(width, 320);
  const H = wide ? 460 : 420;
  const R = wide ? 44 : 40;
  // On a phone the outer rings sit as far out as they can: the two figures
  // beside the grid ring need the gap between rings, and it is narrow.
  const edge = wide ? 96 : 46;
  return { W, H, R, wide, BEND: wide ? 40 : 28, left: edge, right: W - edge, top: wide ? 72 : 66, bottom: H - (wide ? 72 : 66), cx: W / 2, cy: H / 2 };
}
type Frame = ReturnType<typeof frameFor>;

const centerOf = (f: Frame): Record<RingId, { x: number; y: number }> => ({
  sun: { x: f.left, y: f.top },
  owners: { x: f.right, y: f.top },
  vzev: { x: f.cx, y: f.cy },
  you: { x: f.left, y: f.bottom },
  grid: { x: f.cx, y: f.bottom },
  others: { x: f.right, y: f.bottom },
});

interface Connector {
  d: string;
  label: { x: number; y: number; anchor: "start" | "middle" | "end" };
}

/** Each flow's path, from its source ring's edge to its target's, so a dot following it moves the way the energy does. */
function connector(f: Frame, id: LinkId): Connector {
  const { R, BEND } = f;
  const c = centerOf(f);
  /** A straight run between two rings, edge to edge, with its figure beside the midpoint. */
  const straight = (a: RingId, b: RingId, side: -1 | 1): Connector => {
    const dx = c[b].x - c[a].x;
    const dy = c[b].y - c[a].y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const x1 = c[a].x + ux * R;
    const y1 = c[a].y + uy * R;
    const x2 = c[b].x - ux * R;
    const y2 = c[b].y - uy * R;
    return {
      d: `M${x1},${y1} L${x2},${y2}`,
      label: { x: (x1 + x2) / 2 + side * 9, y: (y1 + y2) / 2 + 4, anchor: side > 0 ? "start" : "end" },
    };
  };
  switch (id) {
    case "sunToOwners":
      return { d: `M${f.left + R},${f.top} H${f.right - R}`, label: { x: f.cx, y: f.top - 8, anchor: "middle" } };
    case "sunToVzev":
      // Down from the sun, round the bend, into the vZEV from its left.
      return {
        d: `M${f.left},${f.top + R} V${f.cy - BEND} Q${f.left},${f.cy} ${f.left + BEND},${f.cy} H${f.cx - R}`,
        label: { x: f.cx - R - 10, y: f.cy - 7, anchor: "end" },
      };
    case "vzevToYou":
      return straight("vzev", "you", -1);
    case "vzevToOthers":
      return straight("vzev", "others", 1);
    case "vzevToGrid":
      return { d: `M${f.cx},${f.cy + R} V${f.bottom - R}`, label: { x: f.cx + 9, y: (f.cy + f.bottom) / 2 + 4, anchor: "start" } };
    case "gridToYou":
      return { d: `M${f.cx - R},${f.bottom} H${f.left + R}`, label: { x: (f.cx + f.left) / 2, y: f.bottom - 8, anchor: "middle" } };
    case "gridToOthers":
      return { d: `M${f.cx + R},${f.bottom} H${f.right - R}`, label: { x: (f.cx + f.right) / 2, y: f.bottom - 8, anchor: "middle" } };
  }
}

/** Feather's outline icons (MIT), on a 24-unit box. */
function RingIcon({ ring, x, y }: { ring: RingId; x: number; y: number }) {
  const size = 22;
  return (
    <g
      transform={`translate(${x - size / 2},${y - size / 2}) scale(${size / 24})`}
      fill="none"
      stroke={RING_COLOR[ring]}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ring === "sun" && (
        <>
          <circle cx={12} cy={12} r={5} />
          <line x1={12} y1={1} x2={12} y2={3} />
          <line x1={12} y1={21} x2={12} y2={23} />
          <line x1={4.22} y1={4.22} x2={5.64} y2={5.64} />
          <line x1={18.36} y1={18.36} x2={19.78} y2={19.78} />
          <line x1={1} y1={12} x2={3} y2={12} />
          <line x1={21} y1={12} x2={23} y2={12} />
          <line x1={4.22} y1={19.78} x2={5.64} y2={18.36} />
          <line x1={18.36} y1={5.64} x2={19.78} y2={4.22} />
        </>
      )}
      {ring === "owners" && (
        <>
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </>
      )}
      {ring === "vzev" && (
        <>
          <circle cx={18} cy={5} r={3} />
          <circle cx={6} cy={12} r={3} />
          <circle cx={18} cy={19} r={3} />
          <line x1={8.59} y1={13.51} x2={15.42} y2={17.49} />
          <line x1={15.41} y1={6.51} x2={8.59} y2={10.49} />
        </>
      )}
      {ring === "you" && (
        <>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx={12} cy={7} r={4} />
        </>
      )}
      {ring === "grid" && <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />}
      {ring === "others" && (
        <>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx={9} cy={7} r={4} />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </>
      )}
    </g>
  );
}

interface Hover {
  id: LinkId;
  x: number;
  y: number;
}

export function VzevFlow({
  siteId,
  partyId,
}: {
  siteId: string | null | undefined;
  /** Whose view to show. A participant's own is implied — the API decides — so they pass none. */
  partyId?: string | null;
}) {
  const t = useT();
  const uid = useId().replace(/:/g, "");
  const reducedMotion = usePrefersReducedMotion();
  const { ref: wrapRef, element: wrapEl, width } = useElementWidth();
  const [hover, setHover] = useState<Hover | null>(null);

  const query = useQuery({
    queryKey: ["vzev-live", siteId, partyId ?? null],
    queryFn: () => api.vzev.live(siteId!, partyId ?? undefined),
    enabled: !!siteId,
    refetchInterval: REFRESH_MS,
    placeholderData: (previous) => previous,
  });
  const view: VzevLiveView | undefined = query.data;
  // The card holds its place while the first answer is on its way, so the
  // day's curve beside it does not jump once it arrives.
  if (!view) {
    return (
      <div className="rounded-lg border bg-white p-4">
        <h3 className="text-sm font-medium text-slate-900">{t("flow.liveTitle")}</h3>
        <p className="mt-2 text-sm text-slate-500">{query.isError ? (query.error as Error).message : t("common.loading")}</p>
      </div>
    );
  }

  // "You" is anybody with a meter in the vZEV — a producer too, who draws
  // from another plant or from the grid like everyone else. Only an admin
  // who named nobody, or somebody who is no member, has no such ring.
  const hasYou = view.viewer?.consumes === true;
  const rings: RingId[] = ["sun", "owners", "vzev", ...(hasYou ? (["you"] as const) : []), "grid", "others"];
  const names: Record<RingId, string> = {
    sun: t("vzevFlow.production"),
    owners: t(view.producerCount > 1 ? "vzevFlow.owners" : "vzevFlow.owner"),
    vzev: t("vzevFlow.feedIn"),
    // A participant looking at their own; an admin looking at somebody's.
    you: partyId ? (view.viewer?.name ?? "") : t("vzevFlow.you"),
    grid: t("flow.grid"),
    others: t("vzevFlow.others"),
  };
  const kwh = (v: number | null) => (v == null ? "—" : `${formatKwhAuto(v)} kWh`);
  const figure: Record<RingId, string | null> = {
    sun: kwh(view.today.producedKwh),
    owners: kwh(view.today.keptKwh),
    vzev: kwh(view.today.feedInKwh),
    you: kwh(view.today.ownKwh),
    grid: null,
    others: kwh(view.today.othersKwh),
  };
  /**
   * How a consumer's day was covered — from the vZEV's own feed-in, and
   * from the grid — settled quarter-hour by quarter-hour on the server.
   * Drawn under the total as two figures, each beside a dot in the colour
   * its energy has on the connectors.
   */
  const split: Partial<Record<RingId, { local: number; grid: number }>> = {
    ...(view.today.ownLocalKwh != null && view.today.ownGridKwh != null
      ? { you: { local: view.today.ownLocalKwh, grid: view.today.ownGridKwh } }
      : {}),
    ...(view.today.othersLocalKwh != null && view.today.othersGridKwh != null
      ? { others: { local: view.today.othersLocalKwh, grid: view.today.othersGridKwh } }
      : {}),
  };
  // The grid's two directions today: what the vZEV sent on to it, and what
  // its members drew from it. The second is only known as far as their
  // consumption is.
  const drawnFromGrid =
    view.today.ownGridKwh == null && view.today.othersGridKwh == null
      ? null
      : (view.today.ownGridKwh ?? 0) + (view.today.othersGridKwh ?? 0);
  const gridLines = [`↓ ${formatKwhAuto(view.today.surplusKwh)}`, `↑ ${drawnFromGrid == null ? "—" : formatKwhAuto(drawnFromGrid)}`];

  const flows = allocateVzevPower(view.power);
  // Where the feed-in goes can only be drawn once somebody's draw is known.
  // With no participant's consumption reported, the sums would send every
  // watt to the grid — a claim the sensors do not make. So the feed-in is
  // shown arriving, and what leaves it is left out until there is a reading.
  const drawKnown = view.power.ownW != null || view.power.othersW != null;
  const links = LINKS.filter((l) => rings.includes(l.source) && rings.includes(l.target))
    .filter((l) => drawKnown || l.source === "sun")
    .map((l) => ({ ...l, value: flows[l.id] }))
    .filter((l) => l.value >= MIN_W);
  const maxValue = Math.max(...links.map((l) => l.value), 0);

  const f = frameFor(width);
  const center = centerOf(f);
  const onHover = (id: LinkId, e: MouseEvent<SVGElement>) => {
    const r = wrapEl?.getBoundingClientRect();
    if (r) setHover({ id, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const hovered = hover ? (links.find((l) => l.id === hover.id) ?? null) : null;
  /** Which of the feed-in's destinations are shares worked out, not metered. */
  const shared = hovered != null && (hovered.id === "vzevToYou" || hovered.id === "vzevToOthers");

  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="text-sm font-medium text-slate-900">
        {t("flow.liveTitle")}
        <InfoTip text={t("vzevFlow.note")} />
      </h3>
      <div ref={wrapRef} className="relative mt-2 w-full">
        {width > 0 && (
          <svg
            viewBox={`0 0 ${f.W} ${f.H}`}
            width="100%"
            role="img"
            aria-label={
              links.length > 0
                ? links.map((l) => `${names[l.source]} → ${names[l.target]}: ${fmtW(l.value)}`).join("; ")
                : t("vzevFlow.idle")
            }
            onMouseLeave={() => setHover(null)}
            className="mx-auto block"
            style={{ maxWidth: MAX_WIDTH }}
          >
            {reducedMotion && (
              <defs>
                {links.map((l) => (
                  <marker key={l.id} id={`${uid}-head-${l.id}`} markerWidth={6} markerHeight={6} refX={5} refY={3} orient="auto" markerUnits="userSpaceOnUse">
                    <path d="M0,0 L6,3 L0,6 z" fill={l.color} />
                  </marker>
                ))}
              </defs>
            )}
            {links.map((l) => {
              const c = connector(f, l.id);
              const share = maxValue > 0 ? l.value / maxValue : 0;
              const stroke = STROKE_MIN + (STROKE_MAX - STROKE_MIN) * share;
              const isHovered = hover?.id === l.id;
              // The largest flow crosses in TRIP_FASTEST_S, one a tenth its size takes ten times as long.
              const trip = Math.min(TRIP_SLOWEST_S, TRIP_FASTEST_S / Math.max(share, 0.01));
              const pathId = `${uid}-path-${l.id}`;
              return (
                <g key={l.id}>
                  <path
                    id={pathId}
                    d={c.d}
                    fill="none"
                    stroke={l.color}
                    strokeWidth={isHovered ? stroke + 2 : stroke}
                    strokeOpacity={hover == null || isHovered ? 0.9 : 0.4}
                    markerEnd={reducedMotion ? `url(#${uid}-head-${l.id})` : undefined}
                    style={{ transition: "stroke-opacity 120ms, stroke-width 120ms" }}
                  />
                  {!reducedMotion && (
                    <circle r={DOT_R} fill={l.color} stroke={PALETTE.surface} strokeWidth={1.5}>
                      <animateMotion dur={`${trip.toFixed(1)}s`} repeatCount="indefinite" rotate="auto">
                        <mpath href={`#${pathId}`} />
                      </animateMotion>
                    </circle>
                  )}
                  {/* A wide invisible twin: the connector itself is too thin to hover. */}
                  <path
                    d={c.d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    onMouseEnter={(e) => onHover(l.id, e)}
                    onMouseMove={(e) => onHover(l.id, e)}
                    onMouseLeave={() => setHover(null)}
                  />
                </g>
              );
            })}
            {links.map((l) => {
              const c = connector(f, l.id);
              return (
                <text
                  key={`figure-${l.id}`}
                  x={c.label.x}
                  y={c.label.y}
                  textAnchor={c.label.anchor}
                  fontSize={11}
                  fill={PALETTE.ink}
                  style={HALO}
                  className="pointer-events-none tabular-nums"
                >
                  {fmtW(l.value)}
                </text>
              );
            })}
            {rings.map((ring) => {
              const { x, y } = center[ring];
              const value = figure[ring];
              // The top row and the hub are named above, the bottom row below — clear of the connectors.
              const nameAbove = ring === "sun" || ring === "owners" || ring === "vzev";
              return (
                <g key={ring} className="pointer-events-none">
                  <circle cx={x} cy={y} r={f.R} fill={PALETTE.surface} stroke={RING_COLOR[ring]} strokeWidth={RING} />
                  {ring === "grid" ? (
                    <>
                      <RingIcon ring={ring} x={x} y={y - 18} />
                      <text x={x} textAnchor="middle" fontSize={11} fill={PALETTE.ink} className="tabular-nums">
                        <tspan y={y + 9}>{gridLines[0]}</tspan>
                        <tspan x={x} y={y + 23}>
                          {gridLines[1]}
                        </tspan>
                      </text>
                    </>
                  ) : split[ring] ? (
                    <>
                      <RingIcon ring={ring} x={x} y={y - 24} />
                      <text x={x} y={y + 1} textAnchor="middle" fontSize={12} fontWeight={600} fill={PALETTE.ink} className="tabular-nums">
                        {value}
                      </text>
                      {/* The dot carries which energy it is; the figure stays in ink. */}
                      {(
                        [
                          [PALETTE.local, split[ring]!.local, y + 15],
                          [PALETTE.grid, split[ring]!.grid, y + 28],
                        ] as const
                      ).map(([color, kwhValue, lineY]) => (
                        <g key={color}>
                          <circle cx={x - 14} cy={lineY - 3.5} r={3} fill={color} />
                          <text x={x - 7} y={lineY} textAnchor="start" fontSize={10.5} fill={PALETTE.ink} className="tabular-nums">
                            {formatKwhAuto(kwhValue)}
                          </text>
                        </g>
                      ))}
                    </>
                  ) : (
                    <>
                      <RingIcon ring={ring} x={x} y={value == null ? y : y - 13} />
                      {value != null && (
                        <text x={x} y={y + 18} textAnchor="middle" fontSize={12} fontWeight={600} fill={PALETTE.ink} className="tabular-nums">
                          {value}
                        </text>
                      )}
                    </>
                  )}
                  <text
                    // Centred on its ring where there is room. On a phone the
                    // outer rings touch the frame's edge, so their names start
                    // or end at the ring's own edge instead of running off it.
                    x={f.wide || x === f.cx ? x : x < f.cx ? x - f.R : x + f.R}
                    y={nameAbove ? y - f.R - 10 : y + f.R + 17}
                    textAnchor={f.wide || x === f.cx ? "middle" : x < f.cx ? "start" : "end"}
                    fontSize={12}
                    fontWeight={500}
                    fill={PALETTE.axis}
                    style={HALO}
                  >
                    {names[ring]}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {/* Said out loud rather than left to be assumed: with nobody else's
            draw reported, the surplus is drawn as all of it reaching the
            grid — an upper bound, not a measurement. */}
        {drawKnown && view.power.othersW == null && flows.vzevToGrid >= MIN_W && (
          <p className="mt-1 text-xs text-slate-500">{t("vzevFlow.othersUnknown")}</p>
        )}
        {hovered && hover && (
          <div
            className="pointer-events-none absolute z-10 max-w-64 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
            style={{ top: hover.y + 14, ...(hover.x < width / 2 ? { left: hover.x + 14 } : { right: width - hover.x + 14 }) }}
          >
            <p className="font-medium text-slate-900">
              {names[hovered.source]} → {names[hovered.target]}
            </p>
            <p className="mt-0.5 tabular-nums text-slate-900">{fmtW(hovered.value)}</p>
            {shared && <p className="text-slate-500">{t("vzevFlow.sharedNote")}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
