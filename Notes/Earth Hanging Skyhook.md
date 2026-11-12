# Example design — outline

Exported from the Moonwards home workbench on 2026-11-12 15:03. Each installation lists its calculator's cards tab by tab, inputs then results. "—" is a figure with no model behind it yet; ☑ / ☐ is a part in use or not; [x] is the option chosen among buttons; "›" marks a line inside a folded section or under an optional part.

Detailed below: 1 of the design's 10 installations. Placeholder cards (parts no calculator covers yet) are left out.

## Bodies and installations

| Body | Skyhook | Space Elevator | Kinetic Launcher |
|---|---|---|---|
| Moon | Hanging | Through L1 | Mass driver |
| Earth | Hanging | — | — |
| Mars | Hanging, Phobos | — | Mass driver |
| Ceres | — | Standard | On space elevator |
| Psyche | — | — | Mass driver |

## Earth · Hanging skyhook

### Architecture

#### Inputs

##### Basics

| Item | Value | Note |
|---|---|---|
| Top altitude | 6200 km | site of boost engines |
| › speed | 8.89 km/s |  |
| › free orbit speed | 5.63 km/s |  |
| › multiple | 1.58 × |  |
| Centre of mass (C.o.M) altitude | 2900 km | determines orbital speed |
| › Period | 2.47 h |  |
| › speed | 6.56 km/s |  |
| Foot altitude | 120 km |  |
| › speed | 4.59 km/s |  |
| › free orbit speed | 7.84 km/s |  |
| › multiple | 0.59 × |  |

##### Tether materials

| Item | Value |
|---|---|
|  | Best lunar silica · 17 GPa, 2.3 g/cm³ |
| Breaking length at 1 g₀ | 754 km |
| Breaking length at local g of 9.8 m/s² | 753 km |
| Safety factor | 3 × |
| Lower tether ratio | taper 20.61 · mass 28.57× load carried |
| Upper tether ratio | taper 15.43 · mass 31.43× load carried |
| Anchor to C.o.M. ratio | mass 0.0042× load carried |

##### Core Facilities

| Item | Value | Note |
|---|---|---|
| Top station | 60 kt | engines, release facilities |
| Upper tether load | 20 kt | tracks, power lines, equipment |
| Anchor station | 8000 kt | production, docks, load balance |
| Lower tether load | 50 kt | tracks, power lines, equipment |
| Foot station | 20 kt | for surface shuttles |

##### Optional Stations

_Nothing to show yet._

#### Results

##### Foot ↔ Ground trips

| Item | Value | Note |
|---|---|---|
| Impact / launch speed | 4,836.2 m/s | horizontal 4,677.3 m/s · vertical 1,229.6 m/s |
| Impact / launch angle to the ground | 14.73 ° |  |
| Downrange / uprange distance | 895 km |  |
| Fall / flight time | 196 s |  |

##### Loads

| Item | Value | Note |
|---|---|---|
| Total load, upper tether | 80.00 kt | tip 60 kt + spread 20 kt |
| Upper tether mass | 2,514.27 kt |  |
| Total load, lower tether | 70.00 kt | tip 20 kt + spread 50 kt |
| Lower tether, foot → anchor station | 1,988.11 kt |  |
| Anchor station offset | 22.5 km | below the centre of mass |
| Tether, anchor station → centre of mass | 33.86 kt |  |
| Tether mass, total | 4,536.23 kt |  |
| › **Upper tether, top → centre of mass** |  |  |
| › › Top → centre of mass | 2,514.27 kt | 3,300 km |
| › **Lower tether, foot → centre of mass** |  |  |
| › › Foot → anchor station | 1,988.11 kt | 2,757 km |
| › › Anchor station → centre of mass | 33.86 kt | 23 km |
| Tension at the centre of mass | 3.70 GN | the same from above and from below |

##### Stations

| Item | Value |
|---|---|
| **Top station · 6,200 km** |  |
| › Total strain | 226.0 MN |
| › Escape v∞ | 3,954 m/s |
| › Pull felt | 3.77 m/s² |
| **Anchor station · 2,877 km** |  |
| › Total strain | 3.7 GN |
| › Pull felt | 0.03 m/s² |
| **Foot station · 120 km** |  |
| › Total strain | 124.3 MN |
| › Impact speed | 4,836 m/s |
| › Pull felt | 6.21 m/s² |

##### Release points

| Item | Value | Note |
|---|---|---|
| Venus | 5,665 km | v∞ 2,495 m/s |
| Mars | 5,804 km | v∞ 2,945 m/s |

### Logistics

#### Inputs

##### Traffic (average)

