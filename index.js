const map = L.map("map", {center: [28, 0], zoom: 2, zoomSnap: 0, wheelPxPerZoomLevel: 120});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
L.control.scale().addTo(map);

let arealayer = null;
let bounds = map.getBounds();
let center = map.getCenter();
let area = 100;

let soil = {}
let climate = []

document.getElementById("calculatebounds").onclick = () => {
	map.invalidateSize();
	if (arealayer) map.removeLayer(arealayer);
	
	bounds = map.getBounds();
	bounds = [[bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()]];
	center = map.getCenter();
	area = (bounds[1][0] - bounds[0][0]) * 111.32 * (bounds[1][1] - bounds[0][1]) * 111.32 * Math.cos((bounds[1][0] + bounds[0][0]) / 2 * Math.PI / 180);
	
	document.getElementById("landinfo").innerHTML = `
		• Center: ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}<br>
		• Area: ${area.toFixed(2)} km²<br>
	`;
	arealayer = L.rectangle(bounds, {weight: 2, fillOpacity: 0.1}).addTo(map);
};
document.getElementById("calculatesoil").onclick = async() => {
	if (area > 25) {alert("Region must be 25km² or smaller"); return;}
	document.getElementById("overlay").classList.add("on");
	
	soil.soilph = await soilgrids(bounds, "phh2o_5-15cm_mean", 0.1);
	soil.soilclay = await soilgrids(bounds, "clay_5-15cm_mean", 0.1);
	soil.soilsand = await soilgrids(bounds, "sand_5-15cm_mean", 0.1);
	soil.soilsilt = await soilgrids(bounds, "silt_5-15cm_mean", 0.1);
	soil.soiln = await soilgrids(bounds, "nitrogen_5-15cm_mean", 0.01);
	
	document.getElementById("soilinfo").innerHTML = `
		• pH: ${soil.soilph.toFixed(2)}<br>
		• Clay: ${soil.soilclay.toFixed(2)} %<br>
		• Sand: ${soil.soilsand.toFixed(2)} %<br>
		• Silt: ${soil.soilsilt.toFixed(2)} %<br>
		• Nitrogen: ${soil.soiln.toFixed(2)} g/kg<br>
	`;
	
	document.getElementById("overlay").classList.remove("on");
}
document.getElementById("calculateclimate").onclick = async() => {
	if (area > 25) {alert("Region must be 25km² or smaller"); return;}
	const startingyear = Number(document.getElementById("startingyear").value);
	if (startingyear < 1990 || startingyear > 2025) {alert("Starting year must be between 1990 and 2025 (inclusively)"); return;}
	document.getElementById("overlay").classList.add("on");
	
	climate = await nasapower(center, startingyear);
	climategraph(climate);
	
	document.getElementById("overlay").classList.remove("on");
}

document.getElementById("calculatecrop").onclick = async() => {
    if (area > 25) {alert("Region must be 25km² or smaller"); return;}
    if (Object.keys(soil).length == 0) {alert("Calculate soil properties first!"); return;}
    if (climate.length == 0) {alert("Calculate climate properties first!"); return;}

	const crops = await fetch("crops.json").then(r => r.json());
    const getWeek = id => {
        const value = document.getElementById(id).value;
        const n = Number(value);
        return value !== "" && Number.isInteger(n) && n >= 1 && n <= 52 ? n : null;
    };

    const ranges = [
        [getWeek("week1"), getWeek("week2")],
        [getWeek("week3"), getWeek("week4")]
    ].filter(([a, b]) => a !== null && b !== null && a <= b);

    if (!ranges.length) {
        alert("Enter at least one valid week range (1–52).");
        return;
    }

    document.getElementById("overlay").classList.add("on");

    try {
        const cropdata = await crops;

        const weeks = new Set();
        for (const [start, end] of ranges)
            for (let w = start - 1; w < end; w++) weeks.add(w);

        const average = values =>
            values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

        // Absolute min, optimal min, optimal max, absolute max
        const rangePenalty = (value, [amin, omin, omax, amax]) => {
            if (!Number.isFinite(value)) return 0;

            if (value < amin)
                return -20 - 10 * Math.min(1, (amin - value) / (omin - amin));

            if (value > amax)
                return -20 - 10 * Math.min(1, (value - amax) / (amax - omax));

            if (value < omin)
                return -20 * (omin - value) / (omin - amin);

            if (value > omax)
                return -20 * (value - omax) / (amax - omax);

            return 0;
        };

        // Sand, silt, clay
        const texturePenalty = (value, [min, max]) => {
            if (!Number.isFinite(value)) return 0;
            return -20 * Math.min(1, Math.max(0, (min - value) / 20, (value - max) / 20));
        };

        // Insufficient light
        const lightPenalty = (value, [min]) => {
            if (!Number.isFinite(value)) return 0;
            return -20 * Math.min(1, Math.max(0, (min - value) / min));
        };

        // Annual precipitation (mm/year)
        const annualPrecipitation = climate.reduce(
            (sum, w) => sum + (Number.isFinite(w.p) ? w.p : 0), 0
        );

        const cropscore = {};

        for (const crop in cropdata) {
            const c = cropdata[crop];
            let score = 0;

            // Soil pH
            score += rangePenalty(soil.soilph, c.ph);

            // Soil texture
            score += texturePenalty(soil.soilsand, c.sand) / 3;
            score += texturePenalty(soil.soilsilt, c.silt) / 3;
            score += texturePenalty(soil.soilclay, c.clay) / 3;

            // Precipitation
            score += rangePenalty(annualPrecipitation, c.p);

            // Temperature and light
            const temperatures = [];
            const light = [];

            for (const week of weeks) {
                const w = climate[week];

                if (Number.isFinite(w.t))
                    temperatures.push(rangePenalty(w.t, c.t));

                if (Number.isFinite(w.l) && c.dli) {
                    const dailyDLI = w.l * 7.2;
                    light.push(lightPenalty(dailyDLI, c.dli));
                }
            }

            score += average(temperatures);
            score += average(light);

            cropscore[crop] = Math.min(0, score);
        }

        const ranked = Object.entries(cropscore)
            .sort((a, b) => b[1] - a[1]);

        
const html = `
    <ol class="crop-list">
        ${ranked.map(([crop, score], i) => {
            const fit = Math.round(
                Math.max(0, Math.min(100, 100 * (1 + score / 130)))
            );

            return `
                <li class="crop-card">
                    <div class="crop-rank">#${i + 1}</div>

                    <div>
                        <div class="crop-name">${crop}</div>
                        <div class="crop-penalty">
                            Penalty: ${score.toFixed(1)}
                        </div>
                    </div>

                    <div class="crop-score">${fit}/100</div>

                    <div class="crop-bar">
                        <div class="crop-fill"
                             style="width: ${fit}%">
                        </div>
                    </div>
                </li>
            `;
        }).join("")}
    </ol>
`;

document.getElementById("cropresults").innerHTML = html;


    } catch (error) {
        console.error(error);
        alert(`Crop ranking failed: ${error.message}`);

    } finally {
        document.getElementById("overlay").classList.remove("on");
    }
};



