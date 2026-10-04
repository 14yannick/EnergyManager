import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PARTY_SENSOR_SPECS,
  sensorKindsFor,
  type Party,
  type PartySensor,
  type PartySensorGroup,
  type PartySensorKind,
  type PartySensorSource,
} from "@energy-manager/shared";
import { api } from "../api/client";
import { useT, type MessageKey } from "../i18n/context";

/**
 * One participant's Home Assistant sensors: add one by choosing what it
 * measures, then which sensor reports it.
 *
 * Which kinds are on offer follows from the participant — every member has
 * their grid import, feed-in opens the export, the two detailed options
 * open the plant's own counters and live readings (see partySensors.ts in
 * the shared package, which the API enforces too). The list is that
 * catalogue filtered to this participant, minus what is already mapped.
 */

const KIND_LABEL: Record<PartySensorKind, MessageKey> = {
  import: "sensor.import",
  live_import_power: "sensor.liveImportPower",
  export: "sensor.export",
  live_export_power: "sensor.liveExportPower",
  inverter_ac: "sensor.inverterAc",
  pv_dc: "sensor.pvDc",
  battery_charge: "sensor.batteryCharge",
  battery_discharge: "sensor.batteryDischarge",
  consumption_own: "sensor.consumptionOwn",
  live_pv_power: "sensor.livePvPower",
  live_battery_power: "sensor.liveBatteryPower",
  live_battery_soc: "sensor.liveBatterySoc",
  live_load_power: "sensor.liveLoadPower",
  forecast_today: "sensor.forecastToday",
  forecast_remaining: "sensor.forecastRemaining",
  forecast_tomorrow: "sensor.forecastTomorrow",
};
const KIND_HINT: Record<PartySensorKind, MessageKey> = {
  import: "sensor.importHint",
  live_import_power: "sensor.liveImportPowerHint",
  export: "sensor.exportHint",
  live_export_power: "sensor.liveExportPowerHint",
  inverter_ac: "sensor.inverterAcHint",
  pv_dc: "sensor.pvDcHint",
  battery_charge: "sensor.batteryChargeHint",
  battery_discharge: "sensor.batteryDischargeHint",
  consumption_own: "sensor.consumptionOwnHint",
  live_pv_power: "sensor.livePvPowerHint",
  live_battery_power: "sensor.liveBatteryPowerHint",
  live_battery_soc: "sensor.liveBatterySocHint",
  live_load_power: "sensor.liveLoadPowerHint",
  forecast_today: "sensor.forecastTodayHint",
  forecast_remaining: "sensor.forecastRemainingHint",
  forecast_tomorrow: "sensor.forecastTomorrowHint",
};
const GROUP_LABEL: Record<PartySensorGroup, MessageKey> = {
  member: "sensor.group.member",
  feedIn: "sensor.group.feedIn",
  detailedRevenue: "sensor.group.detailedRevenue",
  detailedLiveView: "sensor.group.detailedLiveView",
};
/** The signed power sensors: which way is positive is the sensor's own. */
const SIGN_FLAG: Partial<Record<PartySensorKind, { label: MessageKey; hint: MessageKey }>> = {
  live_import_power: { label: "sensor.invertedImport", hint: "sensor.invertedImportHint" },
  live_export_power: { label: "sensor.invertedExport", hint: "sensor.invertedExportHint" },
  live_battery_power: { label: "sensor.invertedBattery", hint: "sensor.invertedBatteryHint" },
};

interface Option {
  id: string;
  label: string;
}

/** What Home Assistant offers for each sort of sensor, fetched once the editor is open. */
function useSensorOptions() {
  const statistics = useQuery({ queryKey: ["ha-statistics"], queryFn: api.homeAssistant.statistics });
  const power = useQuery({ queryKey: ["ha-sensors", "power"], queryFn: () => api.homeAssistant.sensors("power") });
  const battery = useQuery({ queryKey: ["ha-sensors", "battery"], queryFn: () => api.homeAssistant.sensors("battery") });
  const energy = useQuery({ queryKey: ["ha-sensors", "energy"], queryFn: () => api.homeAssistant.sensors("energy") });

  const live = (q: typeof power): Option[] =>
    (q.data ?? []).map((o) => ({
      id: o.entityId,
      label: `${o.entityId}${o.friendlyName ? ` · ${o.friendlyName}` : ""}${o.unit ? ` (${o.unit})` : ""}`,
    }));
  const bySource: Record<PartySensorSource, Option[]> = {
    // Home Assistant classifies statistics by unit; "energy" is the set that
    // can be read as kWh. Fall back to the unit string if an install does not
    // report a class.
    statistic: (statistics.data ?? [])
      .filter((s) => s.unitClass === "energy" || (s.unitClass === null && (s.unit === "kWh" || s.unit === "Wh")))
      .map((s) => ({ id: s.statisticId, label: `${s.statisticId}${s.name ? ` · ${s.name}` : ""}` })),
    power: live(power),
    battery: live(battery),
    energy: live(energy),
  };
  const queries = [statistics, power, battery, energy];
  return {
    bySource,
    loading: queries.some((q) => q.isLoading),
    error: (queries.find((q) => q.isError)?.error as Error | undefined) ?? null,
  };
}