| Item | Value |
|---|---|
| Incoming resources |  |
| › From surface, per orbit | 1 kt |
| › Equal to | 9.73 kt/day · 3,552 kt/yr |
| › › Launch method | Detect: launchpad |
| › › By shuttle ☑ Bulk | 30.0 t |
| › › flights per orbit | 33.3 |
| › › Docking point: Foot |  |
| › › Haul cargo to anchor | energy: 839 MW loss orbit: 275 kN loss |
| › From the Moon, per day | 0 kt |
| › Equal to | 0 kt/week · 0 kt/yr |
| › › By freighter Standard ☐ Bulk | 50 kt |
| › › load per flight | 0 |
| › › Docking point: Top |  |
| › From interplanetary, per year | 0 kt |
| › Equal to | 0 kt/orbit · 0 kt/day |
| › › By freighter Standard ☑ Bulk | 50 kt |
| › › flights per year | 0 |
| › › Docking point: Top |  |
| Total annual resources | 3,552 kt |
| › What leaves as products (or continues on) | 90% |
| › Resources sent to the surface | 5% |
| › Waste, and resources used on anchor | 5.0% |
| Outgoing products per year | 3,197 kt |
| › To the Moon, per day | 0 kt |
| › Equal to | 0 kt/orbit · 0 kt/yr |
| › › By freighter Standard ☑ Bulk | 50 kt |
| › › flights per day | 0 |
| › › Release point: Top |  |
| › To interplanetary, per year | 3197 kt |
| › Equal to | 0.9 kt/orbit · 8.75 kt/day |
| › › By freighter Standard ☐ Bulk | 50 kt |
| › › load per flight | 0 |
| › › Release point: Top |  |
| › › Haul cargo from anchor | energy: 683 MW gain orbit: 413 kN loss |
| › To surface, per orbit | 0.050 kt |
| › Equal to | 0.486 kt/day · 177.6 kt/yr |
| › › By shuttle ☐ Bulk |  |
| › › load per flight | 0.002 kt |
| › › Release point: Foot |  |
| › › Haul cargo from anchor | energy: 42.0 MW gain orbit: 13.7 kN gain |

##### Shuttle (standard)

| Item | Value | Note |
|---|---|---|
| Propellant | Magnesium / LOX · ~260 s | vacuum Isp |
| Dry mass | 20 t |  |
| Payload | 30 t |  |
| Propellant capacity | 40 t |  |
| Heat shield | None |  |
| Δv, loaded | 1.50 km/s |  |
| Δv, empty | 2.80 km/s |  |

##### Freighter

| Item | Value | Note |
|---|---|---|
| Propellant | Methane / LOX · 370 s | vacuum Isp |
| Dry mass | 4 kt |  |
| Payload | 50 kt |  |
| Propellant capacity | 20 kt |  |
| Heat shield | Advanced - PICA |  |
| Δv, loaded | 1.09 km/s |  |
| Δv, empty | 4.91 km/s |  |

##### Capsule (standard)

| Item | Value | Note |
|---|---|---|
| Propellant | Magnesium / LOX · ~260 s | vacuum Isp |
| Dry mass | 16 t |  |
| Payload | 144 t |  |
| Propellant capacity | 0.5 t |  |
| Heat shield | Crude - microsphere and frit |  |
| Δv, loaded | 0.01 km/s |  |
| Δv, empty | 0.04 km/s |  |

#### Results

##### Energy and orbit balance

| Item | Value |
|---|---|
| Energy balance per orbit | 1.01 TJ loss |
| per year | 3.61 PJ loss |
| Climber efficiency | — |
| Orbit balance per orbit | 5.99 GN·s loss |
| per year | 21.28 TN·s loss |
| Thruster efficiency | 60% |

##### Climber energy

| Item | Value | Note |
|---|---|---|
| Foot → centre (uphill) | 7,454.5 kJ/kg |  |
| Centre → top (downhill) | 6.74 MJ/kg | Regenerative: the climber is pulled outward and can recover energy. |

##### Ship legs

| Item | Value | Note |
|---|---|---|
| Shuttle: gap to close | — km/s | Carries 1.50 km/s loaded (standard shuttle). |
| Freighter: gap to close | — km/s | Carries 1.09 km/s loaded (Freighter). |
| Capsule: gap to close | — km/s | Carries 0.01 km/s loaded (standard capsule). |

### Engineering

#### Inputs

##### Station-keeping

| Item | Value | Note |
|---|---|---|
| Propellant | Oxygen |  |
| Exhaust velocity | 8 km/s | VASIMR |
| Thruster efficiency | 60% | electrical → jet |
| Power supply efficiency | 90% | generation and delivery |

#### Results

##### Station-keeping

| Item | Value | Note |
|---|---|---|
| Reboost thrust at top | 674.32 kN | cancels the traffic's drag on the orbit · torque 8.48 TN·m |
| Propellant | 7,282.61 t/day | Oxygen · 84.29 kg/s · 0.79 t per t released |
| Jet power | 2.70 GW | at 8 km/s exhaust · useful orbit power 6.00 GW |
| Electrical power at thrusters | 4.50 GW |  |
| Generated power required | 4.99 GW |  |
| Energy to hold the orbit | 119.88 GWh/day | 431,562 GJ/day |
| Energy per tonne released | 46.71 GJ/t |  |
