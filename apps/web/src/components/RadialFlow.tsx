import { useEffect, useId, useState, type MouseEvent } from "react";
import { PALETTE } from "../lib/palette";
import { HALO, NODE_COLOR, type NodeId } from "./flowModel";

/**
 * Flows drawn the way a home-energy panel draws them: a ring per entity,
 * connectors between them, and a dot travelling each connector in the
 * direction the energy goes — faster the more of it there is. Two callers:
 * the range's kWh (EnergyFlowChart, where the Sankey says how much and this
 * says where) and the instant's watts (LiveFlow). The unit is the caller's;
 * this only draws values, so the rings' figures come from the caller too.
 */

/** The rings. Grid import and export are one ring with two figures. */
export type RingId = "sun" | "grid" | "house" | "battery" | "vzev";

/** A flow to draw, in whatever unit the caller formats. */
export interface RadialLink {
  source: NodeId;
  target: NodeId;
  value: number;
  color: string;
}
const RING_OF: Record<NodeId, RingId> = {
  sun: "sun",
  gridImport: "grid",
  gridExport: "grid",
  house: "house",
  battery: "battery",
  vzev: "vzev",
};
const RING_COLOR: Record<RingId, string> = {
  sun: NODE_COLOR.sun,
  grid: NODE_COLOR.gridExport,
  house: NODE_COLOR.house,
  battery: NODE_COLOR.battery,
  vzev: NODE_COLOR.vzev,
};

/**
 * The drawing's frame. Desktop gets the panel's own proportions; below that
 * the frame is as wide as the space it has and its rings and lanes shrink
 * a little, so the text keeps its size on screen instead of scaling down
 * with the geometry until a phone cannot read it.
 */
interface Frame {
  W: number;
  H: number;
  /** Ring radius. */
  R: number;
  /** Distance of a ring's centre from the frame's edge. */
  EDGE: number;
  /** Distance of the paired connectors from the centre lines they flank. */
  LANE: number;
  /** The corner a connector turns through. */
  BEND: number;
  CX: number;
  CY: number;
}
const WIDE_FROM = 560;
function frameFor(width: number): Frame {
  const wide = width >= WIDE_FROM;
  const W = wide ? 560 : Math.max(width, 320);
  const H = wide ? 460 : 380;
  return {
    W,
    H,
    R: wide ? 44 : 40,
    EDGE: wide ? 72 : 62,
    LANE: wide ? 18 : 14,
    BEND: wide ? 40 : 28,
    CX: W / 2,
    CY: H / 2,
  };
}
const RING = 3;
/** The drawing never grows past this, however wide its column. */
const MAX_WIDTH = 620;

/** How tall the radial renders at a given wrapper width — for a drawing beside it to match. */
export function radialHeightFor(width: number): number {
  const f = frameFor(width);
  return Math.round((Math.min(width, MAX_WIDTH) * f.H) / f.W);
}

const centers = (f: Frame): Record<RingId, { x: number; y: number }> => ({
  sun: { x: f.CX, y: f.EDGE },
  grid: { x: f.EDGE, y: f.CY },
  house: { x: f.W - f.EDGE, y: f.CY },
  battery: { x: f.CX, y: f.H - f.EDGE },
  vzev: { x: f.W - f.EDGE, y: f.EDGE },
});

/** Connector width, thinnest to widest, by the flow's share of the largest. */
const STROKE_MIN = 2;
const STROKE_MAX = 7;
/** A dot's trip along the largest flow, and the slowest a smaller one gets. */
const TRIP_FASTEST_S = 1.6;
const TRIP_SLOWEST_S = 14;
const DOT_R = 4;

interface Connector {
  d: string;
  label: { x: number; y: number; anchor: "start" | "middle" | "end" };
}

/**
 * Each flow's path, from its source ring's edge to its target's, so a dot
 * following it moves the way the energy did. The paired connectors flank
 * the centre lines a lane apart; the figures sit where nothing else does.
 */
