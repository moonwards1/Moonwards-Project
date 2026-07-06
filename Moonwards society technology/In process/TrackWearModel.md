# Climber Track Wear & Rolling-Contact Fatigue

A shared model for the running surfaces that climbers (cars) roll on, applicable to every
tracked tension structure in the architecture: the **Moon–L1 space elevator**, the **lunar
gravity-gradient skyhook**, and the **Ceres space elevator with tip spin launcher**. All
three move cargo along a tensioned cable on wheeled climbers; all three run in hard vacuum; all three want the track to last and the climbers to be cheap to maintain. The wear and fatigue physics is the same problem with different load and gravity numbers plugged in, so it belongs in one place. The companion piece is `MoonL1ElevatorDynamics.md`, whose "Climber cruise speed" section sets the speed that this model then prices in track wear.

The headline conclusions, up front:

- **The contact load on a cable climber is set by grip, not weight.** The wheels clamp the cable to transmit traction without slipping, so the contact force scales with the along-cable drive force (the effective weight of the loaded climber), divided by the traction coefficient. This is larger than the bare weight and is what the surfaces must survive.
- **In vacuum the enemy is adhesion, not abrasion.** Clean metal surfaces cold-weld; there is no oxide film to re-form after each pass. This rules metal-on-metal contact out and pushes the running surfaces toward hard covalent ceramics.
- **Diamond grit on a silicon-carbide (or magnesium-alloy/CNT) track is a viable pairing,** and at the worst location in the whole system — the foot of the Moon–L1 elevator — keeps the Hertzian contact stress around 0.5 GPa, an order of magnitude inside what these ceramics tolerate.
- **Deliberately make the wheel the wear member.** Concentrating wear on the small, swappable, mass-cheap wheel instead of the thousands-of-km track is the single biggest lever on lifecycle mass and downtime.

## 1. The contact picture: a clamped climber, not a loaded railcar

A train wheel is pressed onto the rail by gravity; the normal force *is* the weight. A cable
climber is different: it grips the cable from both sides and must transmit the entire
along-cable drive force by friction, so the wheels are **clamped** with a normal force large
enough that they do not slip. If the climber's effective weight (the along-cable force the
drive fights) is $W = M\cdot a_\text{eff}$ and the traction coefficient at the contact is $\mu_t$, then the total clamp force across all driven contacts must be at least

$$
N_\text{clamp} = W / \mu_t
$$

With per-climber effective weight $W$ shared over $N_c$ wheel contacts, the per-wheel normal force is

$$
F_N = \frac{W}{\mu_t \cdot N_c}
$$

- $W$ — climber's effective weight (along-cable drive force)
- $M$ — climber mass, $a_\text{eff}$ — local effective gravity
- $\mu_t$ — traction coefficient at the wheel/track contact
- $N_\text{clamp}$ — total clamp force needed across all driven contacts
- $N_c$ — number of driven wheel contacts
- $F_N$ — per-wheel normal (clamp) force

$F_N$ — not the weight — is what sets the Hertzian stress, the wear rate, and the fatigue life. Because $W = M\cdot a_\text{eff}$, contact severity tracks the local **effective gravity** along the structure (Section 7), and is therefore worst low in a gravity well and near a spinning tip, and mild near a centre of mass or stationary point.

$\mu_t$ matters twice over: a higher traction coefficient lowers the clamp force needed (good for contact stress) but a too-slippery surface forces more clamp and more gross slip (bad). This is why the traction surface choice (Section 5) is not a side issue.

## 2. Hertzian contact stress

For a crowned wheel of rolling radius $R_w$ against a track, treated as line contact of
length $b$ carrying load per length $F' = F_N/b$, the peak contact pressure is

