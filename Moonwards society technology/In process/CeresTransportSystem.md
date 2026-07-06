# Ceres transport system

## Relevant facts

* Sidereal year 4.6 y  
* Synodic year 1.28 y  
* Inclination 10.6°  
* Axial tilt 4°  
* Day length 9.074 h
* Perihelion 2.55 AU, semi-major axis 2.77 AU, aphelion 2.98 AU
* Eccentricity 0.0785
* A pattern of 18 launch windows over ~23 years, successive windows 100° apart, in all spaced every 20°, cycle repeats with minimal drift

## Requirements and Parameters:

* Enough cargo must arrive from Ceres each year to provide all the needed inputs for the exports the moon sends to Earth  
  * 6 megatonnes of carbon for CNT, graphene, carbides, and other materials  
  * 1.5 megatonnes of nitrogen, lithium, boron, copper, hydrogen, chlorine, and fluorine for sundry uses  
* An average of 9.6 megatonnes must launch from Ceres every window to maintain this supply
  * If done over the course of 20 days, 

## Ceres-moon flights

- Every launch window, 160 ships leave Ceres over the course of 20 Earth days
  - 3 ships are launched per Ceres day, at the moment the Ceres space elevator is moving exactly retrograde to Ceres' orbit
- The ecliptic latitude of Ceres during a window is compensated for by the spin launcher at the end of the space elevator. It is used to do a plane change, rotating ship trajectories around their radial axis. The periapsis of the trajectory is also lowered. The net trajectory is set up to encounter Earth some time before or after periapsis. 
- When ships arrive, they do an aerobrake maneuver through Earth's atmosphere
  - This slows the ship enough to enter a very eccentric Earth orbit in which its apoapsis is near the edge of Earth's SOI
  - When it reaches this apoapsis, it does a burn to change its inclination and raise its periapsis such that it will encounter the moon and enter its orbit. Possibly it will need to do two burns, on successive apoapses, in order to cheaply set up a good encounter. 
- Once in lunar orbit, a tug is sent out from lunar installations to meet the ship. The tug then attaches to the ship and uses its own engines to bring the ship in to the outer docs
- The arrival at Earth of all the ships launched in one window is spread over a few days
- There is no hurry to bring these ships in to dock, as the Ceres fleet numbers approximately 1500 ships. They don't need to depart again for at least a year at the earliest, and probably not for more than two years.

## Moon-Ceres flights

- Launches to Ceres can't take advantage of aerobraking to get into Ceres orbit. They have to be able to easily set up capture by one arm of the spin launcher on the Ceres space elevator, which then slows them down and reels them in to the counterweight.

- If a spin launcher is involved in launch from the moon's environs (connected to the skyhook or space elevator), a plane change plus a small overshoot of the orbit of Ceres can be used to set up an encounter with Ceres when it is some distance above or below the ecliptic. But this is worthwhile when the ecliptic latitude on arrival is low. If it is nore than a few degrees, the approach angle on the Ceres end becomes too steep for a capture by the Ceres spin launcher to be feasible, much less safe.

- For these reasons, many Hohmann transfer launch windows are skipped. Only the ones where Ceres will be less than 3 or 4 degrees from the ecliptic are used, and the maximum possible fraction of all ships are launched on the very best windows.

- If only a skyhook is used, the ships need to carry enough fuel for a small plane change when they cross the node - a significant cost. On the other hand, when they arrive at Ceres their relative speed will be lower than is the case for ships thrown past the orbit of Ceres at launch, in order to get them to cross Ceres orbit with the right ecliptic latitude.

- If a spin launcher is also used, the ships do only part of the plane change themselves, or possibly none - so they only need to carry enough fuel for course corrections. But, they will be moving faster when they reach Ceres, as they won't be at apoapsis - instead they are rising towards apoapsis, on a trajectory that is inclined enough for them to be at the ecliptic latitude of Ceres on arrival. 

## The Ceres fleet

