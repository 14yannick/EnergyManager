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
  localMidnightIso,
  periodBounds,
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

describe("localMidnightIso and periodBounds", () => {
  it("is 23:00Z the evening before in winter and 22:00Z in summer", () => {
    expect(localMidnightIso("2026-01-01")).toBe("2025-12-31T23:00:00.000Z");
    expect(localMidnightIso("2026-07-01")).toBe("2026-06-30T22:00:00.000Z");
  });

  it("bounds a period from its first local midnight to the one after its last day", () => {
    expect(periodBounds("2026-10-01", "2026-12-31")).toEqual({
      startIso: "2026-09-30T22:00:00.000Z",
      endExclusiveIso: "2026-12-31T23:00:00.000Z",
    });
  });
});

describe("positionsChangingWithin", () => {
  // Positions are stored from local midnights, so the fixtures are too.
  const jan1 = (y: number) => localMidnightIso(`${y}-01-01`);
  const spanning = (label: string, validFrom: string, validTo: string): GridTariffPosition => ({
    ...position(label, "energie", "pool_shared", 39),
    validFrom,
    validTo,
  });

  it("is empty when every overlapping position covers the whole period", () => {
    const year = spanning("base", jan1(2026), jan1(2027));
    expect(positionsChangingWithin([year], "2026-04-01", "2026-06-30")).toEqual([]);
  });

  it("names both halves of a tariff that changed inside the period", () => {
    const before = spanning("base v1", jan1(2026), localMidnightIso("2026-07-01"));
    const after = spanning("base v2", localMidnightIso("2026-07-01"), jan1(2027));
    const hit = positionsChangingWithin([before, after], "2026-06-15", "2026-07-15");
    expect(hit.map((p) => p.label).sort()).toEqual(["base v1", "base v2"]);
  });

  it("does not flag a tariff that ends on the period's own last midnight", () => {
    // Q4 2026 against a 2026 tariff and its 2027 successor: the boundary is
    // the period's end, not a change inside it. This was a false positive
    // while the bound was computed in UTC — 23:59:59Z overshoots the local
    // midnight by an hour, and the 2026 tariff then "ended inside" Q4.
    const y2026 = spanning("base 2026", jan1(2026), jan1(2027));
    const y2027 = spanning("base 2027", jan1(2027), jan1(2028));
    expect(positionsChangingWithin([y2026, y2027], "2026-10-01", "2026-12-31")).toEqual([]);
    expect(positionsChangingWithin([y2026, y2027], "2027-01-01", "2027-03-31")).toEqual([]);
  });

  it("ignores positions entirely outside the period", () => {
    const far = spanning("far", jan1(2028), jan1(2029));
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

describe("the owner's own consumption on their invoice", () => {
  // A small tariff: one base charge, one per-kWh energy price, one per-kWh
  // levy on everything consumed. Rates round, so the split is checkable.
  const positions = [
    position("Tarif de base", "netznutzung", "pool_shared", 100),
    position("Tarif unique", "energie", "per_kwh", 0.2),
    position("Taxe", "abgaben", "per_kwh_total", 0.05),
  ];
  const owner = (): InvoiceInputs => ({
    from: "2026-01-01",
    to: "2026-12-31",
    days: 365,
    participantCount: 4,
    positions,
    localRateChf: 0.14,
    usage: {
      partyId: "o",
      partyReference: null,
      partyName: "Owner",
      gridKwh: 1000,
      localKwh: 0,
      selfDirectKwh: 400,
      selfBatteryKwh: 300,
    },
  });

  it("leads the invoice with the self-consumed energy at a price of nothing", () => {
    const inv = buildParticipantInvoice(owner());
    const [first, second] = inv.lines;
    expect(first?.kind).toBe("self_direct");
    expect(first?.quantity).toBe(400);
    expect(first?.amountChf).toBe(0);
    expect(second?.kind).toBe("self_battery");
    expect(second?.quantity).toBe(300);
    expect(second?.amountChf).toBe(0);
    expect(inv.selfDirectKwh).toBe(400);
    expect(inv.selfBatteryKwh).toBe(300);
  });

  it("charges nothing for it, so the total is the grid draw and the shared base alone", () => {
    const inv = buildParticipantInvoice(owner());
    // 1000 kWh at 0.20 + levy on every kWh consumed except the self-consumed
    // ones, which never crossed the meter: 1000 at 0.05, + 100/4 base.
    expect(inv.totalChf).toBeCloseTo(1000 * 0.2 + 1000 * 0.05 + 25, 2);
  });

  it("prices every self-consumed kWh at the grid's rates in the comparison", () => {
    const inv = buildParticipantInvoice(owner());
    const perKwh = inv.comparison.lines.filter((l) => l.quantityUnit === "kWh");
    for (const line of perKwh) expect(line.quantity).toBe(1700);
    expect(inv.comparison.totalChf).toBeCloseTo(1700 * 0.25 + 100, 2);
  });

  it("splits the benefit into direct use, battery and RCP, and the three add up", () => {
    const inv = buildParticipantInvoice(owner());
    const { directUseChf, batteryChf, rcpChf } = inv.comparison.savingSplit;
    expect(directUseChf).toBeCloseTo(400 * 0.25, 2);
    expect(batteryChf).toBeCloseTo(300 * 0.25, 2);
    // What is left: the base charge borne alone less the shared quarter.
    expect(rcpChf).toBeCloseTo(100 - 25, 2);
    expect(directUseChf + batteryChf + rcpChf).toBeCloseTo(inv.comparison.savingChf, 2);
  });

  it("leaves a participant's invoice exactly as it was", () => {
    const inputs = owner();
    inputs.usage = { ...inputs.usage, selfDirectKwh: undefined, selfBatteryKwh: undefined, localKwh: 200 };
    const inv = buildParticipantInvoice(inputs);
    expect(inv.lines.some((l) => l.kind === "self_direct" || l.kind === "self_battery")).toBe(false);
    expect(inv.lines[0]?.kind).toBe("local");
    expect(inv.selfDirectKwh).toBe(0);
    expect(inv.comparison.savingSplit.directUseChf).toBe(0);
    expect(inv.comparison.savingSplit.batteryChf).toBe(0);
    expect(inv.comparison.savingSplit.rcpChf).toBeCloseTo(inv.comparison.savingChf, 2);
  });
});
