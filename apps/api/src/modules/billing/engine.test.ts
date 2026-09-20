import type { PartyRole } from "@energy-manager/shared";
import { describe, expect, it } from "vitest";
import type { GridTariffPosition } from "@energy-manager/shared";
import {
  buildParticipantInvoice,
  consumptionCosts,
  inclusiveDays,
  ownerFixedCosts,
  ownerIsMember,
  isBilledParty,
  participantCountOf,
  positionsChangingWithin,
  usageLooksHalfImported,
  type InvoiceInputs,
} from "./engine.js";

// The 2026 tariff as the provider bills it, gross (VAT passed through).
const G = 1.081;
function position(
  label: string,
  category: GridTariffPosition["category"],
  allocation: GridTariffPosition["allocation"],
  rateChf: number,
  countsInDirectBilling = true,
  sortOrder = 0,
): GridTariffPosition {
  return {
    id: label,
    siteId: "s",
    category,
    label,
    allocation,
    rateChf,
    validFrom: "2026-01-01T00:00:00Z",
    validTo: "2027-01-01T00:00:00Z",
    countsInDirectBilling,
    sortOrder,
    createdAt: "",
    updatedAt: "",
  };
}

const positions: GridTariffPosition[] = [
  position("Energie Grundtarif", "energie", "pool_shared", 39 * G, true, 1),
  position("Energie Einheitstarif", "energie", "per_kwh", 0.1002 * G, true, 2),
  position("Netznutzung Grundtarif", "netznutzung", "pool_shared", 96 * G, true, 3),
  position("Arbeit Einheitstarif", "netznutzung", "per_kwh", 0.0839 * G, true, 4),
  position("Messung", "messung", "per_participant", 79 * G, true, 5),
  position("Virtuelle Messung", "messung", "pool_shared", 15 * G, false, 6),
];

function inputs(overrides: Partial<InvoiceInputs> = {}): InvoiceInputs {
  return {
    from: "2026-01-01",
    to: "2026-12-31",
    days: 365,
    participantCount: 3,
    positions,
    localRateChf: 0.14,
    usage: { partyId: "p1", partyReference: "592971", partyName: "Neighbour A", gridKwh: 1000, localKwh: 2000 },
    ...overrides,
  };
}

describe("buildParticipantInvoice", () => {
  it("divides pool positions by the participants and charges metering individually", () => {
    const inv = buildParticipantInvoice(inputs());
    const by = (l: string) => inv.lines.find((x) => x.label === l)!;

    // 39 + 96 + 15 = 150 gross/a shared three ways; 79 gross/a borne alone.
    expect(by("Energie Grundtarif").amountChf).toBeCloseTo((39 * G) / 3, 2);
    expect(by("Netznutzung Grundtarif").amountChf).toBeCloseTo((96 * G) / 3, 2);
    expect(by("Virtuelle Messung").amountChf).toBeCloseTo((15 * G) / 3, 2);
    expect(by("Messung").amountChf).toBeCloseTo(79 * G, 2);

    const fixed = ((39 + 96 + 15) / 3 + 79) * G;
    expect(fixed).toBeCloseTo(139.45, 2); // the figure agreed for a three-participant pool
  });

  it("charges grid positions on grid kWh only, and local energy at the agreed rate", () => {
    const inv = buildParticipantInvoice(inputs());
    expect(inv.lines.find((l) => l.label.includes("production locale"))!.amountChf).toBeCloseTo(
      2000 * 0.14,
      2,
    );
    // Only the 1000 grid kWh carry the provider's per-kWh positions.
    expect(inv.lines.find((l) => l.label === "Energie Einheitstarif")!.quantity).toBe(1000);
  });

  it("prices every kWh at grid rates in the comparison, including what the VZEV supplied", () => {
    const inv = buildParticipantInvoice(inputs());
    const line = inv.comparison.lines.find((l) => l.label === "Energie Einheitstarif")!;
    expect(line.quantity).toBe(3000);
  });

  it("leaves VZEV-only positions out of the comparison so the saving isn't overstated", () => {
    const inv = buildParticipantInvoice(inputs());
    expect(inv.comparison.lines.some((l) => l.label === "Virtuelle Messung")).toBe(false);
    // Standing charges are borne in full when billed directly, not shared.
    expect(inv.comparison.lines.find((l) => l.label === "Energie Grundtarif")!.amountChf).toBeCloseTo(
      39 * G,
      2,
    );
  });

  it("reports the saving as the gap between the two totals", () => {
    const inv = buildParticipantInvoice(inputs());
    expect(inv.comparison.savingChf).toBeCloseTo(inv.comparison.totalChf - inv.totalChf, 2);
    expect(inv.comparison.savingChf).toBeGreaterThan(0);
  });

  it("pro-rates annual positions by day exactly as the provider does", () => {
    // The real Q2 invoice: 91 days of a 39.00 CHF/a tariff came to 9.72 CHF.
    const inv = buildParticipantInvoice(
      inputs({
        days: 91,
        participantCount: 1,
        positions: [position("Energie Grundtarif", "energie", "pool_shared", 39)],
        localRateChf: null,
        usage: { partyId: null, partyReference: null, partyName: "solo", gridKwh: 81, localKwh: 0 },
      }),
    );
    expect(inv.lines[0]!.amountChf).toBeCloseTo(9.72, 2);
  });
});

