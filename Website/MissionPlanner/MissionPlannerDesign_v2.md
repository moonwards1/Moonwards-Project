# Mission Planner Design (v2)

This app assists users to plot out an entire mission based on real ephemeris data and trajectory plots. Users can then choose which technology to use to accomplish the mission, from a range of options that are realistic in a future setting. They can either feed in data from calculators (in a separate section) that set the parameters their chosen 'tech stack' would have, or find the parameters by playing around in the app, and instead send those to the relevant calculators to see what properties the launcher or vehicle would need. They can swap technologies and change the parameters on their tech, in the app or in the relevant calculator, and the mission profile updates as needed. They can set up several missions within the app that coexist, and compare different mission architectures. 

The use case of the app is to teach users how different launch tech and rocket tech works, how orbital mechanics works, and the comparative strengths and weaknesses of different launch and rocket tech. Ease of use for a naive user is important, while also offering sophisticated users a quick, intuitive means of testing ideas. The level of accuracy is the best that is feasible within the requirements of providing mission design freedom with many tech choices. 

*Words in italics concern features not yet implemented*

## Interface

There are three main panes to the layout - the top pane, the three.js pane that shows simulations (which includes two floating panes), and the tool pane, otherwise known as the sidebar. The contents of these areas change depending on context. Mission plans are designed in steps, and users go back and forth between them to iterate, refine, and try different combinations of technology and events. 

### Top pane

The top pane, spanning the width of the window, has three parts. 

#### The top part

is for organizing open missions in tabs, and has a button for duplicating the currently displayed mission, and one for opening a mission from a drop-down menu where users can choose from a small number of example missions, or a mission they saved themselves. It also has the Ephemeris tab, which is the starting point for creating any new mission.

#### The middle part

displays key data related to the timeline. In the Ephemeris tab, it has the field for manually entering a date, and a little basic info. In mission tabs, it has the buttons for the three mission phases - Departure, Coast, and Arrival. To the right of those buttons, key parameters and indicators about the mission are shown, and change according to the displayed phase. To the right of that, is the 'Copy mission link' button.

#### The bottom part

has the scrubbable timelines. In the Ephemeris tab, it spans all the dates covered by the app's internal ephemeris. In mission tabs, the timelines change according to the displayed mission phase, and indicate key points in the mission for that phase.

##### Departure

shows the period between launch from the origin body, and hand-off to the coast phase. The beginning of the coast phase is set by the beginning of the trajectory created in the Ephemeris tab, that was used to form a mission. The beginning of the departure timeline is established by using a formula to estimate how long it will take after launch to exit the SOI of the primary in the origin system. As the set of events in the departure leg is set up, the end of the timeline updates dynamically according to the duration of the trajectory. 

