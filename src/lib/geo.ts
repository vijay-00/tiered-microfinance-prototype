/**
 * Where a field visit took place. The device's own GPS when it gives one; if
 * it is refused, missing or slow, a stand-in near the member's village, marked
 * as such, so the demo never sticks on a permission prompt.
 */

export interface VisitLocation {
  lat: number;
  lng: number;
  accuracyMetres: number;
  locationSource: 'GPS' | 'DEMO';
}

/** Towns near each society, for the stand-in. */
const PLACES: Record<string, [number, number]> = {
  Melur: [10.0322, 78.3386],
  Vadipatti: [10.084, 77.9616],
  Alanganallur: [10.0469, 78.0903],
  Sholavandan: [10.0235, 77.9622],
  Kallikudi: [9.8098, 77.9668],
  Budalur: [10.7868, 78.9866],
  Orathanadu: [10.6274, 79.2517],
  Papanasam: [10.9247, 79.2694],
  Thiruvaiyaru: [10.8817, 79.1042],
  Ammapettai: [10.8042, 79.1944],
  Natham: [10.2233, 78.2299],
  Vedasandur: [10.5312, 77.9478],
  Nilakottai: [10.1654, 77.8558],
  Oddanchatram: [10.4886, 77.7522],
  Batlagundu: [10.1647, 77.7555],
};

/** The same village always lands on the same spot. */
export function demoLocation(village: string): VisitLocation {
  const [lat, lng] = PLACES[village] ?? [9.9252, 78.1198]; // Madurai
  let hash = 0;
  for (const c of village) hash = (hash * 31 + c.charCodeAt(0)) % 997;
  return {
    lat: Number((lat + ((hash % 40) - 20) / 10_000).toFixed(5)),
    lng: Number((lng + (((hash >> 3) % 40) - 20) / 10_000).toFixed(5)),
    accuracyMetres: 12,
    locationSource: 'DEMO',
  };
}

export function captureLocation(village: string, timeoutMs = 6000): Promise<VisitLocation> {
  return new Promise((resolve) => {
    const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
    if (!geo) {
      resolve(demoLocation(village));
      return;
    }
    geo.getCurrentPosition(
      (p) =>
        resolve({
          lat: Number(p.coords.latitude.toFixed(5)),
          lng: Number(p.coords.longitude.toFixed(5)),
          accuracyMetres: Math.round(p.coords.accuracy),
          locationSource: 'GPS',
        }),
      () => resolve(demoLocation(village)),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

export const mapLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`;
