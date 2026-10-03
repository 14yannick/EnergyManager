/**
 * The vZEV as a participant sees it at one instant: what the plants make,
 * what of it they feed in, and who takes it.
 *
 * A participant has no interest in the producer's battery or kitchen. What
 * matters to them is the energy that reaches the vZEV — the feed-in — and
 * where it goes: to them, to their neighbours, or on to the grid. A producer
 * is on both sides of that: their plant feeds in, and their meter draws —
 * from another producer's plant, or from the grid — like anyone's. So the
 * producers appear as two figures only, what they made and what they kept
 * (the difference to what they fed in), summed over however many there are.
 *
 * The meters say how much was fed in and how much each side drew, not who
 * got which kWh. That is decided the way a vZEV is settled: the feed-in
 * covers the participants' draw first, shared in proportion to what each is
 * drawing, and only the surplus goes to the grid. Whatever the feed-in does
 * not cover, each draws from the grid. Every figure is clamped at zero, so
 * a moment where sensors disagree by a few watts draws a small flow rather
 * than a negative one.
 */
export interface VzevPowerReading {
  /** What all the plants are making, in watts; null when no producer reports it. */
  productionW: number | null;
  /** What the producers are feeding into the vZEV, in watts. */
  feedInW: number | null;
  /**
   * What the viewer is drawing at their meter; null when it is not known.
   * A producer draws too — at night, or from another producer's plant — so
   * they have this figure like anyone else.
   */
  ownW: number | null;
  /** What the other members are drawing together, producers among them. */
  othersW: number | null;
}

export interface VzevPowerFlows {
  /** Production the producers did not feed in: their own use and their batteries. */
  sunToOwners: number;
  /** The feed-in itself: production that reached the vZEV. */
  sunToVzev: number;
  vzevToYou: number;
  vzevToOthers: number;
  /** Feed-in nobody in the vZEV took. */
  vzevToGrid: number;
  gridToYou: number;
  gridToOthers: number;
}

export function allocateVzevPower(r: VzevPowerReading): VzevPowerFlows {
  const feedIn = Math.max(r.feedInW ?? 0, 0);
  const own = Math.max(r.ownW ?? 0, 0);
  const others = Math.max(r.othersW ?? 0, 0);
  const demand = own + others;

  // Shared in proportion to the draw: the same rule for a watt as for the
  // quarter-hour it is settled in.
  const local = Math.min(feedIn, demand);
  const vzevToYou = demand > 0 ? (local * own) / demand : 0;
  const vzevToOthers = local - vzevToYou;

  return {
    // Unknown production says nothing about what was kept — not that it was nil.
    sunToOwners: r.productionW == null ? 0 : Math.max(r.productionW - feedIn, 0),
    sunToVzev: feedIn,
    vzevToYou,
    vzevToOthers,
    vzevToGrid: feedIn - local,
    gridToYou: own - vzevToYou,
    gridToOthers: others - vzevToOthers,
  };
}

/**
 * What a participant's live view of the vZEV shows: the instant's power
 * and the day's energy so far. Site-wide figures are sums over the
 * producers; `others` is a sum over the other participants and names
 * nobody, so it gives away no single household's consumption.
 */
export interface VzevLiveView {
  /** When these values were read. */
  at: string;
  /** How many participants feed in — one plant owner, or several. */
  producerCount: number;
  /**
   * Whose view this is. Null for an admin or viewer who named no
   * participant. `consumes` says whether they have a meter in the vZEV —
   * every member does, a producer included: their plant is in the
   * production figures and their own draw is theirs, here.
   */
  viewer: { partyId: string; name: string; isProducer: boolean; consumes: boolean } | null;
  power: VzevPowerReading;
  /** kWh since local midnight, from the readings — which trail the sensors by a sync. */
  today: {
    /** Everything the plants made, what went into their batteries included. */
    producedKwh: number;
    /** What they fed into the vZEV. */
    feedInKwh: number;
    /** producedKwh − feedInKwh, floored at zero: what the producers kept. */
    keptKwh: number;
    /** The viewer's own consumption; null when there is no reading of it yet. */
    ownKwh: number | null;
    othersKwh: number | null;
  };
}
