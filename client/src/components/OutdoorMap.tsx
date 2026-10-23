import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import type { LocationResult, OutdoorPlace } from "../../../server/outdoor/types";

const startingIcon = L.divIcon({ className: "outdoor-marker starting-marker", html: '<span aria-hidden="true"></span>', iconSize: [26, 26], iconAnchor: [13, 13] });
const createPlaceIcon = (active: boolean) => L.divIcon({ className: `outdoor-marker result-marker ${active ? "is-active" : ""}`, html: '<span aria-hidden="true"></span>', iconSize: active ? [24, 24] : [19, 19], iconAnchor: active ? [12, 12] : [9, 9] });

function Recenter({ location, activePlace }: { location: LocationResult; activePlace?: OutdoorPlace }) {
  const map = useMap();
  useEffect(() => { map.setView(activePlace ? [activePlace.latitude, activePlace.longitude] : [location.latitude, location.longitude], activePlace ? Math.max(map.getZoom(), 14) : 13, { animate: true, duration: 0.7 }); }, [map, location.latitude, location.longitude, activePlace?.latitude, activePlace?.longitude]);
  return null;
}

export default function OutdoorMap({ location, places, activeId, onSelect }: { location: LocationResult; places: OutdoorPlace[]; activeId: string | null; onSelect: (id: string) => void }) {
  const activePlace = places.find(place => place.id === activeId);
  const center = useMemo<[number, number]>(() => [location.latitude, location.longitude], [location.latitude, location.longitude]);
  return <div className="interactive-map"><MapContainer center={center} zoom={13} scrollWheelZoom={false} zoomControl={true} attributionControl={false} className="leaflet-map" aria-label={`Map of outdoor places near ${location.displayName}`}>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' url="https://tile.openstreetmap.de/{z}/{x}/{y}.png" maxZoom={19}/>
    <Recenter location={location} activePlace={activePlace}/>
    <Marker position={center} icon={startingIcon} zIndexOffset={1000}><Tooltip direction="top" offset={[0, -10]}>{location.name} · selected location</Tooltip></Marker>
    {places.map(place => <Marker key={place.id} position={[place.latitude, place.longitude]} icon={createPlaceIcon(activeId === place.id)} eventHandlers={{ click: () => onSelect(place.id) }}><Tooltip direction="top" offset={[0, -8]}>{place.name} · {place.distanceKm.toFixed(1)} km</Tooltip></Marker>)}
    <CircleMarker center={center} radius={4} pathOptions={{ color: "#fffdf7", fillColor: "#d66e49", fillOpacity: 1, weight: 2 }}/>
  </MapContainer></div>;
}
