import { useMemo, type MouseEvent } from "react";
import { PALETTE } from "../lib/palette";
import { HALO, type FlowLink, type NodeId } from "./flowModel";

/**
 * The flows as a Sankey: sources on the left (the sun, grid import), what
 * the energy powered on the right (the house, the grid, the participants),
 * and the battery between them, the one thing energy passes through.
 * Ribbon width is kWh.
 *
 * Laid out by hand rather than with a Sankey library. Six fixed nodes have
 * exactly one crossing-free arrangement, written down in NODE_ORDER and in
 * the order `linksOf` lists the flows; a general solver would only
 * rediscover it, or on a bad iteration fail to.
 */

const NODE_W = 12;
/** Vertical space between two nodes of one column. */
const NODE_PAD = 14;
/** Surface gap between neighbouring ribbons at a node. */
const LINK_GAP = 2;
/** A ribbon is never thinner than this: 7 kWh of import beside 5 700 of production is a flow, not nothing. */
const MIN_LINK = 1.5;
const MIN_NODE = 6;
const MARGIN_Y = 8;
/** Narrower than this and the labels move inside the plot, over the ribbons. */
const INSET_BELOW = 560;
const LABEL_GUTTER = 118;
/** A ribbon at least this wide carries its own figure; thinner ones say it on hover. */
const LABELLED_FROM = 16;
const RIBBON_OPACITY = 0.45;
const RIBBON_OPACITY_HOVER = 0.8;

/** Column by column, top to bottom. */
const NODE_ORDER: Record<NodeId, { column: 0 | 1 | 2; rank: number; color: string }> = {
  gridImport: { column: 0, rank: 0, color: PALETTE.grid },
  sun: { column: 0, rank: 1, color: PALETTE.sun },
  battery: { column: 1, rank: 0, color: PALETTE.battery },
  house: { column: 2, rank: 0, color: PALETTE.house },
  gridExport: { column: 2, rank: 1, color: PALETTE.grid },
  vzev: { column: 2, rank: 2, color: PALETTE.local },
};

interface LaidNode {
  id: NodeId;
  x: number;
  y: number;
  h: number;
  color: string;
  inKwh: number;
  outKwh: number;
}

interface LaidLink extends FlowLink {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  w: number;
  /** Columns crossed: 2 for a ribbon that spans the battery's column. */
  span: number;
}

function layout(links: FlowLink[], width: number, height: number, inset: boolean): { nodes: LaidNode[]; links: LaidLink[] } {
  const gutter = inset ? 8 : LABEL_GUTTER;
  const x0 = gutter;
  const x2 = width - gutter - NODE_W;
  const columnX = [x0, (x0 + x2) / 2, x2] as const;

  const present = new Set<NodeId>();
  for (const l of links) {
    present.add(l.source);
    present.add(l.target);
  }
  const ids = (Object.keys(NODE_ORDER) as NodeId[])
    .filter((id) => present.has(id))
    .sort((a, b) => NODE_ORDER[a].column - NODE_ORDER[b].column || NODE_ORDER[a].rank - NODE_ORDER[b].rank);
  const inColumn = (column: 0 | 1 | 2) => ids.filter((id) => NODE_ORDER[id].column === column);

  const inOf = (id: NodeId) => links.filter((l) => l.target === id);
  const outOf = (id: NodeId) => links.filter((l) => l.source === id);
  const sum = (ls: FlowLink[]) => ls.reduce((s, l) => s + l.kwh, 0);
  // A node is as tall as the busier of its two sides. The difference is
  // energy that stopped there: the battery's losses and what it still holds.
  const sideKwh = (id: NodeId) => Math.max(sum(inOf(id)), sum(outOf(id)));
  const gapsOf = (id: NodeId) => LINK_GAP * (Math.max(inOf(id).length, outOf(id).length, 1) - 1);

  // Pixels per kWh: both outer columns must fit, so the fuller one sets it.
  let scale = Infinity;
  for (const column of [0, 2] as const) {
    const col = inColumn(column);
    if (col.length === 0) continue;
    // The 6 is slack for ribbons drawn at their minimum width.
    const fixed = 2 * MARGIN_Y + NODE_PAD * (col.length - 1) + col.reduce((s, id) => s + gapsOf(id), 0) + 6;
    const kwh = col.reduce((s, id) => s + sideKwh(id), 0);
    if (kwh > 0) scale = Math.min(scale, (height - fixed) / kwh);
  }
  if (!Number.isFinite(scale)) scale = 0;
  const px = (kwh: number) => Math.max(kwh * scale, MIN_LINK);
  const stackPx = (ls: FlowLink[]) => ls.reduce((s, l) => s + px(l.kwh), 0) + LINK_GAP * Math.max(ls.length - 1, 0);
  const heightOf = (id: NodeId) => Math.max(stackPx(inOf(id)), stackPx(outOf(id)), MIN_NODE);

  // The outer columns stack from the top.
  const y = new Map<NodeId, number>();
  for (const column of [0, 2] as const) {
    let cursor = MARGIN_Y;
    for (const id of inColumn(column)) {
      y.set(id, cursor);
      cursor += heightOf(id) + NODE_PAD;
    }
  }
  // The battery hangs where the sun's ribbon reaches it, nudged up by half of
  // what it keeps: its outgoing ribbons then leave level with where they
  // land, and the sun's export ribbon passes under it instead of behind it.
  if (present.has("battery")) {
    let offset = 0;
    for (const l of outOf("sun")) {
      if (l.target === "battery") break;
      offset += px(l.kwh) + LINK_GAP;
    }
    const kept = stackPx(inOf("battery")) - stackPx(outOf("battery"));
    y.set("battery", Math.max(MARGIN_Y, (y.get("sun") ?? MARGIN_Y) + offset - Math.max(kept, 0) / 2));
  }

  const nodes: LaidNode[] = ids.map((id) => ({
    id,
    x: columnX[NODE_ORDER[id].column],
    y: y.get(id)!,
    h: heightOf(id),
    color: NODE_ORDER[id].color,
    inKwh: sum(inOf(id)),
    outKwh: sum(outOf(id)),
  }));
  const nodeOf = new Map(nodes.map((n) => [n.id, n]));

  const outCursor = new Map<NodeId, number>();
  const inCursor = new Map<NodeId, number>();
  const laid: LaidLink[] = links.map((l) => {
    const s = nodeOf.get(l.source)!;
    const t = nodeOf.get(l.target)!;
    const w = px(l.kwh);
    const so = outCursor.get(l.source) ?? 0;
    outCursor.set(l.source, so + w + LINK_GAP);
    const ti = inCursor.get(l.target) ?? 0;
    inCursor.set(l.target, ti + w + LINK_GAP);
    return {
      ...l,
      sx: s.x + NODE_W,
      sy: s.y + so,
      tx: t.x,
      ty: t.y + ti,
      w,
      span: NODE_ORDER[l.target].column - NODE_ORDER[l.source].column,
    };
  });
  return { nodes, links: laid };
}

