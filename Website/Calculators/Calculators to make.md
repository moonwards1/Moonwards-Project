# Calculators to make or expand

## Tether tool expansion

- Refine list of 'Minimum release altitudes' to reflect altitude needed to reach listed bodies when they are at their average distance, considering V-inf value after release, plus speed imparted by moon's motion around the Earth when it is in position to make a prograde release.

## Inter-calculator functions

- Easy copy-pasting of results from one field to a corresponding one in a different calculator

- Results of 'Deep Space Skyhook Trajectory Plotter' or 'Hohmann Transfer Plotter' can be connected to 'Solar System Trajectory Plotter' by clicking buttons in it labelled 'Link', for each of the other calculators
  
  - Plotting the orbit determined by chosen parameters into its 3D solar system model
  
  - Updating that orbit when those parameters are changed in one of those other calculators

## Deep Space Skyhook Trajectory Plotter

Designed in three panes: 

- Ephemeris date section just like the one for the 'Solar-System-Trajectory-Plotter' calculator

- 3D model of Earth-moon system, with a preset for a gravity-gradient skyhook in orbit around the moon
  
  - Similar to the solar system simulation from Solar-System-Trajectory-Plotter, but isolated to the Earth and the moon, with the sun off-screen and indicated only by lighting direction falling on the spheres of the Earth and the moon
  
  - Navigable in the same way as in Solar-System-Trajectory-Plotter, with the moon's nodes indicated in the same way, and the SOI of both bodies shown
  
  - Only the vicinity of the Earth and moon can be viewed, up to a distance of perhaps 1 million km from Earth
  
  - Skyhook is shown thus, all to scale:
    
    - The circlular orbit traced by the top of the skyhook is drawn as a line
    
    - So is the orbit of the center of mass

- Sidebar with adjustable parameters
  
  - On a large screen, 1/3 of width, rest of height, on the right
  
  - On a small screen, full width under 3d model, scrollable

- 3D model pane setup:
  
  - Navigable with rotate, zoom, and pan
  
  - Shows orbit of moon around the Earth
  
  - Shows axial tilt of the moon and the Earth
  
  - The sun is communicated by showing how it illuminates the orbs of the Earth and moon
  
  - Portrays the orbit of the deep space skyhook around the moon 
  
  - 
  
  - A radial line extends outwards from where the tip of the skyhook is in its orbit
  
  - Draws the trajectory of a vessel released from the skyhook, based on the ephemeris time, and trajectory data

- Ephemeris Sliders
  
  - In two parts, both of which are most of the width of the pane:
    - Upper Slider goes from Jan 1 of 2030 on left tip to Jan 1 of 2031 on the right tip
    - Lower Slider shows one lunar sidereal month (one full orbit back to the same spot), and scrolls through the full year according to the position of the Upper Slider
  - Date field below the sliders shows the date according to slider positions, or can be clicked into so a date can be manually entered
  - Narrow horizontal bars across the sliders indicate when the moon is full - the best moment to launch a ship prograde into a Hohmann transfer - and when it is new - the best moment to launch a ship retrograde into a Hohmann transfer

- Release Parameters et cetera
  
  - Slider rotates skyhook through its orbit. (As orbits are only 2.2 h long, arbitrarily choosing a position is allowed for convenience, rather than doing ephemeris-style tracking of the orbit.)
  
  - A field is also available where the position of the skyhook can be entered numerically (in degrees of a circle with one decimal place).
  
  - Release altitude on the skyhook can be chosen with another slider, or numerically entered in a field
    
    - As this calculator is for the purpose of analyzing interplanetary voyages, the minimum value available here is one where the ship will escape the Earth-moon system. This is to simplify the math for drawing the trajectory.
    - 
  
  - With these two set, a vector triangle appears below them, showing the prograde and radial elements of the resulting trajectory, the net vector, and the numerical value of each
  
  - A trajectory is also drawn onto the 3D model, showing the path the ship would take in the Earth-moon neighborhood
    
    - Where the trajectory passes close enough to the Earth for flyby effects to be significant, those are calculated and added to the trajectory plot
    - In that case, a value is displayed beside the vector triangle, labelled 'Oberth effect', showing the multiple of delta v that would result from doing a burn at closest approach to the Earth
  
  - A slider to add a burn immediately after release from the skyhook, in the normal direction
    
    - This is added into the trajectory calculation, and the inclination of the orbit is adjusted 
    - A graphic below the slider shows the prograde vector length (corresponding to prograde/retrograde speed), the normal vector length, and an arrow showing the net vector and length
    - If the trajectory involves a flyby of Earth, the first calculation is of how the flyby trajectory changes, and then how the orbit after flyby is affected
  
  - A slider to add an Oberth effect burn at closest approach to Earth
    
    - This slider isn't available unless there is an Earth flyby
    - The slider goes from 0 to 3 km/s, or a higher value can be typed into the field beside it (which is also a way to select a value)
      - Values are in m/s, no decimals

## Hohmann Transfer Plotter

- Designed in two panes: 3D solar system display in the pane on the left, and input interfaces in the pane on the right

- Includes all planets, plus Ceres, Psyche, Vesta, and Pluto
  
  - As a 3D model navigable with rotate, zoom, and pan
  
  - Celestial bodies are represented by a semi-transparent sphere marking their SOI

- Input Pane setup
  
  - Ephemeris Slider, for scrubbing through a 100 year period,
    
    - with field to optionally put in a number between 0 and 100, with two decimal places
    - This sets the position of all the celestial bodies based on an ephemeris
    - 0 represents Jan 1 2030 (or would it be better to use the nearest date where Earth is at 0 degrees in its orbit?)
  
  - Lists for selecting two bodies: an origin and a destination
    
    - Once selected, the list of all Hohmann transfer opportunities between these bodies during the covered period, is displayed as dots along the orbit of each body, in the right pane, in green for origin and red for destination.
    - Once selected, the ephemeris slider shows lines across the slider bar at each window's time
    - Once selected, a text field appears that shows the list of all transfer windows, one per line, as a scrollable list with 5 lines visible at a time
      - with a consecutive number, a departure date, and an arrival date
  
  - Date selector, with a field for specifying a date, and alternate options for setting it
    
    - double clicking on one of the dots on the orbit of the origin or destination selects that date
    
    - Double clicking on one of the lines listing transfer windows

## Solar System Trajectory Plotter

- Designed in two panes: 3D solar system display in the pane on the left, and input interfaces in the pane on the right

- Includes all planets, plus Ceres, Psyche, Vesta, and Pluto
  
  - As a 3D model navigable with rotate, zoom, and pan
  
  - Celestial bodies are represented by a semi-transparent sphere marking their SOI

### Input pane setup:

- Select a date within the 100 year period covered by the calculator 

- Select point of origin (one of the bodies)

- Set length of 3 vectors - prograde/retrograde, radial, and normal - dragging arrows or entering numbers for km/s

- Optionally select a point along the trajectory plotted based on this

- Given a readout of the 3 vectors at that point
  
  - change the vector values with the same sort of interface as above

- Optionally select a second point along the trajectory plotted based on this

### Outputs are:

- redraw the resulting trajectory every time vector values are changed
- as indicated above, provide the vector values for any selected point on the trajectory
- Once points have been set, store them, and update how they change when points earlier on the trajectory are changed

## Ceres Space Elevator Launches and Catches

- Can import trajectory result from 'Solar System Trajectory Plotter'

## Psyche Space Elevator Launches and Catches