(Fixing the timeline start according to the estimate is necessary when a satellite of the primary contributes impulse to the launch thanks to its motion - this has to be included in mission planning in the Ephemeris tab, and thus can't be changed in the mission tab. This is implemented for the moon, and will need implementation for Phobos, as it is the anchor of the modelled Mars skyhook.)

*If a body does not have satellites to think about, it would be more accurate to fix the epoch at the end of the departure phase, and have the estimate for the length of the departure leg extend backwards in time from there, with the beginning of that leg being the one that dynamically changes. This should work even for Mars, where the orbit of Phobos is a factor in a skyhook design, but is brief enough for solutions to fall within the one-day margin.*

That is the date at the end of the the Departure timeline. The beginning of the timeline comes from the estimate of how long the ship would take after launch to leave the SOI of the origin body. As long as the ship leaves the SOI within a day of the date at the end of the timeline, it is sufficiently on course to comply with the mission plan. The moment when it would leave is indicated on the timeline.

##### Coast

shows the period established by the mission plan as created in the Ephemeris tab. It may include up to two waypoints when imported, or such waypoints may be added. This timespan is fixed. If the user wishes to change it, they must copy the mission data using the button in the top pane, paste it into the ephemerise tab, make their adjustments, and create a new mission. In order to provide time for the events needed to bring the ship in for capture by the destination body (or the platforms orbiting it), the Coast phase timeline ends up to a few days before the time shown in the original trajectory in the Ephemeris tab. The length of that period is established by the length of time it would take the ship to cross the destination body's SOI at the speed it has relative to the destination at the end of the coast phase in the original trajectory, or two days, whichever is longer.

##### Arrival

shows the length of time from the end of the coast phase, on the right end, and the beginning of the hand-off period established by the formula described at the end of the Coast section above. 

### The Three.js pane

shows the solar system, celestial bodies in it, ship trajectories and related indicators. It is on the left side under the top pane.

#### In Ephemeris mode

it shows the full solar system, with the sun and the orbits of all the included bodies, all to scale. Orbits are accurate, with the side north of their nodes brighter, and the side south of their nodes darker. The SOI of each body is shown. If the camera is close enough, then bodies are shown as orbs, to scale. As the camera zooms out, bodies reduce in size until they are a single bright pixel, as do their SOIs. The bodies are all in the correct spot for the date on the timeline, and move as the timeline is scrubbed. 

Once an origin body is chosen, a Keplerian orbit is shown as a bright blue polyline, as results from the heading and speed at the origin point, with the starting point on the origin body denoted by a bright pink square. As impulses are entered for the Departure point, the trajectory shows the Keplerian orbit that would result, and arrows at the origin point show the magnitude of the net impulse in the prograde direction, and the net direction of the impulse and the magnitude in that direction. As the timeline is scrubbed, the shape and orientation of the trajectory changes to be as it would be if launch was on that date. 

If any point on the trajectory passes close enough to the orbit of another body, that point is indicated by an orbit approach ring. If the user clicks on the trajectory, a chevron marker is placed on that spot representing a ship, and the marker card then shows information about that point, a slider to scrub along the trajectory, and buttons for different modes of setting up rendezvous. 

If a destination body has been chosen, and a chevron has been placed on the trajectory, then the time of flight to reach the chevron's position is used to place an 'x' on the orbit of the destination body. That x marks where the body would have gotten to in its orbit during the time of flight needed for the ship to reach the chevron's position. If the chevron passes by the x mark within a certain number of days, then a temporal proximity ring shows the phasing of when the ship would pass by versus when the body would pass that point. 

If waypoints are added, they are shown by a gizmo that has axes for the prograde, radial, and normal directions before the burn made at that point, and two arrows. The  yellow arrow shows the magnitude of the net prograde impulse imparted by the burn, and the pink arrow shows the net direction and magnitude of the impulse (ie, the direction opposite the one the engines were fired in).

#### In Mission Departure mode

the origin body is shown (so far only showing the primary body and omitting any satellites, except in the case of the Earth moon system, and Mars, where Phobos is shown). The orbit of the body is shown, and the sun is visible in the distance. A small floating pane shows a view of the solar system and coast phase trajectory, and another small floating pane shows a view of the destination body. These small panes are draggable. As launch technology and waypoint burns are added in the tool pane, the trajectory that results is shown, cutting off at the time the departure timeline ends. Simple renderings of the launch tech are shown to indicate basically how they work, and where the ship would start from at launch. Any waypoints are indicated by gizmos on the trajectory that are like the ones in the Ephemeris mode. The gizmos (and their cards in the tool pane) are oriented in the heliocentric frame. *At the hand-off end of the trajectory is a yellow arrow, analogous to the prograde arrow of the ephemeris phase, except it shows the heading the trajectory needs to have at that point in order to be on course, ie, what the prograde direction there needs to be*.  A *chevron moves along the trajectory as the timeline is scrubbed, showing where the ship would be at that moment.*

*A ship card floats in the pane. It is roughly analogous to the marker card in that it displays pertinent information about the ship, which is represented by the chevron on the trajectory. It shows the prograde speed of ship at the point it's at on the timeline. It has a three.js gizmo on it that looks a lot like the gizmos shown for waypoints, but that works a bit differently. It shows the heliocentric axes just like the waypoint gizmo. It also has an arrow like the one at the end of the trajectory, showing the heading the ship must have to be on course, with the speed it must have indicated by the length of the arrow. And it has a second arrow that shows the heading the ship currently has when it reaches the hand-off point. There is a checkbox that snaps the display of the gizmo to be the same as the camera has in the main pane, and if unchecked, then by dragging the mouse within the gizmo's pane, it can be rotated independently.*

#### In Mission Coast mode

the main pane becomes the solar system view, while the origin body moves to a floating pane. The coast leg (transfer leg) trajectory of the mission is shown, and the chevron showing the ship moves along it as the mission coast timeline is scrubbed.

*The ship card continues to exist here, but is switched to its context. It shows the current prograde speed of the ship, and provides context through its gizmo display that helps with refining the transfer leg, so that arrival is as close as possible to the ideal position and moment. If an existing waypoint is clicked in this view, it is focussed on, and the gizmo displays the prograde, normal, and radial axes for the trajectory at that point, plus an arrow showing the heading of the trajectory at its arrival terminus, and another arrow that shows what the heading would be if it was ideal, pointing at a low orbit altitude of the destination body at closest approach.* 

<u>Can there be a third arrow that represents the relative angle between the path of the ship, and the prograde direction of the destinatin body's orbit? There should maybe be a way to set up a better approach angle - I'd like to be able to play with that, at least, before deciding how useful that is. The difference would best be addressed by the 2nd waypoint, which would be closer to the end of the leg, but should maybe be present in the first one too. </u>

*The waypoint interface in this context only tunes its burn in fine increments, so the presentation of the heading in the gizmo needs to indicate very slight differences in heading between current and ideal - that is all it is for.*

*This is where the presence of the mini-view of the other two panes becomes relevant. The mini view of the destination system has to be sufficient to show the trajectory passing by it, and the user has to be able to rotate it in order to see how adjustments to waypoints improve or degrade that, while remaining in the Coast phase view.*



#### In Mission Arrival mode

the main pane becomes the destination body view (including the moon, for Earth, and Phobos, for Mars). The trajectory of the ship is shown from the hand-off point, to the arrival point, and continues on as a dimmer line, showing how the ship would proceed onwards if it fails to be captured by the destination body or the tech platforms doing the capturing. The point where the ship would pass by is shown according to how it calculates from the trajectory of the coast phase, including waypoint burns. As waypoints are added to the arrival trajectory, it bends to show the path the ship will then take, including the influence of the gravity of the destination. The presence of capture platforms are indicated by simplifed sketches very similar to those that show them in the departure phase. The technology platforms are in fact identical to those of the same name in the departure phase (and in the linked calculators). In Arrival mode, they are simply portrayed in the configuration, or highlighting the elements, that would capture ships, instead of launching ships. 

### The tool pane (sidebar)

#### In Ephemeris mode

The user selects and origin body from a drop-down list. Under that field, basic facts about that body are stated. Then there is the origin impulse card, with an isometric interface for setting the impulse the ship gets during departure, in the prograde, radial, and normal directions. Once any arrow is placed on it, or any field below it has an amount manually entered, a tooltip appears listing the net impulse delta v, plane change, and prograde delta v (corresponding to the indicator arrows in the three.js pane). Basic data about the resulting trajectory is stated below them. Below that the destination body can be selected from another drop-down list. 

The waypoint card is in a new section under that interface. There is an 'add waypoint' button, which if clicked creates a new impulse burn card, identical to the one that sets up the departure requirements. It also has several additional features. The waypoint can be snapped to the periapsis (or apoapsis, whichever is opposite the origin), ascending node, or descending node. Once one of these are selected, a slider allows it to be slid along the trajectory up to 90 degrees before or after that point. There is a button to remove the waypoint, and under the card there is a new 'add waypoint' button, which can be used to add another, but then that's the limit.

#### In Mission Departure mode

there is a Departure technology card, with a drop-down list from which a technology can be selected. In the case of the Earth, the moon is always the first card in the sidebar, and the tech card becomes the second. (This is necessary because in the imagined future this app is based on, the moon is where the vast majority of space industry is located, and fixed launch infrastructure is thus all located there.) 

Once a technology is chosen, the card for it is loaded, *and has an interface for setting the parameters that determine the impulse it imparts.* Also *each card has a 'link to calculator' toggle. If it's clicked, and if the calculator for that link is open and has impulse-related parameters set for the correct body, those are imported, and after that, changes to that tech in either the calculator or the app are synchronized until such time as the link is toggled off, or the card is removed.*

There are a small set of fixed launch technologies that could feasibly be added as a second element attached to another fixed launch platform. For example, a small ring mass driver or spin launcher could be added to the top of a spin launcher or space elevator, and other similar options may exist. Where such combinations could realistically make sense, they are available to add onto an appropriate base platform. *This is just a matter of refining the options in the drop-down to be context-sensitive and follow a rule set.* 

Below these cards is a button for adding a waypoint, and the standard configuration is that up to two may be added to the departure leg. The interface is identical to that of the waypoints in the Ephemeris tab, except that there are no snapping points. Instead, the first one appears on the mid-point of the trajectory established by the previous cards, and can then be dragged along it from end to end using the slider. If there is a second waypoint, it is placed at the midpoint after the first waypoint, and its slider can move it from the location of the first one to the end of the leg.

#### In Mission Coast mode

#### In Mission Arrival mode

## Designing a mission in the Ephemeris tab

The process begins in the Ephemeris tab. 