/** A ribbon: two cubic edges sharing their horizontal control points. */
function ribbonPath(l: LaidLink): string {
  const xm = (l.sx + l.tx) / 2;
  const b0 = l.sy + l.w;
  const b1 = l.ty + l.w;
  return `M${l.sx},${l.sy} C${xm},${l.sy} ${xm},${l.ty} ${l.tx},${l.ty} L${l.tx},${b1} C${xm},${b1} ${xm},${b0} ${l.sx},${b0} Z`;
}

/** A point on the ribbon's centre line, `t` of the way along it. */
function ribbonPoint(l: LaidLink, t: number): { x: number; y: number } {
  const xm = (l.sx + l.tx) / 2;
  const u = 1 - t;
  const x = u * u * u * l.sx + 3 * u * u * t * xm + 3 * u * t * t * xm + t * t * t * l.tx;
  const c0 = l.sy + l.w / 2;
  const c1 = l.ty + l.w / 2;
  const y = (u * u * u + 3 * u * u * t) * c0 + (3 * u * t * t + t * t * t) * c1;
  return { x, y };
}

interface LabelPlace {
  x: number;
  /** Baseline of the name; the figure sits one line under it. */
  y: number;
  anchor: "start" | "middle" | "end";
  halo: boolean;
}

/**
 * Outer columns label outward into their gutter — or, when there is none,
 * inward over the ribbons with a halo. The battery, alone in the middle,
 * labels below itself, or above when it sits near the bottom edge.
 */