- mass 3000 tonnes empty (? Do they need to be heavier, in order to handle 10 g aerobraking through Earth's upper atmosphere?)
  
  - with methane/LOX chemical engines built for many burns with long idle periods between
  
  - Strong light frame of CNT composites and cable combined with lightweight lunar alloys and MMCs
  
  - Operation is completely crewless. There are no life support systems and no pressurized holds.

- Ceres ships mass between 3700 and 4200 tonnes at launch from the moon, depending on delta v required for the flight
  
  - Carry 500 tonnes of cargo, being components and machinery needed for the upkeep and improvement of Ceres operations
  
  - The remainder is fuel - between 200 and 700 tonnes of it, for up to 700 m/s delta v, for an Oberth maneuver at Earth, plus small plane change at node crossing of up to 1.2°

- They must withstand repeated aerobraking at very high speed, repeated capture by spin launchers (and likely launch by them as well), and years of travel in deep space

- They are maintained and repaired in lunar facilities, and can receive less thorough servicing in Ceres facilities

- Their heat shields are single use. They are made of PICA tiles fabricated and installed on Ceres. Thay mass about 2700 tonnes when installed. After arrival at their lunar facility, the used tiles are removed and processed for their content of carbon (and any remaining hydrogen). That is, they are treated as cargo.

- They leave Ceres carrying the methane needed to return, and are fueled with LOX at both ends of the journey

- They carry 60,000 tonnes of cargo from Ceres

# Major transport infrastructure

## Space elevator at Ceres with spin launcher at tip, for launch, and capture of arriving ships

* Anchored on the equator of Ceres, with a length of 20000 km above the equator, the tip has an angular velocity of 3.94 km/s  
  * The counterweight at the tip is massive enough to allow for heavy traffic, and has lots of facilities for fueling, berthing, and ship capture  
    * A large fraction of the counterweight mass is actually the empty ships waiting to be loaded for their return trip  
  * Incoming ships need only do small maneuvers in order to arrive in the right spot with a small relative velocity  
* The CNT cables are strong enough to handle several megatonnes of mass on the elevator at once, distributed along its length  
  * As surface production provides product, it is taken up the elevator to geosynchronous altitude, and stored there  
  * As the launch window approaches, climbers move up the cable, very heavy with cargo  
  * They park in a queue, far enough from the tip to minimize their strain on the cables, near enough that the next climber can reach the tip in time for their loads to be transferred onto ships, and then those ships are released at the moment that puts them on trajectory to Earth  
* If the launch window is also 20 days, that is 53 orbits available for the entire 9.6 megatonnes of cargo to be set on its journey to the moon  
  * 181 kilotonnes must be launched per orbit, on 3 ships  
  * The elevator cables should be sized to handle perhaps 2.5 megatonnes at the tip, for any eventuality

## Possible ship configurations

### Methane / LOX chemical engines

# Spin launchers — design conclusions and sizing tools

The plan puts a spin launcher at the tip of the Ceres space elevator (for launch and
capture) and contemplates one on the Moon skyhook/elevator for the outbound leg. This section records what the physics says about whether that is viable, how to size it, and the two calculators built to explore it.

## Is a tip spin launcher viable?

Yes, for this society, with caveats. The spin launcher is a short, fast tension arm that
takes over part of the velocity job from the long, slow main tether, and it adds a
genuine second axis of freedom for plane changes. Key findings:

- **Strength is not the limit.** A spinning arm at constant stress has a hub/tip taper
  ratio of $\exp\!\left(v_\text{tip}^2 / (2\sigma/\rho)\right)$. It depends only on **tip speed, not arm length**.
  For mature CNT (σ/ρ ≈ 15 MJ/kg at safety 2) even a few km/s of tip speed is a taper of ~1.1–1.8 — trivial. Peak tip force $m\cdot v_\text{tip}^2/r$ actually *falls* with arm length.
- **g-load makes it cargo-only.** Tip acceleration is $a = v_\text{tip}^2/r$. People can't ride
  it (human-tolerable g would need arms hundreds of km long); but the Ceres freighters are crewless bulk carriers built for repeated aerobraking, so ~10 g is fine, and the raw-material cargo tolerates far more.
- **A long arm cures the secondary problems.** At fixed tip speed, lengthening the arm lowers g ($v^2/r$), spin rate ($\omega = v/r$), released-payload tumble (= ω), and
  release-timing sensitivity (pointing error = $\omega\cdot dt$) — all as 1/r. So you make the arm
  just long enough for the cargo's g limit.
- **Use a counter-rotating pair** (one ship arm, one equal counter-mass arm). It balances the centre of mass during spin-up and stores almost no *net* angular momentum, so it exerts no net gyroscopic torque on the main tether as the whole structure swings round.
- **Energy is buffered, not free.** Energy to a payload per launch is $\tfrac{1}{2}\cdot m\cdot v_\text{spin}^2$,
  supplied actively (electric → flywheel → payload) between launches. Stored angular
  momentum $L = m\cdot v\cdot r$ grows with arm length (the real reason not to over-lengthen); stored *energy* $\tfrac{1}{2}mv^2$ does not.
- **Single-payload recoil is the open issue.** Releasing one ship leaves the hub with an uncancelled impulse $m\cdot v_\text{spin}$; the counterweight kick is $m\cdot v_\text{spin} / M_\text{hub}$. For the Ceres case (63,000 t ship, 2.5 Mt hub) that is ~33 m/s per launch — large. Either the counter-mass is released as reaction mass, ships are launched in balanced pairs, or the hub is much heavier. **Decision still open.**

Symbols used above: $v_\text{tip}$/$v_\text{spin}$ — arm tip (release) speed; $\sigma/\rho$ — cable specific strength; $m$ — payload mass; $r$ — arm length; $a$ — tip acceleration; $\omega$ — spin rate; $L$ — stored angular momentum; $M_\text{hub}$ — hub/counterweight mass.

## Ceres elevator + spin launcher (inbound, ships to Earth)

Release is retrograde at the tip; the spin launcher lowers periapsis (to reach Earth) and
does the plane change for Ceres' ecliptic latitude.

- Full-length elevator: **25,500 km → tip 4.996 km/s**, retrograde release reaches
  heliocentric periapsis **0.972 AU** (crosses Earth's orbit).
- Shortening to **20,000 km → tip 3.938 km/s**, periapsis rises to 1.21 AU (misses Earth) — so the spin launcher must restore ~1.06 km/s of retrograde throw.
- **Why shorten:** cable mass per kg of tip payload roughly **halves (2.91 → 1.43)**,
  taper drops (2.29 → 1.67), and the climb distance / number of loaded climbers in transit falls ~22%. The cost is shifted onto the spin launcher's power and angular-momentum budget (a long passive lever on Ceres' spin is replaced by active spin-up power).
- The launcher's two jobs combine as a vector: in-plane retrograde boost (to hit a
  target periapsis) and out-of-plane $v_\perp = v_\text{helio}\cdot\tan(\Delta i)$; required tip speed is
  $\sqrt{v_\text{boost}^2 + v_\perp^2}$. For 20,000 km, target periapsis ~1 AU, 3.5° plane change: **boost
  ~0.9–1.1 km/s, tip speed ~1.3 km/s, arm ~16–18 km at 10 g** — tens of km, not hundreds.
