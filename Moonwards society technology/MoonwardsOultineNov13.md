# Example design — outline

Exported from the Moonwards home workbench on 2026-11-13 11:18. Each installation lists its calculator's cards tab by tab, inputs then results. "—" is a figure with no model behind it yet; ☑ / ☐ is a part in use or not; [x] is the option chosen among buttons; "›" marks a line inside a folded section or under an optional part.

Detailed below: 6 of the design's 10 installations. Placeholder cards (parts no calculator covers yet) are left out.

## Bodies and installations

| Body | Skyhook | Space Elevator | Kinetic Launcher |
|---|---|---|---|
| Moon | Hanging | Through L1 | Mass driver |
| Earth | Hanging | — | — |
| Mars | Hanging, Phobos | — | Mass driver |
| Ceres | — | Standard | On space elevator |
| Psyche | — | — | Mass driver |

## Moon · Hanging skyhook

> ⚠ Traffic: the surface route comes to 58 kt a year; the surface share is 356 kt.

### Architecture

#### Inputs

##### Basics

| Item | Value | Note |
|---|---|---|
| Top altitude | 2000 km | site of boost engines |
| › speed | 2.90 km/s |  |
| › free orbit speed | 1.15 km/s |  |
| › multiple | 2.53 × |  |
| Centre of mass (C.o.M) altitude | 275 km | determines orbital speed |
| › Period | 2.25 h |  |
| › speed | 1.56 km/s |  |
| Foot altitude | 1 km |  |
| › speed | 1.35 km/s |  |
| › free orbit speed | 1.68 km/s |  |
| › multiple | 0.80 × |  |

##### Tether materials

| Item | Value |
|---|---|
|  | Best lunar silica · 17 GPa, 2.3 g/cm³ |
| Breaking length at 1 g₀ | 754 km |
| Breaking length at local g of 1.6 m/s² | 4,547 km |
| Safety factor | 3 × |
| Lower tether ratio | taper 1.03 · mass 0.06× load carried |
| Upper tether ratio | taper 2.13 · mass 0.52× load carried |
| Anchor to C.o.M. ratio | mass 0.000016× load carried |

##### Core Facilities

| Item | Value | Note |
|---|---|---|
| Top station | 40 kt | engines, release facilities |
| Upper tether load | 60 kt | tracks, power lines, equipment |
| Anchor station | 25000 kt | production, docks, load balance |
| Lower tether load | 50 kt | tracks, power lines, equipment |
| Foot station | 500 kt | for surface shuttles |

##### Optional Stations

| Item | Value | Note |
|---|---|---|
| Release deck | ☑ | for alternate destination |
| › altitude | 949.4 km |  |
| › peak mass | 10 kt |  |
| Outer docks | ☑ | arrival from holding orbit |
| › altitude | 750 km |  |
| › peak mass | 200 kt |  |
| Receiving deck | ☑ | shuttles from the surface |
| › altitude | 233 km |  |
| › peak mass | 8 kt |  |

#### Results

##### Foot ↔ Ground trips

| Item | Value | Note |
|---|---|---|
| Impact / launch speed | 1,349.9 m/s | horizontal 1,349.5 m/s · vertical 34.0 m/s |
| Impact / launch angle to the ground | 1.44 ° |  |
| Downrange / uprange distance | 79 km |  |
| Fall / flight time | 59 s |  |

##### Loads

| Item | Value | Note |
|---|---|---|
| Total load, upper tether | 310.00 kt | tip 40 kt + spread 60 kt + release deck 10 kt + outer docks 200 kt |
| Upper tether mass | 159.70 kt |  |
| Total load, lower tether | 558.00 kt | tip 500 kt + spread 50 kt + receiving deck 8 kt |
| Lower tether, foot → anchor station | 33.50 kt |  |
| Anchor station offset | 2.4 km | below the centre of mass |
| Tether, anchor station → centre of mass | 0.41 kt |  |
| Tether mass, total | 193.61 kt |  |
| › **Upper tether, top → centre of mass** |  |  |
| › › Top → release deck | 62.05 kt | 1,051 km |
| › › Release deck → outer docks | 18.95 kt | 199 km |
| › › Outer docks → centre of mass | 78.70 kt | 475 km |
| › **Lower tether, foot → centre of mass** |  |  |
| › › Foot → receiving deck | 28.49 kt | 232 km |
| › › Receiving deck → anchor station | 5.01 kt | 40 km |
| › › Anchor station → centre of mass | 409.92 t | 2 km |
| Tension at the centre of mass | 420.53 MN | the same from above and from below |

