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
 * got which kWh. That is decided the way a vZEV is settled (see
 * `splitAvailable`): the feed-in covers the participants' draw first, and
 * only the surplus goes to the grid; when they draw more than is fed in,
 * each receives their share of it and takes the rest from the grid. Every figure is clamped at zero, so
 * a moment where sensors disagree by a few watts draws a small flow rather
 * than a negative one.
 */
/** One party's draw, and how much of it the vZEV's own energy covered. */
export interface VzevShare {
  id: string;
  /** What the party drew: watts at an instant, kWh over an interval. */
  demand: number;
  /** The part of it covered by what the producers fed in. */
  local: number;
  /** The rest, drawn from the grid. */
  grid: number;
}

/**
 * The vZEV's rule for sharing what is available, in one place — the same
 * for power at an instant and for energy over an interval, since it is a
 * proportion and has no unit of its own.
 *
 * While the producers feed in at least as much as the parties draw, every
 * party is covered in full and the rest is surplus, for the grid. Once the
 * draw is higher than what is available, the available is split by each
 * party's share of the total draw: a party drawing a third of everything
 * drawn receives a third of everything available, and takes the remainder
 * of its draw from the grid.
 *
 * Negative inputs are read as zero. The shares come back in the order the
 * demands were given.
 */
export function splitAvailable(
  available: number,
  demands: ReadonlyArray<{ id: string; demand: number }>,
): { shares: VzevShare[]; surplus: number } {
  const pool = Math.max(available, 0);
  const total = demands.reduce((sum, d) => sum + Math.max(d.demand, 0), 0);
  // The fraction of every party's draw that the pool covers: all of it
  // while the pool is large enough, the same quota for each once it is not.
  const quota = total > 0 ? Math.min(pool / total, 1) : 0;
  const shares = demands.map((d) => {
    const demand = Math.max(d.demand, 0);
    const local = demand * quota;
    return { id: d.id, demand, local, grid: demand - local };
  });
  return { shares, surplus: Math.max(pool - total, 0) };
}

/**
 * One interval of the vZEV, settled: what was fed in, against what each
 * party drew.
 *
 * A party arrives in one of two ways. With the grid provider's own split
 * (`official`) — that is the settlement, and it is taken as given rather
 * than recomputed. Or with only a metered draw (`demand`), from their own
 * sensor — then their share is worked out by `splitAvailable`, from what
 * the official shares have left of the feed-in.
 */
export interface VzevIntervalParty {
  id: string;
  /** The provider's split for this interval, where it has arrived. */
  official?: { local: number; grid: number };
  /** Otherwise, what the party's own meter drew. */
  demand?: number;
}

export function settleVzevInterval(
  feedIn: number,
  parties: ReadonlyArray<VzevIntervalParty>,
): { shares: VzevShare[]; surplus: number } {
  const settled: VzevShare[] = [];
  let taken = 0;
  for (const p of parties) {
    if (!p.official) continue;
    const local = Math.max(p.official.local, 0);
    const grid = Math.max(p.official.grid, 0);
    settled.push({ id: p.id, demand: local + grid, local, grid });
    taken += local;
  }
  const metered = parties.filter((p) => !p.official && p.demand != null).map((p) => ({ id: p.id, demand: p.demand! }));
  const { shares, surplus } = splitAvailable(Math.max(feedIn, 0) - taken, metered);
  return { shares: [...settled, ...shares], surplus };
}

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

  // The viewer and everybody else, as two parties of the same split: the
  // rule is a proportion, so sharing with the others as one sum gives the
  // viewer exactly what sharing with each of them would.
  const { shares, surplus } = splitAvailable(feedIn, [
    { id: "you", demand: own },
    { id: "others", demand: others },
  ]);
  const [you, rest] = shares as [VzevShare, VzevShare];

  return {
    // Unknown production says nothing about what was kept — not that it was nil.
    sunToOwners: r.productionW == null ? 0 : Math.max(r.productionW - feedIn, 0),
    sunToVzev: feedIn,
    vzevToYou: you.local,
    vzevToOthers: rest.local,
    vzevToGrid: surplus,
    gridToYou: you.grid,
    gridToOthers: rest.grid,
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
    /**
     * How that consumption was covered, settled interval by interval (see
     * settleVzevInterval) and summed: the part from the vZEV's own feed-in
     * and the part from the grid. A day's totals could not say this — a
     * sunny noon does not cover a dark evening — so it is worked out per
     * quarter-hour. Null with the consumption it splits.
     */
    ownLocalKwh: number | null;
    ownGridKwh: number | null;
    othersLocalKwh: number | null;
    othersGridKwh: number | null;
    /** Feed-in nobody in the vZEV took, interval by interval: what went on to the grid. */
    surplusKwh: number;
  };
}
