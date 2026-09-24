import { useQuery } from "@tanstack/react-query";
import type { LiveEnergyView } from "@energy-manager/shared";
import { api } from "../api/client";
import { useT } from "../i18n/context";
import { StatCard } from "./StatCard";

/**
 * What the installation is doing at this instant, read live from Home
 * Assistant and never stored. Shared by the participant's Consumption page
 * and the owner's Dashboard — the same four figures answer both "is there
 * cheap local energy about right now" and "how's the sun doing today".
 */

/**
 * Below this, feed-in is meter noise rather than something anybody could
 * act on — a few tens of watts drift across zero all night. Calling that
 * "surplus available" would send somebody to start a machine on nothing.
 */
export const SURPLUS_FLOOR_W = 100;

export function useLiveView(siteId: string | null | undefined) {
  return useQuery({
    queryKey: ["ha-live", siteId],
    queryFn: () => api.homeAssistant.live(siteId!),
    enabled: !!siteId,
    // Inverter readings move by the second; a minute is close enough to
    // "now" for deciding whether to put the washing on, and gentle on both
    // Home Assistant and the browser.
    refetchInterval: 60 * 1000,
  });
}

/**
 * Whether there is a single live figure to show. Each card needs its own
 * entity configured, so a partial setup shows what it has — and an unset-up
 * site shows nothing at all rather than a row of dashes.
 */
export function hasLiveCards(live: LiveEnergyView): boolean {
  return (
    live.configured &&
    (live.exportW != null ||
      live.pvW != null ||
      live.forecastTodayKwh != null ||
      live.forecastRemainingKwh != null ||
      live.forecastTomorrowKwh != null)
  );
}

const kw = (w: number) => `${(w / 1000).toFixed(2)} kW`;
const kwh = (v: number) => `${v.toFixed(1)} kWh`;

export function LiveCards({ live }: { live: LiveEnergyView }) {
  const t = useT();
  if (!hasLiveCards(live)) return null;
  const surplus = live.exportW != null && live.exportW >= SURPLUS_FLOOR_W;
  return (
    // Two abreast even on a phone: four figures in a column is a screen of
    // scrolling for what fits in two rows.
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {live.pvW != null && <StatCard tone="sun" label={t("party.live.pv")} value={live.pvW} format={kw} />}
      {live.exportW != null && (
        <StatCard
          tone="grid"
          label={t("party.live.exporting")}
          // The feed-in sensor swings negative when the house is drawing from
          // the grid, but a card titled "exporting" cannot show a negative:
          // nothing is leaving, so nothing is what it says.
          value={Math.max(live.exportW, 0)}
          format={kw}
          emphasis={surplus ? "strong" : undefined}
          sub={surplus ? t("party.live.exportingSub") : t("party.live.exportingNone")}
        />
      )}
      {/* Forecasts stay untinted: a prediction wears no flow's colour, the
          same rule that draws it dashed and neutral on the day's chart. */}
      {live.forecastRemainingKwh != null && (
        <StatCard
          label={t("party.live.remaining")}
          value={live.forecastRemainingKwh}
          format={kwh}
          sub={
            live.forecastTodayKwh != null
              ? t("party.live.ofToday", { total: live.forecastTodayKwh.toFixed(1) })
              : undefined
          }
        />
      )}
      {live.forecastTomorrowKwh != null && (
        <StatCard label={t("party.live.tomorrow")} value={live.forecastTomorrowKwh} format={kwh} />
      )}
    </div>
  );
}
