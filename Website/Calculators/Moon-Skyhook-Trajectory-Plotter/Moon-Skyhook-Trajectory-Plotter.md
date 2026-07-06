# Moon Skyhook Trajectory Plotter

## Purpose

Shows the trajectories that result when a vessel is released from a lunar skyhook with given parameters, at a given point, optionally including two waypoints afterwards. Must be able to show the effect of an Earth flyby, where the trajectory makes that relevant, including Oberth effect if there is a burn.

## Design

In three panes: Ephemeris date section, 3D simulation of the Earth-moon system with skyhook, Sidebar with input field/sliders and read-outs of effects.

### Ephemeris date section

- Similar to the one for the 'Solar-System-Trajectory-Plotter' calculator, except

- The top slider scrubs through 3 years, from midnight on Jan. 1, 2030, to midnight on Dec. 31, 2033

- The second slider goes through one lunar month, centered on the point in the top slider. That is, the moon moves through exactly 360° from the beginning to the end of the slider.

- add another slider below those two, that scrubs the skyhook through 360° of its orbit based on the parameters set in the sidebar (or the default)

### 3D model of Earth-moon system and skyhook

- Similar to the solar system simulation from Solar-System-Trajectory-Plotter, but isolated to the Earth and the moon, with the sun off-screen and indicated only by lighting direction falling on the spheres of the Earth and the moon

- Navigable in the same way as in Solar-System-Trajectory-Plotter, with the moon's nodes indicated in the same way, and the SOI of both bodies shown

- Only the vicinity of the Earth and moon can be viewed, up to a distance of perhaps 1.5 million km from Earth

- Skyhook is shown thus, all to scale:
  
  - The circlular orbit traced by the top of the skyhook is drawn as a line
  
  - As is the orbit of the center of mass
  
  - A radial line starting 20 km above the surface of the moon, from the moon's center through the CoM and top, indicates the current position of the skyhook
  
  - A small arrow pointing at the radial line indicates the location of the release point from the skyhook to be used in calculations
- Skyhook preset is: CoM at 275 km, release point 950 km, top 6000 km
- Moon and Earth start at their position at midnight on Jan 1, 2030, and the skyhook is orbiting the moon's equator, and starts at 0° longitude of the ecliptic 
- The sphere for the moon has the image '2k_moon-Wrap' on its surface, and the Earth has 'NASA-Earth-world.200407.3x5400x2700'
- Zoom function: 
  - double click on the moon puts it in focus, showing the view from a point 20,000 km from its center
  - double click on the Earth puts it in focus, showing the view from a point 30,000 km from its center

### Sidebar

- at top, side by side, a field for setting the altitude of the CoM, and one for setting the altitude of the top
  
  - below the CoM field is the read-out of its orbital velocity
  
  - below the top field is the read-out of its angular velocity and the centrifugal force felt there
- Below that, the next row is for setting the altitude of the release point, between the altitudes of CoM and top
  - or, the user can drag the triangle indicator on the drawing of the skyhook instead
  - Once set, the read-out below it shows the speed on release - at the release point, the v_inf at the edge of the moon's SOI, and the v_inf at the edge of the Earth's SOI (assuming perfectly spherical SOIs). 




