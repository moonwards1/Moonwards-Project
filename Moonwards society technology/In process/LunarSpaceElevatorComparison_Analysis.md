# Architecture Verdict: Moon→L1 Space Elevator vs. Skyhook + Mass Driver

*Companion analysis to `LunarSpaceElevatorComparison.md`. Numbers reproduced from
`MoonL1ElevatorCalc` (Moon‑L1 elevator) and from `LunarSkyhook.md` /
`Gravity-gradient-skyhooks` (skyhook). All elevator figures below were recomputed
from the calculator's own physics so the three altitude options can be compared on
equal footing.*

---

## 1. What is actually being compared

The parent document says the test is **Phase 2** — operations expanded to Ceres and
Psyche — and that an architecture "fails the test" if it works in the Earth–Moon
context but falls down when higher volumes or other bodies are involved. That framing
matters, because two of the rows in the original table quietly compare *different
phases of the two systems against each other*. Most importantly the **tether‑mass
row** (elevator ~466 kt vs skyhook ~111 kt) pits a Phase‑2‑capable elevator against
the **Phase‑1** (2,000 km) skyhook. The fair Phase‑2 skyhook is the **6,000 km Version
A**, whose extension alone is far heavier. Correcting that mismatch changes the story,
so this analysis restates every quantity on a like‑for‑like Phase‑2 basis.

Three elevator candidates are on the table:

- **150,000 km** counterweight — the calculator default. Releases into a high ellipse.
- **222,000 km** — Note 1's "release straight onto an entry trajectory" option.
- **190,000 km** — Note 1's "hand cargo to an Earth skyhook at ~7,000 km" option.

