<!--
LORE ENTRIES — the text behind every info note on the site, and the Lore page.
(Anything between these comment markers is ignored by the site.)

CHAPTERS
  # Chapter title
  Groups the entries below it on the Lore page. Optional; reorder freely.

ENTRIES
  ## Title {#entry-id tier=2}
  Text of the note, in Markdown.

  - The title is only a label: pop-ups show your text with no heading. It
    heads the entry on the Lore page; add `notitle` inside the { } to hide
    it there too:  ## Basics {#basics tier=2 notitle}
  - entry-id: the site's marks point at this id, so leave it as it is
    (ask Claude to change one). The title can change freely.
  - tier=1  tooltip: short, plain text — meaning or how-to
    tier=2  orange dotted underline, opens a pop-up beside the word
    tier=3  word with an orange ⓘ, opens the same pop-up — central information
    no tier a note reached only through links in other notes: {#entry-id}
  - An entry with no text yet is a stub: its mark works, and shows
    "Note not written yet". Add ?lore=pending to any page's address to
    outline the marks still waiting for text; the Lore page has a
    Pending filter.
  - "previous tooltip" comments hold the hover text a row had before its
    mark replaced it, for reference. Delete them whenever you like.

LORE PAGE ONLY
  Text between these two lines shows on the Lore page but not in the pop-up.
  Use as many as you like, before, after or between pop-up paragraphs:
  ::: lore
  Wider background, pictures, links for the Lore page…
  :::

WRITING THE TEXT
  Blank line = new paragraph.      **bold**   *italic*
  ### Subheading                   - bullet list    1. numbered list
  [text](#other-entry-id)          opens that entry in place, Nutshell-style
                                   (nests two deep; deeper opens the Lore page)
  [text](https://…)                an outside link, opens in a new tab
  ![Caption](images/picture.png)   an image or video (.mp4/.webm) on its own
                                   line; paths are relative to this folder
  $v = \sqrt{GM/r}$                inline maths (KaTeX)
  $$                               display maths on its own lines
  \Delta v = v_e \ln(m_0/m_f)
  $$
-->

# Body facts

<!-- Home page, vision section aside: row labels, the same for every body -->

## Orbital distance {#orbital-distance tier=1}

This is the average distance. Orbits of planets and moons are slightly elliptical (oval), putting the body closer to its primary on one side of its orbit, and farther away on the other. During real operations, this must be considered. Sometimes it has a significant impact on the length of a flight and the fuel it requires. Some asteroids have very elliptical orbits and the effect is big.

## Orbital speed {#orbital-speed tier=1}

This is the average speed. The closer a body is to its primary, the faster it moves. As orbits are slightly elliptical (oval), the difference in body speed has an impact on flight planning in real operations. 

## Diameter {#diameter tier=1}

## Surface gravity {#surface-gravity tier=1}

## Escape velocity {#escape-velocity tier=1}

<!-- The Moon's aside only, beside its rotation -->

## Tidally locked {#tidally-locked tier=1}

# Bodies

<!-- Workbench: the body named above a facility's cards, e.g. "Moon · Hanging skyhook" -->

## Mercury {#body-mercury tier=3}

## Venus {#body-venus tier=3}

## Earth {#body-earth tier=3}

## Moon {#body-moon tier=3}

## Mars {#body-mars tier=3}

## Vesta {#body-vesta tier=3}

## Ceres {#body-ceres tier=3}

## Pallas {#body-pallas tier=3}

## Psyche {#body-psyche tier=3}

## Hygiea {#body-hygiea tier=3}

## Callisto {#body-callisto tier=3}

## Titan {#body-titan tier=3}

# Hanging skyhook — Architecture

<!-- Above the cards, beside the body -->

## Hanging skyhook {#hanging-skyhook tier=3}

A hanging skyhook is a tether thousands of kilometers long, hanging in orbit around a planet or moon. The skyhook is held vertical and taut because its foot feels a pull towards the ground, and its top feels a pull outwards towards space. The point where those pulls are balanced is in orbit - it's moving at exactly orbital speed for its altitude. Everything below moves too slowly for its height, so gravity wins and the lower tether hangs. Everything above moves too fast for its height, so it's flung outward and the upper tether is pulled up. 

That's what makes a skyhook useful. Its foot moves far slower than orbital speed, so a vessel from the surface needs much less speed to reach it than to reach orbit. Its top moves faster than orbital speed, so a ship released there goes into a higher orbit, or escapes the body altogether, using no propellant of its own. And various other tricks save fuel needed by ships that come and go. But each arrival or departure changes the orbit of the whole skyhook by either removing or adding momentum. Ships arriving from offworld raise momentum and thus raise the orbit, ships departing lower momentum and lower the orbit. Ideally this can be balanced, but traffic is never that smooth.

Boost engines at the skyhook top add or remove momentum as needed. Since it's fine if these engines are very heavy, and they don't need to have high thrust, they can be built to be a lot more efficient than rocket engines. VASIMR engines are the top choice. In Moonwards' world, most skyhooks orbit bodies that host other transport facilities, that can toss mass between them solely to provide momentum. This is used where it makes sense.

Rotating skyhooks are different. They are stretched taut by spinning in orbit.

<!-- Basics card -->

## Basics {#basics tier=2}

## Boost engines {#boost-engines tier=2}

The engines sit at the top because that is the farthest point from the Moon, and so it moves around in the biggest circle each orbit. [The same job spread over a longer path takes less force](#boost-engine-torque). That means the engines don't need to push as hard, and they need less propellant.

## Boost engine torque {#boost-engine-torque}

$$\tau = F\,r_{mount} \quad\Rightarrow\quad F = \frac{\tau}{r_{mount}}$$

- $\tau$ = angular momentum the engines must restore per second (N·m)
- $F$ = steady push along the direction of travel (N)
- $r_{mount}$ = distance of the engines from the body's center (m)

The path view gives the same result:

1. Over one orbit of period $T$, the engines must restore the energy $E = \omega\,\tau\,T$, where $\omega$ is the orbital angular speed (rad/s).
2. Since $\omega T = 2\pi$, this is $E = 2\pi\tau$.
3. Work is force times distance, and the engines travel $2\pi r_{mount}$ per orbit, so $E = F \cdot 2\pi r_{mount}$.
4. Setting the two equal gives $F = \tau / r_{mount}$ again.

The savings follow from $F$:

$$\dot m_{prop} = \frac{F}{v_e} = \frac{\tau}{r_{mount}\,v_e} \qquad P_{jet} = \tfrac12 F v_e$$

- $\dot m_{prop}$ = propellant flow (kg/s)
- $v_e$ = exhaust velocity (m/s)
- $P_{jet}$ = jet power (W)

## Free orbit speed {#free-orbit-speed tier=1}

The speed an object would move at if it was in a circular orbit at this altitude. (Things in circular orbits move at a constant speed.)

## Balance point {#balance-point tier=2}

This is the point along the tethers that is moving at exactly orbital speed for its altitude. The farther away something on a tether is from this point, the bigger the force it feels pulling it away from that point. So, the tethers are thickest here, because they have to support all the pull upwards and downwards of everything else. At the same time, because it is the point in free orbit, no gravity and no angular momentum is felt here.

## Foot altitude {#foot-altitude tier=1}

For bodies with atmospheres, the minimum feasible altitude is shown. Any lower and the foot feels enough drag to be a problem. It probably would cost more fuel to compensate for that drag than is worth it. Skyhooks that are traffic hubs, or have more traffic going down that coming up, get a bit of leeway. That's the case for Earth and Mars in Moonwards. 

<!-- Tether materials card -->

## Tether materials {#tether-materials tier=3}

Skyhooks are so long it's necessary to taper their tethers, thickest at the balance point and thinnest at the tips. On Earth cables are almost never long enough for this to matter. The similar situation is how a tower can be much taller if it gets narrower as it gets higher. Each extra floor puts a greater load on every floor below it, and so each floor has to have more and thicker columns to support the cumulative weight of everything above. Imagine the Eiffel Tower. Now imagine two stuck together, ten thousand times longer, hanging in space, made of cable, being pulled towards their tips instead of being compressed towards the ground.&#32;

For a tether to be sufficient to support everything on it safely while being as light as possible, it has fewer and thinner cables as it gets farther from the balance point. Even so, to be practical at lengths of thousands of kilometers, cables must be of the lightest and strongest materials known. Better material properties provide an exponential reduction in tether mass needed. Development of the right material will suddenly make skyhooks and space elevators feasible. &#32;

The listed materials are the best ones for this task. The first figure is the force it takes to snap them - tensile strength - in gigapascals (GPa). The best fishing line has a tensile strength of about 1 GPa. The second figure is their density, which is just as important, otherwise the needed mass balloons beyond all practicality. Playing with material choice, especially a custom material, will show the effect dramatically in the drawing at right.

[Lunar silica](#lunar-silica) and [carbon nanotube](#carbon-nanotube) are both on the list because manufacturing in deep space unlocks their potential. [Early lunar glass](#early-lunar-glass) enables useful skyhooks even when local manufacturing is at an early stage.

## Lunar Silica {#lunar-silica tier=2}

Silica molecules are bonded together quite strongly, but on Earth are  weakened by the presence of water, which is just everywhere and beyond control. Any tiny surface flaw grows through interaction with water molecules.  Moon dirt starts extremely dry, and silica in it can then be purified to an extreme level. The hard vacuum is quite helpful here, lowering boiling temperatures, making heat easy to hold in, preventing contamination and dispersing vapors instantly. Rods of pure silica glass can then be heated and drawn into fibers in an orbital facility. Drawing is at the ideal rate and temperature - no sagging, no contact, no exposure to gasses.

In theory, silica glass can reach strengths of [around 20](https://vbn.aau.dk/ws/files/467355538/Advancing_the_Mechanical_Performance_of_Glasses_Perspectives_and_Challenges.pdfhttps://vbn.aau.dk/ws/files/467355538/Advancing_the_Mechanical_Performance_of_Glasses_Perspectives_and_Challenges.pdf) or maybe 25 GPa. The highest measured strengths are a bit over [14 GPa](https://www.osti.gov/servlets/purl/10110576). The figures here are a tad lower even for the perfected process. 

## Carbon Nanotube {#carbon-nanotube tier=2}

A carbon nanotube (CNT) is a tube of carbon atoms each bonded to three others such that they make a continuous sheet of hexagons. The bonds holding the carbon atoms together in that sheet are among the strongest in nature, and a nanotube is almost nothing but those bonds. A single flawless nanotube is about a hundred times stronger than the best fishing line - [100 GPa](https://doi.org/10.1038/nnano.2008.211) - at about half the density of aluminium. One research effort published in Nature has achieved a genuine, tiny bundle a few cm long that had a measured strength of 43 GPa - [Bai et al., 2018](https://www.nature.com/articles/s41565-018-0141-z).

In this world, CNT cable is made in installations orbiting the Moon. [On Earth today](https://en.wikipedia.org/wiki/Synthesis_of_carbon_nanotubes), CNT production is done by creating a gas rich in carbon and precisely exposing it to a carefully made substrate of metal particles. The particles catalyze the carbon atoms to bond together in rings around them, over and over, sort of knitting a tube of them. In the lunar facilities, the hard vacuum and weightlessness mean that gas cloud naturally stays in place and remains pure, no convection, no need to mix in another gas to support the process. Your reactor can be as large as you like and have any shape. Using lasers or electron beams in that reactor is easy. Intense energy use is no concern.

## Breaking length at 1 g {#breaking-length-1g tier=1}

How long a cable made of this can be before its own weight makes it snap. This is a common engineering term. Since it's always been done on Earth, 1 Earth gravity is the standard in the formula (which is specific strength divided by gravity, and specific strength is tensile strength divided by density - the two values in the list above).

## Breaking length at local g {#breaking-length-local-g tier=1}

How long a cable made of this can be before its own weight makes it snap, in local gravity. This is a good way to get across how other places in the solar system are much easier sites to make a useful hanging skyhook.

## Safety factor {#safety-factor tier=2}

Take the amount of tether material that would just barely support the load it must bear, multiply it by this number, and that's how much material is actually used. Note that reduced strength due to manufacturing flaws, imperfect fiber bundling, and a fraction of fibers not actually bearing load, is already accounted for in the listed strength. Tethers are also sets of cables, each set woven into a lattice that passes the load of a failed cable to its neighbors. Cables are also replaced on a schedule well before they are likely to fail.

## Lower tether ratio {#lower-tether-ratio tier=1}

From the balance point to the foot. The taper number is the area at the balance point compared to the area at the foot, the mass number is the mass of the tether itself compared to everything on it that isn't tether. 

## Upper tether ratio {#upper-tether-ratio tier=1}

From the balance point to the top. The taper number is the area at the balance point compared to the area at the top, the mass number is the mass of the tether itself compared to everything on it that isn't tether. The upper tether also bears the pull of the engines at the top, but that force is small compared to the pull of the structures themselves.

## Extra tether {#extra-tether tier=1}

The anchor station is used to balance the upper and lower tethers so that the balance point is at the desired altitude. It is rarely exactly at the balance point. This is the extra tether needed to support its mass against the pull it feels at its distance from the actual balance point. 

<!-- Core Facilities card -->

## Core Facilities {#core-facilities tier=2}

## Top station {#top-station tier=2}

<!-- previous tooltip: Mass held at the top tip. It sets the peak tension. -->

## Upper tether load {#upper-tether-load tier=1}

<!-- previous tooltip: Everything carried along the upper tether apart from the stations (climbers, power, fuel, tracks), treated as spread evenly over its length. The stations' masses are on the Optional Stations card. -->

## Anchor station {#anchor-station tier=2}

<!-- previous tooltip: The skyhook orbits at the altitude where the outward and inward pulls balance - at the balance point. Above there, the tether is pulled outwards, below there, it is pulled inwards. Because the loads on the upper and lower tethers are very different, and they are very different lengths, the anchor station is to one side of the balance point. If the loads other than the anchor station are extremely different on the upper and lower tethers, the anchor station might even need to be at the foot. The heavier the anchor station, the closer it can sit to the balance point, and the less that point moves as loads change. -->

## Foot station {#foot-station tier=2}

<!-- previous tooltip: Mass held at the foot tip. -->

<!-- Optional Stations card -->

## Release deck {#release-deck tier=1}

<!-- previous tooltip: Where ships bound for an alternate destination are released; released cargo leaves at this deck's speed. -->

## Release deck (Moon) {#release-deck-moon tier=2}

<!-- previous tooltip: Where ships bound for an alternate destination are released; released cargo leaves at this deck's speed. -->

## Outer docks {#outer-docks tier=2}

<!-- previous tooltip: Where incoming ships arriving from parking orbit dock. -->

## Receiving deck {#receiving-deck tier=2}

<!-- previous tooltip: Where shuttles from the surface join the tether. -->

<!-- Orbit tilt card -->

## Orbit tilt {#orbit-tilt tier=2}

## Sun-synchronous {#sun-synchronous tier=2}

<!-- previous tooltip: Finds the tilt at which the bulge turns the plane eastward exactly once a year, so the plane keeps the same angle to the body's orbit all year. -->

## Periodic ecliptic alignment {#periodic-ecliptic-alignment tier=2}

<!-- previous tooltip: Sets the tilt to the equator's own tilt to the ecliptic, so as the bulge turns the plane, it lies in the ecliptic once each period. -->

## Nodal precession period {#nodal-precession-period tier=2}

## Node drift {#node-drift tier=1}

## Other bodies' pull {#other-bodies-pull tier=1}

The real precession rate can sometimes be significantly different than that shown. Other bodies far more massive than the host body can have a large enough influence to change precesssion, if they are nearby. This is here so you notice when that is true.

<!-- Foot ↔ Ground trips card (results) -->

## Foot ↔ Ground trips {#foot-ground-trips tier=3}

There are a number of things to consider when choosing an altitude for the foot. This spells out the tradeoffs. An object dropped from the foot hits the surface at the speed and angle shown. An object launched with the same speed and angle will appear at rest when it reaches the foot, from the foot's perspective. The two paths are mirror images.  
On airless bodies, the closer the foot is to the ground when a ship drops off, the closer to horizontal its flight will be when it meets the ground. This makes it much easier for the ship to brake to a stop on a runway, or be caught by something that then brings it to a stop. But, other points the skyhook passes over are very probably going to be higher. In that case the foot has to be adjustable, probably by an altitude of 10 to 20 km, and the mechanism has to not alter the overall mass distribution along the skyhook. On bodies with atmospheres, entry into the atmosphere at a shallow angle makes the drag milder, which reduces the peak forces the ship must endure and lowers the heat of entry.
A foot at a higher altitude might be worth it for the lighter tether, simpler foot platform, or to allow other orbital facilities to pass beneath the foot without risk of collision. 

<!-- Loads card (results) -->

## Loads {#loads tier=2}

## Anchor station offset {#anchor-station-offset tier=2}

## Tension at the balance point {#tension-at-balance-point tier=1}

<!-- Stations card (results): marked in the first station's figures -->

## Total strain {#total-strain tier=1}

## Escape v∞ {#escape-v-inf tier=2}

## Pull felt {#pull-felt tier=1}

<!-- Release points card (results) -->

## Release {#release tier=1}

# Hanging skyhook — Logistics

<!-- Traffic card -->

## Traffic {#traffic tier=2}

<!-- Energy and orbit balance card (results) -->

## Energy and orbit balance {#energy-orbit-balance tier=2}

## Climber efficiency {#climber-efficiency tier=1}

## Thruster efficiency {#thruster-efficiency tier=1}

# Ships

<!-- Ship cards: the same notes on the Shuttle, Freighter and Capsule cards (and in the Mission Planner), apart from Propellant -->

## Shuttle {#shuttle tier=3}

## Freighter {#freighter tier=3}

## Capsule {#capsule tier=3}

## Propellant (shuttle) {#propellant-shuttle tier=3}

## Propellant (freighter) {#propellant-freighter tier=2}

## Propellant (capsule) {#propellant-capsule tier=2}

## Vacuum Isp {#vacuum-isp tier=2}

## Dry mass {#dry-mass tier=1}

## Payload {#payload tier=1}

## Propellant capacity {#propellant-capacity tier=1}

## Heat shield {#heat-shield tier=2}

## Δv, loaded {#delta-v-loaded tier=1}

## Δv, empty {#delta-v-empty tier=1}

## Make a local version {#make-local-version tier=1}

# Mission Planner

<!-- Ephemeris tab -->

## Ephemeris {#mp-ephemeris tier=2}

## Ship marker {#mp-ship-marker tier=2}

## Departure impulse {#mp-departure-impulse tier=3}

## Waypoints {#mp-waypoints tier=3}
