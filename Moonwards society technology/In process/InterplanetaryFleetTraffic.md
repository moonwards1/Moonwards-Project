# Interplanetary fleet traffic

How megatonnes of cargo a year move between the Earth–Moon system, Mars and Ceres, and how the Moonwards traffic apps can show it. A working outline: the system picture first, then how the apps could represent it.

## The driving fact: windows

Interplanetary departures and arrivals bunch into windows. Because the traffic uses skyhooks, elevators and aerobraking rather than rocket burns alone, these windows will not necessarily line up with the traditional Hohmann windows, especially between the Moon and Mars. Working out when they fall is future work. What can be designed for now is their shape: **during a window, possibly hundreds of freighters arrive or depart.** That pulse is the main driver of everything else in the system.

A pulse sets a peak rate far above the yearly average:

$$
r = \frac{N}{T}
$$

- $r$ — freighters to be handled per day during the window
- $N$ — freighters in the window
- $T$ — length of the window (days)

*Illustrative:* 300 freighters over a 30-day window is $r = 300/30 = 10$ per day.

Sizing every facility for that peak would make the installations large and idle most of the time. The design answer, repeated at every node, is a **buffer**: something that absorbs the pulse and lets the facilities behind it run at a steady rate. Each facility is then sized for the average flow, not the peak.

## The system picture

### Earth–Moon: arrivals

**Every incoming freighter aerobrakes into a very high Earth orbit, approaching the edge of the Hill sphere.** This is the critical step. The atmosphere absorbs the pulse: it does not matter how many freighters make their pass in one week. Each freighter then stays in the system for months before it finally docks. That gives a lot of time to work with. Adjusting when each one makes its burns toward L1 gives good leeway to keep the process orderly, and it can be low on propellant.

**How far out is safe.** Earth's Hill radius:

$$
r_H = a\left(\frac{m}{3M}\right)^{1/3}
$$

- $r_H$ — Hill radius: roughly, the distance within which Earth's gravity dominates the Sun's
- $a$ — Earth's distance from the Sun, $1.496\times10^{8}$ km
- $m/M$ — Earth's mass over the Sun's mass, $3.0\times10^{-6}$

Working through it: $3.0\times10^{-6}/3 = 1.0\times10^{-6}$, and $(1.0\times10^{-6})^{1/3} = 0.0100$, so $r_H \approx 1.5\times10^{6}$ km.

A rule of thumb from studies of distant-satellite stability: orbits going round Earth in the same direction Earth goes round the Sun stay bound only out to about half the Hill radius (~750,000 km). Orbits going the other way stay bound considerably farther, close to the full radius. Beyond those limits the Sun can pull a freighter away over a stay of months. Two other effects are levers as well as hazards:

- The Sun's pull raises and lowers perigee over the months of the stay. This can lift a freighter's perigee out of the atmosphere for free, or drop it back in, which fits the Sun-assisted routing already in the Earth–Moon app.
- An apogee beyond the Moon's orbit means lunar encounters. These can reshape the orbit, or disturb it.

**Lifting perigee after the aerobrake pass.** The pass leaves perigee in the atmosphere; a small burn at apogee lifts it out. Speed at apogee, from the vis-viva equation:

$$
v_a = \sqrt{\mu\left(\frac{2}{r_a} - \frac{1}{a}\right)}, \qquad a = \frac{r_p + r_a}{2}
$$

- $v_a$ — speed at apogee
- $\mu$ — Earth's gravitational parameter, 398,600 km³/s²
- $r_a$, $r_p$ — apogee and perigee distances from Earth's centre
- $a$ — semi-major axis

*Illustrative, apogee 750,000 km:*

- Perigee in the upper atmosphere at 6,500 km: $a = 378{,}250$ km, $2/r_a - 1/a = 2.6667\times10^{-6} - 2.6438\times10^{-6} = 2.29\times10^{-8}$ km⁻¹, so $v_a = \sqrt{398{,}600 \times 2.29\times10^{-8}} = 0.0955$ km/s, about 95.5 m/s.
- Perigee lifted to 7,000 km (about 600 km altitude): $a = 378{,}500$ km, giving $v_a \approx 99.1$ m/s.
- The lifting burn is the difference: about **3.6 m/s**. The orbital period at this size is about 27 days:

$$
P = 2\pi\sqrt{\frac{a^3}{\mu}} = 2\pi\sqrt{\frac{(378{,}250)^3}{398{,}600}} \approx 2.3\times10^{6}\ \text{s} \approx 27\ \text{days}
$$

So the high parking orbit is cheap to enter, and its months-long stay is spent a few laps at a time.