##### Stations

| Item | Value |
|---|---|
| **Top station · 2,000 km** |  |
| › Total strain | 76.0 MN |
| › Escape v∞ | 2,405 m/s |
| › Pull felt | 1.90 m/s² |
| **Release deck · 949 km** |  |
| › Total strain | 223.1 MN |
| › Escape v∞ | 833 m/s |
| › Pull felt | 0.94 m/s² |
| **Outer docks · 750 km** |  |
| › Total strain | 385.3 MN |
| › Apoapsis | 40,412 km |
| › Pull felt | 0.70 m/s² |
| **Anchor station · 273 km** |  |
| › Total strain | 420.5 MN |
| › Pull felt | 0.00 m/s² |
| **Receiving deck · 233 km** |  |
| › Total strain | 311.4 MN |
| › Periapsis | 5 km |
| › Pull felt | 0.08 m/s² |
| **Foot station · 1.0 km** |  |
| › Total strain | 288.5 MN |
| › Impact speed | 1,350 m/s |
| › Pull felt | 0.58 m/s² |

##### Release points

| Item | Value | Note |
|---|---|---|
| Earth | 950 km | v∞ 834 m/s |
| Venus | 1,539 km | v∞ 1,863 m/s |
| Mars | 1,868 km | v∞ 2,260 m/s |

### Logistics

#### Inputs

##### Traffic (average)

| Item | Value |
|---|---|
| Incoming resources |  |
| › From surface, per orbit | 1.5 kt |
| › Equal to | 16.0 kt/day · 5,846 kt/yr |
| › › Launch method | Detect: mass driver |
| › › By shuttle ☑ Bulk | 30.0 t |
| › › flights per orbit | 50.0 |
| › › Docking point: Foot |  |
| › › Haul cargo to anchor | energy: 13.9 MW loss orbit: 39.2 kN loss |
| › From Earth, per day | 0.1 kt |
| › Equal to | 0.7 kt/week · 36.5 kt/yr |
| › › By freighter 0.1 kt ☑ Bulk | 0.100 kt |
| › › flights per day | 1.00 |
| › › Docking point: Outer docks |  |
| › › Haul cargo to anchor | energy: 206 kW loss orbit: 516 N gain |
| › From interplanetary, per year | 6000 kt |
| › Equal to | 1.54 kt/orbit · 16.4 kt/day |
| › › By freighter Standard ☑ Bulk | 50 kt |
| › › flights per year | 120.0 |
| › › Docking point: Anchor |  |
| Total annual resources | 11,882 kt |
| › What leaves as products (or continues on) | 93% |
| › Resources sent to the surface | 3% |
| › Waste, and resources used on anchor | 4.0% |
| Outgoing products per year | 11,051 kt |
| › To Earth market, per day | 30 kt |
| › Equal to | 2.81 kt/orbit · 10,958 kt/yr |
| › › By freighter 0.1 kt ☐ Bulk | 0.100 kt 0.100 kt |
| › › load per flight | 0.100 kt |
| › › Release point: Top |  |
| › › Haul cargo from anchor | energy: 2.15 MW gain orbit: 2.39 kN loss |
| › › Haul freighter from outer docks | energy: 974 kW gain orbit: 935 N loss |
| › › By capsule | 144.0 t 29.9 kt |
| › › flights per day | 207.6 |
| › › Release point: Top |  |
| › › Haul cargo from anchor | energy: 644 MW gain orbit: 713 kN loss |
| › To interplanetary, per year | 50 kt |
| › Equal to | 0.0128 kt/orbit · 0.137 kt/day |
| › › By freighter Standard ☐ Bulk | 50 kt |
| › › load per flight | 0.417 kt |
| › › Release point: Top |  |
| › › Haul cargo from anchor | energy: 2.95 MW gain orbit: 3.27 kN loss |
| › › Haul freighter from anchor | energy: 49.2 MW gain orbit: 54.6 kN loss |
| › To surface, per orbit | 0.015 kt |
| › Equal to | 0.16 kt/day · 58.5 kt/yr |
| › › By shuttle ☐ Bulk |  |
| › › load per flight | 0.000 kt |
| › › Release point: Foot |  |
| › › Haul cargo from anchor | energy: 139 kW gain orbit: 392 N gain |

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
| Propellant | Magnesium / LOX · ~260 s | vacuum Isp |
| Dry mass | 0.05 kt |  |
| Payload | 0.1 kt |  |
| Propellant capacity | 0.02 kt |  |
| Heat shield | None |  |
| Δv, loaded | 0.32 km/s |  |
| Δv, empty | 0.86 km/s |  |

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
| Energy balance per orbit | 5.55 TJ gain |
| per year | 21.62 PJ gain |
| Climber efficiency | — |
| Orbit balance per orbit | 6.58 GN·s loss |
| per year | 25.65 TN·s loss |
| Thruster efficiency | 60% |