function labelFor(n: LaidNode, inset: boolean, height: number): LabelPlace {
  const column = NODE_ORDER[n.id].column;
  if (column === 1) {
    const below = n.y + n.h + 32 <= height;
    return { x: n.x + NODE_W / 2, y: below ? n.y + n.h + 16 : n.y - 20, anchor: "middle", halo: true };
  }
  // Centred on the node, but kept inside the drawing for a sliver of a node
  // at the very top or bottom.
  const cy = Math.min(Math.max(n.y + n.h / 2, 14), height - 14);
  if (column === 0) {
    return inset
      ? { x: n.x + NODE_W + 6, y: cy, anchor: "start", halo: true }
      : { x: n.x - 8, y: cy, anchor: "end", halo: false };
  }
  return inset
    ? { x: n.x - 6, y: cy, anchor: "end", halo: true }
    : { x: n.x + NODE_W + 8, y: cy, anchor: "start", halo: false };
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
/** Rough glyph widths: enough to keep labels off each other, not to typeset. */
const NAME_CHAR_W = 7;
const FIGURE_CHAR_W = 6.3;
const LABEL_PAD = 3;
/**
 * Where along a ribbon its figure may sit, in order of preference. A ribbon
 * spanning the battery's column starts near the end it lands at, off the
 * battery and its label; a short one starts in its middle.
 */
const RIBBON_LABEL_SPOTS: Record<number, number[]> = { 2: [0.78, 0.5, 0.3, 0.22], 1: [0.5, 0.35, 0.65] };

interface PlacedLabels {
  nodes: Array<{ key: string; place: LabelPlace; name: string; figure: string }>;
  ribbons: Array<{ key: string; x: number; y: number; text: string }>;
}

/**
 * Node labels go where `labelFor` puts them. Each ribbon's figure then takes
 * the first of its spots that touches neither a node label nor a figure
 * already placed, and goes without when every spot is taken — the hover
 * still says it. Inside a phone's width the node labels sit over the
 * ribbons, and this is what keeps "1'086" from printing across "House".
 */
function placeLabels(
  laid: { nodes: LaidNode[]; links: LaidLink[] },
  inset: boolean,
  height: number,
  name: (id: NodeId) => string,
  fmt: (kwh: number) => string,
): PlacedLabels {
  const taken: Box[] = [];
  const nodes = laid.nodes.map((n) => {
    const place = labelFor(n, inset, height);
    const nameText = name(n.id);
    // The battery's two figures: what went in, what came back.
    const figure =
      n.id === "battery" ? `${fmt(n.inKwh)} → ${fmt(n.outKwh)} kWh` : `${fmt(Math.max(n.inKwh, n.outKwh))} kWh`;
    const w = Math.max(nameText.length * NAME_CHAR_W, figure.length * FIGURE_CHAR_W);
    const x0 = place.anchor === "end" ? place.x - w : place.anchor === "middle" ? place.x - w / 2 : place.x;
    taken.push({ x0: x0 - LABEL_PAD, x1: x0 + w + LABEL_PAD, y0: place.y - 12 - LABEL_PAD, y1: place.y + 14 + LABEL_PAD });
    return { key: `${n.id}-label`, place, name: nameText, figure };
  });
  const ribbons: PlacedLabels["ribbons"] = [];
  for (const l of laid.links) {
    if (l.w < LABELLED_FROM) continue;
    const text = fmt(l.kwh);
    const w = text.length * FIGURE_CHAR_W;
    for (const spot of RIBBON_LABEL_SPOTS[l.span] ?? [0.5]) {
      const p = ribbonPoint(l, spot);
      const box = { x0: p.x - w / 2 - LABEL_PAD, x1: p.x + w / 2 + LABEL_PAD, y0: p.y - 6 - LABEL_PAD, y1: p.y + 6 + LABEL_PAD };
      if (taken.some((b) => overlaps(b, box))) continue;
      taken.push(box);
      ribbons.push({ key: `${l.source}-${l.target}-figure`, x: p.x, y: p.y, text });
      break;
    }
  }
  return { nodes, ribbons };
}

export function SankeyFlow({
  links,
  width,
  height: heightWanted,
  name,
  fmt,
  hoverIndex,
  onHover,
  onLeave,
  ariaLabel,
}: {
  links: FlowLink[];
  /** The wrapper's width; the drawing fills it. */
  width: number;
  /** The drawing's height; by default what suits the width. */
  height?: number;
  name: (id: NodeId) => string;
  fmt: (kwh: number) => string;
  hoverIndex: number | null;
  onHover: (index: number, e: MouseEvent<SVGElement>) => void;
  onLeave: () => void;
  ariaLabel: string;
}) {
  const inset = width < INSET_BELOW;
  const height = heightWanted ?? (inset ? 280 : 320);
  const laid = useMemo(() => layout(links, width, height, inset), [links, width, height, inset]);
  const labels = useMemo(() => placeLabels(laid, inset, height, name, fmt), [laid, inset, height, name, fmt]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      onMouseLeave={onLeave}
      className="block overflow-visible"
    >
      {laid.links.map((l, i) => (
        <path
          key={`${l.source}-${l.target}`}
          d={ribbonPath(l)}
          fill={l.color}
          fillOpacity={hoverIndex === i ? RIBBON_OPACITY_HOVER : RIBBON_OPACITY}
          style={{ transition: "fill-opacity 120ms" }}
          onMouseEnter={(e) => onHover(i, e)}
          onMouseMove={(e) => onHover(i, e)}
          onMouseLeave={onLeave}
        />
      ))}
      {laid.nodes.map((n) => (
        <rect key={n.id} x={n.x} y={n.y} width={NODE_W} height={n.h} rx={3} fill={n.color} />
      ))}
      {labels.ribbons.map((r) => (
        <text
          key={r.key}
          x={r.x}
          y={r.y + 4}
          textAnchor="middle"
          fontSize={11}
          fill={PALETTE.ink}
          style={HALO}
          className="pointer-events-none tabular-nums"
        >
          {r.text}
        </text>
      ))}
      {labels.nodes.map((n) => (
        <text
          key={n.key}
          x={n.place.x}
          textAnchor={n.place.anchor}
          style={n.place.halo ? HALO : undefined}
          className="pointer-events-none tabular-nums"
        >
          <tspan y={n.place.y - 2} fontSize={12} fontWeight={600} fill={PALETTE.ink}>
            {n.name}
          </tspan>
          <tspan x={n.place.x} y={n.place.y + 12} fontSize={11} fill={PALETTE.axis}>
            {n.figure}
          </tspan>
        </text>
      ))}
    </svg>
  );
}