### Earth–Moon: docking and departure

**Loaded freighters dock at L1, on the elevator.** The elevator needs no reboosting: the catch loads go into the Moon itself.

**Departing freighters are released from the lunar skyhook**, and from the Earth skyhook on occasions when the flight costs favour it. Before leaving, a freighter is tossed from the elevator to the lunar skyhook. This can be done so it arrives at very low relative speed, catchable even when almost fully loaded. The cargo in its hold is then sent down, to the anchor station and some to the skyhook foot, while the empty freighter climbs to its release point.

**Freighters return without their heat shields.** The shields are processed for their carbon content, and new ones are fitted at the freighter's destination (Ceres or Mars). Departing freighters carry supplies for the offworld operations, but not much: those operations are mostly self-sufficient, and what goes out is under 1% of what comes in. Current estimate: a freighter masses about **3 kt on departure** (cargo and propellant included) against roughly **60 kt on arrival**. The departing freighter is therefore the lightest mass in the whole loop.

**The skyhook's momentum ledger.** A hanging skyhook's anchor carries the balance of everything caught, let go, and sent down. To first order:

$$
\Delta v_c \approx \frac{1}{M}\left[\sum m_{in}\,(v_{in}-v_c) \;-\; \sum m_{out}\,(v_{out}-v_c) \;+\; \sum m_{down}\,(v_c-v_{down})\right]
$$

- $\Delta v_c$ — change in the orbital speed of the skyhook's centre of mass (positive raises the orbit)
- $M$ — mass of the whole skyhook (anchor, tethers, ballast)
- $v_c$ — orbital speed of the centre of mass
- $m_{in}$, $v_{in}$ — each caught freighter's mass and its speed when caught
- $m_{out}$, $v_{out}$ — each released freighter's mass and its speed at release
- $m_{down}$, $v_{down}$ — each mass sent down, and its speed when let go below the centre of mass

Each term in words:

- A catch above the centre of mass ($v_{in} > v_c$) adds to the orbit. The elevator toss therefore brings momentum to the skyhook: in effect the elevator, anchored on the Moon, supplies the skyhook.
- A release above the centre of mass ($v_{out} > v_c$) draws on the orbit. Releases are made by empty, shield-less freighters, so $m_{out}$ is small.
- Mass let go below the centre of mass leaves slower than the orbit ($v_{down} < v_c$), so it gives back to the orbit. The inbound cargo is heavy, so $m_{down}$ is large.

Heavy cargo going down and light empty freighters going out can come close to cancelling, so **the net momentum that has to be made up may be quite low.** This formula is only bookkeeping. The traffic apps do the full orbital calculation, which includes the shift of the centre of mass as masses come and go.

### Ceres

**Heavy traffic goes by space elevator.** Ceres sends out many fully loaded freighters, and does it with an elevator. The elevator is anchored on Ceres, so reboosting is not the problem. The problem is **keeping the installation as small as it can be by organising the traffic on the tether.** The tether's size is set by the heaviest total load it carries at once. Its buffer is storage on the tether itself: climb steadily all year, park freighters at or above the release point, and let the window set only *when* they are let go, not how fast they climb. The tether is then sized for the average climbing load.

### Mars

**Mars is usually a waypoint**, for freighters from Ceres on their way to the Earth–Moon system. It also launches plenty of freighters of its own. It has three separate release and catch facilities, so that one of them is likely to be well placed for a given arrival and to have the leeway for the energy and momentum exchange:

- **The space elevator** (anchored on Mars) and **the Phobos skyhook** (anchored on a body of about $1.07\times10^{16}$ kg) can release a great deal of mass without concern about momentum loss.
- **The sun-synchronous hanging skyhook** handles windows that would otherwise demand a difficult plane change, or a hard catch on the equatorial facilities.

Mars's buffer is choice: three facilities share the catches, so no single one takes the whole pulse. Freighters passing through also help the ledger. A freighter caught and later re-released hands back much of what its catch deposited, in proportions that depend on where on the tether each happens.

## What makes it pay

For multi-megatonne traffic to be profitable, a few ratios have to come out well. The apps can eventually show them:

$$
\text{Annual throughput:}\quad \dot{M} = \sum_{\text{windows per year}} N\,m
$$

$$
\text{Infrastructure leverage:}\quad L = \frac{\dot{M}}{M_{\text{facility}}}
$$

$$
\text{Propellant per tonne delivered:}\quad p = \frac{\sum m_{\text{prop}}}{\sum m_{\text{cargo}}}
$$