describe("inclusiveDays", () => {
  it("counts both end dates, matching the provider's day counts", () => {
    expect(inclusiveDays("2026-04-01", "2026-06-30")).toBe(91);
    expect(inclusiveDays("2026-01-01", "2026-03-31")).toBe(90);
  });
});

describe("per_kwh_total allocation", () => {
  const communeLevy = position("Redevance communale", "abgaben", "per_kwh_total", 0.0162, true, 12);

  it("charges a levy on locally supplied energy as well as grid draw", () => {
    const inv = buildParticipantInvoice(inputs({ positions: [...positions, communeLevy] }));
    const line = inv.lines.find((l) => l.label === "Redevance communale")!;
    // 1000 from the grid + 2000 from local PV.
    expect(line.quantity).toBe(3000);
    expect(line.amountChf).toBeCloseTo(3000 * 0.0162, 2);
  });

  it("is identical to per_kwh in the direct comparison, where everything comes off the grid", () => {
    const inv = buildParticipantInvoice(inputs({ positions: [...positions, communeLevy] }));
    const line = inv.comparison.lines.find((l) => l.label === "Redevance communale")!;
    expect(line.quantity).toBe(3000);
  });
});

describe("participantCountOf", () => {
  const p = (role: PartyRole) => ({ role });

  it("bills and counts an admin who is also a member", () => {
    // The ordinary case: whoever runs the RCP lives on the connection too,
    // pays a share of the fixed costs and imports from the grid like anyone
    // else. Three neighbours plus that owner is four households.
    expect(
      participantCountOf([p("rcp_party"), p("rcp_party"), p("rcp_party"), p("rcp_admin")]),
    ).toBe(4);
  });

  it("leaves out an admin who is not part of the RCP", () => {
    // A managing agent runs the app without consuming anything, so the
    // shared costs divide between the three who do.
    expect(
      participantCountOf([p("rcp_party"), p("rcp_party"), p("rcp_party"), p("rcp_admin_only")]),
    ).toBe(3);
  });

  it("ignores viewers, who consume nothing", () => {
    expect(
      participantCountOf([p("rcp_party"), p("rcp_party"), p("rcp_admin"), p("viewer")]),
    ).toBe(3);
  });

  it("assumes an unlisted owner only while no party administers the site", () => {
    // How every site looked before parties carried a role: the owner
    // consumes but hasn't been entered, so they are added back.
    expect(participantCountOf([p("rcp_party"), p("rcp_party"), p("rcp_party")])).toBe(4);
    // Once one is entered, its own role decides. Adding the constant as well
    // would count that household twice — the regression that reached 5 for
    // four people and under-charged everybody.
    expect(
      participantCountOf([p("rcp_party"), p("rcp_party"), p("rcp_party"), p("rcp_admin")]),
    ).toBe(4);
  });

  it("never divides by zero", () => {
    // A site with nobody billable still has to survive a pool_shared
    // position rather than produce Infinity.
    expect(participantCountOf([])).toBe(1);
    expect(participantCountOf([p("viewer")])).toBe(1);
    expect(participantCountOf([p("rcp_admin_only"), p("viewer")])).toBe(0);
  });
});

describe("isBilledParty", () => {
  it("bills members and member-admins, not observers", () => {
    expect(isBilledParty({ role: "rcp_party" })).toBe(true);
    expect(isBilledParty({ role: "rcp_admin" })).toBe(true);
    expect(isBilledParty({ role: "rcp_admin_only" })).toBe(false);
    expect(isBilledParty({ role: "viewer" })).toBe(false);
  });
});

describe("consumptionCosts", () => {
  it("is the invoice before rounding, and its saving the comparison's", () => {
    const inv = buildParticipantInvoice(inputs());
    const costs = consumptionCosts(inputs());
    // Each line rounds by at most half a centime.
    expect(Math.abs(costs.rcpChf - inv.totalChf)).toBeLessThanOrEqual(0.005 * inv.lines.length + 1e-9);
    expect(Math.abs(costs.directChf - inv.comparison.totalChf)).toBeLessThanOrEqual(
      0.005 * inv.comparison.lines.length + 1e-9,
    );
    expect(costs.localEnergyChf).toBeCloseTo(2000 * 0.14, 9);
  });

  it("charges nothing for local energy when no neighbour rate is set", () => {
    expect(consumptionCosts(inputs({ localRateChf: null })).localEnergyChf).toBe(0);
  });
});