$$
p_\max = \sqrt{\frac{F'\cdot E^*}{\pi\cdot R_w}} \qquad\text{with effective modulus}\qquad \frac{1}{E^*} = \frac{1-\nu_1^2}{E_1} + \frac{1-\nu_2^2}{E_2}
$$

- $p_\max$ — peak Hertzian contact pressure
- $R_w$ — wheel rolling radius, $b$ — contact length, $F' = F_N/b$ — load per unit length
- $E^*$ — effective contact modulus; $E_1,\nu_1$ / $E_2,\nu_2$ — the modulus and Poisson's ratio of each contacting material

(For a point/elliptical contact the equivalent is $p_\max = (6 F_N {E^*}^2 / (\pi^3 R_\text{eff}^2))^{1/3}$.) The thing to notice is the weak exponent: $p_\max \propto F_N^{1/2}$ for line contact, $\propto F_N^{1/3}$ for point contact. Contact stress is **forgiving of load** and the design knob is geometry (wheel radius, contact length, crown) and modulus, not just force. This is what lets a modest number of stiff ceramic wheels carry a meganewton-scale clamp force at safe stress.

## 3. Shakedown — the design gate

The first question for any rolling contact is not "how fast does it wear" but "does it stay
elastic." Under repeated rolling, a contact below the **shakedown limit** develops a
protective residual stress field and thereafter deforms only elastically — effectively
unlimited life from plasticity. Above it, the material **ratchets**: each pass adds a sliver
of plastic strain until the surface delaminates. For line contact the elastic shakedown
limit is roughly $p_\max \lesssim 4k$ (with $k$ the shear yield strength), falling as the traction
coefficient rises — strong surface traction drags the critical point to the surface and cuts the allowable pressure. For reference, wheel-rail steels shake down around **0.5–0.65 GPa**.

**Design rule: keep $p_\max$ below the shakedown limit at the worst location and worst (dynamic) load.** For the ceramics proposed here, whose yield/compressive strengths are 3–50 GPa, the shakedown limit is far above the ~0.5 GPa working stress (Section 7), so these surfaces operate deep in the elastic-shakedown regime — the regime where wear, not plasticity, is the life-limiter.

## 4. Wear (Archard) — distance-based, not speed-based

Mild wear follows Archard's law: the worn volume is

$$
V = K \cdot F_N \cdot s / H
$$

- $V$ — worn volume
- $K$ — dimensionless wear coefficient
- $s$ — sliding (micro-slip) distance
- $H$ — hardness of the **softer** contacting member

The two design facts that fall out of this:

1. **Baseline wear per tonne delivered is independent of cruise speed.** For a fixed tonnage, the total contact distance over the track is fixed regardless of how fast climbers run. Faster climbers do the same wear in less time, not more. (Speed re-enters only through the dynamic-force and thermal terms below.)
2. **Wear lands on the softer surface (small $H$).** This is the hook for the
   wheel-as-wear-member strategy (Section 6): pick $H_\text{wheel} < H_\text{track}$ and the wheel takes the wear.

The slip distance $s$ is not the gross travel — a well-designed traction wheel **rolls**, and
wear is driven by the small **creepage** (micro-slip in the contact patch) needed to transmit traction, plus asperity interaction. Good traction (diamond grit) reduces the creepage needed for a given drive force, which directly reduces $s$ and thus wear.

## 5. Vacuum tribology drives the material choice

Two vacuum effects dominate and they point the same way:

**Cold welding / adhesive wear.** In vacuum there is no oxide film to re-form after contact, so clean metal asperities that touch can diffuse and fuse; adhesion forces under fretting can reach tens of newtons, and metal pairs like steels and aluminium alloys show strong cold-welding tendencies. Galileo's high-gain antenna is the canonical cautionary tale. The implication is blunt: **the running surfaces cannot be exposed metal-on-metal.** Covalent ceramics (diamond, SiC, B₄C) do not cold-weld to each other the way metals do, which is the deeper reason — beyond hardness — to face the contact in ceramic.

**Diamond's termination paradox.** Diamond is the hardest, most wear-resistant, and most thermally conductive option, but its *friction* in vacuum is not fixed: a hydrogen-terminated diamond surface is superlubricating (μ ≈ 0.005) because the dangling bonds are passivated — which is **too slippery for a traction surface** — while a clean or graphitised surface has high friction and can adhere. As hydrogen desorbs under load the friction climbs. The way out is to get traction **mechanically** rather than molecularly: use diamond as textured **grit** (or a roughened polycrystalline-diamond / CVD facing) so micro-asperities interlock for grip, independent of the molecular friction state, while still presenting the hardest possible surface to wear. Flash heating must be kept below the graphitisation onset (~700 °C with catalytic metals present), which couples back to the thermal limit below.

### Candidate track materials

| Material                                 | Density (g/cm³) | Hardness (GPa / HV) | Role                  | Source / notes                                                                                                                                     |
| ---------------------------------------- | --------------- | ------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mg alloy plate (WE43 / ZK60)**         | 1.80–1.83       | ~0.9 (HV ~90)       | structural backing    | Light, machinable, clips together; **soft and cold-welds — never the contact face.** Yield 160–320 MPa, fatigue 90–165 MPa.                        |
| **CNT webbing**                          | 1.4             | — (42 GPa tensile)  | tension member        | The in-house cable material; carries the track's share of tension between the Mg plates.                                                           |
| **Diamond grit (textured / PCD facing)** | 3.5             | 70–100              | traction + wear face  | Hardest, highest thermal conductivity; vacuum friction is termination-dependent (use as grit for mechanical grip); watch graphitisation.           |
| **Silicon carbide (SiC)**                | 3.2             | ~25 (HV ~2500)      | best all-round face   | Covalent (no cold weld), tough, high thermal conductivity, **made from local Si + C.** The pragmatic default where diamond is overkill.            |
| **Boron carbide (B₄C)**                  | 2.52            | 30–38               | mass-efficient face   | Third-hardest known; best hardness-per-mass, attractive for long tracks. Brittle; boron is on the import list, carbon is local.                    |
| **WC-Co cermet**                         | ~15             | 16–22               | small wear parts only | Tough and proven, but **heavy and tungsten is not locally sourced** — sensible for a few small wheel components, not for thousands of km of track. |

The user's proposed build — **magnesium-alloy plates clipping together on either side of a CNT webbing, with a diamond-grit traction surface** — is coherent under this model: the Mg is the light structural backing, the CNT carries tension, and the diamond grit is the only part in the contact, so the soft cold-welding Mg never touches the wheel. The two ceramics worth carrying as alternatives are **SiC** (the cheap, tough, locally-made default for most of the length) and **B₄C** (when track mass is the binding constraint and the brittleness can be managed). A reasonable architecture is **diamond/PCD only at the highest-load zones** (e.g. the foot of the L1 elevator) and **SiC over the long mild-load runs**, with the wheel chosen to be the sacrificial member everywhere (next section).

## 6. Make the wheel the wear member

The single most valuable design move is to **direct wear onto the climber's wheels rather than the track.** The justification is mass and logistics:

- The track is enormous and effectively unreplaceable in bulk — even a thin wear allowance over the Moon–L1 elevator's ~220,000 km is a huge standing mass and any in-situ resurfacing is a major operation. A wheel set is a few tonnes per climber and is **swapped at a waystation in minutes.** Spending the wear budget on the cheap, serviceable member is obviously better.
- Archard's $V \propto 1/H$ gives the mechanism for free: face the **track** with the harder surface (diamond/SiC) and the **wheel tread** with a tougher, slightly softer controlled-wear material, and the wear ratio is approximately $V_\text{wheel}/V_\text{track} \approx H_\text{track}/H_\text{wheel}$. Tune that ratio large and the track is effectively permanent while the wheel is consumable.

Three points to get right, none of them hard once the contact is ceramic-on-ceramic:

1. **Wear should be gradual abrasion, not fatigue spalling.** Keep the wheel inside its own shakedown limit (Section 3) so it loses material as a fine, steady dust rather than shedding flakes. This is not about debris sticking — hard ceramic flakes don't (point 2) — it is about predictability: smooth abrasion thins the tread on a known schedule you can plan swaps around, whereas spalling removes chunks unpredictably, roughens the running surface, and feeds the dynamic-load term (Section 8). "Wheel wears" means controlled abrasion, not surface fatigue.
2. **Debris doesn't stick, so there is almost nothing to manage.** With both surfaces hard covalent ceramic (diamond / SiC / B₄C), a freed wear particle has no mechanism to cold-weld (it is not metal), to adhere (these covalent solids have low vacuum adhesion), or to embed (it cannot press into a 25–100 GPa surface at a ~0.5 GPa contact stress). So unlike a metal vacuum contact there is nothing to gall, capture, or clean — the failure modes of Section 5 simply do not apply to the inert ceramic dust this contact produces. The only residual is transient three-body abrasion if a grain lingers in the contact, so the contact geometry should be open enough that particles drop straight out. Once free they fall away under the local effective gravity — which scales with the same `a_eff` that set the contact load in the first place, so wherever wear is generated there is a pull removing it, and wherever the pull vanishes (the balance points) almost no wear is generated. No capture surfaces or waystation cleaning are needed.
3. **No mid-span failure.** Wear must be monitored and bounded so a wheel never reaches end-of-life between stations. This pairs naturally with the per-wheel-independent, fail-soft drive already required by the dynamics doc (a worn or failed wheel freewheels and redistributes load, rather than seizing).

## 7. Application to the three architectures

Contact severity scales with the **effective gravity** the climber works against, because that sets $W = M\cdot a_\text{eff}$ and hence the clamp force and $F_N$. The three structures span a wide range:

| Location                                       | Effective gravity       | (lunar g) | Climber cargo | Contact severity          |
| ---------------------------------------------- | ----------------------- | --------- | ------------- | ------------------------- |
| **L1 elevator — foot**                         | 1.62 m/s²               | 1.00      | 1,000 t       | **highest in the system** |
| L1 elevator — by 10,000 km                     | ~0.05 m/s²              | ~0.03     | 1,000 t       | low                       |
| Lunar skyhook — foot (10 km)                   | 0.55 m/s² (toward Moon) | 0.34      | 160 t         | moderate                  |
| Lunar skyhook — CoM (275 km)                   | ~0                      | 0         | 160 t         | negligible                |
| Lunar skyhook — top deck (2,000 km)            | 1.90 m/s² (outward)     | 1.17      | 160 t         | moderate (light climber)  |
| Ceres elevator — surface                       | 0.27 m/s²               | 0.16      | (heavy)       | low                       |
| Ceres elevator — Ceres-stationary (722 km alt) | ~0                      | 0         | (heavy)       | negligible                |

Two structural facts emerge:

- **The Moon–L1 elevator's lower section is the binding case** — full lunar gravity acting on the heaviest (1,000 t) climbers. If the track/wheel pairing survives there, it survives everywhere. The skyhook sees comparable *effective* gravity only at its ends, but on much lighter (160 t) climbers and at low speed (50 m/s average); Ceres is gentle throughout (≤ 0.16 lunar g). So this model is **sized by the L1 foot and reused with margin elsewhere.**
- **Effective gravity reverses across a balance point** (the skyhook CoM, the elevator L1, the Ceres-stationary radius). The drive and the clamp must work in both directions, and the wear/fatigue accounting is symmetric about those points.

### Worked check — the worst location

Take the L1 elevator foot: a loaded climber of $M \approx 1.1\times10^6$ kg (1,000 t cargo + ~10% tare) at $a_\text{eff} = 1.62$ m/s², so $W = M\cdot a_\text{eff} \approx 1.78$ MN. With a diamond-grit traction coefficient $\mu_t \approx 0.4$, the clamp force is $N_\text{clamp} = W/\mu_t \approx 4.46$ MN. Spread over $N_c \approx 200$ driven contacts, $F_N \approx 22$ kN per wheel. For a crowned diamond/PCD wheel of $R_w = 0.2$ m on a SiC track over a contact length $b = 0.05$ m ($F' = 4.4\times10^5$ N/m), with $E^* \approx 325$ GPa:

$$
p_\max = \sqrt{F'\cdot E^*/(\pi\cdot R_w)} \approx 0.48\text{ GPa}
$$

SiC's compressive strength is ~3–4 GPa and diamond's exceeds 50 GPa, so the worst contact in the entire architecture runs at roughly **an eighth of the SiC limit and ~1% of diamond's** — comfortably in elastic shakedown. Strength is not the constraint; **wear life and debris control are.** (Reducing $N_c$, or the wheel radius, raises $p_\max$ only as the square root, so there is wide design freedom to trade wheel count against contact stress.)

## 8. Speed coupling (why this doc and the dynamics doc are linked)

Cruise speed enters wear through two terms, both already flagged in `MoonL1ElevatorDynamics.md`:

- **Dynamic contact force from track waviness:** a wheel of unsprung mass $m_u$ crossing waviness of amplitude $\delta$, wavelength $\lambda$ at speed $v$ sees $\Delta F = m_u\cdot\delta\cdot(2\pi v/\lambda)^2 \propto v^2$. For representative numbers ($m_u = 20$ kg, $\delta = 0.1$ mm, $\lambda = 0.5$ m) this is ~13 kN at 200 m/s and ~50 kN at 400 m/s — comparable to the static $F_N$, so track surface quality, not cruise speed alone, dominates the dynamic load.
- **RCF amplification:** since $p_\max \propto F_N^{1/3}$ and RCF life follows a steep stress-life law $N_f \propto p_\max^{-m}$ with $m \approx 6\text{–}9$, doubling speed (~4× dynamic force) raises $p_\max$ by ~1.6× and cuts fatigue life by **~40×** at $m = 8$. This is the quantitative basis for the dynamics doc's conclusion that cruise speed is an **economic optimum (~400 m/s)** set by trading structural mass (∝ 1/v) against wear (∝ v² in force, far steeper in fatigue) — and it shows the real levers are **track surface finish ($\delta$, $\lambda$) and suspension bandwidth** (which decouple $m_u$ and absorb $\Delta F$), not the cruise speed by itself.

## 9. Bottom line and open questions

A diamond-grit-on-ceramic running surface, over a magnesium-alloy/CNT track backing, with the wheel deliberately chosen as the sacrificial wear member, is a **viable pairing for all three structures**, sized by the Moon–L1 elevator's foot and reused with large margin on the skyhook and at Ceres. Contact stress is not the binding constraint anywhere; **wear rate, vacuum debris control, and fatigue at speed are.** The design rules are: keep every contact inside its shakedown limit at the dynamic (not just static) load; face the contact in non-cold-welding ceramic; get traction mechanically from textured grit rather than molecular friction; and put the wear on the wheel.

Open questions worth a dedicated pass:

- **A real wear-coefficient and RCF-exponent set for the actual material pair in vacuum.** The $K$, $H$, and $m$ used here are literature-representative, not measured for diamond-on-SiC at these stresses and temperatures. The whole cost curve hangs on them.
- **Flash-temperature limit.** A radiation-only thermal balance on the contact patch, to set the speed/creepage ceiling that keeps diamond below graphitisation and Mg backing below creep.
- **Traction-coefficient stability** of textured diamond as the grit blunts and as hydrogen desorbs — does $\mu_t$ drift enough over a wheel's life to matter to the clamp budget?
- **Debris capture geometry** for a vacuum rolling contact, and waystation wheel-swap cadence.

## 10. Should this be a calculator?

Yes — the design is concrete enough to warrant a **"Climber track & contact" tool**, and it reuses machinery already in the repo. Proposed shape, in the established two-step calculator
style:

- **Inputs:** climber mass and cargo; number and geometry of driven contacts ($N_c$, $R_w$, $b$, crown); material pair (wheel/track) from a preset list (diamond/PCD, SiC, B₄C, Mg-alloy backing) carrying $E$, $\nu$, $H$, $K$, shakedown limit, density; traction coefficient $\mu_t$; the **effective-gravity profile** of the chosen structure (importable from the L1 elevator and skyhook calculators, which already compute $a_\text{eff}(r)$); cruise speed and track waviness
  ($\delta$, $\lambda$) for the dynamic term.
- **Outputs:** per-wheel $F_N$, Hertzian $p_\max$ and shakedown margin along the structure; Archard wear rate split between wheel and track (mass/year and mm/year), with the wheel-swap cadence; RCF life $N_f$ and the speed-sensitivity factor; flash-temperature estimate vs. the graphitisation/creep limits; and total consumable (wheel) mass per megatonne delivered.

It would share a new `Website/Shared/` helper for Hertzian contact, shakedown, and Archard/RCF (Node-testable, in the project's classic-script convention), so all three structure calculators can call the same wear engine. **Recommend building it as the next step** once the material constants above are pinned to at least order-of-magnitude confidence.

## Sources

Grounding for the vacuum-tribology and materials claims (engineering literature, stable facts):

- Diamond/DLC friction in vacuum and hydrogen termination: [Origin of low friction in hydrogenated DLC (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S0008622320311180); [Friction of diamond on diamond in UHV (ResearchGate)](https://www.researchgate.net/publication/231122227_Friction_of_diamond_on_diamond_in_ultra-high_vacuum_and_low-pressure_environments); [Ultrananocrystalline diamond tribology (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC5762651/)
- Cold welding / adhesive wear in vacuum: [Vacuum tribology in space applications review (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S0301679X26001490); [Cold welding in hold-down points of space mechanisms (MDPI Lubricants)](https://www.mdpi.com/2075-4442/9/8/72)
- Magnesium alloy properties (WE43 / ZK60): [WE43 mechanical properties (PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6862282/)
- Rolling-contact fatigue, Hertzian stress, shakedown: [Rolling Contact Fatigue: A Comprehensive Review (US FRA)](https://railroads.dot.gov/sites/fra.dot.gov/files/fra_net/89/TR_Rolling_Contact_Fatigue_Comprehensive_Review_final.pdf); [RCF and wear of rails and wheels review (MDPI Machines)](https://www.mdpi.com/2075-1702/13/10/970)