- $\dot{M}$ — cargo moved per year (t/yr)
- $N$, $m$ — freighters per window, and cargo per freighter (t)
- $M_{\text{facility}}$ — mass of the installation that handles it (t)
- $L$ — tonnes moved per year for each tonne of installation (higher is better)
- $m_{\text{prop}}$, $m_{\text{cargo}}$ — propellant spent, and cargo delivered, over the same traffic

The buffers are what keep $L$ high: a facility sized for the average flow instead of the peak is much smaller for the same $\dot{M}$. Low-energy routes (Sun-assisted drift in the high parking orbit, low-speed elevator tosses, catches within the mobile catcher's limit) are what keep $p$ low. Reboost energy for the hanging skyhooks is a third cost, set by the momentum ledger above.

## How the traffic apps could show it

The traffic apps (Earth–Moon, and Mars System) exist to get across how this cargo is handled year after year. The aim is to show it in steps, each one usable on its own.

### Step 1: saved flights

A single flight can be saved, exported (as a link or a file) and imported. There are two kinds:

- **Local flights** (skyhook to skyhook, elevator to skyhook, skyhook to surface): saved with the exact release date, so the flight reopens as it was, *and* with the alignment at release, i.e. where the departure facility sits relative to its partner body and destination. The alignment is what lets the same route recur.
- **Offworld arrivals** (Earth–Moon only, from the Mission Planner): saved with their date and the arrival packet, plus the body they came from and the window they belong to. They are one-time events, not repeating routes.

A saved flight stores its inputs and full facility settings, not results. Target solutions are saved as the plain values Target found, so the flight reproduces exactly even if the solver changes.

### Step 2: scenarios

A **scenario** is one facility design plus:

- a set of **repeating local routes**, each flown every time its alignment recurs. The pattern is laid on the lunar-month timeline, with every ship in flight drawn as the user scrubs;
- any **dated arrivals or departures**.

Repeats are not exact. The Moon's eccentric, tilted orbit and the 18.6-year nodal cycle (and for Mars, Phobos's eccentricity and the hanging skyhook's precession) mean each repeat needs a small re-trim. A scenario can re-solve each repeat and mark which ones still close within the catch limits and which don't. Watching windows for local routes open and close across the cycle is part of what the apps teach.

### Step 3: window bands

A window is first an **input the user places**, not something the app solves: a dated band on the long-term timeline with

- the other body (Mars, Ceres, …) and the direction (arriving or departing),
- the date span,
- the number of freighters, and the cargo per freighter.

The user's numbers stand in until window calculation exists. When it does, it fills in the bands, and scenarios built on them keep working.

A Mission Planner arrival becomes **one sample freighter from a window**: its trajectory is flown $N$ times across the band, with small re-trims. Local routes feeding a departure window work the same way in reverse.

### What a scenario with windows should read out

These are the readouts that make the case for the system:

- **Peak rate against capacity:** $r = N/T$ for each band, against what each facility can catch or release per orbit within its limits.
- **Buffer contents over time:** how many freighters are in the high parking orbit through the months after an arrival window, and how fast the L1 docking schedule clears them; for Ceres, freighters parked on the tether before a departure window.
- **The momentum ledger over time:** each hanging skyhook's running $\Delta v_c$ through a pulse, and whether opposing traffic, cargo sent down, or reboost between windows brings it back before the next one.
- **The profitability ratios** above, totalled over the scenario.

For the Earth–Moon app the chain reads: arrival band → aerobrake passes → high parking orbit queue → metered L1 docking → elevator toss to the lunar skyhook → cargo down, empty freighter up → release into a departure band. For the Mars app: bands for through traffic from Ceres and for Mars's own exports, spread across the three facilities. The Mars app exchanges no packets with the Mission Planner; captures of arriving traffic at Mars facilities stay in the Mission Planner.

## Open questions

- When the windows fall, given the infrastructure used, and how long they last; especially Moon–Mars.
- Size and direction of the high parking orbit: how far out, and whether the stability of orbits going the other way justifies arriving in that sense.
- How the Sun's pull on the high parking orbit is best used to meter perigee and L1 approaches.
- With arrivals about 20 times heavier than departures, whether the lunar skyhook's ledger runs a surplus rather than a deficit, and how best to spend it.
- How heavy an arriving freighter can be made, given that its single-use heat shield is itself carbon cargo for CNT manufacturing.
- Catch and release rates each facility can sustain, set by tether traffic, clearances and the mobile catcher.
- How the Ceres elevator's tether storage is laid out, and its effect on tether size.
- How Mars chooses among its three facilities for each arrival, and how through traffic balances against its own exports.
- How the scenario readouts are best drawn on the timelines without crowding them.
