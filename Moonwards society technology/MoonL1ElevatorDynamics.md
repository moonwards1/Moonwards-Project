# Moon–L1 Space Elevator: Dynamic Considerations

Operational analysis of a tether rising from the Moon's surface along the Earth–Moon
line, through the Earth–Moon L1 point, to a counterweight beyond it. Built on the
default parameters in `MoonL1ElevatorCalc.html` and focused on how the changing
Earth–Moon geometry moves the tether and what that means for the structure and its
vehicles.

## Baseline (calculator defaults, reproduced)

| Quantity                                      | Value                                            |
| --------------------------------------------- | ------------------------------------------------ |
| Moon radius / Earth–Moon distance             | 1,738 km / 384,400 km                            |
| Rotation rate $\omega = \sqrt{G(M_\text{Earth}+M_\text{Moon})/D^3}$ | 2.665×10⁻⁶ rad/s (period 27.3 d)                 |
| L1 from Moon centre (g = 0)                   | 58,016 km                                        |
| Counterweight                                 | 1 Mt at 222,100 km                               |
| Material                                      | Mature CNT, 42 GPa, 1,400 kg/m³, safety factor 3 |
| Minimum (taut) counterweight                  | ≈ 0.42 Mt — operating point is 2.35× that        |
| Peak tension (at L1)                          | ≈ 17.4 MN                                        |
| Surface hold-down tension (empty, worst case) | ≈ 9.9 MN                                         |
| Taper ratio (L1/surface)                      | ≈ 1.76                                           |
| Tether mass                                   | ≈ 362,000 t                                      |

The taper is modest because mature CNT is vastly overbuilt for the Moon's weak field — even at a safety factor of 3 the cross-section only grows ~1.8× from surface to L1.
**Material strength is the easy part of this design.** The hard part is motion.

Governing relations (coordinate $r$ = distance from Moon centre, toward Earth):

$$
g(r) = \frac{GM_\text{Earth}}{(D-r)^2} - \frac{GM_\text{Moon}}{r^2} + \omega^2(r - x_b)
$$

$$
\Phi(r) = -\frac{GM_\text{Moon}}{r} - \frac{GM_\text{Earth}}{D-r} - \tfrac{1}{2}\omega^2(r - x_b)^2
$$

$$
k_\perp(r) = \frac{GM_\text{Moon}}{r^3} + \frac{GM_\text{Earth}}{(D-r)^3} - \omega^2
$$

- $g(r)$ — effective along-line (radial) force
- $\Phi(r)$ — effective potential
- $k_\perp(r)$ — transverse (sideways) stiffness; positive everywhere → transversely stable pendulum
- $GM_\text{Earth}$, $GM_\text{Moon}$ — gravitational parameters of Earth and the Moon
- $D$ — Earth–Moon distance
- $\omega$ — system rotation rate
- $x_b$ — barycentre offset from the Moon's centre

## What actually moves: three drivers

The calculator assumes a rigid rod on a fixed Earth–Moon line at constant ω and D.
Reality departs from this in three ways, because the Moon is tidally locked to its
*mean* motion, not its instantaneous motion, and its orbit is eccentric and inclined.

1. **Libration in longitude (dominant).** Orbital eccentricity (e = 0.0549) makes the
   orbital rate vary while spin stays constant, so Earth swings east–west in the lunar
   sky by **±7.9°** over an anomalistic month (27.55 d). L1 and the entire net-force
   axis swing that far from the clamped, mean-pointing tether base, and back, monthly.
2. **Libration in latitude.** The 6.7° spin-axis tilt makes the sub-Earth point wander
   **±6.7°** north–south over a draconic month (27.21 d) — an out-of-plane swing.