##### Climber energy

| Item | Value | Note |
|---|---|---|
| Foot → centre (uphill) | 74.9 kJ/kg |  |
| Centre → top (downhill) | 1.86 MJ/kg | Regenerative: the climber is pulled outward and can recover energy. |

##### Entry at Earth

| Item | Value | Note |
|---|---|---|
| v∞ leaving the Moon | 833 m/s | 185 m/s at the Moon's distance after braking |
| Release before longitude 0 | 46.4 ° | ahead of the point facing Earth: the Moon's pull turns the departure by this much |
| Perigee altitude | 90 km |  |
| Entry angle | −4.0 ° | at 122 km altitude, entry speed 10.99 km/s |
| Peak deceleration | ~12 g | Ballistic estimate, calibrated to Stardust; lift and guidance reduce it. |

##### Ship legs

| Item | Value | Note |
|---|---|---|
| Shuttle: gap to close | — km/s | Carries 1.50 km/s loaded (standard shuttle). |
| Freighter: gap to close | — km/s | Carries 0.32 km/s loaded (Freighter). |
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
| Reboost thrust at top | 812.70 kN | cancels the traffic's drag on the orbit · torque 3.04 TN·m |
| Propellant | 8,777.14 t/day | Oxygen · 101.59 kg/s · 0.29 t per t released |
| Jet power | 3.25 GW | at 8 km/s exhaust · useful orbit power 2.36 GW |
| Electrical power at thrusters | 5.42 GW |  |
| Generated power required | 6.02 GW |  |
| Energy to hold the orbit | 144.48 GWh/day | 520,127 GJ/day |
| Energy per tonne released | 17.17 GJ/t |  |

## Moon · L1 elevator

### Architecture

#### Inputs

##### Tether materials

| Item | Value |
|---|---|
|  | Early carbon nanotube · 18 GPa, 1.45 g/cm³ |
| Breaking length at 1 g₀ | 1,266 km |
| Breaking length at local g of 1.6 m/s² | 7,646 km |
| Safety factor | 3 × |
| Taper ratio (L1 / surface anchor) | 2.372 |
| Taper ratio (L1 / counterweight) | 1.269 |

##### Counterweight position

| Item | Value | Note |
|---|---|---|
| Counterweight distance | 221900 km | from the Moon's centre |

##### Counterweight mass

| Item | Value | Note |
|---|---|---|
| Mass | 1000 kt |  |
| Multiple of the minimum | 5.81 × | not chosen |

#### Results

##### Cable properties

| Item | Value | Note |
|---|---|---|
| Tether (cable) mass | 877.7 kt |  |
| Initial total cable structures mass estimate | 968.4 kt | Cable plus its track (1.6 kg/m at the surface, thinning to 0.4 kg/m above the gravity well); counterweight not included. |

##### Forces

| Item | Value | Note |
|---|---|---|
| Tension at L1 (peak) | 17.61 MN |  |
| Hold-down tension at surface | 7.42 MN |  |
| Net acceleration at counterweight | 1.387e-2 m/s² | Outward, toward Earth (1.41e-3 × Earth g). |

##### Orbit after release

| Item | Value | Note |
|---|---|---|
| Release radius from Earth (apogee) | 162,499 km |  |
| Tangential speed at release | 433.1 m/s |  |
| Perigee of released vessel | 90 km | altitude; 6,461 km from Earth's centre |
| Entry flight-path angle (at interface) | −4.0 ° | entry speed 10.87 km/s |
| Estimated peak deceleration | ~12 g | ballistic estimate |

### Logistics

