# Huawei battery figures: what each counter measures

Findings from 2026-09-25 on the reference site (Huawei SUN2000-10K-MAP0 hybrid
inverter, LUNA battery, EMMA controller, read through Home Assistant). Written
down because the battery figures on the flow charts look lopsided at first
sight, and the explanation is in the counters, not in the app.

## The question

The quarter's radial chart showed 501 kWh into the battery and 359 kWh out.
That reads like a 72 % round trip, which is far below what a lithium battery
should do. Is the charge figure inflated?

## What the app reads

| Metric kind            | Home Assistant statistic               | Side | Note |
|------------------------|----------------------------------------|------|------|
| `battery_charge`       | `sensor.emma_total_charged_energy`     | DC   | cumulative, battery side |
| `battery_discharge`    | `sensor.emma_total_discharged_energy`  | DC   | cumulative, battery side |
| `inverter_ac`          | `sensor.emma_inverter_total_energy_yield` | AC | cumulative, inverter output |
| `pv_dc`                | `sensor.emma_total_pv_energy_yield`    | DC   | cumulative, panel side |
| `battery_discharge_ac` | derived, see `apps/api/src/modules/homeAssistant/split.ts` | AC | the battery's share of `inverter_ac` |
| `production`           | derived, same split                    | AC   | the panels' share of `inverter_ac` |

All synced counters are cumulative and only ever rise, so the sync's
"drop negative deltas" rule never fires for them. The store's daily charge
matched the counter's daily delta to the hundredth on every day checked.

## The answer

The two arrows measure different things. 501 is DC into the battery; 359 is AC
out of the inverter attributed to the battery. Splitting the quarter
(July to September 2026):

| Leg                              | kWh   | Ratio |
|----------------------------------|-------|-------|
| DC into battery                  | 501.0 |       |
| DC out of battery                | 489.5 | 97.7 % battery round trip |
| AC out attributed to the battery | 358.9 | 73.3 % discharge conversion |

The battery itself is fine. The loss is on the discharge leg, and it is
measured rather than modelled: in the 855 night hours of the quarter, where
the panels give nothing and every watt out of the inverter must be battery,
the raw counters say 359.7 kWh DC left the battery and 282.4 kWh AC left the
inverter. That is 78.5 %.

Why so low: average night output is about 330 W, around 3 % of the inverter's
rating, where the efficiency curve of a hybrid inverter sits at 80 to 88 %.
On top of that the inverter, the EMMA and the battery draw their own standby
power from the battery, in the order of 20 W, which counts as discharge with
nothing coming out. Roughly 17 kWh over a quarter of nights.

The equivalent AC-to-AC round trip of the whole system comes out near 70 %.
That is low against the 90 % manufacturers quote at nominal load, and normal
for a house that cycles a large battery through a few hundred watts overnight.

## The FusionSolar daily yield, decoded

The FusionSolar integration's plant "day energy"
(`sensor.254601_pm_weber_y_plagne_total_current_day_energy`) falls in the
evening and stays at zero for a while after production starts. It is not a
net-of-consumption figure in the usual sense. It equals

    inverter AC yield + battery charged (DC) − battery discharged (DC)

and that identity held at every point checked:

| Check                    | Inverter AC + charge − discharge | FusionSolar |
|--------------------------|----------------------------------|-------------|
| 2026-09-24 18:00         | 19.72 + 14.72 − 3.37 = 31.07     | 31.07 |
| 2026-09-25 live          | 72.33 + 6.79 − 4.29 = 74.83      | 74.83 |
| September 2026 to date   | 1516.95 + 172.33 − 164.91 = 1524.37 | 1524.64 |

So in the evening the number drops by exactly the discharge conversion loss
(DC subtracted in full, AC added back). Overnight it would go negative and is
clamped to zero, and in the morning the panels first have to make up that
deficit before the value moves. FusionSolar books the conversion loss against
the PV yield and treats the battery round trip as lossless. The app books it on
the battery side, DC in and AC out. Same physics, different column.

Measured discharge conversion, DC to AC:

| Window                              | Ratio |
|-------------------------------------|-------|
| 2026-09-24 00:00 to 07:00           | 78 % |
| 2026-09-24 18:00 to 23:00           | 83 % |
| September 2026                      | 74 % |
| All night hours, July to September  | 78.5 % |

## Known simplification

The range charts draw every kWh of charge as sun → battery. The daily rows
have no grid-to-battery split, so any night-time charging from the grid would
be painted as solar. On this site the import meter says the battery took at
most 0.3 kWh from the grid at night over February to September 2026, so the
error is negligible here, but it is a modelling choice, not a measurement.

## Open ideas

- Label the battery's two figures "in, DC" and "out, AC" in the tooltip, or
  show a "conversion loss" figure between them.
- Show DC discharge next to AC discharge, or a round-trip efficiency figure.