3. **Distance variation.** D ranges 363,000 km (perigee) to 405,500 km (apogee), ±5.5%.
   With angular momentum $h = \sqrt{GM\cdot a(1-e^2)}$ conserved, instantaneous orbital rate
   $\omega = h/r^2$ swings +11.8% / −10.3%. L1 walks ±~1,600 km; the counterweight's outward "weight" — and the tension it sets — swings substantially (table below). Because the counterweight now sits farther out (222,100 km), where the $\omega^2(r-x_b)$ term dominates, that tension swing is larger than for a closer-in counterweight.

## How much it oscillates

The tether is a gravity-gradient pendulum. Moment-of-inertia–weighting k⊥ over the
cable plus the 1-Mt counterweight gives a natural transverse libration period:

- $T_n = 2\pi/\sqrt{\langle k_\perp\rangle} \approx \textbf{8.0 days}$. This is *shorter* than the bare $\sqrt{3}\cdot\omega$ dumbbell value
  (~15.8 d) because the counterweight sits closer to Earth (D−r ≈ 162,000 km), where
  Earth's tidal gradient stiffens the pendulum.

The monthly forcing now sits well below this natural frequency: $\omega_f/\omega_n \approx 0.29$, so

$$
\text{dynamic amplification} = \frac{1}{|1 - (\omega_f/\omega_n)^2|} \approx 1.09
$$

- $T_n$ — the tether's natural transverse libration period
- $k_\perp$ — transverse stiffness (defined above), angle-bracket = averaged over the cable
- $\omega_f$ — the monthly forcing frequency (from libration/eccentricity)
- $\omega_n$ — the tether's natural transverse frequency ($=2\pi/T_n$)

The swing essentially follows
the forcing quasi-statically, with little resonant gain — a comfortable margin, though
still worth re-checking, since changing the counterweight's mass or distance moves ω_n.

Resulting monthly sweep (rigid-rod upper-bound estimate; a flexible cable curves into a
mode shape and swings somewhat less, but the order of magnitude holds):

| Location                   | Lateral excursion (longitude swing) |
| -------------------------- | ----------------------------------- |
| L1 region (58,000 km)      | ±~8,000 km                          |
| Counterweight (222,100 km) | ±~31,000 km                         |

Latitude libration adds a comparable out-of-plane swing, so the counterweight traces a
roughly elliptical/Lissajous path **tens of thousands of km wide**, once per month, at a
peak transverse tip speed of ~88 m/s. **The "L1 station" is not a fixed point — it
patrols a region larger than the Earth.**

## Tension cycling (eccentricity)

| Phase   | g(r_cw)        | Tension at counterweight | vs. mean |
| ------- | -------------- | ------------------------ | -------- |
| Perigee | 1.87×10⁻² m/s² | 18.7 MN                  | +34%     |
| Mean    | 1.39×10⁻²      | 13.9 MN                  | —        |
| Apogee  | 1.07×10⁻²      | 10.7 MN                  | −23%     |

A roughly +34% / −23% tension swing every 27.55 days (~12.4 cycles/year) — larger than it would be for a counterweight nearer L1, because more of the counterweight's outward "weight" comes from the ω²(r−x_b) term, which the monthly ω variation modulates directly.

## Implications for design and operations

### Approach: build everything to move with the system

The gross swing is slow (monthly) and **deterministic** — driven by libration and
eccentricity, which are pure ephemeris, predictable years ahead. Compute it from a
calendar, not by nervous extrapolation. Only the vibrational state riding on top needs
live sensing and damping.

### Fatigue is likely not the binding constraint

At ~12.4 cycles/year, even a 50-year element sees only ~620 major cycles — *low-cycle*,
benign at ±~30% with a safety factor of 3. Micrometeoroid attrition already forces
continuous element replacement, so no fiber is expected to live indefinitely. The
safety margin already carried covers fatigue. **But it concentrates locally**, not in
bulk fiber: at element splices, at vehicle grippers, and above all at the **gimballed
base**, which sweeps ±8° monthly and sees the largest concentrated cyclic bending in the system. That is where inspection effort belongs. The base needs a large gimbal/universal joint; a rigid clamp would create severe cyclic bending moments at the surface.