- **The natural input is target periapsis (AU)**, not a hand-entered boost: release being retrograde at Ceres' distance (the transfer aphelion), the heliocentric release speed is

  $$
  v = \sqrt{GM_\odot\left(\frac{2}{r_\text{Ceres}} - \frac{1}{a}\right)} \qquad a = \tfrac{1}{2}(r_\text{Ceres} + r_\text{peri})
  $$

  - $v$ — heliocentric release speed at Ceres' distance
  - $GM_\odot$ — the Sun's gravitational parameter
  - $r_\text{Ceres}$ — Ceres' heliocentric distance (the transfer aphelion)
  - $a$ — transfer orbit semi-major axis, $r_\text{peri}$ — target heliocentric periapsis

  That speed both sets the retrograde throw needed and is the velocity the plane change tilts.

## Moon skyhook/elevator + spin launcher (outbound, ships to Ceres)

The hard direction. The payload must climb out of the Moon's well **and** Earth's before
it is on a heliocentric transfer, so the launcher's job is set by inverting the
Moon→Earth→Sun chain from a target heliocentric apoapsis (~2.77 AU = Ceres):

1. apoapsis → heliocentric speed at 1 AU: $v = \sqrt{GM_\odot(2/r_E - 1/a)}$, $a = \tfrac{1}{2}(r_E + r_\text{apo})$
2. → $v_\infty$ at Earth $= v - V_\text{Earth}$
3. → Earth-relative speed at lunar distance $= \sqrt{v_{\infty,E}^2 + 2\cdot GM_E/a_\text{moon}}$
4. → $v_\infty$ from the Moon $=$ that $- V_\text{moon}$
5. → required launch-deck speed $= \sqrt{v_{\infty,\text{moon}}^2 + 2\cdot GM_\text{moon}/r_\text{deck}}$

