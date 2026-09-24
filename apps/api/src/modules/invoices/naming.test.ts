import { describe, expect, it } from "vitest";
import { filenameFor, periodLabelFor } from "./naming.js";

describe("periodLabelFor", () => {
  it("labels a whole calendar quarter", () => {
    expect(periodLabelFor("2027-01-01", "2027-03-31")).toBe("Q1.2027");
    expect(periodLabelFor("2027-04-01", "2027-06-30")).toBe("Q2.2027");
    expect(periodLabelFor("2027-10-01", "2027-12-31")).toBe("Q4.2027");
  });

  it("labels a whole calendar year, not the first quarter it starts with", () => {
    expect(periodLabelFor("2027-01-01", "2027-12-31")).toBe("2027");
  });

  it("labels a whole calendar month", () => {
    expect(periodLabelFor("2027-02-01", "2027-02-28")).toBe("2027-02");
  });

  it("gets February's last day right across a leap year", () => {
    expect(periodLabelFor("2028-02-01", "2028-02-29")).toBe("2028-02");
    // A non-leap February must not accept the 29th as its last day.
    expect(periodLabelFor("2027-02-01", "2027-02-29")).toBe("2027-02-01_2027-02-29");
  });

  it("falls back to the raw dates for a range that isn't a whole calendar unit", () => {
    expect(periodLabelFor("2027-01-15", "2027-03-31")).toBe("2027-01-15_2027-03-31");
    expect(periodLabelFor("2027-01-01", "2027-02-15")).toBe("2027-01-01_2027-02-15");
    // Spans two quarters, so it isn't one even though both ends land on
    // otherwise-valid quarter/month boundaries.
    expect(periodLabelFor("2027-01-01", "2027-06-30")).toBe("2027-01-01_2027-06-30");
  });
});

describe("filenameFor", () => {
  it("leads with the period, then the party's reference", () => {
    expect(filenameFor({ partyReference: "592971", partyName: "Anne-Marie Liechti" }, "Q1.2027")).toBe(
      "Q1.2027_592971.pdf",
    );
  });

  it("falls back to the party's name when there's no reference", () => {
    expect(filenameFor({ partyReference: null, partyName: "Jean-Pierre Rossel" }, "Q1.2027")).toBe(
      "Q1.2027_Jean-Pierre_Rossel.pdf",
    );
  });
});