### Vehicles need to factor in the geometry, but not be radically adapted

The forces the swing imposes on a vehicle gripping the cable are tiny — the vehicle is
*carried*, it does not fight the motion. (Accelerations below are quoted in **milli-g**:
1 mg = 10⁻³ g₀ ≈ 0.0098 m/s², a thousandth of Earth surface gravity. For scale, the
−165 mg surface row is just lunar gravity, 1.62 m/s² = 0.165 g₀, pointing Moonward.)

| Load on vehicle                                    | Magnitude                                                      |
| -------------------------------------------------- | -------------------------------------------------------------- |
| Riding the monthly swing ($a = r\cdot\theta\cdot\omega_f^2$) | ~0.006 mg at L1, ~0.024 mg at counterweight                    |
| Coriolis from climbing ($2\omega v$)               | 0.03 mg at 50 m/s; 0.1 mg at 200 m/s; 0.5 mg at 1 km/s         |
| **Along-cable "weight" the drive already handles** | **−165 mg at surface** (lunar g), ~5 mg by 10,000 km, ~0 at L1 |

The transverse loads are one to four orders of magnitude below the longitudinal load the drive system is already built for — a rounding error on wheel design. What vehicles do need: bidirectional guide rollers (small), an attitude reference tracking a local
vertical that tilts a few degrees over hours, and a drive that can both **pull and
brake**, because the along-cable force reverses sign across L1 (toward Moon below,
outward above).

**The swing does not limit climbing speed.** Cruise speed is set by base traction and
power, exactly as on any space elevator — the orbital mechanics add no ceiling.

### The real constraint on fast travel: transverse waves

Plucking the cable sends a transverse wave at

$$
c = \sqrt{T/\mu} = \sqrt{\sigma_\text{eff}/\rho} \approx 3{,}160\text{ m/s}
$$

- $c$ — transverse wave speed along the cable
- $T$ — local tension, $\mu$ — local mass per unit length (their ratio is constant along a constant-stress cable, since $T$ and $\mu$ taper together)
- $\sigma_\text{eff}$ — effective strength = 42 GPa ÷ 3 = 14 GPa
- $\rho$ — cable material density

Over ~220,000 km that is a **~19.4-hour** one-way traverse. The lowest gravity-gradient
pendulum mode (the 8-day swing above) is well separated from the elastic "ringing"
modes, which form a series near $2L/c \approx 39$ hours for the fundamental, with harmonics
at ~19 h, ~13 h, ~8 h… The 1-Mt counterweight is only ~3× the cable mass, so the far
end is a *partial* reflector, not a clean node — it recoils a little, lengthening the
fundamental somewhat. A vehicle that accelerates hard, stops abruptly, or changes speed
injects exactly this kind of pulse; so does a micrometeoroid strike. The operational
rule is therefore **"move smoothly," not "move slowly"**: gentle acceleration ramps,
traffic coordination so multiple climbers don't pump the same mode in phase, and active damping at the base and counterweight. Fast steady cruise is fine; abrupt and
uncoordinated operation is what whips the cable. This is a control-and-scheduling problem.

### Worked example: a micrometeoroid strike

It is worth following one concrete impulsive event all the way through, because the
result is reassuring and slightly counter-intuitive: a typical micrometeoroid does **not**
ring the cable. It punches a hole and is gone.

A transverse impulse delivers sideways momentum $J = m\cdot v_\perp$ (impactor mass × the velocity component perpendicular to the cable). That impulse launches **two transverse kinks** that race apart along the cable at the wave speed c, leaving the cable offset sideways between them by a step of height

$$
h = \frac{J}{2\sqrt{T\mu}} = \frac{J\cdot c}{2T}
$$

