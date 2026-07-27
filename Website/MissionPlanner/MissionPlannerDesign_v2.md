# Mission Planner Design (v2)

This app assists users to plot out an entire mission based on real ephemeris data and trajectory plots. Users can then choose which technology to use to accomplish the mission, from a range of options that are realistic in a future setting. They can either feed in data from calculators (in a separate section) that set the parameters their chosen 'tech stack' would have, or find the parameters by playing around in the app, and instead send those to the relevant calculators to see what properties the launcher or vehicle would need. Once they have succeeded in setting parameters that result in a ship successfully travelling from origin to destination, indicators in different spots signal success. They can swap technologies and change the parameters on their tech, in the app or in the relevant calculator, and the mission profile updates as needed. They can set up several missions within the app that coexist, and compare different mission architectures by reviewing the information in each one. 

The use case of the app is to teach users how different launch tech and rocket tech works, how orbital mechanics works, and the comparative strengths and weaknesses of different launch and rocket tech. Ease of use for a naive user is important, while also offering sophisticated users a quick, intuitive means of testing ideas. The level of accuracy is the best that is feasible within the requirements of providing mission design freedom with many tech choices. 

*Words in italics concern features not yet implemented*

<u>Underlined words are questions or open design decisions</u>

## Interface

There are three main panes to the layout - the top pane, the three.js pane that shows simulations (which includes two floating panes), and the tool pane, otherwise known as the sidebar. The contents of these areas change depending on context. Mission plans are designed in steps, and users go back and forth between them to iterate, refine, and try different combinations of technology and events. 

### Top pane

The top pane, spanning the width of the window, has three parts. 

#### The top part

is for organizing open missions in tabs, and has a button for duplicating the currently displayed mission, and one for opening a mission from *a drop-down menu where users can choose from a small number of example missions*. It also has the Ephemeris tab, which is the starting point for creating any new mission.

#### The middle part

displays key data related to the timeline. In the Ephemeris tab, it has the field for manually entering a date, and a little basic info. In mission tabs, it has the buttons for the three mission phases - Departure, Coast, and Arrival. To the right of those buttons, key parameters and indicators about the mission are shown, and change according to the displayed phase. This is one of two main areas where satisfaction of the mission plan is signalled. When the trajectory has the right heading, 'off course' turns to 'on course' and turns green. When v-inf out, v-inf in, and plan delta v are satisfied, each of them turns green. (The ship card, described below, is also used to indicate when the heading is correct.) To the right of that, is the 'Copy mission link' button.

#### The bottom part

has the scrubbable timelines. In the Ephemeris tab, it spans all the dates covered by the app's internal ephemeris. In mission tabs, the timelines change according to the displayed mission phase, and indicate key points in the mission for that phase.

##### Departure

shows the period between launch from the origin body, and hand-off to the coast phase. The beginning of the coast phase is set by the beginning of the trajectory created in the Ephemeris tab, that was used to form a mission. The beginning of the departure timeline is established by using a formula to estimate how long it will take after launch to exit the SOI of the primary in the origin system. As the set of events in the departure leg is set up, the duration of the timeline is adjusted according to one of two procedures. For bodies without satellites, the beginning of the timeline is dynamically moved. For the Earth and moon, it is the end of the timeline that gets moved, according to an estimation formula. 

