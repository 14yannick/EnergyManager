import type {
  CostItem,
  CostItemInput,
  CostItemsSummary,
  CumulativeSavingsPoint,
  DynamicTariffRate,
  Party,
  PartyInput,
  ReadingsImportResult,
  SavingsSummary,
  SavingsQuery,
  Site,
  TariffKind,
  TariffPeriod,
  TariffPeriodInput,
} from "@energy-manager/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  sites: {
    list: () => request<Site[]>("/sites"),
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
  },
  savings: {
    summary: (siteId: string, from: string, to: string, granularity?: SavingsQuery["granularity"]) =>
      request<SavingsSummary>(
        `/sites/${siteId}/savings/summary?from=${from}&to=${to}${granularity ? `&granularity=${granularity}` : ""}`,
      ),
    cumulative: (siteId: string, from: string, to: string, granularity?: SavingsQuery["granularity"]) =>
      request<CumulativeSavingsPoint[]>(
        `/sites/${siteId}/savings/cumulative?from=${from}&to=${to}${granularity ? `&granularity=${granularity}` : ""}`,
      ),
  },
  dynamicTariffs: {
    sync: (siteId: string) =>
      request<{ inserted: number; updated: number; source: string; publicationTimestamp: string | null }>(
        `/sites/${siteId}/dynamic-tariffs/sync`,
        { method: "POST" },
      ),
    list: (siteId: string, from: string, to: string, kind?: TariffKind) =>
      request<DynamicTariffRate[]>(
        `/sites/${siteId}/dynamic-tariffs?from=${from}&to=${to}${kind ? `&kind=${kind}` : ""}`,
      ),
  },
  parties: {
    list: (siteId: string) => request<Party[]>(`/sites/${siteId}/parties`),
    create: (siteId: string, input: PartyInput) =>
      request<Party>(`/sites/${siteId}/parties`, { method: "POST", body: JSON.stringify(input) }),
    remove: (id: string) => request<void>(`/parties/${id}`, { method: "DELETE" }),
  },
};
