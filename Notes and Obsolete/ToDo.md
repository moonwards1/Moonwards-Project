# To Do

These are Kim's notes to herself. This is not organized and only some of it will actually be acted on.

## Firm plans

- Read over everything and add a (?) beside every point you want to ask Claude about. Go through these before working towards obtaining Claudes analysis.

- Return at some point to the matter of wheel configuration for climbers, and go over the approach from Desktop/1032Pearson.pdf - the deforming wheels that greatly spread the contact area of each. Top speed? Materials? Lifetime?

- Thinking through a single skyhook architecture that does it all. Would be good to see the animation of launches in this scenario - ask Claude to do a new one with the parameters in the new spreadsheet (Moonwards Single Lunar Skyhook Architecture). I think it will work - the full trip takes 3 hours for the direct launch speed, and one skyhook orbit is 2.25 hours, but if there is just a window that is offset from when the skyhook is at the apoapsis of the shuttles by 3 hours, then they can still be launched every 2.25 hours, there shouldn't be a problem. I need to check this. 
  
  - The advantage of using just the one skyhook with a far shorter orbital period, is that the mass driver infrastructure can be smaller. The infrastructure is basically used twice as often while being half as big. Some things will wear out faster, but the number of things is about the same - half as many things, repaired twice as often. I'm sure it isn't all a linear thing, but I think this reduces the size of the build by a fair bit. The catcher has to deal with much higher speeds, but it can do it in 10 lanes instead of 20, so even if each lane is longer, it works out alright. (Also I'm reducing the mass sent up, as the inputs coming from Ceres and Psyche reduce the demand for stuff from the surface to get to that 10 MT total.)

- Re-ask Claude, or Gemini, about plane changes via flyby of Earth, to see how big an inclination can result. 

- Finish write-up of Ceres transport system. This becomes the example for other docs.
  
  - With this piece done, that leaves only Psyche's transport system to design. This should be the last major thorn regarding a realistic and economic transport system. Psyche's system should be very similar, ship design follows from launch, flyby, and capture design. 
  - Tug design and mission profiles are a remaining question. When and how should they be used, are they genuinely better than having ships do burns themselves in each case. Especially, how do they return to their base of operations efficiently, without excess delay or fuel use.
  - Getting the written outline of how the system works, through a series of documents, should provide confidence that all the documentation can be proceeded with. Confidence that there will be no major changes and there are no huge mistakes allows me to proceed without hesitation or further interruptions and backtracking after I realize there is a great mistake in the system.

- change svg so that asteroid has correct dimensions in comparison to space elevator. Tell Claude to get the code from Sigvart's code.

- Break current documents up into smaller docs, and update them. This is a priority so Claude can reference accurate data, which helps it make good suggestions and comments.

- Flywheel calculator

## Possible plans

- Add travel time to Orbit section
- Add synodic window to Asteroid parameters
  - It might be better to instead have such things be part of a calculator about logistics or something.

## Thoughts

- Come up with a way to roughly model the mass of infrastructure along the length of the space elevator (or skyhook).
  - This would be another line under the current one that shows mass per kg of tip. See Claude chat on how to calculate.
- Consider a new calculator that goes further in modeling space elevator or skyhook, looking at combining materials in different sections, or doing a series of tether taper calculations, that start at the tip and work down past major installations on its length. Perhaps this has more value if it also looks at track and climber mass, docking facilities if not at the tip.
- An orbit calculator that shows the solar system has been discussed with Claude. It is quite doable but seems to be a fairly big time commitment. As the viability of the entire concept depends on being able to travel economically between the chosen asteroids and the moon, I am going ahead with a mock-up in Blender, as I'm not prepared to work for a couple of weeks before having a sense of whether this can work.
- How can these calculators create a flow through a design process that both conveys the logic of Moonwards, and provides a design space for other similar systems? Should one calculator flow into the next, pulling previous results into new steps?