#### Inputs

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

##### Ship legs

| Item | Value | Note |
|---|---|---|
| Freighter: gap to close | — km/s | Carries 1.09 km/s loaded (Freighter). |
| Capsule: gap to close | — km/s | Carries 0.01 km/s loaded (standard capsule). |

## Moon · Mass driver

### Logistics

#### Inputs

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

#### Results

##### Ship legs

| Item | Value | Note |
|---|---|---|
| Shuttle: gap to close | — km/s | Carries 1.50 km/s loaded (standard shuttle). |

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
| Lower tether ratio | taper 20.61 · mass 28.40× load carried |
| Upper tether ratio | taper 15.43 · mass 31.43× load carried |
| Anchor to C.o.M. ratio | mass 0.011× load carried |

##### Core Facilities

| Item | Value | Note |
|---|---|---|
| Top station | 60 kt | engines, release facilities |
| Upper tether load | 20 kt | tracks, power lines, equipment |
| Anchor station | 5000 kt | production, docks, load balance |
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
| Lower tether, foot → anchor station | 1,969.37 kt |  |
| Anchor station offset | 36.0 km | below the centre of mass |
| Tether, anchor station → centre of mass | 54.07 kt |  |
| Tether mass, total | 4,537.71 kt |  |
| › **Upper tether, top → centre of mass** |  |  |
| › › Top → centre of mass | 2,514.27 kt | 3,300 km |
| › **Lower tether, foot → centre of mass** |  |  |
| › › Foot → anchor station | 1,969.37 kt | 2,744 km |
| › › Anchor station → centre of mass | 54.07 kt | 36 km |
| Tension at the centre of mass | 3.70 GN | the same from above and from below |

##### Stations

| Item | Value |
|---|---|
| **Top station · 6,200 km** |  |
| › Total strain | 226.0 MN |
| › Escape v∞ | 3,954 m/s |
| › Pull felt | 3.77 m/s² |
| **Anchor station · 2,864 km** |  |
| › Total strain | 3.7 GN |
| › Pull felt | 0.05 m/s² |
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
| › › Haul cargo to anchor | energy: 839 MW loss orbit: 273 kN loss |
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
| › › Haul cargo from anchor | energy: 683 MW gain orbit: 415 kN loss |
| › To surface, per orbit | 0.050 kt |
| › Equal to | 0.486 kt/day · 177.6 kt/yr |
| › › By shuttle ☐ Bulk |  |
| › › load per flight | 0.002 kt |
| › › Release point: Foot |  |
| › › Haul cargo from anchor | energy: 41.9 MW gain orbit: 13.7 kN gain |

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
| per year | 3.60 PJ loss |
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
| Reboost thrust at top | 674.24 kN | cancels the traffic's drag on the orbit · torque 8.48 TN·m |
| Propellant | 7,281.76 t/day | Oxygen · 84.28 kg/s · 0.79 t per t released |
| Jet power | 2.70 GW | at 8 km/s exhaust · useful orbit power 5.99 GW |
| Electrical power at thrusters | 4.49 GW |  |
| Generated power required | 4.99 GW |  |
| Energy to hold the orbit | 119.86 GWh/day | 431,512 GJ/day |
| Energy per tonne released | 46.70 GJ/t |  |

## Mars · Hanging skyhook

> ⚠ Traffic: the products routes come to 2,228 kt a year; the products share is 4,322 kt. Traffic: the surface route comes to 223 kt a year; the surface share is 67 kt.

### Architecture

#### Inputs

##### Basics

| Item | Value | Note |
|---|---|---|
| Top altitude | 2400 km | site of boost engines |
| › speed | 5.14 km/s |  |
| › free orbit speed | 2.72 km/s |  |
| › multiple | 1.89 × |  |
| Centre of mass (C.o.M) altitude | 400 km | determines orbital speed |
| › Period | 1.97 h |  |
| › speed | 3.36 km/s |  |
| Foot altitude | 180 km |  |
| › speed | 3.17 km/s |  |
| › free orbit speed | 3.46 km/s |  |
| › multiple | 0.91 × |  |

##### Tether materials