(Fixing the timeline start according to the estimate is necessary when a satellite of the primary contributes impulse to the launch thanks to its motion - this has to be included in mission planning in the Ephemeris tab, and thus can't be changed in the mission tab. This is implemented for the moon. It may need implementation for Phobos, as it is the anchor of the modelled Mars skyhook, but perhaps in that case it can be folded into the particular skyhook case for that system, where a skyhook with Phobos as its anchor is one of the tech options.)

*If a body does not have satellites to think about, it would be more accurate to fix the epoch at the end of the departure phase, and have the estimate for the length of the departure leg extend backwards in time from there, with the beginning of that leg being the one that dynamically changes. This should work even for Mars, where the orbit of Phobos is a factor in a skyhook design, but is brief enough for solutions to fall within the one-day margin.*

The committed hand-off date is always marked on the departure timeline, and the ship's predicted SOI exit is marked separately. As long as the predicted exit falls within one day of the committed hand-off, the ship is sufficiently on course to comply with the mission plan.

##### Coast

shows the period from the Departure hand-off, to the Arrival hand-off. It may include up to two waypoints when imported, or such waypoints may be added. Though its endpoint will move around to a certain degree as it is refined, the changes are measured against its parameters in the original mission plan. If the user wishes to change it beyond that, they must copy the mission data using the button in the top pane, paste it into the ephemerise tab, make their adjustments, and create a new mission. In order to provide time in the Arrival phase for the events needed to bring the ship in for capture by the destination body (or the platforms orbiting it), the Coast phase timeline ends some days before closest approach. That period is the length of time it would take the ship to cross the radius of the destination body's sphere of influence at the speed it has relative to the destination, but no less than two days and no more than five. Because it is measured back from closest approach, and closest approach shifts slightly as waypoints are refined, the end of the Coast timeline moves with it. The upper limit exists because the outer planets have spheres of influence so large that crossing one is still cruising, not arriving.

##### Arrival

shows the length of time from the end of the coast phase, on the left end, and continues past closest approach for perhaps a day. This space after closest approach is included so the user can sweep a tech platform through its orbit or rotation, and see what it does with ample context. 

### The Three.js pane

shows the solar system, celestial bodies in it, ship trajectories and related indicators. It is on the left side under the top pane.

#### In Ephemeris mode

it shows the full solar system, with the sun and the orbits of all the included bodies, all to scale. Orbits are accurate, with the side north of their nodes brighter, and the side south of their nodes darker. The SOI of each body is shown. If the camera is close enough, then bodies are shown as orbs, to scale. As the camera zooms out, bodies reduce in size until they are a single bright pixel, as do their SOIs. The bodies are all in the correct spot for the date on the timeline, and move as the timeline is scrubbed. 

Once an origin body is chosen, a Keplerian orbit is shown as a bright blue polyline, as results from the heading and speed at the origin point, with the starting point on the origin body denoted by a bright pink square. As impulses are entered for the Departure point, the trajectory shows the Keplerian orbit that would result, and arrows at the origin point show the magnitude of the net impulse in the prograde direction, and the net direction of the impulse and the magnitude in that direction. As the timeline is scrubbed, the shape and orientation of the trajectory changes to be as it would be if launch was on that date. 

If any point on the trajectory passes close enough to the orbit of another body, that point is indicated by an orbit approach ring. If the user clicks on the trajectory, a chevron marker is placed on that spot representing a ship, and the marker card then shows information about that point, a slider to scrub along the trajectory, and buttons for different modes of setting up rendezvous. 

If a destination body has been chosen, and a chevron has been placed on the trajectory, then the time of flight to reach the chevron's position is used to place an 'x' on the orbit of the destination body. That x marks where the body would have gotten to in its orbit during the time of flight needed for the ship to reach the chevron's position. If the chevron passes by the x mark within 30 days, then a temporal proximity ring shows that. If closer than 7 days, the temporal ring is smaller and brighter, and gets brighter again if the time gap is less than a day.

If waypoints are added, they are shown by a gizmo that has axes for the prograde, radial, and normal directions before the burn made at that point, and two arrows. The  yellow arrow shows the magnitude of the net prograde impulse imparted by the burn, and the pink arrow shows the net direction and magnitude of the impulse (ie, the direction opposite the one the engines were fired in).

#### In Mission Departure mode

the origin body is shown (so far only showing the primary body and omitting any satellites, except in the case of the Earth moon system, and *Mars, where Phobos and Deimos are shown*). The orbit of the body is shown, and the sun is visible in the distance. A small floating pane shows a view of the solar system and coast phase trajectory, and another small floating pane shows a view of the destination body. These small panes are draggable. As launch technology and waypoint burns are added in the tool pane, the trajectory that results is shown, cutting off at the time the departure timeline ends. Simple renderings of the launch tech are shown to indicate basically how they work, and where the ship would start from at launch. Any waypoints are indicated by gizmos on the trajectory that are like the ones in the Ephemeris mode. The gizmos (and their cards in the tool pane) are oriented in the heliocentric frame. *At the hand-off end of the trajectory is a yellow arrow, analogous to the prograde arrow of the ephemeris phase, except it shows the heading the trajectory needs to have at that point in order to be on course, ie, what the prograde direction there needs to be*.  A *chevron moves along the trajectory as the timeline is scrubbed, showing where the ship would be at that moment.*

##### The ship card

*A ship card floats in the pane. It is roughly analogous to the marker card in that it displays pertinent information about the ship, which is represented by the chevron on the trajectory. It shows the prograde speed of ship at the point it's at on the timeline. It has a three.js gizmo on it that looks somewhat like the gizmos shown for waypoints, but that works a bit differently. It shows the heliocentric axes at the departure hand-off, just like the waypoint gizmo, but each axis displays the mission plan impulse for it, by its length, and has an arrow along it, like the arrows shown in tool pane impulse widgets, that shows what the current tech stack and waypoints give the ship in speed per axis when it reaches hand-off. It also has an arrow like the one at the end of the trajectory, showing the heading the ship must have to be on course, with the speed it must have indicated by the length of the arrow. And it has a second arrow that shows the heading the ship currently has when it reaches the hand-off point. There is a checkbox that snaps the display of the gizmo to be the same as the camera has in the main pane, and if unchecked, then by dragging the mouse within the gizmo's pane, it can be rotated independently.*

*If the proper heading at hand-off has been achieved, the ship card displays that in its top right corner, and the background color of the gizmo also changes to indicate that.*

#### In Mission Coast mode

the main pane becomes the solar system view, while the origin body moves to a floating pane. The coast leg (transfer leg) trajectory of the mission is shown, and the chevron showing the ship moves along it as the mission coast timeline is scrubbed.

*The ship card continues to exist here, but is switched to its context. It shows the current prograde speed of the ship, and has a three.js gizmo display that helps with refining the transfer leg, so that arrival is as close as possible to the ideal position and moment. If an existing waypoint is clicked in the main pain, it is focussed on there, and the gizmo displays the prograde, normal, and radial axes for the trajectory at that point, plus an arrow showing the heading of the trajectory at its arrival terminus, and another arrow that shows what the heading would be if it was ideal, pointing at a low orbit altitude of the destination body at closest approach. If a checkbox is toggled on, the orientation of the gizmo matches that of the main pane. If it is toggled off, it can be rotated independently, so the user can better check the comparison between the two arrows.* *The card also lists the distance of closest approach and the angle separating the vectors of the ship and the destination.* 

<u>Can there be a third arrow that represents the relative angle between the path of the ship, and the prograde direction of the destinatin body's orbit? There should maybe be a way to set up a better approach angle - I'd like to be able to play with that, at least, before deciding how useful that is. The difference would best be addressed by the 2nd waypoint, which would be closer to the end of the leg, but should maybe be present in the first one too. </u>

A dimmer extension of the trajectory some 10° past the destination is helpful. (Currently, something like this is sometimes drawn, but sometimes not.) This is useful especially where a significant gravitational interaction is visible. In the Coast phase especially, having this visible is quite useful, with the patched conic approximation.

*This is where the presence of the mini-view of the other two panes becomes relevant. The mini view of the destination system has to be sufficient to show the trajectory passing by it, and the user has to be able to rotate it in order to see how adjustments to waypoints improve or degrade that, while remaining in the Coast phase view.*

The end point of the Coast phase trajectory is at the point in time calculated by the timing formula used in the timeline, listed in the Coast phase section of the Top pane/bottom part.

#### In Mission Arrival mode

*the main pane becomes the destination body view (including the moon, for Earth, and Phobos, for Mars). The trajectory of the ship is shown from the hand-off point, to the arrival point, and continues on as a dimmer line, showing how the ship would proceed onwards if it fails to be captured by the destination body or the tech platforms doing the capturing. The point where the ship would pass by is shown according to how it calculates from the trajectory of the coast phase, including waypoint burns. As waypoints are added to the arrival trajectory, it bends to show the path the ship will then take, including the influence of the gravity of the destination. For sufficient accuracy, an RK4 trajectory calculation is useful here, and the ability, perhaps, to toggle between heliocentric and destination body reference frames. The presence of capture platforms are indicated by simplifed sketches very similar to those that show them in the departure phase. The technology platforms are in fact identical to those of the same name in the departure phase (and in the linked calculators). In Arrival mode, they are simply portrayed in the configuration, or highlighting the elements, that would capture ships, instead of launching ships*. 

*The destination body is shown on its orbit, with the sun visible in the distance, and its SOI shown.* 

*Scrubbing the timeline moves the chevron showing the ship along the trajectory. The ship card shows the ship's speed at that point.* <u>The ship card may later be the best place to show useful data about the ship's approach to a skyhook, space elevator, tug, or spin launcher or ring mass driver. Some widget like the three.js one for the coast phase might be used, to help refine the precise approach vector needed for successful rendezvous with a tech platform, or for an aerobrake maneuver.</u>

*In the case of the Earth and moon, the interface has to have the gravity calculation method it has in departure mode, and the moon must be shown, with any chosen tech platform. Arrival at Earth involved aerobraking through the atmosphere. This has to be displayed, by a color change in the section of ship trajectory near the Earth. If the Earth is double clicked, the view zooms in on it, and camera manipulation rotates around it, so waypoint burns that refine the approach or occur in the atmosphere can be fine tuned more easily.*

The beginning of the Arrival phase trajectory is at the point in time calculated by the timing formula used in the timeline, listed in the Coast phase section of the Top pane/bottom part. 

### The tool pane (sidebar)

#### In Ephemeris mode

The user selects an origin body from a drop-down list. Under that field, basic facts about that body are stated. Then there is the origin impulse card, with an isometric interface for setting the impulse the ship gets during departure, in the prograde, radial, and normal directions. Once any arrow is placed on it, or any field below it has an amount manually entered, a tooltip appears listing the net impulse delta v, plane change, and prograde delta v (corresponding to the indicator arrows of the same color in the three.js pane). Basic data about the resulting trajectory is stated below them. Below that the destination body can be selected from another drop-down list.

If the Earth is the origin body, then a 'Moon phase at launch' widget display the moon phase and relative heliocentric speed at the date on the timeline. Once an impulse has been set, the estimated time to reach the edge of Earth's SOI with the estimated trajectory is displayed in the 'days to leave system' widget. Under that is a 'departure course' field, that automatically chooses an estimated trajectory unless the user specifies they will 'dive in' (*which is an Earth flyby - probably better to call it 'with flyby'*) or take a route that leaves directly.

The waypoint card is in a new section under that interface. There is an 'add waypoint' button, which if clicked creates a new impulse burn card, identical to the one that sets up the departure requirements. It also has several additional features. The waypoint can be snapped to the periapsis (or apoapsis, whichever is opposite the origin), ascending node, or descending node. Once one of these are selected, a slider allows it to be slid along the trajectory up to 90 degrees before or after that point. There is a button to remove the waypoint, and under the card there is a new 'add waypoint' button, which can be used to add another, but then that's the limit.

#### In Mission Departure mode

there is a Departure technology card, with a drop-down list from which a technology can be selected. In the case of the Earth, the moon is always the first card in the sidebar, and the tech card becomes the second. (This is necessary because in the imagined future this app is based on, the moon is where the vast majority of space industry is located, and fixed launch infrastructure is thus all located there.) 

Once a technology is chosen, the card for it is loaded, *and has an interface for setting the parameters that determine the impulse it imparts.* Also *each card has a 'link to calculator' toggle. If it's clicked, and if the calculator for that link is open and has impulse-related parameters set for the correct body, those are imported, and after that, changes to that tech in either the calculator or the app are synchronized until such time as the link is toggled off, or the card is removed.*

There are a small set of fixed launch technologies that could feasibly be added as a second element attached to another fixed launch platform. For example, a small ring mass driver or spin launcher could be added to the top of a spin launcher or space elevator, and other similar options may exist. Where such combinations could realistically make sense, they are available to add onto an appropriate base platform. *This is just a matter of refining the options in the drop-down to be context-sensitive and follow a rule set.* 

Below these cards is a button for adding a waypoint, and the standard configuration is that up to two may be added to the departure leg. The interface is identical to that of the waypoints in the Ephemeris tab, except that there are no snapping points. Instead, the first one appears on the mid-point of the trajectory established by the previous cards, and can then be dragged along it from end to end using the slider. If there is a second waypoint, it is placed at the midpoint after the first waypoint, and its slider can move it from the location of the first one to the end of the leg.

#### In Mission Coast mode

*Any existing waypoints are shown, each with a widget card, but the cards work a bit differently. Impulses can only be fine tuned. The three widget axes cover only 100 m/s. Their values here can be changed in 0.1 m/s increments.  Above the axes widget is a slider that can be dragged to move the waypoint along the trajectory by up to 5°. Below the axes widget interface, is a timing interface. It is a horizontal bar with 0 in the center, and some number of hours to either side. Shifts in arrival timing due to impulse changes are displayed here. Changes to waypoint values can only be implemented in the plan if they bring the arrival flyby closer to the destination (at its recalculated moment of closest approach), or align the angle between the vectors of the destination and the ship more closely and do so without taking the ship out of the 0.0002 AU range of the innermost proximity ring. If they do, an 'update' button lights up and becomes available, and the change is stored if it is clicked*.

*Waypoints can also be added if they don't exist, in which case the first would be placed at the trajectory midpoint, and the second would be placed halfway along the remainder. Then they behave as above.*

These refinements shift the end of the Coast phase, since it tracks closest approach. What is tested is the encounter itself, measured against the original mission plan: an adjustment is accepted only if it improves the approach, and rejected if it degrades it.

#### In Mission Arrival mode

*The 'add waypoint burn' button is at the top, and underneath is an 'add capture tech' drop-down menu. The drop-down menu includes 'skyhook', 'space elevator', and 'tug'. If skyhook or space elevator is selected, then a 'ring mass driver' or 'spin launcher' can be added as a second layer.* These options will become available in the app as they are developed.

*In the case of skyhooks, as in the departure mode, the sweep of the skyhook through its orbit is established by the phase chosen by the user at the capture point. Its movement as the timeline is scrubbed is established by its phase at that time.* (This is for convenience, so setting up arrival isn't made far more complicated by the need to time the flyby to happen precisely when the skyhook is in position. It can be noted in future advisory texts that adjusting the moment of closest approach to fit the needed time is not a hard maneuver in a real mission, but is needlessly complicated in this interface.)

## Designing a mission in the Ephemeris tab

The process begins in the Ephemeris tab. Choosing an origin body highlights the orbit of that body with the starting ship trajectory. Dragging the impulse widget axis arrows or entering an amount in the axis fields underneath causes the trajectory to redraw, and makes a tooltip appear on the edge of the sidebar showing impulse delta v, plane change, and prograde delta v. Corresponding arrows on the origin body indicate impulse speed and heading, and prograde delta v.

By scrubbing the timelines, coarse and fine, pressing shift to get finer control in either one, a user gets an initial sense of how often the sketched trajectory intersects another orbit, how long such intersections last as the timeline continues to move along, and how adjusting normal and radial impulses affect that. They get a sense of how changing different impulses affects trajectory shape. They get to know how far out, or in, a given prograde or retrograde impulse will get a ship, from each body. When the Earth is the origin body, they see how the phase of the moon, and its changing heliocentric speed, changes the shape of the trajectory. <u>(Should the plane change element be added to that, the small amount imparted by the moon's inclined orbit?</u>) 

Once a click on a trajectory places a chevron on that spot, then the marker card populates with a slider so the user can scrub the chevron along the trajectory, with optional finer controls using the shift button or arrows. Under the slider, several pieces of useful data about the trajectory are listed, and live update. At the same time, an x appears on the destination body's orbit, to show where it would be at that moment in the ship's time of flight on such a trajectory. Now by scrubbing the marker slider, the timeline, and adjusting impulse, a user can set up an encounter with the destination.  The x mark and temporal and spatial proximity markers allows them to close in on a date and refine the impulse needed to arrive. (*Let's remove the 'track' function - upon further experimentation I find I never use it.*) Once they have gotten close by manual iterative approximation, they can click the 'target' button to have calculation done that gives the ship a rendezvous launch date and impulse, as efficiently as possible. If they click the free button after this the values they'd placed in the impulse widget return and they are free again to change impulse parameters. *If they hold shift and click 'free', the target impulse values remain,* which is useful for tweaking. It is sometimes possible to trade off different impulse values to get a different solution that is a bit better for the launch and capture technology they have in mind (such as a smaller normal impulse but a larger radial or prograde impulse). Scrubbing the timeline while in target mode will keep the lock and adjust impulse values to do so. This provides the user with a way to see how long launch windows last for a given delta v budget (which is a field that can be set in this mode), and also allows them to see if a different launch date is more efficient. 

Clicking on any body, or the chevron, or an x mark, focuses the camera on it, and it will rotate around it, and zooming moves towards it. It continues to do so until the mouse is clicked on any other point in the pane, after which camera movement returns to default. Clicking on the chevron also makes the camera follow it as the marker timeline is scrubbed and the solar system moves.

There are various cases where it is useful to add a waypoint along the trajectory - to do a plane change being the typical one. If the marker card is in 'target' mode, and the user clicks 'add waypoint', its burn values are automatically calculated, while the user is free to adjust the impulse values of the departure card. The values of the waypoint automatically compensate. 

Once a trajectory complies with the minimum proximity in time and space, the Start Mission Plan button becomes available. Clicking on that button opens a dialog box where the user can optionally name the mission, or keep the standard name, and if they click Create mission tab then the mission is opened in a new tab.

There is also a button to click if the user wishes to paste in the data copied in a mission link. *This data should be made to work across sessions, so that even after restarting their computer, a user could copy such mission link data stored in a notepad or some such, and it will load the mission parameters.*

### Designing a Departure phase

Once a departure technology is selected, a trajectory is shown, and a card to set its parameters appears, and the timeline starts live displaying the estimated time to leave the body's SOI. Scrubbing the timeline scrubs the chevron marking the ship along the trajectory. *Clicking 'add waypoint' creates a waypoint at the current location of the chevron.* 

The ship card is the key to setting up the proper heading at hand-off. Live updates of its heading and speed display inform the setting of parameters. Users can also use the view of the heading arrow at the end of the trajectory as guidance, if in view.

### Designing a Coast phase

The coast phase design is for the purpose of aligning approach as cheaply as possible to be within range of any capture platforms. As long as the target mode is used, the arrival end of the trajectory should already pass within 30,000 km of the destination body. But generally skyhooks would be shorter than this, and the option of imitating a traditional rocket burn during flyby also greatly benefits from a much closer approach. The ship card would need to list the distance to the destination at closest approach, and the relative angle of approach - how many degrees separate the headings of the two trajectories. The concept is that any mid-course burn, which may already be present for executing a plane change, can be refined here to improve the approach vector and distance. Then a second waypoint might be added for final refinement, for instance if there is an opportunity at an apoapsis, before the trajectory starts returning, and then encounters the destination. <u>Discussion of what approaches work best in such a situation is called for, while keeping in mind that experimentation is kept easy so users can get a sense for the paradigm that way as well.</u>

Being able to go back and forth between Coast and Arrival phases is also useful so that users can rejig their burns to adapt them if they decide to switch arrival tech, or if they have come across a more efficient approach that needs changes in Coast phase burns in order to work.

<u>We could consider the option of adding in an extra delta v requirement here, if the route out during the departure phase added at least 10 m/s to the budget, which would be because of the drift in the epoch at hand-off due to the complications of estimation in the Earth moon case. This would need to be flagged somewhere.</u> 

### Designing an Arrival phase

Changes in trajectory due to interaction with the destination's gravity will already be visible in the trajectory as drawn in the Coast phase, but here a more accurate RK4 calculation is helpful. Being able to switch between the reference frame of the destination body, and the heliocentric frame, can also useful for orientation. 

Once tech has been selected from the drop-downs, being able to optionally follow the ship as it flies by is probably useful, so clicking on the chevron should cause the camera to follow it. Clicking on the tech should zoom the camera in close enough to clearly see how it changes as parameters are adjusted.
