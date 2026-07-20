# Mission Planner Design

This app assists users to plot out an entire mission based on real ephemeris data and trajectory plots. Users can then choose which technology to use to accomplish the mission, feeding in data from calculators (in a separate section) that set the parameters their chosen 'tech stack' would have. They can swap technologies, change the parameters on their tech in the relevant calculator, and the mission profile updates as needed. They can set up several missions within the app that coexist, and compare different mission architectures.

## Interface

There are three main panes to the layout, and two floating panes within the three.js pane. The contents of these areas change depending on context. Designs are achieved in steps, and users can go back and forth between them

## Starting a mission design

The process begins with the Solar-System-Trajectory-Plotter almost as it is now. (The one difference is that it is possible to change the system shown in the three.js pane, switching it out for another multi-body system. Currently the options that could make sense are the Earth-moon system, and the Mars-Phobos system. This would be for missions that occur entirely within that system, for example cargo missions from the moon's surface to the Earth's surface.) This allows the user to determine the timing and trajectory of a mission, by playing with the existing tools to establish a feasible flight plan. 

Once they have created a realistic flight plan by choosing an origin and destination, playing with impulse controls, dropping a marker and setting up a rendezvous with the destination body, they can click on a 'Start Mission Plan' button at the bottom of the Marker card. The button is not clickable unless the marker is within the closest approach rings for both space and time. If Waypoint(s) have been created before they click that button, they are included in the exported data.

Once clicked, they choose a name for their mission, and a new tab is created, with a new interface that allows them to choose the technology they want to use to complete the flight. The starting layout remain accessible in an 'Ephemeris' tab to the left of the mission tab. If they return to that tab, they can choose to delete the marker card and start fresh, creating a new flight plan. The mission plan tab they just made remains intact with the previous flight plan. If they set up a new one and click 'Start Mission Plan' again, a new tab is spawned with the data from that, and now there are three tabs across the top of the app window. 

## Mission Tab

The mission tab presents everything in terms of the dates and trajectory of the flight plan. 

### Top pane

The tabs for the ephemeris and the different mission plans are across the top of the app, with the active one highlighted. Under that are three buttons: Departure, Coast, and Arrival. Depending on which is active, the slider underneath them is for that segment of the journey, and remaining space in this pane displays the core data about the trajectory. Only the 'coast' phase slider is based on specific dates - it is the one that runs from the beginning to end of the dates set up when the mission was created. Because the time that elapses while ships depart and arrive depends heavily on the particular technology used, time in the sliders for those segments stretches to accommodate the events set up within them (once created, before that they are greyed out). The active button also swaps what is shown in the rest of the app.

### Departure

When active, the small floating panes in the three.js pane show the 'coast' and 'arrival' bodies/systems, and the main pane underneath them shows the departure system. The sidebar shows the parameters and cards associated with that - this is where cards for different technologies can be loaded. Technologies can be loaded into the sidebar either by sending a configuration to it from the calculator section, or choosing it from a drop-down list. The card allows key suitable parameters for that tech to be set in the card. 

The existing sidebar for the Moon-Skyhook-Trajectory-Plotter provides a good example. Possibly the card could have tabs or expandable sections that permit further parameters to be set, and passed back to the calculator section, or key info to be displayed. The Earth-moon three.js system will be expanded in future, so that a moon-L1 space elevator, or a lunar mass driver, or an Earth skyhook, or spin launcher attached to the lunar skyhook, are other card options. Once finished, those structures will also be represented in the three.js rendering of the system. Up to 2 waypoint burns that occur within this system can also be added. 

This system also is an example of how departure/coast/arrival could in future make sense for mission planning within this system. The departure section might focus on transfer of a ship from the lunar surface to the skyhook or the space elevator, coast might include a small course adjustment burn, arrival might zoom in on entry, descent and landing.

Once departure technology has been selected, it must be configured to comply with the speed and trajectory required by the mission. Indicators and interactive controls will be added to the three.js pane and the cards that assist with meeting requirements. Once a trajectory exists, it becomes possible to click on it and place a marker, as solar system trajectories can have, with a similar card. The card is designed to help with meeting speed and trajectory requirements.

### Coast

When active, the main system displayed in the three.js pane is (usually) the solar system, and the smaller panes show the other two. If there is a waypoint, it can be adjusted in the sidebar or by dragging it along the trajectory. Or a waypoint can be added, and optionally a second. Once again, any adjustments to the waypoints must meet requirements by getting the ship to the rendezvous point at the right time. 

### Arrival

When active, the destination body is in the main three.js pane. Like with the Departure configuration, tech cards can be loaded into the sidebar by dropdown menu or loaded from their calculator in the calculator section. Most other aspects of the Departure configuration are also mirrored here, except that in this case, the tech must be set up to catch or intercept the approaching ship, and waypoints are about slowing down in preparation for that. 