- $h$ — sideways step height between the two kinks
- $J$ — the delivered transverse impulse
- $T$, $\mu$, $c$ — local tension, mass per length, and wave speed (as above)

(the standard d'Alembert result for a point impulse on a taut string). The response is
largest where the tension T is *smallest* — i.e. low down near the surface (T ≈ 9.9 MN),
not at the high-tension L1 region (T ≈ 17.4 MN). Take a relatively beefy micrometeoroid: m = 1 mg (a sub-millimetre grain, 10⁻⁶ kg) hitting roughly broadside at the Moon's ~20 km/s average impact speed, so $J \approx m\cdot v \approx 0.02$ kg·m/s (an upper bound — most strikes are oblique and couple less). Then

$$
h \approx \frac{0.02 \times 3{,}160}{2 \times 9.9\times10^6} \approx 3\times10^{-6}\text{ m}
$$

near the surface (≈ 1.8 µm up at L1).

A **three-micrometre** sideways twitch, in a cable whose cross-section there is ~707 mm². The grain's kinetic energy is ½mv² ≈ 200 J, and nearly all of it goes into vaporising
material and cratering, not into a travelling wave; the injected pulse is as short as the
contact patch (sub-millimetre), so it is a sharp, localised, low-energy kink, not a long
mode that the structure cares about. It crosses to the base or counterweight in ~19 hours,
reflects, and is utterly lost in the noise.

You have to scale the impactor up enormously before the *wave* matters, because h ∝ m:

| Sideways offset h at the surface | Impulse J needed | Impactor mass at 20 km/s |
| -------------------------------- | ---------------- | ------------------------ |
| 3 µm (the example)               | 0.02 kg·m/s      | 1 mg — a micrometeoroid  |
| 1 mm                             | 6.3 kg·m/s       | ~0.3 g                   |
| 1 cm                             | 63 kg·m/s        | ~3 g                     |
| 1 m                              | 6,300 kg·m/s     | ~0.3 kg — a pebble       |

So a metre-scale transverse wave needs a ~300-gram meteoroid — many orders of magnitude bigger and rarer than the micrometeoroid rain. **The micrometeoroid threat is therefore a local one — severing or eroding individual fibres out of a 700+ mm² section — not a global vibration source.** That is exactly why the design treats micrometeoroids as a continuous *attrition* problem (ongoing element inspection and replacement) rather than a dynamics problem. The cable-whipping budget belongs to abrupt vehicle operations and to the rare gram-to-kilogram impactor, which is precisely where the "move smoothly" rule and active damping are aimed.

### Climber faults: the dominant transverse-wave source

The micrometeoroid is harmless because it is *light*; the real danger is mass coupled to
suddenness, and the climber is the mass. A loaded climber at the calculator defaults is
~1,000 t (10⁶ kg). A single climber fault injects transverse impulse

$$
J = M_c \cdot \Delta v_\perp
$$

- $M_c$ — climber mass
- $\Delta v_\perp$ — the sideways velocity step the fault imparts

producing the same step $h = J\cdot c/(2T)$. So a metre-scale surface wave needs only
Δv⊥ ≈ 6,300 / 10⁶ ≈ **6 mm/s**, and a control loss that throws a thousand-tonne climber
sideways at ~1 m/s gives J ≈ 10⁶ kg·m/s → **h ≈ 160 m**. One misbehaving climber
outweighs the entire micrometeoroid rain as a wave source by ~10⁸. This is where the
cable-whipping budget actually lives.

**Design implication — distributed, fail-soft climbers.** The governing requirement is
that *no single fault may produce a step change in the force a climber applies to the
cable.* Independent drive and suspension per wheel assembly, with isolated (diverse, not merely duplicated) power and control, converts sudden total failures into graceful
degradation: one failed unit is a small, smoothly-redistributed fraction of total grip,
and the cable gives ~19 h (one traverse) before any disturbance reaches a boundary. Two riders on that: each unit must **fail soft** — to a low-drag freewheel, not a lock, since
a seized wheel while the others drive yaws the climber and plucks the cable — and the
per-wheel **suspension should double as a transverse force-limiter**, tuned to bleed a
faulting unit's transient into its stroke rather than transmit a sharp kink.

**How many climbers?** Slicing the same throughput into more, smaller climbers reduces the per-fault worst case *linearly* (consequence $\propto M_c$) while raising event frequency in proportion to climber count; the time-averaged impulse injected, $\propto \text{count} \times M_c$ = total mass on the cable, is invariant to the slicing. So the choice is rare-large vs
frequent-small *for the same mean* — and frequent-small lands inside the cable's
"handle-it-all-day" regime (mm-to-cm waves), while rare-large produces the dangerous tail (the 160 m event). Smaller units are also independently easier to make fail-soft: less
stored grip energy, less mass to arrest. The principled sizing rule is therefore **not
"fewest sources" but "the largest climber whose credible worst-case single-fault impulse $M_c\cdot\Delta v_{\perp,\max}$ stays under the cable's single-event amplitude budget."** That couples climber mass to the suspension force-limit: with a ~1 m budget (J ≈ 6,300 kg·m/s), a suspension
that caps a runaway unit at $\Delta v_\perp \le 0.1$ m/s allows $M_c \lesssim 60$ t; cap it at 0.01 m/s and
~600 t is fine. Choose the *fewest* climbers — to limit gripper interfaces (each a fatigue
and micrometeoroid concentration site) and traffic-phasing complexity — **subject to** that consequence ceiling, not by ignoring it.

## Climber cruise speed: an optimum, not a limit

The coast speed of the climbers drives almost everything downstream: the live mass riding the cable, and through it the taper, the tether mass, and the minimum counterweight. The right way to choose it is to ask which constraint binds *first*. Four candidates compete, and the useful result is that three have enormous headroom — so the operating speed is set by the fourth, which is not a hard wall but an **economic optimum**.

### 1. The hard ceiling (wave speed) is far above any operating point

A climber rolling on a tensioned cable is dynamically a moving load on a string — the same problem as a railway pantograph on a catenary. The limiting speed is the transverse wave speed already derived above:

$$
c = \sqrt{\sigma_\text{eff}/\rho} = \sqrt{14\times10^9 / 1400} \approx 3{,}160\text{ m/s}
$$

The climber's effective Mach number is $M = v/c$, and the steady deflection under the moving contact amplifies as $1/(1 - M^2)$. At 200 m/s, M = 0.06 (amplification 1.004 — nil); even at 1,000 m/s, M = 0.32 (amplification 1.11). Pantograph practice keeps running speed below ~0.7 c to avoid contact loss; here that is ~2,200 m/s. **The physics ceiling is ~1.5–2 km/s, and nothing we would actually want to run approaches it.** This bounds the top, not the operating point.

### 2. The smoothness budget does not force low speed

"Slow, smooth acceleration" constrains *jerk*, not top speed, because the available distance is enormous. At a gentle $a = 0.2$ m/s² (≈ 0.12 lunar g, a fraction of what the drive already exerts against gravity near the surface), $d = v^2/2a$ gives 400 m/s in 400 km and 1,000 m/s in 2,500 km — small slices of the ~220,000 km run, well inside the climb-out of the gravity well. Any sane cruise speed is reached gently long before clearing the well.

### 3. The benefit: live mass on the cable falls as 1/v

This is the lever that matters. The live load riding the cable is

$$
M_\text{live} = \dot m \cdot t_\text{trip} = \dot m \cdot L/v \propto 1/v
$$

- $M_\text{live}$ — live (cargo) mass riding the cable at any moment
- $\dot m$ — cargo delivery rate
- $t_\text{trip}$ — one-way trip time, $L$ — cable length, $v$ — cruise speed

At the calculator defaults (30,700 t/day, L ≈ 220,000 km), that is ~430 kt on the cable at
200 m/s — comparable to the entire tether mass. Because the cable is sized loaded, that live
mass inflates both the taper (tether self-mass) and the minimum counterweight. Re-sizing the
structure at each speed, holding throughput, material and counterweight headroom (2.35×) fixed:

| Climb speed | Trip time | Counterweight | Tether | Structure total | vs. 200 m/s |
| ----------- | --------- | ------------- | ------ | --------------- | ----------- |
| 100 m/s     | 25.5 d    | 1,650 kt      | 603 kt | 2,344 kt        | +62%        |
| 200 m/s     | 12.8 d    | 998 kt        | 361 kt | 1,450 kt        | —           |
| 300 m/s     | 8.5 d     | 780 kt        | 280 kt | 1,152 kt        | −21%        |
| 400 m/s     | 6.4 d     | 672 kt        | 240 kt | 1,002 kt        | −31%        |
| 600 m/s     | 4.3 d     | 563 kt        | 200 kt | 853 kt          | −41%        |
| 800 m/s     | 3.2 d     | 509 kt        | 179 kt | 779 kt          | −46%        |
| 1,000 m/s   | 2.6 d     | 476 kt        | 167 kt | 734 kt          | −49%        |
| 1,500 m/s   | 1.7 d     | 433 kt        | 151 kt | 674 kt          | −53%        |

The marginal saving per +100 m/s roughly halves each step (200→300 saves ~300 kt; 600→800 saves ~37 kt per 100). **The knee is around 400–600 m/s.** Below ~300 you pay a steep mass penalty; above ~800 the savings are nearly spent — what remains is the irreducible self-weight of cable and track, which speed cannot touch.

### 4. The cost: wear rises as v², fatigue much faster

Slightly counter-intuitively, baseline wear does *not* scale with speed. Archard's law,

$$
W = K \cdot F_N \cdot s / H
$$

- $W$ — worn volume, $K$ — wear coefficient, $F_N$ — normal contact force
- $s$ — sliding distance, $H$ — hardness of the softer contact member

makes wear proportional to contact distance $s$ — and for a fixed tonnage delivered, total rolling distance over the track is fixed regardless of speed. Faster climbers do the same grinding in less time, not more of it.

What genuinely scales with speed is the **dynamic** contact force from track irregularities. A wheel of unsprung mass $m_u$ crossing a waviness of amplitude $\delta$ and wavelength $\lambda$ at speed $v$ sees

$$
\Delta F = m_u \cdot \delta \cdot (2\pi v/\lambda)^2 \propto v^2
$$

That $v^2$ peak force drives the damaging mechanisms: rolling-contact fatigue, whose life goes as $N_f \propto (\text{stress})^{-m}$ with $m \approx 3\text{–}6$, so damage per pass climbs steeply; flash heating in the contact (no convection in vacuum — radiation only); and momentary contact loss followed by slam-down and galling, the same mode that limits pantograph speed. These fluctuations are also exactly what pumps transverse waves into the cable during *steady* running, so "move smoothly" applies to cruise, not only to stops. Active suspension absorbs ΔF into its stroke, but the bandwidth and stroke it must provide themselves grow with v.

Power is a secondary check, not a binding one: lift energy is fixed at ≈ 2.7 GJ/t (it is just
the potential climb ΔΦ, independent of v); the kinetic term ½v² is a small, largely recoverable add — 3% of lift energy at 400 m/s, 18% at 1,000 m/s — so power does not bite until ~km/s.

### Conclusion: design around ~400 m/s (band 300–600)

The limit is the crossing of a benefit that saturates past ~600 m/s (structural mass ∝ 1/v) against a cost that accelerates (wear ∝ v², fatigue steeper). They meet in the few-hundred-m/s range. A central design point of **~400 m/s** — double the 200 m/s working default — captures most of the available saving (structure −31%, 1,450 → 1,002 kt going 200 → 400), while sitting at M = 0.13 dynamically and only ~4× the 200 m/s dynamic contact force at equal track quality. Pushing past ~600–800 m/s pays rapidly rising wear and suspension cost to chase savings that have largely run out. The decisive levers are therefore **track surface quality (δ, λ) and suspension bandwidth**, not the cable dynamics: improve those and the optimum shifts up; if track replacement is costly or hard to service, it shifts down toward 300.

### Emergency response: jettison and drift, not brake-and-hold (except low down)

The favoured failure response for a climber in trouble in the **mid-to-upper** structure is to
**release the cable and let the orbital mechanics carry it clear**, then recover it with a tug
from L1 or the counterweight. A released climber is at rest relative to the structure at the
instant of release, so what carries it off is the net effective gravity (which points *away*
from L1 on either side) plus the Coriolis deflection it picks up as it starts to move. Both act
to separate it from the cable line. Integrating the planar rotating-frame (CR3BP) trajectory of
a climber released at rest at various radii:

| Release point             | Time to clear 10 km laterally | Time to clear 100 km | Lateral offset at 5 d |
| ------------------------- | ----------------------------- | -------------------- | --------------------- |
| Mid-cable (30,000 km)     | 3.7 h                         | 8.0 h                | ~6,000 km             |
| Just below L1 (57,000 km) | 14.3 h                        | 30.6 h               | ~7,800 km             |
| Just above L1 (60,000 km) | 11.6 h                        | 24.9 h               | ~14,500 km            |
| Upper cable (120,000 km)  | 4.1 h                         | 8.8 h                | ~174,000 km           |

In every case the climber drifts >100 km off the cable line within roughly a day, and tens of
thousands of km within five — ample for an ephemeris-planned tug intercept, at relative speeds
of only tens of m/s. The slowest separation is right at **L1**, the neutral point, where the
net radial force vanishes and the climber lingers longest (~1.3 days to 100 km) — but that is
exactly where a recovery tug would be stationed, so the worst case for clearance is the best
case for recovery.

**The exception is low in the gravity well.** There the net effective force is strong and
Moonward, so a released climber does not drift clear — it falls back toward the Moon and the
base, on a wild Coriolis-bent trajectory. Below roughly L1/3 the correct response is therefore
**brake and hold, or descend under control**, not release; the jettison option belongs to the
long mid-and-upper run where the climber is already near force balance and a gentle nudge
separates it cleanly. (Worth a follow-up: a per-radius map of the jettison-safe zone, and the
tug Δv budget for the L1-loiter worst case.)

## Caveats and unquantified effects

- The ±31,000 km swing is a rigid-rod upper bound; a flexible tether swings somewhat less but still by many thousands of km.
- Slow modulations not quantified here: apsidal precession (8.85 yr), nodal regression (18.6 yr), and direct solar tidal forcing, which slowly shift the swing amplitudes.
- L1 is only metastable along the line; the radial mode requires tension/active control regardless of the above.

## Bottom line

Tension and material strength are straightforward for a Moon–L1 elevator. The defining
challenges are dynamic: a continuous, large-amplitude monthly pendulum swing (tens of
thousands of km at the tip) at a ~8-day natural period — comfortably below the monthly
forcing, so only mildly amplified — together with ±~30% monthly tension cycling and
day-scale transverse wave modes excited by traffic and impacts. None appears to be a
showstopper. The system must be engineered as a swinging, breathing structure —
gimballed base, vehicles that ride the motion with bidirectional grip and pull/brake
drives, ephemeris-based position prediction, and smooth, coordinated traffic with active
vibration damping. Climber cruise speed is not capped by any of this — it is an economic
optimum around ~400 m/s, set by trading structural mass (∝ 1/v) against track wear (∝ v²),
with jettison-and-drift the natural emergency response over the mid-and-upper run.
