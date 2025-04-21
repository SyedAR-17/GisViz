import React, { useEffect, useState, useRef, useMemo } from "react";
import { Map } from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import { DeckGL } from "@deck.gl/react";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import "maplibre-gl/dist/maplibre-gl.css";

const MAP_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const INITIAL_VIEW_STATE = {
  longitude: 24.8084,
  latitude: 60.1699,
  zoom: 10,
  pitch: 60,
  bearing: 20,
};

const getGradientColor = (value, max) => {
  const ratio = value / max;
  if (ratio < 0.33) {
    const g = Math.round(255 * (ratio / 0.33));
    return [0, g, 255, 200];
  } else if (ratio < 0.66) {
    const r = 255;
    const g = Math.round(255 - (255 * (ratio - 0.33)) / 0.33);
    return [r, g, 0, 200];
  } else {
    const r = 255;
    const g = Math.round(128 - (128 * (ratio - 0.66)) / 0.34);
    return [r, g, 0, 200];
  }
};

const getCentroid = (geometry) => {
  if (!geometry || geometry.type !== "Polygon") return [0, 0];
  const coords = geometry.coordinates[0];
  const [sumLng, sumLat] = coords.reduce(
    ([lngAcc, latAcc], [lng, lat]) => [lngAcc + lng, latAcc + lat],
    [0, 0]
  );
  return [sumLng / coords.length, sumLat / coords.length];
};

