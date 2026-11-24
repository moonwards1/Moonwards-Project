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

## Orbital speed {#orbital-speed tier=1}

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

<!-- Basics card -->

## Basics {#basics tier=2}

## Boost engines {#boost-engines tier=1}

## Free orbit speed {#free-orbit-speed tier=1}

## Balance point {#balance-point tier=2}

## Foot altitude {#foot-altitude tier=1}

<!-- Tether materials card -->

## Tether materials {#tether-materials tier=3}

## Breaking length at 1 g {#breaking-length-1g tier=1}

## Breaking length at local g {#breaking-length-local-g tier=1}

## Safety factor {#safety-factor tier=1}

## Lower tether ratio {#lower-tether-ratio tier=1}

## Upper tether ratio {#upper-tether-ratio tier=1}

## Extra tether {#extra-tether tier=1}

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

The real precession rate can sometimes be significantly different than that shown, in the case of moons. Though they are far away, bodies that are far more massive than the moon can still have a large enough influence to measurably change precesssion. This would take further modelling to account for. 

<!-- Foot ↔ Ground trips card (results) -->

## Foot ↔ Ground trips {#foot-ground-trips tier=3}

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
