import type {
  AuthIdentity,
  CostItem,
  CostItemInput,
  CostItemsSummary,
  CumulativeSavingsPoint,
  DailySavings,
  DynamicTariffRate,
  GridTariffPosition,
  GridTariffPositionInput,
  InvoiceRun,
  HaDynamicTariffCandidate,
  HaSensorCandidate,
  HaEntityMapping,
  HaEntityMappingInput,
  HaStatisticOption,
  HaSyncRequest,
  HaSyncResult,
  IntervalMetricKind,
  LiveEnergyView,
  Party,
  NeighbourSales,
  PartyConsumption,
  PartyInput,
  ReadingsImportResult,
  SavingsDayDetail,
  SavingsSummary,
  SavingsQuery,
  Site,
  SiteUpdateInput,
  TariffKind,
  TariffPeriod,
  TariffPeriodInput,
  TariffSurcharge,
  TariffSurchargeInput,
} from "@energy-manager/shared";

/**
 * A failed request, with the status kept alongside the message.
 *
 * Most callers only ever show `.message`, so it stays an `Error` and reads
 * the same as before. The status is here for the few places that must tell
 * *why* a call failed — chiefly 401/403, which mean the session is the
 * problem rather than the data.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The caller's own address, when the API names it in a rejection. */
    readonly email: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      body.message ?? body.error ?? `Request failed: ${res.status}`,
      res.status,
      typeof body.email === "string" ? body.email : null,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  sites: {
    list: () => request<Site[]>("/sites"),
    update: (id: string, input: SiteUpdateInput) =>
      request<Site>(`/sites/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  },
  tariffPeriods: {
    list: (siteId: string) => request<TariffPeriod[]>(`/sites/${siteId}/tariff-periods`),
    create: (siteId: string, input: TariffPeriodInput) =>
      request<TariffPeriod>(`/sites/${siteId}/tariff-periods`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (id: string, input: TariffPeriodInput) =>
      request<TariffPeriod>(`/tariff-periods/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    remove: (id: string) => request<void>(`/tariff-periods/${id}`, { method: "DELETE" }),
  },
  tariffSurcharges: {
    list: (siteId: string) => request<TariffSurcharge[]>(`/sites/${siteId}/tariff-surcharges`),
    create: (siteId: string, input: TariffSurchargeInput) =>
      request<TariffSurcharge>(`/sites/${siteId}/tariff-surcharges`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (id: string, input: TariffSurchargeInput) =>
      request<TariffSurcharge>(`/tariff-surcharges/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    remove: (id: string) => request<void>(`/tariff-surcharges/${id}`, { method: "DELETE" }),
  },
  costItems: {
    list: (siteId: string) => request<CostItem[]>(`/sites/${siteId}/cost-items`),
    summary: (siteId: string) => request<CostItemsSummary>(`/sites/${siteId}/cost-items/summary`),
    create: (siteId: string, input: CostItemInput) =>
      request<CostItem>(`/sites/${siteId}/cost-items`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (id: string, input: CostItemInput) =>
      request<CostItem>(`/cost-items/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    remove: (id: string) => request<void>(`/cost-items/${id}`, { method: "DELETE" }),
  },
  readings: {
    import: async (siteId: string, file: File, mode: "delta" | "cumulative") => {
      const form = new FormData();
      form.append("mode", mode);
      form.append("file", file);
      const res = await fetch(`/api/sites/${siteId}/readings/import`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`Import failed: ${res.status}`);
      return res.json() as Promise<ReadingsImportResult>;
    },
    range: (siteId: string) =>
      request<{ from: string | null; to: string | null; firstProduction: string | null }>(
        `/sites/${siteId}/readings/range`,
      ),
    // A plain URL rather than a fetch: the browser's own download handling
    // gets the filename from Content-Disposition, with no blob juggling.
    exportUrl: (siteId: string, from: string, to: string, kinds: IntervalMetricKind[]) => {
      const params = new URLSearchParams({ from, to });
      if (kinds.length > 0) params.set("kinds", kinds.join(","));
      return `/api/sites/${siteId}/readings/export.xlsx?${params.toString()}`;
    },
  },
  savings: {
    daily: (siteId: string, from: string, to: string, granularity?: SavingsQuery["granularity"]) =>
      request<DailySavings[]>(
        `/sites/${siteId}/savings/daily?from=${from}&to=${to}${granularity ? `&granularity=${granularity}` : ""}`,
      ),
    summary: (siteId: string, from: string, to: string, granularity?: SavingsQuery["granularity"]) =>
      request<SavingsSummary>(
        `/sites/${siteId}/savings/summary?from=${from}&to=${to}${granularity ? `&granularity=${granularity}` : ""}`,
      ),
    day: (siteId: string, date: string) =>
      request<SavingsDayDetail>(`/sites/${siteId}/savings/day?date=${date}`),
    /** Per participant: what selling to them earned, against exporting instead. */
    neighbours: (siteId: string, from: string, to: string) =>
      request<NeighbourSales>(`/sites/${siteId}/savings/neighbours?from=${from}&to=${to}`),
    cumulative: (siteId: string, from: string, to: string, granularity?: SavingsQuery["granularity"]) =>
      request<CumulativeSavingsPoint[]>(
        `/sites/${siteId}/savings/cumulative?from=${from}&to=${to}${granularity ? `&granularity=${granularity}` : ""}`,
      ),
  },
  dynamicTariffs: {
    list: (siteId: string, from: string, to: string, kind?: TariffKind) =>
      request<DynamicTariffRate[]>(
        `/sites/${siteId}/dynamic-tariffs?from=${from}&to=${to}${kind ? `&kind=${kind}` : ""}`,
      ),
  },
  homeAssistant: {
    status: () =>
      request<{
        configured: boolean;
        url: string | null;
        syncEnabled: boolean;
        syncIntervalMinutes: number;
      }>("/home-assistant/status"),
    statistics: () => request<HaStatisticOption[]>("/home-assistant/statistics"),
    dynamicTariffEntities: () =>
      request<HaDynamicTariffCandidate[]>("/home-assistant/dynamic-tariff-entities"),
    sensors: (deviceClass: "power" | "energy") =>
      request<HaSensorCandidate[]>(`/home-assistant/sensors?deviceClass=${deviceClass}`),
    live: (siteId: string) => request<LiveEnergyView>(`/sites/${siteId}/home-assistant/live`),
    mappings: (siteId: string) => request<HaEntityMapping[]>(`/sites/${siteId}/home-assistant/entities`),
    setMapping: (siteId: string, input: HaEntityMappingInput) =>
      request<HaEntityMapping>(`/sites/${siteId}/home-assistant/entities`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    removeMapping: (id: string) =>
      request<void>(`/home-assistant/entities/${id}`, { method: "DELETE" }),
    sync: (siteId: string, body: HaSyncRequest) =>
      request<HaSyncResult>(`/sites/${siteId}/home-assistant/sync`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
  billing: {
    positions: (siteId: string) => request<GridTariffPosition[]>(`/sites/${siteId}/billing/positions`),
    createPosition: (siteId: string, input: GridTariffPositionInput) =>
      request<GridTariffPosition>(`/sites/${siteId}/billing/positions`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    updatePosition: (id: string, input: GridTariffPositionInput) =>
      request<GridTariffPosition>(`/billing/positions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    removePosition: (id: string) => request<void>(`/billing/positions/${id}`, { method: "DELETE" }),
    invoices: (siteId: string, from: string, to: string) =>
      request<InvoiceRun>(`/sites/${siteId}/billing/invoices?from=${from}&to=${to}`),
  },
  /** Who the server thinks we are. `email: null` means auth is switched off. */
  me: () => request<AuthIdentity>("/me"),

  parties: {
    list: (siteId: string) => request<Party[]>(`/sites/${siteId}/parties`),
    create: (siteId: string, input: PartyInput) =>
      request<Party>(`/sites/${siteId}/parties`, { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: PartyInput) =>
      request<Party>(`/parties/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    remove: (id: string) => request<void>(`/parties/${id}`, { method: "DELETE" }),
    /** One party's consumption split by source, and what it cost. A participant may only ask for their own. */
    consumption: (
      siteId: string,
      partyId: string,
      from: string,
      to: string,
      granularity: SavingsQuery["granularity"],
    ) =>
      request<PartyConsumption>(
        `/sites/${siteId}/parties/${partyId}/consumption?from=${from}&to=${to}&granularity=${granularity}`,
      ),
  },
};