export default function App() {
  const [geojson, setGeojson] = useState(null);
  const [showHexes, setShowHexes] = useState(true);
  const [originId, setOriginId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [routeGeojson, setRouteGeojson] = useState(null);
  const [originCentroid, setOriginCentroid] = useState(null);
  const [destinationCentroid, setDestinationCentroid] = useState(null);
  const [co2, setCo2] = useState(null);
  const [visits, setVisits] = useState(null);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const mapRef = useRef();

  useEffect(() => {
    fetch("/output.geojson")
      .then((r) => r.json())
      .then(setGeojson)
      .catch(console.error);
  }, []);

  const originOptions = useMemo(() => {
    if (!geojson) return [];
    return Array.from(
      new Set(geojson.features.map((f) => f.properties.origin_code_level_9))
    ).sort();
  }, [geojson]);

  const destinationOptions = useMemo(() => {
    if (!geojson) return [];
    return Array.from(
      new Set(geojson.features.map((f) => f.properties.destination_code_level_9))
    ).sort();
  }, [geojson]);

  let maxUsers = 1;
  if (geojson) {
    maxUsers = Math.max(
      ...geojson.features.map((f) => f.properties.EXTRAPOLATED_NUMBER_OF_USERS || 0)
    );
  }

  const hexLayer =
    geojson && showHexes
      ? new GeoJsonLayer({
          id: "hex-layer",
          data: geojson,
          pickable: true,
          extruded: true,
          opacity: 0.8,
          wireframe: false,
          filled: true,
          stroked: false,
          elevationScale: 2,
          getElevation: (f) => f.properties.EXTRAPOLATED_NUMBER_OF_USERS || 0,
          getFillColor: (f) =>
            getGradientColor(f.properties.EXTRAPOLATED_NUMBER_OF_USERS || 0, maxUsers),
        })
      : null;
  

  const pointLayer =
    originCentroid && destinationCentroid
      ? new ScatterplotLayer({
          id: "point-layer",
          data: [
            { position: originCentroid, color: [0, 255, 0], title: "Origin" },
            { position: destinationCentroid, color: [255, 0, 0], title: "Destination" },
          ],
          pickable: true,
          getPosition: (d) => d.position,
          getFillColor: (d) => d.color,
          getRadius: 25,
          radiusMinPixels: 5,
        })
      : null;

  const handleRouteDraw = async () => {
    if (!geojson) return;

    const oFeat = geojson.features.find(
      (f) => f.properties.origin_code_level_9 === originId
    );
    const dFeat = geojson.features.find(
      (f) => f.properties.destination_code_level_9 === destinationId
    );

    if (!oFeat || !dFeat) {
      alert("Origin or destination ID not found.");
      return;
    }

    const oCent = getCentroid(oFeat.geometry);
    const dCent = getCentroid(dFeat.geometry);
    setOriginCentroid(oCent);
    setDestinationCentroid(dCent);

    const co2Val = dFeat.properties.Single_CarTrip_Co2;
    setCo2(co2Val);

    const visitsVal = dFeat.properties.EXTRAPOLATED_NUMBER_OF_USERS;
    setVisits(visitsVal);

    const url = `https://router.project-osrm.org/route/v1/driving/${oCent[0]},${oCent[1]};${dCent[0]},${dCent[1]}?geometries=geojson`;

    try {
      const res = await fetch(url);
      const js = await res.json();
      if (!js.routes?.length) {
        alert("No route returned by OSRM");
        setRouteGeojson(null);
        return;
      }

      const routeFc = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: js.routes[0].geometry,
            properties: { title: "Route" },
          },
        ],
      };
      setRouteGeojson(routeFc);

      const coords = js.routes[0].geometry.coordinates;
      const lons = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      const sw = [Math.min(...lons), Math.min(...lats)];
      const ne = [Math.max(...lons), Math.max(...lats)];

      if (mapRef.current) {
        mapRef.current.getMap().fitBounds([sw, ne], { padding: 40 });
      }
    } catch (err) {
      console.error(err);
      alert("Routing request failed");
    }
  };

  const handleRemoveRoute = () => {
    setRouteGeojson(null);
    setOriginCentroid(null);
    setDestinationCentroid(null);
    setCo2(null);
    setVisits(null);
  };

  const buttonStyle = {
    background: "#333",
    color: "#fff",
    border: "1px solid #666",
    padding: "5px 10px",
    cursor: "pointer",
    borderRadius: 3,
    marginRight: 5,
    marginTop: 5,
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden", fontFamily: "'Orbitron', sans-serif", backgroundColor: "#000" }}>
  <div
    style={{
      width: 300,
      background: "#1a1a1a",
      color: "#d0d0d0",
      padding: 18,
      boxSizing: "border-box",
      flexShrink: 0,
      zIndex: 1,
      overflowY: "auto",
      maxHeight: "100vh",
      borderRight: "1px solid #333",
      fontSize: "13px",
    }}
  >
        <hr style={{ borderColor: "#333" }} />

<label style={{ display: "block", marginTop: 10, color: "#00ffff", fontWeight: 'bolder' }}>
  <input
    type="checkbox"
    checked={showHexes}
    onChange={() => setShowHexes((v) => !v)}
    style={{ marginRight: 6 }}
  />
  VISUALIZE MOST VISITED AREAS
</label>

<hr style={{ borderColor: "#333", margin: "10px 0" }} />
    <h2 style={{ color: "#00ffff", fontSize: "13px", letterSpacing: "1px", marginBottom: 16 }}>
      ROUTE BUILDER
    </h2>

    <div style={{ marginBottom: 14 }}>
      <label style={{ color: "#aaa", marginBottom: 4, display: "block" }}>ORIGIN:</label>
      <select
        style={{
          width: "100%",
          padding: "6px 8px",
          backgroundColor: "#2a2a2a",
          color: "#e0e0e0",
          border: "1px solid #444",
          borderRadius: 4
        }}
        value={originId}
        onChange={(e) => setOriginId(e.target.value)}
      >
        <option value="">-- Select origin ID --</option>
        {originOptions.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </div>

    <div style={{ marginBottom: 14 }}>
      <label style={{ color: "#aaa", marginBottom: 4, display: "block" }}>DESTINATION:</label>
      <select
        style={{
          width: "100%",
          padding: "6px 8px",
          backgroundColor: "#2a2a2a",
          color: "#e0e0e0",
          border: "1px solid #444",
          borderRadius: 4
        }}
        value={destinationId}
        onChange={(e) => setDestinationId(e.target.value)}
      >
        <option value="">-- Select destination ID --</option>
        {destinationOptions.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </div>

    <button
      onClick={handleRouteDraw}
      style={{
        width: "100%",
        marginBottom: 10,
        padding: "8px",
        backgroundColor: "#00ffff",
        color: "#000",
        border: "none",
        borderRadius: 4,
        fontWeight: 600,
        cursor: "pointer",
        boxShadow: "0 0 8px #00ffff55",
        fontSize: "12px"
      }}
      disabled={!originId || !destinationId}
    >
      DRAW STREET ROUTE
    </button>

    {routeGeojson && (
      <button
        onClick={handleRemoveRoute}
        style={{
          width: "100%",
          marginBottom: 20,
          padding: "8px",
          backgroundColor: "#333",
          color: "#fff",
          border: "1px solid #00ffff44",
          borderRadius: 4,
          fontWeight: 600,
          cursor: "pointer",
          fontSize: "12px"
        }}
      >
        REMOVE ROUTE
      </button>
    )}

    {originCentroid && destinationCentroid && (
      <div
        style={{
          background: "#111",
          color: "#ccc",
          padding: 10,
          borderRadius: 6,
          border: "1px solid #00ffff33",
          marginBottom: 18,
          fontSize: "12px"
        }}
      >
        <h3 style={{ color: "#00ffff", fontSize: "13px", marginBottom: 6 }}>ROUTE INFO</h3>
        <p><strong>Origin:</strong> {originId}</p>
        <p><strong>Destination:</strong> {destinationId}</p>
        <p><strong>Origin Centroid:</strong> [{originCentroid[1].toFixed(5)}, {originCentroid[0].toFixed(5)}]</p>
        <p><strong>Destination Centroid:</strong> [{destinationCentroid[1].toFixed(5)}, {destinationCentroid[0].toFixed(5)}]</p>
        <p><strong>CO₂ (1 Car Trip):</strong> {co2 !== null ? `${co2} g` : "N/A"}</p>
        <p><strong>Number of Visits to Desitination Hex.:</strong> {visits !== null ? `${visits}` : "N/A"}</p>
      </div>
    )}

    <hr style={{ borderColor: "#333", margin: "15px 0" }} />
    <h4 style={{ color: "#00ffff", fontSize: "13px", marginBottom: 10, letterSpacing: "0.5px" }}>
      CAMERA CONTROLS
    </h4>

    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {[
        { label: "FLAT", action: () => setViewState((v) => ({ ...v, pitch: 0 })) },
        { label: "ROTATE LEFT", action: () => setViewState((v) => ({ ...v, bearing: v.bearing - 15 })) },
        { label: "ROTATE RIGHT", action: () => setViewState((v) => ({ ...v, bearing: v.bearing + 15 })) },
        { label: "RESET", action: () => setViewState(INITIAL_VIEW_STATE) }
      ].map(({ label, action }) => (
        <button
          key={label}
          style={{
            flex: "1 1 45%",
            padding: "6px",
            backgroundColor: "#222",
            color: "#00ffff",
            border: "1px solid #00ffff33",
            borderRadius: 3,
            cursor: "pointer",
            fontSize: "11px",
            fontWeight: 500
          }}
          onClick={action}
        >
          {label}
        </button>
      ))}
    </div>
  </div>


      <div style={{ flexGrow: 1, position: "relative" }}>
        <DeckGL
          viewState={viewState}
          onViewStateChange={({ viewState }) => setViewState(viewState)}
          controller={true}
          layers={[
            ...(hexLayer ? [hexLayer] : []),
            ...(routeGeojson
              ? [
                  new GeoJsonLayer({
                    id: "route-layer",
                    data: routeGeojson,
                    stroked: true,
                    filled: false,
                    getLineColor: [0, 255, 255],
                    lineWidthMinPixels: 4,
                    pickable: true,
                  }),
                ]
              : []),
            ...(pointLayer ? [pointLayer] : []),
          ]}
          getTooltip={({ object }) =>
            object && {
              html: `<b>Destination ID:</b> ${object.properties.destination_code_level_9}`,
            }
          }
        >
          <Map
            ref={mapRef}
            reuseMaps={true}
            preventStyleDiffing={true}
            mapStyle={MAP_STYLE}
            mapLib={maplibregl}
            style={{ width: "100%", height: "100%" }}
          />
        </DeckGL>
      </div>
    </div>
  );
}
