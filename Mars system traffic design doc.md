# Mars system traffic plotter design overview

This app, like the Earth-moon traffic plotter, allows users to explore the physics,  engineering, and logistics of these vast pieces of infrastructure. All the main pieces that would be involved in the local economy are portrayed, as well as those that integrate it with other active bodies in the solar system. It can be set to the architecture chosen for Moonwards through presets, or set up as the user wishes, for exploration of the concepts or to find alternative approaches.

## Mars System Transport Facilities and Vehicles

The Mars system could have a wide variety of facilities. Here are the ones that bear inclusion in the app:

- Phobos skyhook - with ability to adjust the altitude of the foot and top

- Hanging skyhook, 

  - with inclusion of a tool to calculate how timing changes through movement of ballast along tethers could be used to keep it from colliding with Phobos, if their tethers overlap. In that case, after the design has been specced, a button could get the calculations done, and put into the timeline 

  - The angle of inclination to Mars' equator would be an input field, with sun-synchronous as a checkbox

  - Users can also define the altitude of the top, CoM, and foot, though guidance is needed as to what complies with a synchronous orbit, if there is tether overlap.

- Space elevator, in Layout A or Layout B from the session 'Mars space elevator dimensions'

- A mass driver on the surface that sends traffic to other facilities

The parameters for these installations will sometimes be imported from their cards in the workbench.

Trajectories after release from these facilities, or after launch from a mass driver, are plotted. The purpose is to consider movement within the system. Unlike the Mission Planner, which will be developed to look at how arrival is handled on one facility, this looks at the exchange of cargo between different facilities. Also, in the case of this app, there will be no packet exchange with the Mission Planner. In the case of Earth, aerobrake is the standard approach to entry into a flight plan ending in capture and docking. For Mars, capture at any of the multiple facilities available is the standard approach. That can be handled solely in the Mission Planner.