| Item | Value |
|---|---|
|  | Early carbon nanotube · 18 GPa, 1.45 g/cm³ |
| Breaking length at 1 g₀ | 1,266 km |
| Breaking length at local g of 3.7 m/s² | 3,330 km |
| Safety factor | 2.5 × |
| Lower tether ratio | taper 1.01 · mass 0.02× load carried |
| Upper tether ratio | taper 2.08 · mass 1.31× load carried |
| Anchor to C.o.M. ratio | mass 0.00094× load carried |

##### Core Facilities

| Item | Value | Note |
|---|---|---|
| Top station | 35 kt | engines, release facilities |
| Upper tether load | 30 kt | tracks, power lines, equipment |
| Anchor station | 8000 kt | production, docks, load balance |
| Lower tether load | 20 kt | tracks, power lines, equipment |
| Foot station | 550 kt | for surface shuttles |

##### Optional Stations

| Item | Value | Note |
|---|---|---|
| Release deck | ☑ | for alternate destination |
| › altitude | 2004 km |  |
| › peak mass | 160 kt |  |

#### Results

##### Foot ↔ Ground trips

| Item | Value | Note |
|---|---|---|
| Impact / launch speed | 3,361.9 m/s | horizontal 3,334.8 m/s · vertical 425.5 m/s |
| Impact / launch angle to the ground | 7.27 ° |  |
| Downrange / uprange distance | 2,552 km |  |
| Fall / flight time | 13.7 min |  |

##### Loads

| Item | Value | Note |
|---|---|---|
| Total load, upper tether | 225.00 kt | tip 35 kt + spread 30 kt + release deck 160 kt |
| Upper tether mass | 294.53 kt |  |
| Total load, lower tether | 570.00 kt | tip 550 kt + spread 20 kt |
| Lower tether, foot → anchor station | 11.31 kt |  |
| Anchor station offset | 38.3 km | below the centre of mass |
| Tether, anchor station → centre of mass | 8.04 kt |  |
| Tether mass, total | 313.89 kt |  |
| › **Upper tether, top → centre of mass** |  |  |
| › › Top → release deck | 11.19 kt | 396 km |
| › › Release deck → centre of mass | 283.34 kt | 1,604 km |
| › **Lower tether, foot → centre of mass** |  |  |
| › › Foot → anchor station | 11.31 kt | 182 km |
| › › Anchor station → centre of mass | 8.04 kt | 38 km |
| Tension at the centre of mass | 1.04 GN | the same from above and from below |

##### Stations

| Item | Value |
|---|---|
| **Top station · 2,400 km** |  |
| › Total strain | 114.8 MN |
| › Escape v∞ | 3,404 m/s |
| › Pull felt | 3.28 m/s² |
| **Release deck · 2,004 km** |  |
| › Total strain | 610.1 MN |
| › Escape v∞ | 2,648 m/s |
| › Pull felt | 2.77 m/s² |
| **Anchor station · 362 km** |  |
| › Total strain | 1.0 GN |
| › Pull felt | 0.09 m/s² |
| **Foot station · 180 km** |  |
| › Total strain | 303.7 MN |
| › Impact speed | 3,362 m/s |
| › Pull felt | 0.55 m/s² |

##### Release points

| Item | Value | Note |
|---|---|---|
| Vesta | 1,926 km | v∞ 2,475 m/s |
| Earth | 2,004 km | v∞ 2,649 m/s |
| Ceres | 2,326 km | v∞ 3,275 m/s |

### Logistics

#### Inputs

##### Traffic (average)

| Item | Value |
|---|---|
| Incoming resources |  |
| › From surface, per orbit | 1 kt |
| › Equal to | 12.2 kt/day · 4,456 kt/yr |
| › › Launch method | Detect: mass driver |
| › › By shuttle ☑ Bulk | 30.0 t |
| › › flights per orbit | 33.3 |
| › › Docking point: Foot |  |
| › › Haul cargo to anchor | energy: 8.15 MW loss orbit: 28.8 kN loss |
| › From interplanetary, per year | 0 kt |
| › Equal to | 0 kt/orbit · 0 kt/day |
| › › By freighter Standard ☑ Bulk | 50 kt |
| › › flights per year | 0 |
| › › Docking point: Top |  |
| Total annual resources | 4,456 kt |
| › What leaves as products (or continues on) | 97% |
| › Resources sent to the surface | 1.5% |
| › Waste, and resources used on anchor | 1.5% |
| Outgoing products per year | 4,322 kt |
| › To interplanetary, per year | 2228 kt |
| › Equal to | 0.5 kt/orbit · 6.10 kt/day |
| › › By freighter Standard ☐ Bulk | 50 kt |
| › › load per flight | 0 |
| › › Release point: Top |  |
| › › Haul cargo from anchor | energy: 256 MW gain orbit: 210 kN loss |
| › To surface, per orbit | 0.050 kt |
| › Equal to | 0.61 kt/day · 222.8 kt/yr |
| › › By shuttle ☐ Bulk |  |
| › › load per flight | 0.001 kt |
| › › Release point: Foot |  |
| › › Haul cargo from anchor | energy: 408 kW gain orbit: 1.44 kN gain |

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
| Energy balance per orbit | 1.76 TJ gain |
| per year | 7.85 PJ gain |
| Climber efficiency | — |
| Orbit balance per orbit | 1.68 GN·s loss |
| per year | 7.50 TN·s loss |
| Thruster efficiency | 60% |