function connector(f: Frame, source: NodeId, target: NodeId): Connector | null {
  const { R, LANE, BEND, CX, CY, EDGE } = f;
  const sunBottom = EDGE + R;
  const batteryTop = f.H - EDGE - R;
  const gridRight = EDGE + R;
  const houseLeft = f.W - EDGE - R;
  switch (`${source}>${target}`) {
    case "sun>house":
      return {
        d: `M${CX + LANE},${sunBottom} V${CY - LANE - BEND} Q${CX + LANE},${CY - LANE} ${CX + LANE + BEND},${CY - LANE} H${houseLeft}`,
        label: { x: houseLeft - 10, y: CY - LANE - 6, anchor: "end" },
      };
    case "sun>gridExport":
      return {
        d: `M${CX - LANE},${sunBottom} V${CY - LANE - BEND} Q${CX - LANE},${CY - LANE} ${CX - LANE - BEND},${CY - LANE} H${gridRight}`,
        label: { x: gridRight + 10, y: CY - LANE - 6, anchor: "start" },
      };
    case "sun>battery":
      return { d: `M${CX},${sunBottom} V${batteryTop}`, label: { x: CX, y: CY - LANE - BEND - 10, anchor: "middle" } };
    case "sun>vzev":
      return {
        d: `M${CX + R},${EDGE} H${houseLeft}`,
        label: { x: (CX + R + houseLeft) / 2, y: EDGE - 7, anchor: "middle" },
      };
    case "battery>house":
      return {
        d: `M${CX + LANE},${batteryTop} V${CY + LANE + BEND} Q${CX + LANE},${CY + LANE} ${CX + LANE + BEND},${CY + LANE} H${houseLeft}`,
        label: { x: houseLeft - 10, y: CY + LANE + 14, anchor: "end" },
      };
    case "battery>gridExport":
      return {
        d: `M${CX - LANE},${batteryTop} V${CY + LANE + BEND} Q${CX - LANE},${CY + LANE} ${CX - LANE - BEND},${CY + LANE} H${gridRight}`,
        label: { x: gridRight + 10, y: CY + LANE + 14, anchor: "start" },
      };
    case "gridImport>house":
      return { d: `M${gridRight},${CY} H${houseLeft}`, label: { x: houseLeft - 10, y: CY - 4, anchor: "end" } };
    case "gridImport>battery":
      // The battery→grid connector, travelled the other way.
      return {
        d: `M${gridRight},${CY + LANE} H${CX - LANE - BEND} Q${CX - LANE},${CY + LANE} ${CX - LANE},${CY + LANE + BEND} V${batteryTop}`,
        label: { x: gridRight + 10, y: CY + LANE + 14, anchor: "start" },
      };
    default:
      return null;
  }
}