Against the skyhook in two builds: **Phase 1** (top at 2,000 km) and **Phase 2 Version
A** (top raised to 6,000 km so release speed reaches Ceres' orbit).

---

## 2. The governing physics (so the numbers are reproducible)

Coordinate $r$ = distance from the Moon's centre toward Earth; Earth at $r = D$;
barycentre at $x_b$ from the Moon; system spin rate

$$
\omega = \sqrt{\frac{G(M_\text{Earth}+M_\text{Moon})}{D^3}} = 2.665\times10^{-6}\text{ rad/s} \quad\text{(sidereal month)}
$$

Effective along‑line specific force and potential:

$$
g(r) = \frac{GM_\text{Earth}}{(D-r)^2} - \frac{GM_\text{Moon}}{r^2} + \omega^2(r - x_b)
$$

$$
\Phi(r) = -\frac{GM_\text{Moon}}{r} - \frac{GM_\text{Earth}}{D-r} - \tfrac{1}{2}\omega^2(r - x_b)^2
$$

- $\omega$ — system spin rate, $r$ — distance from the Moon's centre toward Earth
- $D$ — Earth–Moon distance, $x_b$ — barycentre offset from the Moon
- $GM_\text{Earth}$, $GM_\text{Moon}$ — gravitational parameters of Earth and the Moon
- $g(r)$ — net along-line force, $\Phi(r)$ — the matching effective potential

$g = 0$ at L1 (≈58,000 km from the Moon). Below L1 the net force points at the Moon
(the tether "hangs up"); beyond L1 it points outward, and that outward pull on the
counterweight is what holds the whole thing in tension.

A fully tapered constant‑stress cable at operating stress $\sigma_\text{eff} = \sigma_\text{ult} / SF$ has

$$
A(r) = A_\text{cw} \cdot \exp\!\left[\frac{\rho}{\sigma_\text{eff}}\cdot(\Phi(r) - \Phi(r_\text{cw}))\right]
$$

$$
T(r_\text{cw}) = m_\text{cw} \cdot g(r_\text{cw}) \qquad A_\text{cw} = T(r_\text{cw})/\sigma_\text{eff}
$$

$$
\text{taper ratio} = \exp\!\left[\frac{\rho}{\sigma_\text{eff}}\cdot\Delta\Phi\right] \qquad \text{tether mass} = \rho \int A(r)\, dr
$$

- $A(r)$ — cable cross-section at $r$; $A_\text{cw}$ — cross-section at the counterweight
- $\sigma_\text{ult}$ — material ultimate strength, $SF$ — safety factor, $\rho$ — cable density
- $T(r_\text{cw})$ — tension at the counterweight, $m_\text{cw}$ — counterweight mass
- $\Delta\Phi$ — potential difference between the counterweight and the surface

On release, a capsule keeps the rigid‑body tangential speed at the counterweight,
relative to Earth:

$$
v_\text{rel} = \omega\cdot(D - r_\text{cw})
$$

$$
\varepsilon = \frac{v_\text{rel}^2}{2} - \frac{GM_\text{Earth}}{r_\text{rel}} \qquad r_\text{rel} = D - r_\text{cw}
$$

$$
a = -\frac{GM_\text{Earth}}{2\varepsilon} \qquad r_\text{perigee} = 2a - r_\text{rel} \quad\text{(release point is the apogee)}
$$

- $v_\text{rel}$ — release speed relative to Earth, $r_\text{cw}$ — counterweight's radial position
- $\varepsilon$ — specific orbital energy of the released capsule's post-release orbit
- $a$ — that orbit's semi-major axis, $r_\text{perigee}$ — its perigee radius

The lift energy per tonne to L1 (the climber's real work) is

$$
E/\text{tonne} = \Delta\Phi(\text{surface}\to\text{L1}) / \eta_\text{drive}
$$

- $\eta_\text{drive}$ — climber drive efficiency

These are the formulas the tables below come from.

---

## 3. The numbers, restated like‑for‑like

### 3a. Elevator, the three altitude options

Material assumption stated explicitly each time, because — as Section 4 shows — it is
the single biggest lever. "Best silica" = 17 GPa, 2,300 kg/m³ (what the parent doc's
466 kt figure implies). "Mature CNT" = 42 GPa, 1,400 kg/m³.

| Elevator option                            | Tether mass  | Peak tension @L1 | Release v_rel | Perigee altitude         | Δv to reenter | One‑way climb @200 m/s | Lift energy |
| ------------------------------------------ | ------------ | ---------------- | ------------- | ------------------------ | ------------- | ---------------------- | ----------- |
| **150,000 km**, silica, SF 4, 1 Mt cw      | **466 kt**   | 6.2 MN           | 625 m/s       | 24,000 km (HEO)          | **324 m/s**   | 8.6 days               | 3.2 GJ/t    |
| 150,000 km, *mature CNT*, SF 4, 1 Mt       | 109 kt       | 5.6 MN           | 625 m/s       | 24,000 km                | 324 m/s       | 8.6 days               | 3.2 GJ/t    |
| **222,000 km**, silica, SF 4, 1 Mt cw      | **2,364 kt** | 22.5 MN          | 433 m/s       | **73 km (direct entry)** | **~1 m/s**    | 12.8 days              | 3.2 GJ/t    |
| 222,000 km, *mature CNT*, SF 4, 1 Mt       | 445 kt       | 15.7 MN          | 433 m/s       | 73 km                    | ~1 m/s        | 12.8 days              | 3.2 GJ/t    |
| 222,000 km, *mature CNT*, SF 4, **0.5 Mt** | 222 kt       | 7.8 MN           | 433 m/s       | 73 km                    | ~1 m/s        | 12.8 days              | 3.2 GJ/t    |
| **190,000 km**, mature CNT, SF 4, 1 Mt     | 239 kt       | 9.7 MN           | 518 m/s       | 7,250 km                 | 156 m/s       | 10.9 days              | 3.2 GJ/t    |

Two facts jump out of this table and they define the elevator's whole dilemma:

1. **The 222 km "direct‑entry" option costs ~5× the tether mass of the 150 km option
   in the same material** (2,364 kt vs 466 kt in silica). The on‑cable cargo at any
   moment rises to ~391,000 t, matching Note 1's "almost 400,000 tonnes." Kim's
   suspicion in Note 1 is correct: in silica it gets very heavy, and the maintenance
   surface (length × mass exposed to micrometeoroids) balloons with it.
2. **Switching to mature CNT collapses that penalty** — 222 km drops from 2,364 kt to 445 kt, and you can halve the counterweight (the outward $g(r_\text{cw})$ is larger
   further out, so $T_\text{cw} = m_\text{cw}\cdot g(r_\text{cw})$ still holds with less mass) to reach 222 kt.

So "is the 222 km elevator absurd?" has no single answer — it depends entirely on
whether mature CNT is in hand. Which is exactly the question the skyhook Phase‑2 build also turns on.

### 3b. Skyhook, Phase 1 vs Phase 2

| Skyhook build                                | Tether mass                                                  | Top altitude | One‑way climb      | Earth arrival          | Station‑keeping                                     | Energy/tonne                                                                         |
| -------------------------------------------- | ------------------------------------------------------------ | ------------ | ------------------ | ---------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Phase 1 (2,000 km)                           | ~111–148 kt (silica)                                         | 2,000 km     | ~2.5 h @ 50–80 m/s | natural reentry, ~0 Δv | VASIMR, 86 kg O₂/t                                  | 6.3 GJ/t                                                                             |
| **Phase 2 Version A (6,000 km), early CNT**  | **6,600 kt** (taper 44); ~4,100 kt with multi‑cable @ SF 2.6 | 6,000 km     | hours              | natural reentry        | 43 kg O₂/t routine; **935 kg O₂/t** in Ceres bursts | 4.1 GJ/t (down to ~10 GJ/t incl. deep‑extension station‑keeping with regen recovery) |
| **Phase 2 Version A (6,000 km), mature CNT** | **760 kt** (taper 5)                                         | 6,000 km     | hours              | natural reentry        | as above                                            | as above                                                                             |

The crucial correction: **the honest Phase‑2 mass comparison is not 466 vs 111.** It is

- Elevator (Phase‑2‑capable, i.e. the 150 km HEO build or the 222 km direct build):
  466 kt → 2,364 kt in silica, or 109 kt → 445 kt in mature CNT.
- Skyhook Phase 2 (6,000 km): 6,600 kt in early CNT, 760 kt in mature CNT.

In **early/imperfect CNT the skyhook extension is the heavier structure by far**; in
**mature CNT the two are within a small factor of each other** (skyhook ~760 kt vs a
150 km elevator ~109 kt — here the elevator is lighter, but it cannot do the
interplanetary job, see Section 5). The "skyhook wins on mass" claim in the parent
table is an artifact of comparing its Phase‑1 tether against the elevator's Phase‑2
tether. On a true Phase‑2 footing, **mass is roughly a wash and depends on CNT
maturity**, not on the architecture.

---

## 4. Where each architecture is genuinely strongest

**The elevator's real, durable advantages** (these are physics, not engineering luck):

- **Passive station‑keeping.** The counterweight holds tension for free; there is no
  propellant line item at all. The skyhook must run a VASIMR array burning oxygen
  (43–86 kg/t routinely, and ~935 kg/t in the Ceres‑launch bursts) to replace the
  momentum climbers steal as they ascend. This is the elevator's single best card.
- **Lowest lift energy per tonne** (3.2 GJ/t vs the skyhook's 4.1–6.3 GJ/t), because
  it only has to climb the potential well to L1, where net weight is zero.
- **Climb anytime.** No launch window; cargo leaves the top into the *same* transfer
  geometry every time. (The skyhook's 2.25‑hour windows are a minor constraint.)
- **No launch‑to‑structure infrastructure.** No mass driver, no catcher complex, no
  35 m/s shuttle Δv, no rail line from Lalande. You just climb.
- **Free local reach.** Surface points hundreds of km from the base can be tied
  directly into the lower tether for almost nothing.

**The skyhook + mass driver + catcher's real, durable advantages:**

- **It actually launches to Ceres and Psyche.** Raising the tip to 6,000 km gives the
  release speed an apoapsis at Ceres' orbit *as a structural property*. This is the
  decisive one — see Section 5.
- **Natural Earth‑reentry geometry.** Release drops capsules straight onto an entry
  trajectory with essentially no burn. The 150 km elevator instead leaves them in HEO needing **324 m/s per tonne**, which (as the parent doc notes) exceeds the *total*
  per‑tonne propellant of all skyhook operations.
- **Compactness → low maintenance surface.** 2,000–6,000 km of structure versus
  150,000–222,000 km. The elevator exposes roughly **25–100× the linear extent** to
  micrometeoroids and needs maintenance equipment to cover those distances, plus more climbers and more track wear to move the same cargo (climb is 8.6–12.8 days vs ~2.5
  hours).
- **Far richer launch menu.** Strong Oberth opportunities, prograde *or* retrograde
  release, plane‑change tricks via Earth flyby, trajectory bending to advance/delay
  arrival — and the mass driver is multi‑role hardware that earns its keep elsewhere.
- **Dynamically simple.** A compact orbiting body, versus an elevator that (per
  `MoonL1ElevatorDynamics.md`) swings tens of thousands of km laterally every month near a ~14.5‑day natural period, cycles ±20% in tension monthly, and rings with ~10‑hour transverse waves that constrain operations to "move smoothly, not slowly." None of this is a showstopper, but it is real added control complexity at the exact
  moment you want to push volume up.

---

## 5. The decisive Phase‑2 issue: interplanetary reach

This is where the comparison stops being a list of trade‑offs and produces a winner.

The elevator's release speed is fixed by geometry: $v_\text{rel} = \omega\cdot(D - r_\text{cw})$. Pushing the
counterweight *out* to launch faster actually **lowers** $v_\text{rel}$ (the release point
moves closer to Earth), which is why the 222 km build releases *slower* (433 m/s) than
the 150 km build (625 m/s) and plunges to a low perigee rather than flinging outward.
The elevator is built to drop things *toward Earth*, not throw them *away from it*. The
only way to get real outbound velocity is a **spin launcher on the counterweight**, and
to react that throw without flinging the counterweight off station you must make the
counterweight far more massive — the launcher taper itself scales as
$\exp(v_\text{tip}^2/(2\cdot\sigma/\rho))$, brutal at interplanetary tip speeds. The parent doc's own
conclusion ("a spin launcher would have to deal with a huge Δv boost and require the
counterweight become far larger") is the right one.

The skyhook gets interplanetary speed the cheap way: it is *already* a rotating/orbiting
launcher, so extending the tip from 2,000 to 6,000 km adds release speed directly, with
no new launch mechanism — just more cable and more station‑keeping fuel during the rare Ceres windows (produced over the years between windows, so the average rate is modest).

**The project's stated test is volume + interplanetary reach + robust expansion.** The elevator is excellent at the cislunar bulk‑freight half and structurally poor at the
interplanetary half. The skyhook is good at both and *designed to grow into the second*.

---

## 6. The open questions, answered

- **Which trades better with the Earth skyhook?** The **190,000 km elevator variant**
  is a genuinely elegant option here: it releases at 518 m/s onto a 7,250 km perigee,
  i.e. straight at an Earth‑skyhook upper tether sitting ~7,000 km up, needing only
  ~156 m/s of cleanup. But it *depends* on that Earth tether being built of top‑grade
  CNT and placed high (Note 1's own caveat). The lunar skyhook trades well too via its flexible prograde/retrograde release and Oberth options. Net: the elevator can win this *one* narrow row — if and only if the Earth skyhook is built to suit it.
- **Can the counterweight be lighter?** Yes. Because tension at the counterweight is
  $T_\text{cw} = m_\text{cw}\cdot g(r_\text{cw})$ and $g(r_\text{cw})$ grows with distance, the 222 km build holds the same structure with **half** the counterweight (0.5 Mt → 222 kt tether in CNT). The 150 km build is less forgiving (smaller outward $g$ there).
- **Does low tether tension throttle high‑volume travel?** Not directly. Peak tension
  (~6 MN at L1 for the 150 km silica build) and the *extra* tension from a full cargo
  column are a small fraction of the safety margin. The real speed limiter is the
  transverse wave speed $c = \sqrt{\sigma_\text{eff}/\rho} \approx 3{,}870$ m/s: abrupt or uncoordinated climber
  motion pumps ~10‑hour cable modes. The rule is smooth, scheduled, damped traffic —
  a control problem, not a throughput ceiling.

---

## 7. Verdict — there is a clear winner

**For the Phase‑2 mandate as the project defines it, the skyhook + mass driver +
catcher complex is the clear winner.**

The reasoning, in one line: *the elevator wins the convenience rows; the skyhook wins
the rows the project itself declared decisive.*

Unpacking that:

- The elevator's wins (passive station‑keeping, lower lift energy, climb‑anytime, no
  launch infrastructure) are real but are the parent doc's own "minor points," or are
  conveniences rather than capability ceilings.
- The skyhook's wins are on the criteria the doc says define success: **interplanetary
  launch** (the elevator structurally cannot do this cheaply), **natural Earth reentry**
  (the elevator pays 324 m/s/tonne forever, or builds a 2,364 kt silica tether to
  avoid it — both bad), and **graceful, compact, low‑maintenance scaling** to high
  volume (the elevator's 25–100× length penalty bites hardest exactly as volume rises).
- The headline "elevator is 4× heavier" claim is *overstated* (it compares phases
  unequally; on a true Phase‑2 footing mass is a CNT‑maturity wash) — but correcting it does **not** rescue the elevator, because mass was never its losing argument. Reach and operations are.

**Where the elevator would instead be the right call:** if the project's centre of
gravity were *cislunar only* — pure Moon↔Earth bulk freight with no Ceres/Psyche
requirement — and mature CNT were available, the elevator becomes very attractive:
~109 kt, propellant‑free, operationally simple, drama‑free scheduling, with free local
surface tie‑ins. It is the interplanetary requirement, not any Earth‑Moon shortcoming,
that sinks it. If Phase 2 is real, build the skyhook.

**Caveats on the verdict.** Both Phase‑2 builds live or die on CNT quality (skyhook
6,600→760 kt, elevator‑222 2,364→445 kt as silica→mature CNT). The elevator's monthly swing and wave dynamics are characterized but not yet fully engineered. And the lunar skyhook's Ceres‑burst fuel demand (~935 kg O₂/t) is large in the moment even if cheap on average — worth confirming the oxygen supply chain can buffer it. None of these changes the ranking; they're the next things to pin down.
