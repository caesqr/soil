const map = L.map("map");
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);

map.setView([25, 0], 2);

L.rectangle(bounds, {fill: false, weight: 2, opacity: 0.5, color: "#124559"}).addTo(map);
L.control.scale().addTo(map);