/** Feather's outline icons (MIT), on a 24-unit box. */
function RingIcon({ ring, x, y }: { ring: RingId; x: number; y: number }) {
  const size = 22;
  const common = {
    fill: "none",
    stroke: RING_COLOR[ring],
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <g transform={`translate(${x - size / 2},${y - size / 2}) scale(${size / 24})`} {...common}>
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
      {ring === "house" && (
        <>
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </>
      )}
      {ring === "grid" && <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />}
      {ring === "battery" && (
        <g transform="rotate(-90 12 12)">
          <rect x={1} y={6} width={18} height={12} rx={2} ry={2} />
          <line x1={23} y1={13} x2={23} y2={11} />
        </g>
      )}
      {ring === "vzev" && (
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

/** Whether the viewer asked the OS for less motion; the dots then stand still and arrowheads carry direction. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function RadialFlow({
  links,
  width,
  names,
  format,
  ringFigures,
  rings: ringsWanted,
  hoverIndex,
  onHover,
  onLeave,
  ariaLabel,
}: {
  links: RadialLink[];
  /** The wrapper's width, which sets the frame (see `frameFor`). */
  width: number;
  names: Record<RingId, string>;
  /** A connector's figure, in the caller's unit. */
  format: (value: number) => string;
  /** What a ring says inside itself: one line set bold, or two or three set small. */
  ringFigures: (ring: RingId) => string[];
  /** Which rings to draw; by default those a connector touches. */
  rings?: RingId[];
  hoverIndex: number | null;
  onHover: (index: number, e: MouseEvent<SVGElement>) => void;
  onLeave: () => void;
  ariaLabel: string;
}) {
  // Colons out: the id goes into a `url(#…)` and an `href="#…"`.
  const uid = useId().replace(/:/g, "");
  const reducedMotion = usePrefersReducedMotion();
  const f = frameFor(width);
  const center = centers(f);
  const maxValue = Math.max(...links.map((l) => l.value), 0);
  const drawn = links
    .map((l, index) => ({ link: l, index, connector: connector(f, l.source, l.target) }))
    .filter((d): d is { link: RadialLink; index: number; connector: Connector } => d.connector != null);
  const rings = (Object.keys(center) as RingId[]).filter(
    (ring) =>
      ringsWanted?.includes(ring) ??
      links.some((l) => RING_OF[l.source] === ring || RING_OF[l.target] === ring),
  );

  return (
    <svg
      viewBox={`0 0 ${f.W} ${f.H}`}
      width="100%"
      role="img"
      aria-label={ariaLabel}
      onMouseLeave={onLeave}
      className="mx-auto block"
      style={{ maxWidth: MAX_WIDTH }}
    >
      {reducedMotion && (
        <defs>
          {drawn.map(({ link, index }) => (
            <marker
              key={index}
              id={`${uid}-head-${index}`}
              markerWidth={6}
              markerHeight={6}
              refX={5}
              refY={3}
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path d="M0,0 L6,3 L0,6 z" fill={link.color} />
            </marker>
          ))}
        </defs>
      )}
      {drawn.map(({ link, index, connector: c }) => {
        const share = maxValue > 0 ? link.value / maxValue : 0;
        const width = STROKE_MIN + (STROKE_MAX - STROKE_MIN) * share;
        const hovered = hoverIndex === index;
        // A trip's length scales with the flow: the largest crosses in
        // TRIP_FASTEST_S, one a tenth its size takes ten times as long.
        const trip = Math.min(TRIP_SLOWEST_S, TRIP_FASTEST_S / Math.max(share, 0.01));
        const pathId = `${uid}-path-${index}`;
        return (
          <g key={index}>
            <path
              id={pathId}
              d={c.d}
              fill="none"
              stroke={link.color}
              strokeWidth={hovered ? width + 2 : width}
              strokeOpacity={hoverIndex == null || hovered ? 0.9 : 0.4}
              strokeLinecap="butt"
              markerEnd={reducedMotion ? `url(#${uid}-head-${index})` : undefined}
              style={{ transition: "stroke-opacity 120ms, stroke-width 120ms" }}
            />
            {!reducedMotion && (
              <circle r={DOT_R} fill={link.color} stroke="#fff" strokeWidth={1.5}>
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
              onMouseEnter={(e) => onHover(index, e)}
              onMouseMove={(e) => onHover(index, e)}
              onMouseLeave={onLeave}
            />
          </g>
        );
      })}
      {drawn.map(({ link, index, connector: c }) => (
        <text
          key={`figure-${index}`}
          x={c.label.x}
          y={c.label.y}
          textAnchor={c.label.anchor}
          fontSize={11}
          fill={PALETTE.ink}
          style={HALO}
          className="pointer-events-none tabular-nums"
        >
          {format(link.value)}
        </text>
      ))}
      {rings.map((ring) => {
        const { x, y } = center[ring];
        const lines = ringFigures(ring);
        const nameAbove = ring === "sun" || ring === "vzev";
        // One line sits bold under the icon; two sit small; three put a bold
        // headline (the battery's charge) between the icon and the pair.
        const iconY = lines.length === 1 ? y - 13 : lines.length === 2 ? y - 18 : y - 24;
        return (
          <g key={ring} className="pointer-events-none">
            <circle cx={x} cy={y} r={f.R} fill="#fff" stroke={RING_COLOR[ring]} strokeWidth={RING} />
            <RingIcon ring={ring} x={x} y={iconY} />
            {lines.length === 1 ? (
              <text x={x} y={y + 18} textAnchor="middle" fontSize={12} fontWeight={600} fill={PALETTE.ink} className="tabular-nums">
                {lines[0]}
              </text>
            ) : lines.length === 2 ? (
              <text x={x} textAnchor="middle" fontSize={11} fill={PALETTE.ink} className="tabular-nums">
                <tspan y={y + 9}>{lines[0]}</tspan>
                <tspan x={x} y={y + 23}>
                  {lines[1]}
                </tspan>
              </text>
            ) : (
              <text x={x} textAnchor="middle" fill={PALETTE.ink} className="tabular-nums">
                <tspan y={y + 1} fontSize={12} fontWeight={600}>
                  {lines[0]}
                </tspan>
                <tspan x={x} y={y + 15} fontSize={10.5}>
                  {lines[1]}
                </tspan>
                <tspan x={x} y={y + 28} fontSize={10.5}>
                  {lines[2]}
                </tspan>
              </text>
            )}
            <text
              x={x}
              y={nameAbove ? y - f.R - 10 : y + f.R + 17}
              textAnchor="middle"
              fontSize={12}
              fontWeight={500}
              fill={PALETTE.axis}
            >
              {names[ring]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