/** A saved choice never vanishes from its own dropdown, whatever Home Assistant reports today. */
function withCurrent(options: Option[], current: string | undefined): Option[] {
  return current && !options.some((o) => o.id === current) ? [...options, { id: current, label: current }] : options;
}

export function PartySensors({
  siteId,
  party,
  sensors,
  canEdit,
}: {
  siteId: string;
  party: Party;
  /** This participant's sensors, out of the site's. */
  sensors: PartySensor[];
  canEdit: boolean;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const options = useSensorOptions();
  const [error, setError] = useState<string | null>(null);
  const [newKind, setNewKind] = useState<PartySensorKind | "">("");
  const [newEntity, setNewEntity] = useState("");

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["party-sensors", siteId] });
  const setMutation = useMutation({
    mutationFn: (input: { kind: PartySensorKind; entityId: string; inverted?: boolean }) =>
      api.partySensors.set(party.id, input),
    onSuccess: () => {
      setError(null);
      setNewKind("");
      setNewEntity("");
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => api.partySensors.remove(id),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  const allowed = sensorKindsFor(party);
  const mapped = new Map(sensors.map((s) => [s.kind, s]));
  // In the catalogue's order, and only what the participant may still have:
  // a sensor whose option was switched off stays stored but is not read, so
  // it is not listed either — switching the option back on brings it back.
  const rows = allowed.filter((k) => mapped.has(k)).map((k) => mapped.get(k)!);
  const addable = allowed.filter((k) => !mapped.has(k));
  const busy = setMutation.isPending || removeMutation.isPending;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-slate-700">{t("sensor.title", { name: party.name })}</h3>
        <p className="mt-1 max-w-4xl text-xs text-slate-500">{t("sensor.note")}</p>
      </div>

      {options.error && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {t("settings.statListFailed", { message: options.error.message })}
        </p>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 pr-4 font-medium">{t("sensor.type")}</th>
              <th className="py-1 pr-4 font-medium">{t("sensor.entity")}</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((sensor) => {
              const spec = PARTY_SENSOR_SPECS[sensor.kind];
              const flag = SIGN_FLAG[sensor.kind];
              return (
                <tr key={sensor.id} className="border-t align-top">
                  <td className="py-2 pr-4">
                    <div className="text-slate-900">{t(KIND_LABEL[sensor.kind])}</div>
                    <div className="text-xs text-slate-500">{t(KIND_HINT[sensor.kind])}</div>
                  </td>
                  <td className="py-2 pr-4">
                    <select
                      className="input w-full max-w-md"
                      value={sensor.entityId}
                      disabled={!canEdit || options.loading || busy}
                      onChange={(e) =>
                        setMutation.mutate({ kind: sensor.kind, entityId: e.target.value, inverted: sensor.inverted })
                      }
                    >
                      {withCurrent(options.bySource[spec.source], sensor.entityId).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {/* Inverters disagree on which way is positive — guessing
                        the export sign showed 0 kW while the house was
                        exporting 4.8 — so a signed sensor carries its flag. */}
                    {flag && (
                      <label className="mt-2 flex max-w-md items-start gap-2 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={sensor.inverted}
                          disabled={!canEdit || busy}
                          onChange={(e) =>
                            setMutation.mutate({ kind: sensor.kind, entityId: sensor.entityId, inverted: e.target.checked })
                          }
                        />
                        <span>
                          <span className="font-medium text-slate-700">{t(flag.label)}</span>
                          <span className="block text-slate-400">{t(flag.hint)}</span>
                        </span>
                      </label>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 text-right">
                    <span className="mr-3 text-xs text-slate-400">{t(GROUP_LABEL[spec.group])}</span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => removeMutation.mutate(sensor.id)}
                        disabled={busy}
                        className="text-slate-400 hover:text-red-600"
                      >
                        {t("common.delete")}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr className="border-t">
                <td colSpan={3} className="py-3 text-slate-400">
                  {t("sensor.none")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit &&
        (addable.length > 0 ? (
          <form
            className="flex flex-wrap items-end gap-3 border-t pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (newKind && newEntity) setMutation.mutate({ kind: newKind, entityId: newEntity });
            }}
          >
            <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
              {t("sensor.add")}
              <select
                className="input w-64 max-w-full"
                value={newKind}
                onChange={(e) => {
                  setNewKind(e.target.value as PartySensorKind | "");
                  setNewEntity("");
                }}
              >
                <option value="">{t("sensor.pickType")}</option>
                {addable.map((k) => (
                  <option key={k} value={k} title={t(KIND_HINT[k])}>
                    {t(KIND_LABEL[k])} — {t(GROUP_LABEL[PARTY_SENSOR_SPECS[k].group])}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
              {t("sensor.entity")}
              <select
                className="input w-96 max-w-full"
                value={newEntity}
                disabled={!newKind || options.loading}
                onChange={(e) => setNewEntity(e.target.value)}
              >
                <option value="">{t("sensor.pickEntity")}</option>
                {(newKind ? options.bySource[PARTY_SENSOR_SPECS[newKind].source] : []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={!newKind || !newEntity || busy} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
              {t("common.add")}
            </button>
            {newKind && <p className="w-full text-xs text-slate-500">{t(KIND_HINT[newKind])}</p>}
          </form>
        ) : (
          <p className="border-t pt-3 text-xs text-slate-500">{t("sensor.allMapped")}</p>
        ))}
    </div>
  );
}