async function soilgrids(bounds, property, conversion) {
	const { fromArrayBuffer } = await import("https://esm.sh/geotiff");
	const response = await fetch(`https://maps.isric.org/mapserv?map=/map/${property.split("_")[0]}.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=${property}&FORMAT=GEOTIFF_INT16&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326&SUBSET=Lat(${bounds[0][0]},${bounds[1][0]})&SUBSET=Long(${bounds[0][1]},${bounds[1][1]})`);
	const buffer = await response.arrayBuffer();
	const image = await fromArrayBuffer(buffer).then(tiff => tiff.getImage());
	const raster = await image.readRasters();
	
	const bbox = image.getBoundingBox();
	const w = image.getWidth();
	const h = image.getHeight();
	const wl = (bbox[2] - bbox[0]) / w;
	const hl = (bbox[3] - bbox[1]) / h;
	
	let average = 0;
	let count = 0;
	const values = [];
	for (const raw of raster[0]) {
		if (!Number.isFinite(raw) || raw <= 0) continue;
		average += raw * conversion;
		count++;
		values.push(raw * conversion);
	}
	average = count ? average / count: 0;
	
	return average;
};
async function nasapower(center, startingyear) {
	const params = await fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?latitude=${center.lat}&longitude=${center.lng}&start=${startingyear}0101&end=20251231&parameters=T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN&community=AG`).then(response => response.json()).then(data => data.properties.parameter);
	const names = {t: "T2M", tmax: "T2M_MAX", tmin: "T2M_MIN", p: "PRECTOTCORR", l: "ALLSKY_SFC_SW_DWN"};
	for (const key in names) params[names[key]] = Object.values(params[names[key]]);
	
	const yearly = [];
	let day = 0;
	for (let year = startingyear; year <= 2025; year++) {
		for (let week = 0; week < 52; week++) {
			const weekly = {t: 0, tmax: 0, tmin: 0, p: 0, l: 0};
			const counts = {t: 0, tmax: 0, tmin: 0, p: 0, l: 0};
			for (let d = 0; d < 7; d++) {
				for (const key in names) {
					const value = params[names[key]][day];
					if (Number.isFinite(value) && value !== -999) {
						weekly[key] += value;
						counts[key]++;
					}
				}
				day++;
			}
			for (const key in names) weekly[key] = key === "p" ? weekly[key] : (counts[key] > 0 ? weekly[key] / counts[key] : 0);
			yearly.push(weekly);
		}
		day += year % 4 ? 1 : 2;
	}

	const result = [];
	const years = 2026 - startingyear;
	for (let week = 0; week < 52; week++) {
		const weekly = {};
		for (const key in names) {
			const values = [];
			for (let year = 0; year < years; year++) values.push(yearly[year * 52 + week][key]);
			const avg = values.reduce((s, v) => s + v, 0) / years;
			weekly[key] = avg;
			weekly[key + "std"] = Math.sqrt(values.reduce((s, v) => s + (v - avg) ** 2, 0) / years);
		}
		result.push(weekly);
	}

	return result;
}
function climategraph(climate) {
	const names = {t: "Temperature (°C)", tmax: "Maximum temperature (°C)", tmin: "Minimum temperature (°C)", p: "Precipitation (mm/week)", l: "Solar radiation (MJ/m²/day)"};
	Chart.getChart("climateinfo")?.destroy();
	const chart = new Chart(document.getElementById("climateinfo"), {
		type: "line",
		data: {
			labels: climate.map((_, i) => `Week ${i + 1}`),
			datasets: ["t", "tmax", "tmin"].map(key => ({
				label: names[key],
				data: climate.map(w => w[key]),
				tension: 0.2
			}))
		},
		options: {responsive: true}
	});
	
	document.querySelectorAll("#climatebuttons button").forEach(button => {
		button.onclick = () => {
			const keys = button.dataset.key === "t" ? ["t", "tmax", "tmin"] : [button.dataset.key];
			chart.data.datasets = keys.map(key => ({
				label: names[key],
				data: climate.map(w => w[key]),
				tension: 0.2
			}));
			chart.update();
		};
	});
}