##### Climber energy

| Item | Value | Note |
|---|---|---|
| Foot → centre (uphill) | 59.5 kJ/kg |  |
| Centre → top (downhill) | 3.63 MJ/kg | Regenerative: the climber is pulled outward and can recover energy. |

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
| Reboost thrust at top | 237.73 kN | cancels the traffic's drag on the orbit · torque 1.38 TN·m |
| Propellant | 2,567.43 t/day | Oxygen · 29.72 kg/s · 0.38 t per t released |
| Jet power | 950.90 MW | at 8 km/s exhaust · useful orbit power 1.22 GW |
| Electrical power at thrusters | 1.58 GW |  |
| Generated power required | 1.76 GW |  |
| Energy to hold the orbit | 42.26 GWh/day | 152,144 GJ/day |
| Energy per tonne released | 22.67 GJ/t |  |

## Mars · Phobos skyhook

> ⚠ Traffic: the surface route comes to 57 kt a year; the surface share is 114 kt.

### Architecture

#### Inputs

##### Basics

| Item | Value | Note |
|---|---|---|
| Top altitude | 15000 km | site of boost engines |
| › speed | 4.19 km/s |  |
| › free orbit speed | 1.53 km/s |  |
| › multiple | 2.75 × |  |
| Centre of mass (C.o.M) altitude | 5986.5 km | Phobos's orbit |
| › Period | 7.66 h |  |
| › speed | 2.14 km/s |  |
| Foot altitude | 800 km |  |
| › speed | 0.95 km/s |  |
| › free orbit speed | 3.20 km/s |  |
| › multiple | 0.30 × |  |

##### Tether materials

| Item | Value |
|---|---|
|  | Early carbon nanotube · 18 GPa, 1.45 g/cm³ |
| Breaking length at 1 g₀ | 1,266 km |
| Breaking length at local g of 3.7 m/s² | 3,330 km |
| Safety factor | 2.5 × |
| Lower tether ratio | taper 2.16 · mass 3.84× load carried |
| Upper tether ratio | taper 2.36 · mass 1.81× load carried |

##### Core Facilities

| Item | Value | Note |
|---|---|---|
| Top station | 300 kt | engines, release facilities |
| Upper tether load | 40 kt | tracks, power lines, equipment |
| Lower tether load | 5 kt | tracks, power lines, equipment |
| Foot station | 50 kt | for surface shuttles |

##### Optional Stations

| Item | Value | Note |
|---|---|---|
| Release deck | ☑ | for alternate destination |
| › altitude | 12200 km |  |
| › peak mass | 300 kt |  |

#### Results

##### Foot ↔ Ground trips

| Item | Value | Note |
|---|---|---|
| Impact / launch speed | 2,395.3 m/s | horizontal 1,180.4 m/s · vertical 2,084.3 m/s |
| Impact / launch angle to the ground | 60.48 ° |  |
| Downrange / uprange distance | 730 km |  |
| Fall / flight time | 13.7 min |  |

##### Loads