describe("the owner's share of the standing charges", () => {
  // Round synthetic rates: a shared base, individual metering, and a
  // VZEV-only virtual metering fee that exists only because of the pool.
  const base = position("Base", "energie", "pool_shared", 120);
  const meter = position("Meter", "messung", "per_participant", 60);
  const virtualMeter = position("Virtual meter", "messung", "pool_shared", 30, false);

  it("saves nothing for an owner alone on the connection", () => {
    const { aloneChf, rcpChf } = ownerFixedCosts([base, meter], 1, 365);
    expect(rcpChf).toBeCloseTo(aloneChf, 10);
  });

  it("saves the part of the shared base the other members now carry", () => {
    const { aloneChf, rcpChf } = ownerFixedCosts([base, meter], 3, 365);
    // Metering is borne individually either way, so only the base differs.
    expect(aloneChf - rcpChf).toBeCloseTo(120 - 120 / 3, 10);
  });

  it("loses the owner's share of what only the pool costs", () => {
    const without = ownerFixedCosts([base, meter], 3, 365);
    const withVirtual = ownerFixedCosts([base, meter, virtualMeter], 3, 365);
    const gain = (c: { aloneChf: number; rcpChf: number }) => c.aloneChf - c.rcpChf;
    expect(gain(without) - gain(withVirtual)).toBeCloseTo(30 / 3, 10);
  });

  it("accrues by the day", () => {
    const year = ownerFixedCosts([base, meter], 3, 365);
    const day = ownerFixedCosts([base, meter], 3, 1);
    expect(day.aloneChf * 365).toBeCloseTo(year.aloneChf, 10);
    expect(day.rcpChf * 365).toBeCloseTo(year.rcpChf, 10);
  });

  it("counts the owner as a member unless they only administer the RCP", () => {
    expect(ownerIsMember([{ role: "rcp_admin" }, { role: "rcp_party" }])).toBe(true);
    expect(ownerIsMember([{ role: "rcp_party" }])).toBe(true); // unlisted owner
    expect(ownerIsMember([{ role: "rcp_admin_only" }, { role: "rcp_party" }])).toBe(false);
  });
});

describe("positionsChangingWithin", () => {
  const spanning = (label: string, validFrom: string, validTo: string): GridTariffPosition => ({
    ...position(label, "energie", "pool_shared", 39),
    validFrom,
    validTo,
  });

  it("is empty when every overlapping position covers the whole period", () => {
    const year = spanning("base", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z");
    expect(positionsChangingWithin([year], "2026-04-01", "2026-06-30")).toEqual([]);
  });

  it("names both halves of a tariff that changed inside the period", () => {
    const before = spanning("base v1", "2026-01-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    const after = spanning("base v2", "2026-07-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z");
    const hit = positionsChangingWithin([before, after], "2026-06-15", "2026-07-15");
    expect(hit.map((p) => p.label).sort()).toEqual(["base v1", "base v2"]);
  });

  it("ignores a position that ends exactly where the period starts, or starts where it ends", () => {
    const ended = spanning("old", "2025-01-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
    const current = spanning("now", "2026-04-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z");
    expect(positionsChangingWithin([ended, current], "2026-04-01", "2026-06-30")).toEqual([]);
  });

  it("ignores positions entirely outside the period", () => {
    const far = spanning("far", "2028-01-01T00:00:00.000Z", "2029-01-01T00:00:00.000Z");
    expect(positionsChangingWithin([far], "2026-04-01", "2026-06-30")).toEqual([]);
  });
});

describe("usageLooksHalfImported", () => {
  it("flags local energy with no grid draw at all — the missing series", () => {
    expect(usageLooksHalfImported({ localKwh: 42, gridKwh: 0 })).toBe(true);
  });

  it("is quiet for a party with both series, however small the grid share", () => {
    expect(usageLooksHalfImported({ localKwh: 42, gridKwh: 0.3 })).toBe(false);
  });

  it("is quiet for a party with grid draw only — the owner's own local use is not a sale", () => {
    expect(usageLooksHalfImported({ localKwh: 0, gridKwh: 400 })).toBe(false);
  });

  it("is quiet for a party with nothing at all, which the total check already covers", () => {
    expect(usageLooksHalfImported({ localKwh: 0, gridKwh: 0 })).toBe(false);
  });
});
