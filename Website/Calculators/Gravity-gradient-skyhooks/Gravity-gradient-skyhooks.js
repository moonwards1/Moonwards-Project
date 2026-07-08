// ES module (loaded with <script type="module">).
import { systems } from "../../Shared/orbit.js";
import { OrbitalMath } from "../../Shared/math-utils.js";
import { Const } from "../../Shared/constants.js";
import { Exchange } from "../../Shared/exchange.js";
import { PacketTypes } from "../../Shared/exchange-types.js";

function skyhookTool(DOMnode){

// Declarations for variables shared across the tool's inner functions.
// (As a classic script these were implicit globals; modules run in strict
// mode, where assigning to an undeclared name throws.)
var minimum_x_coordinate, minimum_y_coordinate, minimum_x_distance, minimum_y_distance,
	svg_tether, marker_container, text_marker_container;

//part 1: utility functions

function create(
	HTMLtag, classes, text, appendLocation, cssText
){
	let element = document.createElement(HTMLtag);
	if(Array.isArray(classes)){
		element.classList.add(...classes);
		if(classes.includes("newTab")){
			element.setAttribute("target","_blank")
		}
	}
	else if(classes){
		if(classes[0] === "#"){
			element.id = classes.substring(1)
		}
		else{
			element.classList.add(classes);
			if(classes === "newTab"){
				element.setAttribute("target","_blank")
			}
		}
	};
	if(text || text === 0){
		element.innerText = text
	};
	if(appendLocation && appendLocation.appendChild){
		appendLocation.appendChild(element)
	};
	if(cssText){
		element.style.cssText = cssText
	};
	return element
};

//part 2: css

let skyhookStyle = create("style");
skyhookStyle.id = "skyhookToolCSS";
skyhookStyle.type = "text/css";
document.head.appendChild(skyhookStyle);
skyhookStyle.textContent = `
.tetherToolMain .container{
	display: inline-block;
	border-radius: 10px;
	border-style: solid;
	border-width: 1px;
	border-color: black;
	padding: 10px;
	margin: 5px;
	vertical-align: top;
}
.tetherToolMain{
	background-color: #F6F6F0;
	border-radius: 10px;
	padding: 20px;
}
.tetherToolMain .canvas{
	border-style: solid;
	border-width: 1px;
	border-color: black;
	border-radius: 4px;
}
.tetherToolMain .draggable{ cursor: move; }
.tetherToolMain .tooltip{ cursor: help; }
.tetherToolMain .label{ margin-left: 5px; }
.tetherToolMain .svgText {
	pointer-events: none;
	-webkit-user-select: none;
	-moz-user-select: none;
	-ms-user-select: none;
	user-select: none;
}
.tetherToolMain #materialOverride{ display: none; }
.tetherToolMain #overrideMaterial:checked ~ #materialOverride{ display: block; }
.tetherToolMain h4{ margin-top: 0; }
.tetherToolMain .resultHead{ border-bottom:1px solid #ccc; padding-bottom:4px; }
.tetherToolMain .mathbox{
	background: #eef; border: 1px solid #ccd; border-radius: 8px;
	padding: 8px 14px; margin: 10px 5px; font-size: 0.85em; color: #224;
	max-width: 860px;
}
`

//part 3: HTML

const svgNS = "http://www.w3.org/2000/svg";
let mainContainer = create("div","tetherToolMain",false,DOMnode);
create("h2",false,"Skyhook",mainContainer);
create("span",false,"System",mainContainer);
let selector = create("select",false,false,mainContainer);
	selector.name = "system";
create("h3",false,"Tether",mainContainer);
let formElement = create("form","#input",false,mainContainer);
	let formContainer = create("div","container",false,formElement);

		let footInput = create("input",false,false,formContainer);
			footInput.name = "foot";
			footInput.value = 10;
		create("span","label","Foot altitude (km)",formContainer);
		create("br",false,false,formContainer);
		let receivingDeckCheck = create("input",false,false,formContainer);
			receivingDeckCheck.name = "useReceivingDeck";
			receivingDeckCheck.type = "checkbox";
			receivingDeckCheck.checked = true;
		let receivingDeckInput = create("input",false,false,formContainer);
			receivingDeckInput.name = "receivingDeck";
			receivingDeckInput.value = 233;
			receivingDeckInput.type = "number";
			receivingDeckInput.step = "any";
		let receivingDeckLabel = create("span","label","Receiving deck altitude (km) For shuttles from the surface",formContainer);
		receivingDeckCheck.oninput = function(){
			receivingDeckInput.style.display = this.checked ? "" : "none";
			receivingDeckLabel.innerText = (this.checked ? "" : "Optional: ") + "Receiving deck altitude (km) For shutttles from the surface";
		};
		create("br",false,false,formContainer);
		let centreInput = create("input",false,false,formContainer);
			centreInput.name = "centre";
			centreInput.value = 275;
		create("span","label","Tether centre of mass altitude (km). The point that determines orbit",formContainer);
		create("br",false,false,formContainer);
		let outerDocksCheck = create("input",false,false,formContainer);
			outerDocksCheck.name = "useOuterDocks";
			outerDocksCheck.type = "checkbox";
			outerDocksCheck.checked = true;
		let outerDocksInput = create("input",false,false,formContainer);
			outerDocksInput.name = "outerDocks";
			outerDocksInput.value = 606.5;
			outerDocksInput.type = "number";
			outerDocksInput.step = "any";
		let outerDocksLabel = create("span","label","Outer docks altitude (km). For incoming ships from high orbit",formContainer);
		outerDocksCheck.oninput = function(){
			outerDocksInput.style.display = this.checked ? "" : "none";
			outerDocksLabel.innerText = (this.checked ? "" : "Optional: ") + "Outer docks altitude (km). For incoming ships from high orbit";
		};
			create("br",false,false,formContainer);
			let launchDeckCheck = create("input",false,false,formContainer);
				launchDeckCheck.name = "useLaunchDeck";
				launchDeckCheck.type = "checkbox";
				launchDeckCheck.checked = true;
			let launchDeckInput = create("input",false,false,formContainer);
				launchDeckInput.name = "launchDeck";
				launchDeckInput.value = 950;
				launchDeckInput.type = "number";
				launchDeckInput.step = "any";
			let launchDeckLabel = create("span","label","Main launch deck altitude (km). Most ships leave from here",formContainer);
			launchDeckCheck.oninput = function(){
				launchDeckInput.style.display = this.checked ? "" : "none";
				launchDeckLabel.innerText = (this.checked ? "" : "Optional: ") + "Main launch deck altitude (km). Most ships leave from here";
			};
		create("br",false,false,formContainer);
		let topInput = create("input",false,false,formContainer);
			topInput.name = "top";
			topInput.value = 2000;
		create("span","label","Tether top altitude (km) Site of orbital station-keeping engines",formContainer);
		create("br",false,false,formContainer);

let tether = {
	materials: {
		"silica": { displayName: "Lunar Silica (13 GPa, 2.3 g/cm³)", strength: 13000000000, density: 2300 },
		"bestsilica": { displayName: "Best lunar silica (17 GPa, 2.3 g/cm³)", strength: 17000000000, density: 2300 },
		"earlylunarglass": { displayName: "Early lunar glass (3 GPa, 2.7 g/cm³)", strength: 3000000000, density: 2700 },
		"ecnt": { displayName: "Early Carbon Nanotube (18 GPa, 1.45 g/cm³)", strength: 18000000000, density: 1450 },
		"mwcnt": { displayName: "Mature Carbon Nanotube (42 GPa, 1.4 g/cm³)", strength: 42000000000, density: 1400 },
		"zylon": { displayName: "Zylon (5.8 GPa, 1.54 g/cm³)", strength: 5800000000, density: 1540 },
		"steel": { displayName: "Steel (2.62 GPa, 8 g/cm³)", strength: 2617000000, density: 8000 }
	}
};
		create("span",false,"Tether material",formContainer);
		let materialSelector = create("select",false,false,formContainer,"display: block");
			materialSelector.name = "material";
		Object.keys(tether.materials).forEach(material => {
			create("option",false,tether.materials[material].displayName,materialSelector).value = material
		})
		let globalSafetyInput = create("input",false,false,formContainer);
			globalSafetyInput.name = "globalSafety";
			globalSafetyInput.value = 3;
			globalSafetyInput.type = "number";
			globalSafetyInput.step = "0.1";
			globalSafetyInput.min = "1";
		create("span","label","Safety factor",formContainer);
		create("br",false,false,formContainer);
		let overrideInput = create("input",false,false,formContainer);
			overrideInput.name = "overrideMaterial";
			overrideInput.type = "checkbox";
		create("span","label","Use custom material instead",formContainer);
		let materialOverride = create("div","#materialOverride",false,formContainer);
			let strengthInput = create("input",false,false,materialOverride);
				strengthInput.name = "tensileStrength";
			create("span","label","Tensile strength (Pa)",materialOverride);
			let densityInput = create("input",false,false,materialOverride);
				densityInput.name = "density";
			create("span","label","Density kg/m³",materialOverride);
			let safetyInput = create("input",false,false,materialOverride);
				safetyInput.name = "safety";
				safetyInput.value = 1;
			create("span","label","Safety factor",materialOverride);
			overrideInput.oninput = function(){
				materialOverride.style.display = this.checked ? "block" : "none";
			}
		create("br",false,false,formContainer);
		create("br",false,false,formContainer);
		create("span",false,"Payload held at a tether tip (sizes the peak tension)",formContainer);
		create("br",false,false,formContainer);
		let tipMassInput = create("input",false,false,formContainer);
			tipMassInput.name = "tipMass";
			tipMassInput.value = 100;
			tipMassInput.type = "number";
			tipMassInput.step = "any";
			tipMassInput.min = "0";
		create("span","label","Tip payload mass (tonnes)",formContainer);

	let throughputContainer = create("div","container",false,formElement);
		create("h4",false,"Cargo throughput",throughputContainer);
		let rateInput = create("input",false,false,throughputContainer);
			rateInput.name = "rate"; rateInput.value = 1000; rateInput.type="number"; rateInput.step="any"; rateInput.min="0";
		create("span","label","Delivery rate to launch deck (t/day)",throughputContainer);
		create("br",false,false,throughputContainer);
		let perClimberInput = create("input",false,false,throughputContainer);
			perClimberInput.name = "perClimber"; perClimberInput.value = 100; perClimberInput.type="number"; perClimberInput.step="any"; perClimberInput.min="0.001";
		create("span","label","Cargo per climber (t)",throughputContainer);
		create("br",false,false,throughputContainer);
		let vClimbInput = create("input",false,false,throughputContainer);
			vClimbInput.name = "vClimb"; vClimbInput.value = 200; vClimbInput.type="number"; vClimbInput.step="any"; vClimbInput.min="0.1";
		create("span","label","Climb speed (m/s)",throughputContainer);
		create("br",false,false,throughputContainer);
		let effInput = create("input",false,false,throughputContainer);
			effInput.name = "effDrive"; effInput.value = 70; effInput.type="number"; effInput.step="any"; effInput.min="1"; effInput.max="100";
		create("span","label","Drive efficiency (%)",throughputContainer);
		create("br",false,false,throughputContainer);
		create("span","label","Descending traffic to the foot is assumed to be 1% of the ascending rate.",throughputContainer);

	let reentryContainer = create("div","container",false,formElement);
		create("h4",false,"Earth reentry (cargo released from top)",reentryContainer);
		let targetPerigeeInput = create("input",false,false,reentryContainer);
			targetPerigeeInput.name = "targetPerigee"; targetPerigeeInput.value = 50; targetPerigeeInput.type="number"; targetPerigeeInput.step="any"; targetPerigeeInput.min="-300";
		create("span","label","Target perigee altitude (km)",reentryContainer);
		create("br",false,false,reentryContainer);
		let ifaceAltInput = create("input",false,false,reentryContainer);
			ifaceAltInput.name = "ifaceAlt"; ifaceAltInput.value = 122; ifaceAltInput.type="number"; ifaceAltInput.step="any"; ifaceAltInput.min="1";
		create("span","label","Entry interface altitude (km)",reentryContainer);
		create("br",false,false,reentryContainer);
		create("span","label","Cargo flung from the top is braked retrograde so it falls to the parent body; a burn at the lunar-distance apogee trims perigee to the target.",reentryContainer);

	const propellantMax = { oxygen: 20, hydrogen: 80 };//km/s, viable mature-engine ceilings
	let stationContainer = create("div","container",false,formElement);
		create("h4",false,"Orbit station-keeping (VASIMR reboost)",stationContainer);
		create("span",false,"Propellant",stationContainer);
		let propellantSelector = create("select",false,false,stationContainer,"display:block");
			propellantSelector.name = "propellant";
			create("option",false,"Oxygen (cheap, plentiful byproduct)",propellantSelector).value = "oxygen";
			create("option",false,"Hydrogen (higher exhaust speed)",propellantSelector).value = "hydrogen";
		let vExhaustInput = create("input",false,false,stationContainer);
			vExhaustInput.name = "vExhaust"; vExhaustInput.value = 8; vExhaustInput.type="number"; vExhaustInput.step="any"; vExhaustInput.min="1"; vExhaustInput.max = propellantMax.oxygen;
		create("span","label","Exhaust velocity (km/s)",stationContainer);
		create("br",false,false,stationContainer);
		let effThrusterInput = create("input",false,false,stationContainer);
			effThrusterInput.name = "effThruster"; effThrusterInput.value = 60; effThrusterInput.type="number"; effThrusterInput.step="any"; effThrusterInput.min="1"; effThrusterInput.max="100";
		create("span","label","Thruster efficiency, electrical → jet (%)",stationContainer);
		create("br",false,false,stationContainer);
		let effSupplyInput = create("input",false,false,stationContainer);
			effSupplyInput.name = "effSupply"; effSupplyInput.value = 90; effSupplyInput.type="number"; effSupplyInput.step="any"; effSupplyInput.min="1"; effSupplyInput.max="100";
		create("span","label","Power generation & delivery efficiency (%)",stationContainer);
		create("br",false,false,stationContainer);
		create("span","label","The reboost thruster is mounted at the tether top, the longest available lever arm.",stationContainer);
		/*mount field removed*/
			/* */
			/* */
			/* */
			/* */
			/* */
		/* */
			/* */
		/* */
		create("br",false,false,stationContainer);
		if(false){
			/* */
			/* */
			/* */
		};
		create("span","label","Oxygen is capped at 20 km/s, hydrogen at 80 km/s. Engines are assumed to run continuously; spares cover engine-out and maintenance.",stationContainer);
		propellantSelector.oninput = function(){
			var mx = propellantMax[this.value];
			vExhaustInput.max = mx;
			if(Number(vExhaustInput.value) > mx){ vExhaustInput.value = mx; };
		};

	let warnings = create("p","#warnings",false,formElement,"color: red");

let updateButton = create("button",false,"Update",mainContainer,"display: block");
	updateButton.onclick = function(){ calc(); hardReload() };

// Send this design to the Skyhook + Tip Spin-Launcher Calculator (a variant
// of this same tool) as a tether-spec packet — see Shared/exchange.js and
// Website/ARCHITECTURE.md, "Exchange — trading data with the calculators".
let sendTetherButton = create("button",false,"Send tether → Skyhook Spin-Launcher",mainContainer,"display: block; margin-top: 6px;");
let sendTetherStatus = create("span","label",false,mainContainer);
sendTetherButton.onclick = function(){
	calc();
	var gnum = function(field){ return Number(form[field].value); };
	var material = form.overrideMaterial.checked
		? { sigma: gnum("tensileStrength"), rho: gnum("density") }
		: { sigma: tether.materials[form["material"].value].strength,
			rho: tether.materials[form["material"].value].density };
	var packet = PacketTypes.make("tether-spec", {
		body: selector.options[selector.selectedIndex].value,
		footAlt: tether.foot, centreAlt: tether.centre, topAlt: tether.top,
		material: material,
		period: tether.time, tipSpeed: tether.topVel,
		taperRatio: { upper: tether.highRatio, lower: tether.lowRatio }
	}, {
		tool: "gravity-gradient-skyhooks",
		label: selector.options[selector.selectedIndex].value + " tether",
		iso: new Date().toISOString().slice(0, 10)
	});
	Exchange.send(packet, { target: "skyhook-spin-launcher" });
	sendTetherStatus.innerText = "Sent — open the Skyhook Spin-Launcher calculator to apply it.";
};
create("p",false,"You can also adjust the tether by dragging the red markers below:",mainContainer);
let output = create("div","#output",false,mainContainer);
	let tetherSketchContainer = create("div","container",false,output);
		var illustration = document.createElementNS(svgNS,"svg");
		tetherSketchContainer.appendChild(illustration);
		illustration.id = "svg_ilu";
		illustration.style.width = "900px";
		illustration.style.height = "250px";

	create("br",false,false,output);
	let generalContainer = create("div","container",false,output);
		create("h4",false,"General information",generalContainer);
		create("p","#period",false,generalContainer);
		create("p","#footVel",false,generalContainer);
		create("p","#hitTheGround",false,generalContainer);
		create("p","#centreVel",false,generalContainer);
		create("p","#topVel",false,generalContainer);
	create("br",false,false,output);
	let climberContainer = create("div","container",false,output);
		create("h4",false,"Climber",climberContainer);
		create("p","#lowClimber",false,climberContainer);
		create("p","#highClimber",false,climberContainer);
	create("br",false,false,output);
	let propertyContainer = create("div","container",false,output);
		create("h4",false,"Tether properties",propertyContainer);
		create("p","#lowAcceleration",false,propertyContainer);
		create("p","#lowRatio",false,propertyContainer);
		create("p","#lowMass",false,propertyContainer);
		create("p","#highAcceleration",false,propertyContainer);
		create("p","#highRatio",false,propertyContainer);
		create("p","#highMass",false,propertyContainer);
	let forceContainer = create("div","container",false,output);
		create("h4","resultHead","Forces",forceContainer);
		create("p","#tensionCoM",false,forceContainer);
		create("p","#tensionCoMfoot",false,forceContainer);
		create("p","#tetherMassAbs",false,forceContainer);
	let throughputOut = create("div","container",false,output,"min-width:330px");
		create("h4","resultHead","Throughput to launch deck",throughputOut);
		create("p","#trip",false,throughputOut);
		create("p","#cadence",false,throughputOut);
		create("p","#nclimb",false,throughputOut);
		create("p","#spacing",false,throughputOut);
		create("p","#oncable",false,throughputOut);
		create("p","#dT",false,throughputOut);
		create("p","#power",false,throughputOut);
		create("p","#epert",false,throughputOut);
	let stationOut = create("div","container",false,output,"min-width:330px");
		create("h4","resultHead","Orbit station-keeping",stationOut);
		create("p","#skThrust",false,stationOut);
		create("p","#skProp",false,stationOut);
		create("p","#skJet",false,stationOut);
		create("p","#skElec",false,stationOut);
		create("p","#skGen",false,stationOut);
		create("p","#skEnergyDay",false,stationOut);
		create("p","#skEpert",false,stationOut);
	let releaseContainer = create("div","container",false,output);
		create("h4",false,"If released from launch deck:",releaseContainer);
		create("p","#escape",false,releaseContainer);
		create("p","#newApoapsis",false,releaseContainer);
		create("h4","#earthReentryHead","Earth reentry (released from launch deck):",releaseContainer);
		create("p","#earthArrival",false,releaseContainer);
		create("p","#earthPerigee",false,releaseContainer);
		create("p","#earthBurn",false,releaseContainer);
		create("p","#earthFPA",false,releaseContainer);
		create("p","#earthPeakG",false,releaseContainer);
		create("h4",false,"Minimum release altitude:",releaseContainer);
		let releases = create("p",false,false,releaseContainer);
	create("br",false,false,output);


//part 4: planetary data

Array.from(systems.entries()).map(a => a[1]).filter(system =>
	system.properties.type !== "mathematical object"
	&& system.radius
	&& system.GM
).sort().forEach((system,index) => {
	var opt = create("option",false,system,selector);
	if(system.properties.name === "Moon"){
		selector.selectedIndex = index
	}
})

//part 5: tether tool

var form = formElement.elements;
var moon = systems.get(selector.options[selector.selectedIndex].value);

let calc = function(){
	moon = systems.get(selector.options[selector.selectedIndex].value);
	var warnings = "";
	var gnum = function(field){ return Number(form[field].value); };
	var out = function(id,message){ document.getElementById(id).innerText = message; };
	var myRound = function(num,digits){ return Math.floor(num*Math.pow(10,digits))/Math.pow(10,digits); };
	var fmtForce = function(n){
		if(!isFinite(n)) return "—";
		if(Math.abs(n)>=1e9) return (n/1e9).toFixed(3)+" GN";
		if(Math.abs(n)>=1e6) return (n/1e6).toFixed(3)+" MN";
		if(Math.abs(n)>=1e3) return (n/1e3).toFixed(3)+" kN";
		return n.toFixed(2)+" N";
	};
	var fmtTorque = function(n){
		if(!isFinite(n)) return "—";
		if(Math.abs(n)>=1e12) return (n/1e12).toFixed(3)+" TN·m";
		if(Math.abs(n)>=1e9) return (n/1e9).toFixed(3)+" GN·m";
		if(Math.abs(n)>=1e6) return (n/1e6).toFixed(3)+" MN·m";
		if(Math.abs(n)>=1e3) return (n/1e3).toFixed(3)+" kN·m";
		return n.toFixed(2)+" N·m";
	};
	var fmtMass = function(kg){
		if(!isFinite(kg)) return "—";
		if(kg>=1e9) return (kg/1e9).toLocaleString(undefined,{maximumFractionDigits:3})+" kt";
		if(kg>=1e3) return (kg/1e3).toLocaleString(undefined,{maximumFractionDigits:3})+" t";
		return kg.toLocaleString(undefined,{maximumFractionDigits:2})+" kg";
	};
	var fmtPower = function(w){
		if(!isFinite(w)) return "—";
		if(Math.abs(w)>=1e9) return (w/1e9).toFixed(3)+" GW";
		if(Math.abs(w)>=1e6) return (w/1e6).toFixed(2)+" MW";
		if(Math.abs(w)>=1e3) return (w/1e3).toFixed(2)+" kW";
		return w.toFixed(1)+" W";
	};
	var fmtTime = function(d){ return d>=1 ? d.toFixed(2)+" days" : (d*24).toFixed(2)+" hours"; };

	var surfaceGravity = moon.GM/(moon.radius*moon.radius);//local fix: orbit.js exposes no surfaceGravity

//construction of tether object
	tether.foot = gnum("foot")*1000;
	tether.top = gnum("top")*1000;
	tether.centre = gnum("centre")*1000;
	tether.receivingDeck = (form["useReceivingDeck"].checked ? gnum("receivingDeck")*1000 : tether.foot);//where ascending cargo joins the cable
	tether.outerDocks    = (form["useOuterDocks"].checked ? gnum("outerDocks")*1000 : tether.top);   //where descending cargo joins the cable
	tether.launchDeck = (form["useLaunchDeck"].checked ? gnum("launchDeck")*1000 : tether.top);//altitude cargo is flung from on release
	tether.Length = tether.top - tether.foot;
	if(tether.foot < 0){ warnings += "The tether foot is inside the Body!<br>"; };
	if(tether.foot > tether.top){ warnings += "The tether foot can not be higher than the top!<br>"; }
	else if(tether.centre < tether.foot || tether.centre > tether.top){
		warnings += "The centre of the tether must be between the endpoints!<br>";
	};
	if(tether.receivingDeck < tether.foot || tether.receivingDeck > tether.top){
		warnings += "The receiving deck must be between the foot and the top!<br>";
	};
	if(tether.outerDocks < tether.foot || tether.outerDocks > tether.top){
		warnings += "The outer docks must be between the foot and the top!<br>";
		};
		if(tether.launchDeck < tether.foot || tether.launchDeck > tether.top){
			warnings += "The main launch deck must be between the foot and the top!<br>";
	};
	tether.time = 2*Math.PI*Math.sqrt(Math.pow(tether.centre + moon.radius,3)/moon.GM);
	tether.centreVel = OrbitalMath.circularVelocity(moon.GM, moon.radius + tether.centre);
	tether.footVel = (tether.foot + moon.radius) * tether.centreVel/(tether.centre + moon.radius);
	tether.topVel = (tether.top + moon.radius) * tether.centreVel/(tether.centre + moon.radius);
	tether.launchDeckVel = (tether.launchDeck + moon.radius) * tether.centreVel/(tether.centre + moon.radius);
	tether.angularVelocity = tether.centreVel/(tether.centre + moon.radius);

	tether.topOrbit = OrbitalMath.circularVelocity(moon.GM, tether.top + moon.radius);
	tether.launchDeckOrbit = OrbitalMath.circularVelocity(moon.GM, tether.launchDeck + moon.radius);
	tether.footOrbit = OrbitalMath.circularVelocity(moon.GM, tether.foot + moon.radius);
	tether.escapeFromTop = Math.sqrt(
		tether.launchDeckVel * tether.launchDeckVel - tether.launchDeckOrbit * tether.launchDeckOrbit * 2
	);
	tether.hitTheGround = Math.sqrt(
		tether.footVel * tether.footVel + 2*moon.GM / moon.radius - tether.footOrbit * tether.footOrbit*2
	);
	tether.newApoapsis = Math.pow((tether.launchDeck + moon.radius) * tether.launchDeckVel,2)/(
		2*moon.GM - (tether.launchDeck + moon.radius) * tether.launchDeckVel * tether.launchDeckVel
	);
	tether.newPeriapsis = Math.pow((tether.foot + moon.radius) * tether.footVel,2)/(
		2*moon.GM - (tether.foot + moon.radius) * tether.footVel * tether.footVel
	);
	tether.collisionAngle = Math.acos(
		tether.angularVelocity*(tether.foot + moon.radius)*(tether.foot/moon.radius + 1)/tether.hitTheGround
	);

	if(form.overrideMaterial.checked){
		tether.strength = (gnum("tensileStrength")/gnum("safety"))/gnum("density");
	}
	else{
		tether.strength = (tether.materials[form["material"].value].strength/gnum("globalSafety")) / tether.materials[form["material"].value].density;
	};

	tether.lowAcceleration = moon.GM/Math.pow(moon.radius + tether.foot,2) - tether.footVel*tether.footVel/(moon.radius + tether.foot);
	tether.highAcceleration = - moon.GM/Math.pow(moon.radius + tether.top,2) + tether.topVel*tether.topVel/(moon.radius + tether.top);

//calculation of taper ratio
	var integral = function(gm,angularVelocity,foot,top){
		return OrbitalMath.taperIntegral(gm, angularVelocity, foot, top);
	};
	tether.lowIntegral = integral(moon.GM,tether.angularVelocity,tether.foot + moon.radius,tether.centre + moon.radius);
	tether.highIntegral = integral(moon.GM,tether.angularVelocity,tether.centre + moon.radius,tether.top + moon.radius);
	tether.lowRatio = Math.pow(Math.E,tether.lowIntegral/tether.strength);
	tether.highRatio = Math.pow(Math.E,tether.highIntegral/tether.strength);

	var lowIteratorSum = 0;
	var highIteratorSum = 0;
	var iteratorLimit = 1000;
	var lowCrosses = [];
	var highCrosses = [];
	for(var i=0;i<iteratorLimit;i++){
		var lowCross = Math.pow(Math.E,
			integral(moon.GM,tether.angularVelocity,tether.foot + moon.radius,
				tether.foot + i*(tether.centre - tether.foot)/iteratorLimit + moon.radius)/tether.strength);
		lowIteratorSum += lowCross;
		var highCross = Math.pow(Math.E,
			integral(moon.GM,tether.angularVelocity,tether.centre + moon.radius,
				tether.centre + i*(tether.top - tether.centre)/iteratorLimit + moon.radius)/tether.strength);
		highIteratorSum += highCross;
		if(i % 10 == 0){ lowCrosses.push(lowCross); highCrosses.push(highCross); };
	};
	tether.lowMass = tether.lowAcceleration*(tether.centre-tether.foot)*(lowIteratorSum/iteratorLimit)/tether.strength;
	tether.highMass = tether.highAcceleration*(tether.top-tether.centre)*(highIteratorSum/iteratorLimit)/tether.strength;

//── absolute tension at the centre of mass (peak), driven by the tip payload ──
//   constant-stress cable: T(r)=σ·A(r); at a tip A=T_tip/σ with T_tip = m_tip·a_tip,
//   so T(centre)=T_tip·taper.  Top tip (release end) is the direct analogue of the
//   L1 elevator's counterweight; the foot tip (catch end) is shown for comparison.
	tether.tipMass = gnum("tipMass")*1000;//tonnes → kg
	tether.tensionCoM_top  = tether.tipMass * tether.highAcceleration * tether.highRatio;
	tether.tensionCoM_foot = tether.tipMass * tether.lowAcceleration  * tether.lowRatio;
	tether.tensionCoM_peak = Math.max(tether.tensionCoM_top, tether.tensionCoM_foot);
//absolute tether mass implied by that tip payload (per-payload ratios × tip mass)
	tether.massAbs = (tether.lowMass + tether.highMass) * tether.tipMass;

//find bodies reachable after release from the tether
	var potentialTargets = {siblings: [], aunts: []};
	if(moon.orbit){
		potentialTargets.parent = moon.orbit.system;
		potentialTargets.siblings = moon.orbit.system.satellites.filter(sat => sat.properties.name !== moon.properties.name) || [];
		if(moon.orbit.system.orbit){
			potentialTargets.aunts = moon.orbit.system.orbit.system.satellites.filter(sat => sat.properties.name !== potentialTargets.parent.properties.name)
		}
	};
	var targets = [];
	if(potentialTargets.parent){
		targets.push({
			name : potentialTargets.parent.properties.name,
			vinf : moon.orbit.vela - Math.sqrt(moon.orbit.system.GM * (2/(moon.orbit.a) - 2/(moon.orbit.a + moon.orbit.system.radius)))
		});
	};
	for(var i=0;i<potentialTargets.siblings.length;i++){
		targets.push({
			name : potentialTargets.siblings[i].properties.name,
			vinf : Math.abs(moon.orbit.vela - Math.sqrt(moon.orbit.system.GM * (2/(moon.orbit.a) - 2/(moon.orbit.a + potentialTargets.siblings[i].orbit.a))))
		});
	};
	for(var i=0;i<potentialTargets.aunts.length;i++){
		targets.push({
			name : potentialTargets.aunts[i].properties.name,
			vinf : Math.sqrt(
				Math.pow(moon.orbit.system.orbit.vela - Math.sqrt(moon.orbit.system.orbit.system.GM * (2/(moon.orbit.system.orbit.a) - 2/(moon.orbit.system.orbit.a + potentialTargets.aunts[i].orbit.a))),2)
				+ moon.orbit.vela*moon.orbit.vela*2) - moon.orbit.vela
		});
	};

	var findRadiusFromVinf = function(vinf,angular){
		var vinf_squared = vinf*vinf;
		var angular_squared = angular*angular;
		var val = moon.radius + tether.centre;
		var step = (moon.radius + tether.centre)/2;
		while(angular_squared*val*val - 2*moon.GM/val < vinf_squared){ val += step; step *= 2; };
		for(var i=0;i<50;i++){
			step = step/2;
			if(angular_squared*val*val - 2*moon.GM/val < vinf_squared){ val += step; } else{ val -= step; };
		};
		return val;
	};
	releases.innerText = "";
	for(var i=0;i<targets.length;i++){
		if(Number.isNaN(targets[i].vinf)){ continue; };
		targets[i].location = findRadiusFromVinf(targets[i].vinf,tether.angularVelocity);
		var item = document.createElement("p");
		item.innerText = targets[i].name;
		item.innerText += " " + myRound((targets[i].location - moon.radius)/1000,2) + "km";
		releases.appendChild(item);
	};

	out("lowAcceleration","Acceleration at tether foot: " + myRound(tether.lowAcceleration,5) + " m/s² (" + myRound(100*tether.lowAcceleration/surfaceGravity,2) + "% of surface gravity)");
	out("highAcceleration","Acceleration at tether top: " + myRound(tether.highAcceleration,5) + " m/s² (" + myRound(100*tether.highAcceleration/surfaceGravity,2) + "% of surface gravity)");
	out("period","Period: " + myRound(tether.time/3600,3) + " hours");
	out("footVel","Tether velocity at foot " + myRound(tether.footVel,3) + " m/s");
	out("centreVel","Tether velocity at centre " + myRound(tether.centreVel,3) + " m/s");
	out("topVel","Tether velocity at top " + myRound(tether.topVel,3) + " m/s");
	if(tether.newApoapsis > 0){
		out("escape","Does not reach escape velocity");
		out("newApoapsis","Apoapsis after release from tether: " + myRound(tether.newApoapsis/1000,3) + " km");
	}
	else{
		out("escape","Vinf after release from launch deck" + myRound(tether.escapeFromTop,3) + " m/s (840 m/s is required to reach Earth from the Moon)");
		out("newApoapsis","Apoapsis after release from tether: " + myRound(tether.newApoapsis/1000,3) + " km (negative means escape)");
	};
	if(tether.newPeriapsis < moon.radius){
		out("hitTheGround","Velocity at surface after release from tether foot " + myRound(tether.hitTheGround,3) + " m/s (collision angle " + myRound(180*(Math.PI/2 -tether.collisionAngle)/Math.PI,2) + "º from vertical)");
	}
	else{ out("hitTheGround",""); };
	out("lowRatio","foot-centre taper ratio: " + myRound(tether.lowRatio,3));
	out("highRatio","centre-top taper ratio: " + myRound(tether.highRatio,3));
	out("lowMass","Mass of lower tether: " + myRound(tether.lowMass,4) + " x payload mass (anything that's not the tether itself is payload)");
	out("highMass","Mass of higher tether: " + myRound(tether.highMass,4) + " x payload mass (anything that's not the tether itself is payload)");
	out("lowClimber","Lower tether climber energy usage: " + myRound(tether.lowIntegral,0) + " J/kg");
	out("highClimber","Upper tether climber energy usage: " + myRound(tether.highIntegral,0) + " J/kg (centre→top is downhill / regenerative)");

//── Forces ──
	out("tensionCoM","Tension at centre of mass (tip payload at top): " + fmtForce(tether.tensionCoM_top)
		+ "   [peak = " + fmtForce(tether.tensionCoM_peak) + "]");
	out("tensionCoMfoot","Tension at centre of mass (tip payload at foot): " + fmtForce(tether.tensionCoM_foot));
	out("tetherMassAbs","Tether mass for a " + gnum("tipMass").toLocaleString() + " t tip payload: " + fmtMass(tether.massAbs)
		+ " (" + myRound(tether.lowMass + tether.highMass,3) + " × payload)");

//── Throughput to top ──
//   Ascending cargo joins at the receiving deck and climbs to the top; the centre of
//   mass is the potential maximum, so lift energy is the work receiving deck → centre
//   (centre → top is downhill / regenerative).  The 1% descending stream joins at the
//   outer docks and runs down to the foot.  Added tension at the centre of mass uses the
//   L1-elevator convention applied to each stream over its own span.
	var rateTpd = gnum("rate");
	var mC      = gnum("perClimber");
	var vC      = gnum("vClimb");
	var eff     = gnum("effDrive")/100;
	var Rm      = moon.radius;
	var L_up    = tether.launchDeck - tether.receivingDeck; // m, receiving deck → launch deck (actual ascent)
	var L_down  = tether.outerDocks - tether.foot;        // m, outer docks → foot (actual descent)
	var tTrip_up   = (L_up   / vC) / 86400;               // days, ascent
	var tTrip_down = (L_down / vC) / 86400;               // days, descent
	var depPerDay  = rateTpd / mC;                        // climbers/day
	var interval_h = 24 / depPerDay;                      // h between climbers
	var nOnCable   = depPerDay * tTrip_up;                // ascending climbers in transit
	var oncable_t  = rateTpd * tTrip_up;                  // ascending tonnes on cable
	var descRate   = rateTpd * 0.01;                      // 1% descends to the foot
	var descOnCable_t = descRate * tTrip_down;            // descending tonnes on cable
	var spacing_km = (L_up/1e3) / Math.max(nOnCable, 1e-9);
	var liftIntegral = (tether.receivingDeck < tether.centre)
		? integral(moon.GM, tether.angularVelocity, tether.receivingDeck + Rm, tether.centre + Rm)
		: 0;                                              // J/kg, climb receiving deck → CoM (centre → top is downhill)
	var upAboveCoM   = integral(moon.GM, tether.angularVelocity, tether.centre + Rm, tether.launchDeck + Rm);
	var downAboveCoM = integral(moon.GM, tether.angularVelocity, tether.centre + Rm, tether.outerDocks + Rm);
	var lambda_up    = L_up   > 0 ? (oncable_t*1e3)     / L_up   : 0; // kg/m, ascending stream
	var lambda_down  = L_down > 0 ? (descOnCable_t*1e3) / L_down : 0; // kg/m, descending stream
	var dT_CoM   = lambda_up   * (liftIntegral + upAboveCoM)
	             + lambda_down * (tether.lowIntegral + downAboveCoM); // N, added peak tension at CoM
	var pctTip     = 100 * dT_CoM / tether.tensionCoM_peak;
	var massFlow   = rateTpd*1e3/86400;                   // kg/s delivered to the launch deck
	var netLiftIntegral = liftIntegral - upAboveCoM;     // J/kg net, receiving deck → launch deck (below CoM costs, above CoM regenerates)
	var P_lift     = netLiftIntegral * massFlow / eff;   // W (net work to climb receiving deck → launch deck)
	var ePerT      = netLiftIntegral / eff / 1e6;        // GJ per tonne, receiving deck → launch deck

	out("trip","Trip time (receiving deck → launch deck):" + fmtTime(tTrip_up) + "   (descent outer docks → foot: " + fmtTime(tTrip_down) + ")");
	out("cadence","Departure cadence: one every " + interval_h.toFixed(2) + " h  (" + depPerDay.toFixed(1) + "/day)");
	out("nclimb","Climbers on the cable at once: " + nOnCable.toFixed(1));
	out("spacing","Mean spacing between climbers: " + spacing_km.toLocaleString(undefined,{maximumFractionDigits:1}) + " km");
	out("oncable","Cargo on the cable at once: " + fmtMass(oncable_t*1e3) + " up + " + fmtMass(descOnCable_t*1e3) + " down");
	out("dT","Added tension at centre of mass: " + fmtForce(dT_CoM) + "  (" + pctTip.toFixed(2) + "% of tip-payload tension)");
	out("power","Lift power (receiving deck → launch deck, net of regeneration above CoM, at efficiency): " + fmtPower(P_lift));
	out("epert","Energy per tonne delivered: " + ePerT.toFixed(3) + " GJ/t");

//── Orbit station-keeping (VASIMR reboost) ──
//   Climbers carry cargo outward, so the tether feeds it angular momentum through the
//   Coriolis coupling; that momentum comes from the skyhook's orbit, which therefore
//   decays.  Ascending cargo joins at the receiving deck and is flung from the launch deck, so
//   the drain is mdot*omega*(r_launch^2 - r_deck^2).  The 1% descending stream joins at the outer
//   docks and runs to the foot, returning momentum and crediting the budget by
//   mdot_down*omega*(r_docks^2 - r_foot^2).  The net torque is supplied by an equal, opposite
//   thrust F = tau/r_mount at the engine mount radius; mounting farther out (longer lever arm)
//   needs less force, so less propellant.  Propellant = F/v_e, jet = 0.5*F*v_e, electrical = jet/(eff_thr*eff_sup).
	var r_f     = tether.foot          + moon.radius;
	var r_t     = tether.top           + moon.radius;
	var r_c     = tether.centre        + moon.radius;
	var r_deck  = tether.receivingDeck + moon.radius;
	var r_docks = tether.outerDocks    + moon.radius;
	var r_launch = tether.launchDeck   + moon.radius; // cargo is released here, setting the drain
	var wOrb = tether.angularVelocity;
//engine mount radius sets the reboost lever arm
	var r_mount = r_t;//reboost thruster mounted at the tether top (longest lever arm)
	var mountName = "tether top";
	            /* */
	            /* */
	            /* */
	/* */
	              /* */
	              /* */
	              /* */
	var vMount  = wOrb * r_mount;                        // m/s, tether speed at the mount point
	var massFlowDown = massFlow * 0.01;                  // kg/s, 1% descending stream (docks → foot)
	var tau_up   = massFlow     * wOrb * (r_launch*r_launch - r_deck*r_deck); // N·m, drain from ascending cargo (deck → launch deck)
	var tau_down = massFlowDown * wOrb * (r_docks*r_docks - r_f*r_f);     // N·m, credit from descending cargo (docks → foot)
	var tau_sk  = tau_up - tau_down;                     // N·m, net torque the engines must supply
	var F_sk    = tau_sk / r_mount;                      // N, reboost thrust at the mount point
	var P_orbit = F_sk * vMount;                         // W, useful power returned to the orbit (= tau*omega)
	var propName = form["propellant"].value;
	var vEx     = Math.min(gnum("vExhaust"), propellantMax[propName]) * 1000; // m/s, capped
	var effThr  = gnum("effThruster")/100;
	var effSup  = gnum("effSupply")/100;
	var propFlow= F_sk / vEx;             // kg/s of propellant
	var P_jet   = 0.5 * F_sk * vEx;       // W, exhaust kinetic power
	var P_elec  = P_jet / effThr;         // W at the thrusters
	var P_gen   = P_elec / effSup;        // W to be generated
	var propPerCargo = propFlow / Math.max(massFlow,1e-12); // kg propellant per kg cargo
	var propLabel = propName.charAt(0).toUpperCase()+propName.slice(1);

	out("skThrust","Reboost thrust at " + mountName + " (cancels climber drag): " + fmtForce(F_sk)
		+ "   —   torque " + fmtTorque(tau_sk));
	out("skProp",propLabel + " propellant: " + propFlow.toFixed(3) + " kg/s  ("
		+ fmtMass(propFlow*86400) + "/day; " + propPerCargo.toFixed(3) + " t per t of cargo)");
	out("skJet","Jet power at " + (vEx/1000) + " km/s exhaust: " + fmtPower(P_jet)
		+ "   (useful orbit power " + fmtPower(P_orbit) + ")");
	out("skElec","Electrical power at thrusters: " + fmtPower(P_elec));
	out("skGen","Generated power required: " + fmtPower(P_gen));
	out("skEnergyDay","Energy to hold the orbit: " + (P_gen*86400/3.6e12).toFixed(2) + " GWh/day  ("
		+ (P_gen*86400/1e9).toLocaleString(undefined,{maximumFractionDigits:0}) + " GJ/day)");
	out("skEpert","Station-keeping energy per tonne delivered: "
		+ (P_gen/Math.max(massFlow,1e-12)/1e6).toFixed(2) + " GJ/t");

//── Earth reentry of cargo released from the top (patched-conic Moon → parent) ──
//   The payload escapes the Moon with v∞ = escapeFromTop, braked retrograde so its
//   parent-relative speed at lunar distance is V_moon − v∞; that point is the apogee of
//   an Earth-transfer ellipse.  A burn there trims perigee to the target; the entry
//   flight-path angle and a calibrated Allen–Eggers peak-g follow at the interface.
	var isMoon = !!(moon.properties && moon.properties.name === "Moon");
	//Earth-reentry inputs and results only make sense for the Moon → Earth case
	[reentryContainer,
	 document.getElementById("earthReentryHead"),
	 document.getElementById("earthArrival"),
	 document.getElementById("earthPerigee"),
	 document.getElementById("earthBurn"),
	 document.getElementById("earthFPA"),
	 document.getElementById("earthPeakG")
	].forEach(function(el){ if(el){ el.style.display = isMoon ? "" : "none"; } });
	var parentBody = moon.orbit ? moon.orbit.system : null;
	if(parentBody && isFinite(tether.escapeFromTop)){
		var GMe   = parentBody.GM;
		var Re    = Number(parentBody.radius);
		var D     = moon.orbit.a;
		var vinf  = tether.escapeFromTop;
		var Vmoon = Math.sqrt(GMe/D);
		var Varr  = Vmoon - vinf;                       // parent-relative speed at lunar distance
		var epsE  = Varr*Varr/2 - GMe/D;
		var aNat  = -GMe/(2*epsE);
		var rpNat = 2*aNat - D;                         // natural transfer perigee (radius)
		var rpt   = Re + gnum("targetPerigee")*1000;    // target perigee radius
		var rI    = Re + gnum("ifaceAlt")*1000;         // entry-interface radius
		var aT    = (D + rpt)/2;
		var vT    = Math.sqrt(GMe*(2/D - 1/aT));        // apogee speed needed for target perigee
		var dvE   = vT - Varr;                          // +prograde raises perigee, −retrograde lowers
		out("earthArrival","v∞ from Moon: " + myRound(vinf,0) + " m/s → speed at lunar distance (braked): " + myRound(Math.abs(Varr),0) + " m/s");
		out("earthPerigee","Natural transfer perigee: " + myRound((rpNat-Re)/1000,0) + " km altitude" + (rpNat < Re ? " (below surface — steep/direct entry)" : ""));
		out("earthBurn","Δv at lunar-distance apogee for target perigee: " + myRound(Math.abs(dvE),1) + " m/s " + (dvE >= 0 ? "prograde (raise perigee)" : "retrograde (lower perigee)"));
		if(rpt < rI && rI < D){
			var eT     = (D - rpt)/(D + rpt);
			var hT     = Math.sqrt(GMe*aT*(1 - eT*eT));
			var vI     = Math.sqrt(GMe*(2/rI - 1/aT));
			var gammaE = Math.acos(Math.min(1, hT/(rI*vI)));
			out("earthFPA","Entry flight-path angle at interface: −" + myRound(gammaE*180/Math.PI,1) + "° (entry speed " + myRound(vI/1000,2) + " km/s)");
			if(parentBody.atmosphere){
				var peakG = OrbitalMath.allenEggersPeakDecel(vI, gammaE, Const.scaleHeight.earth) / Const.g0;   // A–E peak-g (k=0.55, Stardust-calibrated), in Earth g
				out("earthPeakG","Estimated peak deceleration: ~" + myRound(peakG,0) + " g (ballistic est., calibrated to Stardust; lift/guidance reduces it)");
			}
			else{ out("earthPeakG","Parent body has no atmosphere — no aerodynamic entry"); }
		}
		else{
			out("earthFPA","Target perigee above interface — no atmospheric entry");
			out("earthPeakG","");
		}
	}
	else{
		out("earthArrival","Top release does not escape the Moon — no Earth transfer");
		out("earthPerigee",""); out("earthBurn",""); out("earthFPA",""); out("earthPeakG","");
	}

	out("warnings",warnings);

	while(illustration.lastChild){ illustration.removeChild(illustration.lastChild); };
	minimum_x_coordinate = Math.max(-moon.radius/900,(moon.radius - (tether.top + tether.foot)/2)/1000);
	minimum_y_coordinate = Math.max(-moon.radius/900,-tether.Length/4000);
	minimum_x_distance = Math.min((moon.radius + tether.top)/850,tether.top/300) + Math.min(tether.Length/4000,moon.radius/1000);
	minimum_y_distance = Math.min(moon.radius/450,tether.Length/2000);
	illustration.setAttributeNS(null,"viewBox",minimum_x_coordinate + " " + minimum_y_coordinate + " " + minimum_x_distance + " " + minimum_y_distance);

//lots of svg drawing:
	var addText = function(container,content,x,y,size,color){
		var newMarker = document.createElementNS(svgNS,"text");
		newMarker.setAttributeNS(null,"x",x);
		newMarker.setAttributeNS(null,"y",y);
		newMarker.setAttributeNS(null,"font-size",size);
		newMarker.setAttributeNS(null,"class","svgText");
		newMarker.setAttributeNS(null,"fill",color);
		newMarker.appendChild(document.createTextNode(content));
		container.appendChild(newMarker);
	};
	var addToolTip = function(container,content){
		var newToolTip = document.createElementNS(svgNS,"title");
		container.setAttributeNS(null,"class",container.getAttributeNS(null,"class") + " tooltip");
		newToolTip.appendChild(document.createTextNode(content));
		container.appendChild(newToolTip);
	};
	var svg_planet = document.createElementNS(svgNS,"g");
	var svg_planet_main = document.createElementNS(svgNS,"circle");
	var svg_planet_atmosphere = document.createElementNS(svgNS,"circle");
	svg_planet_main.setAttributeNS(null,"cx",0);
	svg_planet_main.setAttributeNS(null,"cy",0);
	svg_planet_atmosphere.setAttributeNS(null,"cx",0);
	svg_planet_atmosphere.setAttributeNS(null,"cy",0);
	svg_planet_main.setAttributeNS(null,"fill",moon.color);
	svg_planet_atmosphere.setAttributeNS(null,"fill","#E0E0E0");
	svg_planet_main.setAttributeNS(null,"r",moon.radius/1000);
	svg_planet_atmosphere.setAttributeNS(null,"r",(moon.radius + (moon.atmosphere ? moon.atmosphere.height : 0))/1000);
	addToolTip(svg_planet_main,selector.options[selector.selectedIndex].value);
	svg_planet.appendChild(svg_planet_atmosphere);
	svg_planet.appendChild(svg_planet_main);

	var svg_scale = tether.Length/100000;

	svg_tether = document.createElementNS(svgNS,"g");
	var svg_tether_main = document.createElementNS(svgNS,"line");
	svg_tether_main.setAttributeNS(null,"x1",(moon.radius + tether.foot)/1000);
	svg_tether_main.setAttributeNS(null,"y1",0);
	svg_tether_main.setAttributeNS(null,"x2",(moon.radius + tether.top)/1000);
	svg_tether_main.setAttributeNS(null,"y2",0);
	svg_tether_main.setAttributeNS(null,"stroke","black");
	svg_tether_main.setAttributeNS(null,"stroke-linecap","butt");
	svg_tether_main.setAttributeNS(null,"stroke-width",svg_scale);
	svg_tether.appendChild(svg_tether_main);

	marker_container = document.createElementNS(svgNS,"g");
	text_marker_container = document.createElementNS(svgNS,"g");

	addText(text_marker_container,"Foot",(tether.foot + moon.radius)/1000,svg_scale*3,svg_scale*2.5,"black");
	addText(text_marker_container,"Top",(tether.top + moon.radius)/1000,svg_scale*3,svg_scale*2.5,"black");
	addText(text_marker_container,"Centre of mass",(tether.centre + moon.radius)/1000,svg_scale*3,svg_scale*2.5,"black");

	var selectedElement = 0;
	let moveElement = function(evt){
		var pt = illustration.createSVGPoint(), svgP;
		pt.x = evt.clientX; pt.y = evt.clientY;
		svgP = pt.matrixTransform(illustration.getScreenCTM().inverse());
		if(selectedElement.id == "anchor"){
			if(svgP.x > (tether.foot + moon.radius)/1000 && svgP.x < (tether.top + moon.radius)/1000){
				selectedElement.setAttributeNS(null,"cx",svgP.x);
				form["centre"].value = svgP.x - moon.radius/1000;
			};
		}
		else if(selectedElement.id == "foot"){
			if(svgP.x < (tether.centre + moon.radius)/1000 && svgP.x > moon.radius/1000){
				selectedElement.setAttributeNS(null,"cx",svgP.x);
				form["foot"].value = svgP.x - moon.radius/1000;
			};
		}
		else if(selectedElement.id == "top"){
			if(svgP.x > (tether.centre + moon.radius)/1000){
				selectedElement.setAttributeNS(null,"cx",svgP.x);
				form["top"].value = svgP.x - moon.radius/1000;
			};
		}
	};
	let selectElement = function(evt){
		selectedElement = evt.target;
		illustration.onmousemove = moveElement;
		illustration.onmouseup = deselectElement
	}
	let deselectElement = function(evt){
		if(selectedElement != 0){
			illustration.removeAttributeNS(null, "onmousemove");
			illustration.removeAttributeNS(null, "onmouseup");
			selectedElement = 0;
		};
		calc();
	};

	var foot_marker = document.createElementNS(svgNS,"circle");
	foot_marker.setAttributeNS(null,"cx",(tether.foot + moon.radius)/1000);
	foot_marker.setAttributeNS(null,"cy",0);
	foot_marker.setAttributeNS(null,"fill","red");
	foot_marker.setAttributeNS(null,"class","draggable");
	foot_marker.setAttributeNS(null,"id","foot");
	foot_marker.onmousedown = selectElement;
	foot_marker.setAttributeNS(null,"r",svg_scale*1.4);

	var anchor_marker = document.createElementNS(svgNS,"circle");
	anchor_marker.setAttributeNS(null,"cx",(tether.centre + moon.radius)/1000);
	anchor_marker.setAttributeNS(null,"cy",0);
	anchor_marker.setAttributeNS(null,"fill","#900000");
	anchor_marker.setAttributeNS(null,"class","draggable");
	anchor_marker.setAttributeNS(null,"id","anchor");
	anchor_marker.onmousedown = selectElement;
	anchor_marker.setAttributeNS(null,"r",svg_scale*1.4);

	var top_marker = document.createElementNS(svgNS,"circle");
	top_marker.setAttributeNS(null,"cx",(tether.top + moon.radius)/1000);
	top_marker.setAttributeNS(null,"cy",0);
	top_marker.setAttributeNS(null,"fill","red");
	top_marker.setAttributeNS(null,"class","draggable");
	top_marker.setAttributeNS(null,"id","top");
	top_marker.onmousedown = selectElement;
	top_marker.setAttributeNS(null,"r",svg_scale*1.4);

	var descent_trajectory = document.createElementNS(svgNS,"path");
	var semiMajor = (tether.newPeriapsis + moon.radius + tether.foot)/2000;
	var semiMinor = Math.sqrt(semiMajor*semiMajor - Math.pow((tether.foot + moon.radius - tether.newPeriapsis)/2000,2));
	var descent_path = "M" + (moon.radius + tether.foot)/1000 + " 0a" + semiMajor + " " + semiMinor + " 0 0 0 " + 2*-semiMajor + " 0a" + semiMajor + " " + semiMinor + " 0 0 0 " + semiMajor*2 + " 0";
	descent_trajectory.setAttributeNS(null,"d",descent_path);
	descent_trajectory.setAttributeNS(null,"stroke","green");
	descent_trajectory.setAttributeNS(null,"fill","none");
	descent_trajectory.setAttributeNS(null,"stroke-width",svg_scale/3);
	descent_trajectory.setAttributeNS(null,"stroke-dasharray",svg_scale/2);
	if(tether.newPeriapsis < moon.radius){
		var collision_point = document.createElementNS(svgNS,"circle");
		var angle = Math.asin(
			(2*(tether.foot + moon.radius)*tether.newPeriapsis - moon.radius*(tether.foot + moon.radius + tether.newPeriapsis))
			/(moon.radius*(tether.foot + moon.radius - tether.newPeriapsis))
		) + Math.PI/2;
		var secondAngle = angle + tether.collisionAngle - Math.PI/2;
		collision_point.setAttributeNS(null,"cx",Math.cos(angle)*moon.radius/1000);
		collision_point.setAttributeNS(null,"cy",-Math.sin(angle)*moon.radius/1000);
		collision_point.setAttributeNS(null,"fill","blue");
		collision_point.setAttributeNS(null,"r",svg_scale);
		var collision_line = document.createElementNS(svgNS,"line");
		collision_line.setAttributeNS(null,"x1",0);
		collision_line.setAttributeNS(null,"y1",0);
		collision_line.setAttributeNS(null,"x2",Math.cos(angle)*moon.radius/1000);
		collision_line.setAttributeNS(null,"y2",-Math.sin(angle)*moon.radius/1000);
		collision_line.setAttributeNS(null,"fill","none");
		collision_line.setAttributeNS(null,"stroke","pink");
		collision_line.setAttributeNS(null,"stroke-linecap","round");
		collision_line.setAttributeNS(null,"stroke-width",svg_scale/2);
		var reference_line = document.createElementNS(svgNS,"line");
		reference_line.setAttributeNS(null,"x1",0);
		reference_line.setAttributeNS(null,"y1",0);
		reference_line.setAttributeNS(null,"x2",moon.radius/1000);
		reference_line.setAttributeNS(null,"y2",0);
		reference_line.setAttributeNS(null,"fill","none");
		reference_line.setAttributeNS(null,"stroke","pink");
		reference_line.setAttributeNS(null,"stroke-linecap","round");
		reference_line.setAttributeNS(null,"stroke-width",svg_scale/2);
		var reference_angle = document.createElementNS(svgNS,"path");
		reference_angle.setAttributeNS(null,"d","M "+moon.radius/3000+" 0A"+moon.radius/3000+" "+moon.radius/3000+" 0 0 0 "+Math.cos(angle)*moon.radius/3000+" "+Math.sin(angle)*moon.radius/-3000);
		reference_angle.setAttributeNS(null,"fill","none");
		reference_angle.setAttributeNS(null,"stroke","pink");
		reference_angle.setAttributeNS(null,"stroke-linecap","round");
		reference_angle.setAttributeNS(null,"stroke-width",svg_scale/2);
		var collision_angle = document.createElementNS(svgNS,"path");
		collision_angle.setAttributeNS(
			null,"d",
			"M "+2*Math.cos(angle)*moon.radius/3000+" "
			+2*-Math.sin(angle)*moon.radius/3000+"A"
			+moon.radius/3000+" "+moon.radius/3000+" 0 0 1 "
			+(Math.cos(angle)*moon.radius/1000 - moon.radius*Math.cos(secondAngle)/3000)+" "
			+(Math.sin(angle)*-moon.radius/1000 + moon.radius*Math.sin(secondAngle)/3000)
		);
		collision_angle.setAttributeNS(null,"fill","none");
		collision_angle.setAttributeNS(null,"stroke","red");
		collision_angle.setAttributeNS(null,"stroke-linecap","round");
		collision_angle.setAttributeNS(null,"stroke-width",svg_scale/2);
		var velocity_line = document.createElementNS(svgNS,"line");
		velocity_line.setAttributeNS(null,"x1",Math.cos(angle)*moon.radius/1000 - moon.radius*Math.cos(secondAngle)/1000);
		velocity_line.setAttributeNS(null,"y1",-Math.sin(angle)*moon.radius/1000 + moon.radius*Math.sin(secondAngle)/1000);
		velocity_line.setAttributeNS(null,"x2",Math.cos(angle)*moon.radius/1000 + moon.radius*Math.cos(secondAngle)/1000);
		velocity_line.setAttributeNS(null,"y2",-Math.sin(angle)*moon.radius/1000 - moon.radius*Math.sin(secondAngle)/1000);
		velocity_line.setAttributeNS(null,"fill","none");
		velocity_line.setAttributeNS(null,"stroke","red");
		velocity_line.setAttributeNS(null,"stroke-linecap","round");
		velocity_line.setAttributeNS(null,"stroke-width",svg_scale/2);
		addText(
			text_marker_container,
			myRound(180*angle/Math.PI,1) + "º",
			Math.cos(angle/2)*moon.radius/2500,
			-Math.sin(angle/2)*moon.radius/2500,
			svg_scale*2.5,
			"pink"
		);
		addText(
			text_marker_container,
			myRound(180*(Math.PI/2 -tether.collisionAngle)/Math.PI,1) + "º",
			Math.cos(angle)*moon.radius/1000 - moon.radius*Math.cos((secondAngle + angle)/2)/1800,
			-Math.sin(angle)*moon.radius/1000 + moon.radius*Math.sin((secondAngle + angle)/2)/1800,
			svg_scale*2.5,
			"red"
		);

		marker_container.appendChild(collision_angle);
		marker_container.appendChild(collision_line);
		marker_container.appendChild(reference_line);
		marker_container.appendChild(velocity_line);
		marker_container.appendChild(reference_angle);
		marker_container.appendChild(collision_point);
	};

	var anchor_trajectory = document.createElementNS(svgNS,"circle");
	anchor_trajectory.setAttributeNS(null,"stroke","green");
	anchor_trajectory.setAttributeNS(null,"fill","none");
	anchor_trajectory.setAttributeNS(null,"cx",0);
	anchor_trajectory.setAttributeNS(null,"cy",0);
	anchor_trajectory.setAttributeNS(null,"r",(tether.centre + moon.radius)/1000);
	anchor_trajectory.setAttributeNS(null,"stroke-width",svg_scale/3);
	anchor_trajectory.setAttributeNS(null,"stroke-dasharray",svg_scale/2);

	svg_tether.appendChild(descent_trajectory);
	svg_tether.appendChild(anchor_trajectory);
	marker_container.appendChild(foot_marker);
	marker_container.appendChild(anchor_marker);
	marker_container.appendChild(top_marker);

	for(var i=0;i<targets.length;i++){
		var marker = document.createElementNS(svgNS,"circle");
		marker.setAttributeNS(null,"cx",targets[i].location/1000);
		marker.setAttributeNS(null,"cy",0);
		marker.setAttributeNS(null,"fill","blue");
		marker.setAttributeNS(null,"r",svg_scale);
		addToolTip(marker,"Release point for " + targets[i].name + " transfer\nAltitude " + myRound((targets[i].location - moon.radius)/1000,2) + "km\nVinf " + myRound(targets[i].vinf,2) + "m/s");

		marker_container.appendChild(marker);

		addText(
			text_marker_container,
			targets[i].name + "↑",
			targets[i].location/1000,
			svg_scale*3,
			svg_scale*2.5,
			"blue"
		);
	};
	//construct path for tether width diagram
	var tether_width_scale = Math.min(
		Math.sqrt(tether.lowRatio)*svg_scale*4,
		Math.sqrt(tether.highRatio)*svg_scale*4,
		svg_scale*13
	);
	var lowerPath = "M" + (tether.foot + moon.radius)/1000 + " " + svg_scale*4.5 + "l" + (tether.centre - tether.foot)/1000 + " 0l0 " + tether_width_scale;
	var upperPath = "M" + (tether.top  + moon.radius)/1000 + " " + svg_scale*4.5 + "l" + (tether.centre - tether.top )/1000 + " 0l0 " + tether_width_scale;
	for(var i=1;i<lowCrosses.length;i++){
		lowerPath += "l-" + (tether.centre - tether.foot)/(1000*lowCrosses.length) + " " + (Math.sqrt(1/lowCrosses[i]) -  Math.sqrt(1/lowCrosses[i-1]))*tether_width_scale;
		upperPath += "l" + (tether.top - tether.centre)/(1000*highCrosses.length) + " " + (Math.sqrt(1/highCrosses[i]) -  Math.sqrt(1/highCrosses[i-1]))*tether_width_scale;
	};
	lowerPath += "l-" + (tether.centre - tether.foot)/(1000*lowCrosses.length) + " 0z";
	upperPath += "l" + (tether.top - tether.centre)/(1000*highCrosses.length) + " 0z";
	var tether_cross_low = document.createElementNS(svgNS,"path");
	tether_cross_low.setAttributeNS(null,"fill","black");
	tether_cross_low.setAttributeNS(null,"d",lowerPath);
	tether_cross_low.setAttributeNS(null,"id","lowerPath");
	tether_cross_low.setAttributeNS(null,"stroke","none");
	addToolTip(tether_cross_low,"Lower tether diameter\nDiameter ratio " + myRound(Math.sqrt(tether.lowRatio),3) + "\nCross section ratio " + myRound(tether.lowRatio,3));

	text_marker_container.appendChild(tether_cross_low);

	var tether_cross_high = document.createElementNS(svgNS,"path");
	tether_cross_high.setAttributeNS(null,"fill","black");
	tether_cross_high.setAttributeNS(null,"d",upperPath);
	tether_cross_high.setAttributeNS(null,"id","upperPath");
	tether_cross_high.setAttributeNS(null,"stroke","none");
	addToolTip(tether_cross_high,"Upper tether diameter\nDiameter ratio " + myRound(Math.sqrt(tether.highRatio),3) + "\nCross section ratio " + myRound(tether.highRatio,3));

	text_marker_container.appendChild(tether_cross_high);
	illustration.appendChild(svg_tether);
	illustration.appendChild(svg_planet);
	illustration.appendChild(marker_container);
	illustration.appendChild(text_marker_container);

};
var hardReload = function(){
	var animation = document.createElementNS(svgNS,"animate");
	animation.setAttributeNS(null,"attributeName","opacity");
	animation.setAttributeNS(null,"begin","indefinite");
	animation.setAttributeNS(null,"values","0;0;1");
	animation.setAttributeNS(null,"dur", 1.5);
	animation.setAttributeNS(null,"fill","freeze");

	var marker_animation = document.createElementNS(svgNS,"animate");
	marker_animation.setAttributeNS(null,"attributeName","opacity");
	marker_animation.setAttributeNS(null,"begin","indefinite");
	marker_animation.setAttributeNS(null,"values","0;0;0;0;1");
	marker_animation.setAttributeNS(null,"dur", 2);
	marker_animation.setAttributeNS(null,"fill","freeze");

	var text_marker_animation = document.createElementNS(svgNS,"animate");
	text_marker_animation.setAttributeNS(null,"attributeName","opacity");
	text_marker_animation.setAttributeNS(null,"begin","indefinite");
	text_marker_animation.setAttributeNS(null,"values","0;0;0;0;0;1");
	text_marker_animation.setAttributeNS(null,"dur", 2.5);
	text_marker_animation.setAttributeNS(null,"fill","freeze");

	var svg_rotate = document.createElementNS(svgNS,"animate");
	svg_rotate.setAttributeNS(null,"attributeName","viewBox");
	svg_rotate.setAttributeNS(null,"begin","indefinite");
	svg_rotate.setAttributeNS(null,"from",-moon.radius/900 + " " + (-moon.radius/900) + " " + (moon.radius*2 + tether.top)/225 + " " + moon.radius/112);
	svg_rotate.setAttributeNS(null,"to",minimum_x_coordinate + " " + minimum_y_coordinate + " " + minimum_x_distance + " " + minimum_y_distance);
	svg_rotate.setAttributeNS(null,"dur",0.5);

	svg_tether.appendChild(animation);
	text_marker_container.appendChild(text_marker_animation);
	marker_container.appendChild(marker_animation);
	illustration.appendChild(svg_rotate);

	svg_rotate.beginElement();
	marker_animation.beginElement();
	text_marker_animation.beginElement();
};
calc();hardReload();
selector.oninput = function(){calc();hardReload();}
}
skyhookTool(document.getElementById("insertItHere"));