| Item | Value | Note |
|---|---|---|
| Total load, upper tether | 640.00 kt | tip 300 kt + spread 40 kt + release deck 300 kt |
| Upper tether mass | 1,159.12 kt |  |
| Total load, lower tether | 55.00 kt | tip 50 kt + spread 5 kt |
| Lower tether mass | 211.25 kt |  |
| Phobos's orbit shift | 0.40 m | higher, from the net pull of 667.74 MN away from Mars · Δ = F / (3ω²M) |
| Tether mass, total | 1,370.37 kt |  |
| › **Upper tether, top → centre of mass** |  |  |
| › › Top → release deck | 178.36 kt | 2,800 km |
| › › Release deck → centre of mass | 980.75 kt | 6,214 km |
| › **Lower tether, foot → centre of mass** |  |  |
| › › Foot → centre of mass | 211.25 kt | 5,187 km |
| Tension at the centre of mass | 913.47 MN | from above; 245.72 MN from below. Phobos holds the difference. |

##### Stations

| Item | Value |
|---|---|
| **Top station · 15,000 km** |  |
| › Total strain | 248.7 MN |
| › Escape v∞ | 3,594 m/s |
| › Pull felt | 0.83 m/s² |
| **Release deck · 12,200 km** |  |
| › Total strain | 577.5 MN |
| › Escape v∞ | 2,671 m/s |
| › Pull felt | 0.63 m/s² |
| **Foot station · 800 km** |  |
| › Total strain | 111.1 MN |
| › Impact speed | 2,395 m/s |
| › Pull felt | 2.22 m/s² |

##### Release points

| Item | Value | Note |
|---|---|---|
| Vesta | 11,685 km | v∞ 2,475 m/s |
| Earth | 12,141 km | v∞ 2,649 m/s |
| Ceres | 13,970 km | v∞ 3,275 m/s |
| Psyche | 14,812 km | v∞ 3,537 m/s |

### Logistics

#### Inputs

##### Traffic (average)

| Item | Value |
|---|---|
| Incoming resources |  |
| › From surface, per orbit | 1 kt |
| › Equal to | 3.13 kt/day · 1,145 kt/yr |
| › › Launch method | Detect: mass driver |
| › › By shuttle ☑ Bulk | 30.0 t |
| › › flights per orbit | 33.3 |
| › › Docking point: Foot |  |
| › › Haul cargo to anchor | energy: 139 MW loss orbit: 31.6 kN loss |
| › From interplanetary, per year | 0 kt |
| › Equal to | 0 kt/orbit · 0 kt/day |
| › › By freighter Standard ☑ Bulk | 50 kt |
| › › flights per year | 0 |
| › › Docking point: Top |  |
| Total annual resources | 1,145 kt |
| › What leaves as products (or continues on) | 50% |
| › Resources sent to the surface | 10% |
| › Waste, and resources used on anchor | 40.0% |
| Outgoing products per year | 572 kt |
| › To interplanetary, per year | 572 kt |
| › Equal to | 0.5 kt/orbit · 1.57 kt/day |
| › › By freighter Standard ☐ Bulk | 50 kt |
| › › load per flight | 0 |
| › › Release point: Top |  |
| › › Haul cargo from anchor | energy: 77.3 MW gain orbit: 56.2 kN loss |
| › To surface, per orbit | 0.050 kt |
| › Equal to | 0.157 kt/day · 57.2 kt/yr |
| › › By shuttle ☐ Bulk |  |
| › › load per flight | 0.002 kt |
| › › Release point: Foot |  |
| › › Haul cargo from anchor | energy: 6.94 MW gain orbit: 1.58 kN gain |

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
| Energy balance per orbit | 1.51 TJ loss |
| per year | 1.72 PJ loss |
| Climber efficiency | — |
| Orbit balance per orbit | 2.38 GN·s loss |
| per year | 2.72 TN·s loss |
| Thruster efficiency | 60% |

##### Climber energy

| Item | Value | Note |
|---|---|---|
| Foot → centre (uphill) | 3,827.0 kJ/kg |  |
| Centre → top (downhill) | 4.26 MJ/kg | Regenerative: the climber is pulled outward and can recover energy. |

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
| Reboost thrust at top | 86.29 kN | cancels the traffic's drag on the orbit · torque 1.59 TN·m |
| Propellant | 931.90 t/day | Oxygen · 10.79 kg/s · 0.54 t per t released |
| Jet power | 345.15 MW | at 8 km/s exhaust · useful orbit power 361.71 MW |
| Electrical power at thrusters | 575.25 MW |  |
| Generated power required | 639.16 MW |  |
| Energy to hold the orbit | 15.34 GWh/day | 55,224 GJ/day |
| Energy per tonne released | 32.06 GJ/t |  |