- $r_E$ — Earth's heliocentric distance (1 AU), $r_\text{apo}$ — target heliocentric apoapsis (Ceres)
- $V_\text{Earth}$, $V_\text{moon}$ — Earth's and the Moon's own orbital speeds
- $a_\text{moon}$ — the Moon's distance from Earth, $r_\text{deck}$ — skyhook launch-deck radius

For Ceres this is steep: **36.1 km/s heliocentric → 6.33 km/s v∞ at Earth → 5.47 km/s
from the Moon → ~5.79 km/s launch-deck speed.** A small default skyhook (top ~1000 km) provides only ~2.12 km/s, leaving the launcher a 3.66 km/s prograde boost (≈4.28 km/s tip speed with the plane change) → a **~187 km arm at 10 g**. So a short Moon skyhook throws almost the whole job onto the launcher; **raising the skyhook's top/launch-deck altitude is the lever that shrinks the arm.** This quantifies the doc's note that the outbound leg is expensive and only the best (low-latitude) windows are worth using.

## Capture at Ceres (reverse use)

The Ceres tip launcher also catches arriving ships — the same machinery run backwards (max absorbable approach speed = tip speed; catch-g = $v^2/r$). This is why the Moon→Ceres approach angle must stay shallow: the existing constraint that Ceres be within ~3–4° of the ecliptic on arrival is, in part, a *capture* feasibility limit, not just a launch one.

## The calculators

Two tools were built (both reuse new pure helpers added to `Website/Shared/math-utils.js`:
`OrbitalMath.planeChangeComponent / spinReleaseSpeed / spinTipAccel / spinArmLength /
spinRate / spinPlaneTilt / spinTaperRatio`, all Node-tested):

- **`Website/Calculators/Tip-Spin-Launcher-Calculator/`** — Ceres space elevator + tip spin launcher (inbound). Inputs: body/cable/tip altitude, **target heliocentric
  periapsis (AU)** and plane-change angle; arm sized by a g-limit↔arm-length toggle, tip load, hub mass, launches/day, arm material. Outputs the derived retrograde boost,
  velocity tilted, tip speed, arm length, taper, mass, energy, power, angular momentum, gyro torque, recoil and timing.
- **`Website/Calculators/Skyhook-Spin-Launcher/`** — Moon gravity-gradient skyhook + tip spin launcher (outbound). Same arm-sizing engine, but driven by **target heliocentric apoapsis (AU)**, inverting the full Moon→Earth→Sun chain to get the required launch-deck speed and the launcher's share. Keeps all the original skyhook outputs.

Both assume the counter-rotating pair and report the single-payload recoil so the hub /
reaction-mass decision can be made with numbers.
