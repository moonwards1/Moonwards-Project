// Explanations behind each result, shown in the info pop-ups.
//
// Each entry: title, body (blocks), now(r, f) → a line with the current
// values. Block kinds: { p } prose, where $…$ is inline TeX; { tex } display
// TeX; { vars: [[symbol TeX, meaning], …] } a variable list.

export const INFO = {

sled: {
	title: "Sled mass and length",
	body: [
		{ p: "The sled is the reusable carriage that holds the ship during the run. It carries the superconducting field magnets, which straddle the guideway blade from both sides. The ship never needs magnets of its own." },
		{ p: "Both the sled's mass and its length scale with the ship's mass, set by the preset. Scaling the length means the magnet area grows in step with the driving force. That keeps the magnetic shear the same whatever the ship size, for a given acceleration and field:" },
		{ tex: "m_s = f_m\\,m_{ship}, \\qquad \\ell = f_\\ell\\,m_{ship}, \\qquad A = n\\,h\\,\\ell" },
		{ vars: [
			["m_s", "sled mass (kg)"],
			["f_m", "sled mass as a fraction of ship mass (from the preset)"],
			["\\ell", "sled (magnet array) length (m)"],
			["f_\\ell", "sled length per unit of ship mass (from the preset)"],
			["A", "magnet area facing the windings (m²)"],
			["n", "winding faces: 2, one each side of the blade"],
			["h", "magnet and winding height (m), a design assumption"],
		] },
		{ p: "A longer sled spreads the force over more winding, so the windings and the guideway blade can be thinner. The cost is a heavier sled, which must be accelerated with the ship and then stopped in the braking section." },
	],
	now: (r, f) => `Sled mass ${f.mass(r.mSled)}, length ${f.len(r.sledLength)}, moving mass (ship + sled) ${f.mass(r.mMoving)}.`,
},

trackLength: {
	title: "Launch track length",
	body: [
		{ p: "The launch section is the stretch of track over which ship and sled are driven from rest to release speed. It runs from its free far end to the hub, where the ship leaves the sled and flies on past the tether. Launching toward the hub is what keeps the whole track in tension (see the CNT spine)." },
		{ p: "At constant acceleration the length follows from basic kinematics:" },
		{ tex: "L = \\frac{v^2}{2a}" },
		{ p: "With the power cap on, acceleration holds at $a$ only until the power reaches the cap $P$, at speed $v_c$. The rest of the run is at constant power, and the length becomes:" },
		{ tex: "v_c = \\frac{P}{m\\,a}, \\qquad L = \\frac{v_c^2}{2a} + \\frac{m\\,(v^3 - v_c^3)}{3P}" },
		{ vars: [
			["L", "launch track length (m)"],
			["v", "release speed (m/s)"],
			["a", "maximum acceleration (m/s²)"],
			["m", "moving mass, ship + sled (kg)"],
			["P", "power cap (W)"],
			["v_c", "speed at which the cap is reached (m/s)"],
		] },
		{ p: "Doubling the acceleration halves the track. It saves little mass, because the force doubles too: what the track must carry is force times length, which is the launch energy." },
	],
	now: (r, f) => `Track ${f.len(r.launch.L)}` + (r.launch.capped
		? `; power cap reached at ${f.speed(r.launch.vc)}, ${f.len(r.launch.x1)} along.` : "."),
},

duration: {
	title: "Launch duration",
	body: [
		{ p: "The time from the sled starting at rest to the ship's release at the hub. At constant acceleration it is simply speed divided by acceleration. With the power cap, the constant-power phase adds time: kinetic energy grows at the fixed rate $P$." },
		{ tex: "t = \\frac{v}{a} \\quad\\text{(constant acceleration)}" },
		{ tex: "t = \\frac{v_c}{a} + \\frac{m\\,(v^2 - v_c^2)}{2P} \\quad\\text{(power-capped)}" },
		{ vars: [
			["t", "launch duration (s)"],
			["v", "release speed (m/s)"],
			["a", "maximum acceleration (m/s²)"],
			["v_c", "speed at which the power cap is reached (m/s)"],
			["m", "moving mass, ship + sled (kg)"],
			["P", "power cap (W)"],
		] },
		{ p: "A short run matters in three ways. The recoil impulse is delivered to the tip faster than the tether can respond, so the local tip mass absorbs it. The power has to be delivered in a brief burst. And each winding block is energised only for the moment the sled passes over it. That moment sets how thin the windings can be (see Winding mass)." },
	],
	now: (r, f) => `Launch takes ${f.time(r.launch.T)}.`,
},

force: {
	title: "Driving force",
	body: [
		{ p: "The force the windings exert on the sled, which carries the ship. By Newton's third law, an equal force pushes back on the track. It is the moving mass times its acceleration:" },
		{ tex: "F = (m_{ship} + m_s)\\,a" },
		{ p: "With the power cap on, the force holds at this value until the cap is reached, then falls as power divided by speed. It is lowest at release:" },
		{ tex: "F_{rel} = \\frac{P}{v}" },
		{ vars: [
			["F", "maximum driving force (N)"],
			["m_{ship}", "ship mass (kg)"],
			["m_s", "sled mass (kg)"],
			["a", "maximum acceleration (m/s²)"],
			["F_{rel}", "force at release when power-capped (N)"],
			["P", "power cap (W)"],
			["v", "release speed (m/s)"],
		] },
		{ p: "The maximum force sizes the CNT spine along its whole length, because every section between the sled and the hub carries it at the start of the run. The local force sizes the windings and the guideway blade at each point. The ship's own structure must carry $m_{ship}\\,a$ into its cradle on the sled. For drone cargo ships that is a matter of hull design, not crew limits." },
	],
	now: (r, f) => `Maximum force ${f.force(r.launch.Fmax)}` + (r.launch.capped
		? `, falling to ${f.force(r.launch.Frelease)} at release.` : `, constant through the run.`),
},

peakPower: {
	title: "Peak power",
	body: [
		{ p: "The mechanical power delivered to the sled is force times speed. At constant acceleration it rises steadily and peaks at release, at twice the run's average:" },
		{ tex: "P_{peak} = m\\,a\\,v, \\qquad \\bar P = \\frac{E}{t} = \\tfrac{1}{2}\\,m\\,a\\,v" },
		{ vars: [
			["P_{peak}", "peak mechanical power (W)"],
			["\\bar P", "average power over the run (W)"],
			["m", "moving mass, ship + sled (kg)"],
			["a", "acceleration (m/s²)"],
			["v", "release speed (m/s)"],
			["E", "launch energy (J)"],
			["t", "launch duration (s)"],
		] },
		{ p: "Peak power is likely the costliest number in the design. Power conversion hardware scales with it: the converters in the Power delivery results are rated by it. Ticking the power cap trades it away: harder acceleration at low speed, where power is cheap, and constant power near release. The cost is a longer track and a heavier spine." },
		{ p: "Electrical draw at the peak is somewhat higher than this mechanical figure, by conversion losses and winding heating." },
	],
	now: (r, f) => `Peak mechanical power ${f.power(r.launch.Ppeak)}` + (r.launch.capped ? " (capped)." : " at release."),
},

braking: {
	title: "Sled braking section",
	body: [
		{ p: "After release, the empty sled continues past the hub into the braking section. There, the same kind of windings run as generators and stop it at high deceleration, returning most of its kinetic energy to storage. The sled is then returned slowly to the start of the launch section for the next ship." },
		{ tex: "L_b = \\frac{v^2}{2a_b}, \\qquad t_b = \\frac{v}{a_b}, \\qquad F_b = m_s\\,a_b, \\qquad E_s = \\tfrac{1}{2}\\,m_s\\,v^2" },
		{ vars: [
			["L_b", "braking section length (m)"],
			["t_b", "braking time (s)"],
			["F_b", "braking force (N)"],
			["E_s", "sled kinetic energy at release (J)"],
			["v", "release speed (m/s)"],
			["a_b", "braking deceleration (m/s²)"],
			["m_s", "sled mass (kg)"],
		] },
		{ p: "The braking reaction drags the windings in the sled's direction of travel, away from the hub. So this section is also a tension member hanging from the hub, with its own CNT spine. The ship flies on straight over the braking section while the sled slows beneath it. Its clearance must allow for the small drift that the local field and Coriolis acceleration cause over a few seconds." },
	],
	now: (r, f) => `Braking ${f.len(r.brake.L)} in ${f.time(r.brake.T)} at ${f.force(r.brake.F)}.`,
},

energy: {
	title: "Launch energy",
	body: [
		{ p: "The kinetic energy given to ship and sled together by the end of the run:" },
		{ tex: "E = \\tfrac{1}{2}\\,(m_{ship} + m_s)\\,v^2" },
		{ vars: [
			["E", "launch energy (J)"],
			["m_{ship}", "ship mass (kg)"],
			["m_s", "sled mass (kg)"],
			["v", "release speed (m/s)"],
		] },
		{ p: "At 2 km/s this is 2 GJ per tonne. The ship's share leaves with it. The sled's share, $\\tfrac12 m_s v^2$, is mostly recovered in the braking section, so it raises the storage needed for one launch but not the energy consumed per launch." },
		{ p: "This energy comes from the infrastructure, not the ship. The structure that carries the drive force has a minimum mass of this energy divided by the material's specific strength, whatever the acceleration (see the CNT spine). That is why release speed, more than acceleration, sets the size of the driver." },
	],
	now: (r, f) => `Launch energy ${f.energy(r.energy.eKin)}, of which the sled carries ${f.energy(r.energy.eSled)}.`,
},

storage: {
	title: "Energy storage (thin-rim CNT flywheels)",
	body: [
		{ p: "Storage must hold one launch's worth of energy plus the heat left in the track windings, generators and feeders, divided by the conversion efficiency. It is assumed to be thin-rim flywheels of CNT fibre. In a thin rim the hoop stress is the density times the rim speed squared, so the energy a rim can store per kilogram is set by the material's specific strength:" },
		{ tex: "\\sigma = \\rho\\,v_{rim}^2 \\;\\Rightarrow\\; e_{rim} = \\tfrac{1}{2}\\,v_{rim}^2 = \\frac{\\sigma}{2\\,\\rho\\,SF}" },
		{ p: "A flywheel cannot be drained to a standstill, because its generator's voltage falls with speed. Discharging from full speed down to a fraction $r$ of it releases $1 - r^2$ of the stored energy:" },
		{ tex: "E_{store} = \\frac{E + Q}{\\eta}, \\qquad M_{fw} = \\frac{E_{store}}{e_{rim}\\,(1 - r^2)}" },
		{ vars: [
			["\\sigma", "CNT tensile strength (Pa)"],
			["\\rho", "CNT density (kg/m³)"],
			["SF", "safety factor"],
			["v_{rim}", "rim speed (m/s)"],
			["e_{rim}", "usable energy per kg of rim at full speed (J/kg)"],
			["E", "launch energy (J)"],
			["Q", "heat left in the launch windings, generators and feeders (J)"],
			["\\eta", "conversion efficiency"],
			["r", "minimum ÷ maximum flywheel speed"],
			["M_{fw}", "rim mass (kg)"],
		] },
		{ p: "This is rim mass only: hubs, bearings, housings and generators come on top. At a skyhook tip this mass is useful as well as costly, since it helps absorb the recoil of each launch." },
	],
	now: (r, f) => `Store ${f.energy(r.energy.eStore)}; rim energy ${f.num(r.energy.eRim / 1e6)} MJ/kg; usable fraction ${f.num(r.energy.dod * 100)}%; rim mass ${f.mass(r.energy.flywheelMass)}. Sled braking returns ${f.energy(r.energy.eRecovered)}.`,
},

windings: {
	title: "Winding mass",
	body: [
		{ p: "The motor is a linear synchronous motor. The sled's superconducting magnets give a field $B$ in the gap. The track carries thin aluminium windings on both faces of the guideway blade, switched on in blocks as long as the sled, only while the sled passes. The thrust per square metre comes from the field acting on the windings' sheet current:" },
		{ tex: "\\tau_s = \\tfrac{1}{2}\\,B\\,K \\;\\Rightarrow\\; K = \\frac{2\\,\\tau_s}{B}" },
		{ p: "Each block is on for only a moment, so its heat has nowhere to go. The conductor warms like a fuse, from its cold starting temperature $T_0$ to its limit $T_1$. That caps the current density it can carry for that time, and the current density sets the thickness:" },
		{ tex: "\\int J^2\\,dt = \\int_{T_0}^{T_1} \\frac{\\rho_m\\,c_p}{\\rho_e}\\,dT \\equiv G, \\qquad J = \\sqrt{\\frac{G}{t_{on}}}, \\qquad t_c = \\frac{K}{J}" },
		{ tex: "M_w = \\int_0^L n\\,h\\,t_c\\,\\rho_m\\,k_e\\,dx, \\qquad Q = M_w\\,\\Delta H" },
		{ vars: [
			["\\tau_s", "magnetic shear: thrust per m² of magnet area (Pa)"],
			["B", "gap field from the sled magnets (T)"],
			["K", "sheet current: amperes per metre of track (A/m)"],
			["J", "current density in the conductor (A/m²)"],
			["t_{on}", "time a block is energised: the sled travelling two sled-lengths (s)"],
			["c_p,\\ \\rho_e", "aluminium specific heat and resistivity, from a temperature table"],
			["\\rho_m", "aluminium density (kg/m³)"],
			["t_c", "conductor thickness (m)"],
			["n,\\ h", "faces (2) and winding height (m)"],
			["k_e", "allowance for end turns and fill"],
			["\\Delta H", "heat absorbed per kg from T₀ to T₁ (J/kg)"],
		] },
		{ p: "Windings are thick at the slow start, where each block stays on longest, and foil-thin near release. Cold aluminium is used because its resistance falls steeply with temperature." },
		{ p: "Taking $t_{on} \\approx 2\\ell/v$ and $F\\,dx = m\\,v\\,dv$, the integral has a closed form. It shows that acceleration, and the power cap, drop out:" },
		{ tex: "M_w \\approx \\frac{4\\sqrt{2}}{3}\\,\\frac{\\rho_m\\,k_e\\,m\\,v^{3/2}}{B\\,\\sqrt{G\\,\\ell}}" },
		{ p: "Here $m$ is ship plus sled, $v$ the release speed and $\\ell$ the sled length. Winding mass grows with release speed to the power 3/2, and shrinks with a stronger field or a longer sled." },
	],
	now: (r, f) => `Launch ${f.mass(r.windings.launch)} (conductor ${f.num(r.windings.launchThickMax * 1e3)} mm at the start, ${f.num(r.windings.launchThickMin * 1e3)} mm near release); braking ${f.mass(r.windings.brake)}; heat per launch ${f.energy(r.windings.heatLaunch)}.`,
},

shear: {
	title: "Magnetic shear and sheet current",
	body: [
		{ p: "These are design checks on the motor rather than masses. The magnetic shear is the thrust each square metre of sled magnet must produce. The sheet current is what the windings must carry to produce it, given the field $B$:" },
		{ tex: "\\tau_s = \\frac{F}{n\\,h\\,\\ell}, \\qquad K = \\frac{2\\,\\tau_s}{B}, \\qquad B_K = \\mu_0\\,K" },
		{ vars: [
			["\\tau_s", "magnetic shear (Pa)"],
			["F", "driving force (N)"],
			["n,\\ h,\\ \\ell", "winding faces, magnet height, sled length (m)"],
			["K", "sheet current (A/m)"],
			["B", "gap field from the sled magnets (T)"],
			["B_K", "field produced by the windings' own current (T)"],
			["\\mu_0", "permeability of free space, 4π×10⁻⁷ H/m"],
		] },
		{ p: "Shear of a few hundred kilopascals is ambitious but plausible for superconducting machines. If the windings' own field $B_K$ approaches the sled's field $B$, the windings are doing most of the magnetic work. The simple sheet model then stops being trustworthy. The cure is a stronger field preset or a longer sled." },
		{ p: "Because the presets scale the sled length with ship mass, the shear depends only on acceleration, field and preset, not on ship size." },
	],
	now: (r, f) => `Peak shear ${f.num(r.windings.peakShear / 1e3)} kPa; sheet current ${f.num(r.windings.peakSheet / 1e3)} kA/m; windings' own field ${f.num(r.windings.statorField)} T vs sled field ${f.num(r.B)} T.`,
},

spine: {
	title: "CNT tension spine",
	body: [
		{ p: "The drive reaction pushes the windings backward along the track with the full driving force. Something must carry that to the hub. Ships launch toward the hub, so the track between the sled and the hub is always being pulled, never pushed. That lets a CNT cable anchored at the hub, the spine, carry the whole axial load in tension. The braking section is the mirror case." },
		{ p: "Each section of spine carries the largest force applied anywhere between it and the free end. That is the force at the start of the run, so the spine is uniform:" },
		{ tex: "M_{spine} = SF\\,\\frac{F_{max}\\,L\\,\\rho}{\\sigma} \\;=\\; SF\\,\\frac{E}{\\sigma/\\rho} \\quad\\text{(constant acceleration)}" },
		{ vars: [
			["M_{spine}", "spine mass (kg)"],
			["SF", "CNT safety factor"],
			["F_{max}", "maximum driving force (N)"],
			["L", "section length (m)"],
			["\\rho,\\ \\sigma", "CNT density (kg/m³) and tensile strength (Pa)"],
			["E", "launch energy (J)"],
		] },
		{ p: "At constant acceleration, force times length is the launch energy, so the minimum spine is launch energy divided by specific strength, independent of acceleration. Carrying the same load in ceramic compression would take some 40 times the mass, before allowing for buckling. With the power cap the starting force is held over a longer track, so the spine grows." },
	],
	now: (r, f) => `Launch spine ${f.mass(r.structure.spineLaunch)}, braking spine ${f.mass(r.structure.spineBrake)}.`,
},

web: {
	title: "Guideway blade: CNT diagonals and cordierite posts",
	body: [
		{ p: "The guideway is a central blade with the windings on both faces and the sled's magnets straddling it. The magnets' sideways pulls on the two faces balance, so the blade mainly has to pass the thrust shear down to the spine at its root. The shear enters spread over the winding height $h$, so it travels $h/2$ on average." },
		{ p: "The blade is built as a truss. CNT diagonals at 45° carry the shear in tension; cordierite glass-ceramic posts carry the matching compression. Per metre of track, at shear flow $q$:" },
		{ tex: "q = \\frac{F}{\\ell}, \\qquad \\lambda_d = SF_c\\,\\frac{\\rho_c\\,q\\,h}{\\sigma_c}, \\qquad \\lambda_p = SF_k\\,k_b\\,\\frac{\\rho_k\\,q\\,h}{2\\,\\sigma_k}" },
		{ vars: [
			["q", "shear flow into the blade (N per m of track)"],
			["F,\\ \\ell", "local driving force (N), sled length (m)"],
			["\\lambda_d,\\ \\lambda_p", "diagonal and post mass per metre of track (kg/m)"],
			["\\rho_c,\\ \\sigma_c,\\ SF_c", "CNT density, strength, safety factor"],
			["\\rho_k,\\ \\sigma_k,\\ SF_k", "cordierite density, compressive strength, safety factor"],
			["k_b", "allowance for post buckling and fittings"],
		] },
		{ p: "The posts dominate, because ceramic in compression is far weaker per kilogram than CNT in tension. Each short blade segment is clamped to the spine, with small gaps between segments. That keeps the axial launch load out of the ceramic and absorbs thermal expansion." },
	],
	now: (r, f) => `CNT diagonals ${f.mass(r.structure.diag)}, cordierite posts ${f.mass(r.structure.posts)}.`,
},

skin: {
	title: "Cordierite skin",
	body: [
		{ p: "A thin cordierite skin on both faces of the blade backs the aluminium windings. It holds the foil flat in its exact position relative to the sled magnets, and insulates it. Cordierite is chosen for this role because it doesn't conduct electricity and isn't magnetic, so it picks up no eddy currents or drag in the motor's field. It also expands little with temperature, so it pairs well with CNT, which barely expands at all." },
		{ tex: "M_{skin} = n\\,h\\,t_{skin}\\,\\rho_k\\,(L + L_b)" },
		{ vars: [
			["M_{skin}", "skin mass (kg)"],
			["n,\\ h", "faces (2) and winding height (m)"],
			["t_{skin}", "skin thickness (m), a design assumption"],
			["\\rho_k", "cordierite density (kg/m³)"],
			["L,\\ L_b", "launch and braking section lengths (m)"],
		] },
		{ p: "The skin's thickness is a minimum practical gauge, not the result of a load calculation, so this line is only as good as that assumption. Each segment is post-tensioned internally, keeping the brittle ceramic in compression against handling, thermal and vibration stresses." },
	],
	now: (r, f) => `Skin ${f.mass(r.structure.skin)}.`,
},

powerConfig: {
	title: "Power delivery: where the flywheels sit",
	body: [
		{ p: "The flywheels hold the launch energy, but it still has to reach the windings. Three kinds of hardware get it there. Generators turn rotor motion into electricity. Converters turn that into the frequency each block needs, locked to the sled: from zero at the start up to hundreds of hertz at release. Feeders carry it along the track to whichever block is switched on. Where the flywheel banks sit trades these three against each other." },
		{ p: "• At the hub: one set of machines, rated once for the peak and reused moments later to absorb the sled's braking. The launch ends at the hub, so the highest power has the shortest way to travel, but feeders still run the full track." },
		{ p: "• Clustered or distributed: each bank serves only its own stretch of track, so feeders are short. But each bank's converters must be rated for the highest power in its stretch, and those ratings add up:" },
		{ tex: "P_{rated} = \\sum_{i} \\; \\max_{x \\in \\text{stretch } i} \\; F(x)\\,v(x)" },
		{ vars: [
			["P_{rated}", "total converter rating (W)"],
			["F(x),\\ v(x)", "driving force (N) and speed (m/s) at position x"],
			["i", "flywheel bank number; each serves one stretch of track"],
		] },
		{ p: "• Direct drive: each bank's generator is wired straight to its blocks, with no converters. The track's pole pitch is graded so that the generator's frequency matches the sled at every point, and thrust is set through the generator's field current. It is more speculative, since the run must be programmed precisely in advance, but it removes the converters entirely." },
	],
	now: (r, f) => `${r.power.banks} bank${r.power.banks === 1 ? "" : "s"}; converters rated ${r.power.converters > 0 ? f.power(r.power.rating) : "— none"}; generators ${f.mass(r.power.generators)}, converters ${f.mass(r.power.converters)}, feeders ${f.mass(r.power.feeders)}; total ${f.mass(r.power.total)}.`,
},

generators: {
	title: "Generators",
	body: [
		{ p: "Each flywheel bank drives generators built onto its rotors. A generator is the track's motor in reverse. Its power comes from magnetic shear across the gap, moving at the rotor's surface speed:" },
		{ tex: "P = \\tau_g\\,A_g\\,v_s" },
		{ p: "Its stator windings heat during the bank's duty, by the same adiabatic rule as the track windings. Unlike a track block, though, every stator conductor works the whole time, so the copper is well used. Applying the rule, the gap area cancels, and the conductor mass depends only on the power the bank delivers over time:" },
		{ tex: "M_{gen} = k_s \\sum_{\\text{banks}} \\frac{2\\,\\rho_m\\,k_e\\,\\sqrt{\\int P^2\\,dt}}{B_g\\,v_s\\,\\sqrt{G}}" },
		{ vars: [
			["\\tau_g,\\ A_g", "generator gap shear (Pa) and gap area (m²)"],
			["v_s", "rotor surface speed at the gap (m/s)"],
			["M_{gen}", "generator mass (kg)"],
			["k_s", "allowance for stator structure and cooling"],
			["\\rho_m,\\ k_e", "aluminium density and end-turn allowance"],
			["P", "power through the bank (W)"],
			["B_g", "generator gap field (T)"],
			["G", "conductor heating limit (see Winding mass)"],
		] },
		{ p: "Splitting the duty among $N$ banks raises the total by up to $\\sqrt{N}$, because each bank's machines idle while the sled is elsewhere. CNT rims at the default stress spin at about 3.9 km/s. The generator's active surface is assumed slower, to carry its magnets and conductors." },
	],
	now: (r, f) => `Generators ${f.mass(r.power.generators)} across ${r.power.banks} bank${r.power.banks === 1 ? "" : "s"}.`,
},

converters: {
	title: "Converters",
	body: [
		{ p: "The generators turn at a nearly steady speed, but each block must be driven at a frequency locked to the passing sled, and phased to its position:" },
		{ tex: "f = \\frac{v}{2\\,p_p}" },
		{ p: "This frequency rises from zero at the start to hundreds of hertz at release. Power converters make that conversion. Their mass is modelled simply, as rated power divided by a specific power:" },
		{ tex: "M_{conv} = \\frac{P_{rated}}{p_{conv}}" },
		{ vars: [
			["f", "drive frequency at a block (Hz)"],
			["v", "sled speed (m/s)"],
			["p_p", "pole pitch of the track windings (m)"],
			["M_{conv}", "converter mass (kg)"],
			["P_{rated}", "total converter rating (W): the peak at the hub, or each bank's local peak summed"],
			["p_{conv}", "converter specific power (W/kg)"],
		] },
		{ p: "The specific power is the most uncertain number in this calculator. Today's best power electronics reach tens of kW/kg. The default of 100 kW/kg assumes a mature, space-cooled technology rated for brief pulses. Converter mass scales directly with it, so try halving or doubling it." },
		{ p: "Because converters are rated by peak power, they are where the power cap pays off most. They are also why spreading banks along the track is expensive, unless the banks can do without converters (direct drive)." },
	],
	now: (r, f) => r.power.converters > 0
		? `Converters rated ${f.power(r.power.rating)} in total: ${f.mass(r.power.converters)}.`
		: `Direct drive: no converters.`,
},

feeders: {
	title: "Feeders",
	body: [
		{ p: "Feeders are the conductor pairs carrying current from a bank to the block where the sled is. The current is power divided by voltage. A feeder at a given point carries current whenever the sled is farther from the bank than that point. It is sized by the same adiabatic rule as the windings, cold aluminium heated from $T_0$ to $T_1$:" },
		{ tex: "I = \\frac{P}{V}, \\qquad A(x) = \\frac{1}{V}\\sqrt{\\frac{\\int_{\\text{sled beyond } x} P^2\\,dt}{G}}, \\qquad M_{feed} = n_c\\,\\rho_m \\int A\\,dx" },
		{ vars: [
			["I", "feeder current (A)"],
			["P", "power drawn by the sled (W)"],
			["V", "feeder voltage (V)"],
			["A(x)", "conductor cross-section at position x (m²)"],
			["G", "conductor heating limit (see Winding mass)"],
			["M_{feed}", "feeder mass (kg)"],
			["n_c", "conductors per feeder: 2, out and back"],
			["\\rho_m", "aluminium density (kg/m³)"],
		] },
		{ p: "Launching toward the hub helps a hub bank. The highest power is drawn close to the hub, so the long feeders out to the far end carry only the early, low-power part of the run. Feeder mass falls in proportion to voltage. Higher voltage needs more turns in each block and more insulation, though vacuum makes insulation easier." },
		{ p: "Every feeder and generator conductor ends a launch at $T_1$, so its heat is its mass times $\\Delta H$. That heat is added to the storage needed, and it must be radiated away before the next launch." },
	],
	now: (r, f) => `Feeders ${f.mass(r.power.feeders)}; peak current ${f.num(r.power.peakCurrent / 1e6)} MA at the hub end; heat in generators and feeders ${f.energy(r.power.heat)} per launch.`,
},

total: {
	title: "Estimated driver mass, and what it leaves out",
	body: [
		{ p: "The sum of the structure (spines, blade web, skin), the windings, the flywheel rims, and power delivery (generators, converters, feeders):" },
		{ tex: "M = M_{spine} + M_{web} + M_{skin} + M_w + M_{fw} + M_{gen} + M_{conv} + M_{feed}" },
		{ p: "Things not included:" },
		{ p: "• Support against the local field and Coriolis acceleration: stays or hangers carrying the track's weight and the moving ship's vertical load. These depend on where the driver is mounted. At a lunar skyhook tip at 2,500 km, the field is about 2.3 m/s² outward, and Coriolis adds up to about 3 m/s² on prograde runs." },
		{ p: "• The sled itself, the hub and its swivel bearing, switchgear, cooling and radiators, and flywheel hubs, bearings and housings." },
		{ p: "• The tether needed to hold all of this up at a skyhook tip. Multiply the tip mass by $(1 + k)$, where $k$ is the tether-to-tip-mass ratio from the skyhook calculators. For example, $k \\approx 2.6$ for a silica tether at a 2,500 km lunar tip." },
	],
	now: (r, f) => `Total ${f.mass(r.total)}: structure ${f.mass(r.structure.total)}, windings ${f.mass(r.windings.total)}, flywheel rims ${f.mass(r.energy.flywheelMass)}, power delivery ${f.mass(r.power.total)}.`,
},

};
