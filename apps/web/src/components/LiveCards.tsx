import { useQuery } from "@tanstack/react-query";
import type { LiveEnergyView, VzevLiveView } from "@energy-manager/shared";
import { api } from "../api/client";
import { formatChf, formatKwh, formatNumber } from "../lib/format";
import { useT } from "../i18n/context";
import { StatCard } from "./StatCard";

/**
 * What the installation is doing at this instant, read live from Home
 * Assistant and never stored. Shared by the participant's Consumption page
 * and the owner's Dashboard — the same figures answer both "is there cheap
 * local energy about right now" and "how's the sun doing today".
 *
 * One tile sums up the day so far: what the panels made, what of it was
 * available to the vZEV, and what the forecast still expects.
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
  return live.configured && (live.exportW != null || live.pvW != null || dayOf(live) != null);
}

/**
 * The day so far, summed the way the hour-by-hour chart sums it: made is
 * production plus what charged the battery, available is what left the
 * house. Null when there is neither a curve nor a forecast to say anything.
 */
function dayOf(live: LiveEnergyView): { madeKwh: number; availableKwh: number } | null {
  if (!live.today && live.forecastRemainingKwh == null) return null;
  const sum = (hours: ReadonlyArray<{ kwh: number }> | undefined) => (hours ?? []).reduce((acc, h) => acc + h.kwh, 0);
  return {
    madeKwh: sum(live.today?.actual) + sum(live.today?.batteryCharge),
    availableKwh: sum(live.today?.exportedLocal),
  };
}

/**
 * The member's own consumption: what their meter draws now and has drawn
 * today, and — where they map their house's load — what the whole house
 * runs on, own production and battery included.
 */
export interface OwnDraw {
  w: number | null;
  kwh: number | null;
  localKwh: number | null;
  loadW: number | null;
  loadKwh: number | null;
}

/**
 * The viewed member's own draw from the vZEV's live view, or null when
 * their meter says nothing — no import sensor and, for a producer, no
 * export sensor to read the other way.
 */
export function ownDrawOf(view: VzevLiveView | undefined): OwnDraw | null {
  if (!view?.viewer?.consumes) return null;
  const draw = {
    w: view.power.ownW,
    kwh: view.today.ownKwh,
    localKwh: view.today.ownLocalKwh,
    loadW: view.power.ownLoadW ?? null,
    loadKwh: view.today.ownLoadKwh ?? null,
  };
  return draw.w == null && draw.kwh == null && draw.loadW == null ? null : draw;
}

const kw = (w: number) => `${formatNumber(w / 1000, 2)} kW`;
const chf = (v: number) => `${formatChf(v)} CHF`;

/**
 * Today in money, for the member in view: what the day earned a producer,
 * or what the vZEV saved a member — and either way what their own
 * consumption has cost so far.
 */
export interface DayMoney {
  kind: "earning" | "advantage";
  valueChf: number | null;
  costChf: number | null;
}

export function LiveCards({
  live,
  own,
  money,
}: {
  live: LiveEnergyView;
  own?: OwnDraw | null;
  money?: DayMoney | null;
}) {
  const t = useT();
  if (!hasLiveCards(live) && !own && !money) return null;
  const surplus = live.exportW != null && live.exportW >= SURPLUS_FLOOR_W;
  const day = live.configured ? dayOf(live) : null;
  // The feed-in sensor swings negative when the house is drawing from the
  // grid, but nothing leaving is nothing exported, not a negative export.
  const exportW = live.exportW == null ? null : Math.max(live.exportW, 0);
  const exportNote =
    exportW == null ? null : `${t("party.live.exportingShort", { kw: kw(exportW) })} · ${t(surplus ? "party.live.exportingSub" : "party.live.exportingNone")}`;
  return (
    // Two abreast even on a phone: four figures in a column is a screen of
    // scrolling for what fits in two rows.
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {/* One tile for the plant: what it produces this instant, and under it
          what leaves the house and whether that is a surplus worth using.
          Without a PV sensor, the export becomes the headline instead. */}
      {live.pvW != null ? (
        <StatCard
          tone="sun"
          label={t("party.live.pv")}
          value={live.pvW}
          format={kw}
          emphasis={surplus ? "strong" : undefined}
          sub={exportNote ?? undefined}
        />
      ) : (
        exportW != null && (
          <StatCard
            tone="grid"
            label={t("party.live.exporting")}
            value={exportW}
            format={kw}
            emphasis={surplus ? "strong" : undefined}
            sub={t(surplus ? "party.live.exportingSub" : "party.live.exportingNone")}
          />
        )
      )}
      {/* The day so far, and what is still to come. */}
      {day && (
        <StatCard
          tone="sun"
          label={t("party.live.madeToday")}
          hint={t("party.live.madeTodayHint")}
          value={day.madeKwh}
          format={(v) => `${formatKwh(v)} kWh`}
          sub={[
            t("party.live.availableSub", { kwh: formatKwh(day.availableKwh) }),
            live.forecastRemainingKwh != null
              ? t("party.live.stillExpectedSub", {
                  kwh: formatKwh(live.forecastRemainingKwh),
                  total: formatKwh(live.forecastTodayKwh ?? 0),
                })
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      )}
      {/* The member's own meter: what it draws this instant, and what it
          has drawn since midnight — the figure the day's bill is made of. */}
      {/* The member's own consumption. The whole house where its load is
          mapped — what it runs on, own production and battery included;
          otherwise what the meter draws. Either way with the local part
          underneath: for the house, everything that did not come from the
          grid — own production, the battery, and what the vZEV supplied. */}
      {own && (
        <StatCard
          label={t("party.live.drawing")}
          value={own.loadW ?? own.w}
          format={kw}
          sub={
            own.loadW != null
              ? own.loadKwh != null
                ? t("party.live.drawingSub", {
                    kwh: formatKwh(own.loadKwh),
                    // The meter's grid share is what the house did not cover
                    // locally; the vZEV's part of the meter's draw is local.
                    local: formatKwh(Math.max(own.loadKwh - ((own.kwh ?? 0) - (own.localKwh ?? 0)), 0)),
                  })
                : own.w != null
                  ? t("party.live.houseNowSub", { kw: kw(Math.max(own.loadW - own.w, 0)) })
                  : undefined
              : own.kwh != null
                ? t("party.live.drawingSub", {
                    kwh: formatKwh(own.kwh),
                    local: formatKwh(own.localKwh ?? 0),
                  })
                : undefined
          }
        />
      )}
      {/* Today in money: the producer's earnings, or a member's vZEV
          advantage, with the day's consumption cost underneath. */}
      {money && (
        <StatCard
          label={t(money.kind === "earning" ? "party.live.earningToday" : "party.live.advantageToday")}
          value={money.valueChf}
          format={chf}
          emphasis={money.valueChf != null && money.valueChf > 0 ? "positive" : undefined}
          sub={
            money.costChf != null
              ? t("party.live.costToday", { total: chf(money.costChf) })
              : undefined
          }
        />
      )}
    </div>
  );
}
