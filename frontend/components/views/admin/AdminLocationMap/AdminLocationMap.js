// AdminLocationMap — a compact, read-only location preview for the admin panels
// (EP-2 deferred stretch, built in EP-4). Lets a reviewer see WHERE an event is
// before approving (ReviewQueue) or while managing it (LiveListings).
//
// It reuses the SAME keyless Google `output=embed` iframe the public detail page
// uses (EventDetail.js) — so it needs NO API key and incurs no billing. When the
// event carries stored coordinates (EP-2), the marker is an EXACT PIN (`lat,lng`);
// legacy events with no coordinates fall back to the address-string query (venue
// NAME dropped — a name alone geocodes poorly), exactly like the public page.
//
// The iframe is mounted only when open (`initialOpen` / the Show map toggle) so we
// don't fire N Google embeds — and their cookies — for a long list of rows. A
// short "lat, lng · region · postcode" summary line is always shown when present.
import { useState } from 'react';

function AdminLocationMap({ item, initialOpen = false }) {
  const [open, setOpen] = useState(initialOpen);

  const hasCoords = item.latitude != null && item.longitude != null;
  // Same query construction as EventDetail: exact pin when we have coordinates,
  // else the address string (address, city, region, country — no venue name).
  const coordQuery = hasCoords ? `${item.latitude},${item.longitude}` : null;
  const addressQuery = [item.venue_address, item.city, item.region, item.country]
    .filter(Boolean)
    .join(', ');
  const mapQuery = coordQuery || addressQuery;
  if (!mapQuery) return null; // nothing to place — hide entirely

  const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    mapQuery,
  )}${
    hasCoords && item.place_id
      ? `&destination_place_id=${encodeURIComponent(item.place_id)}`
      : ''
  }`;

  // Summary line: exact coords when present (proves the address was Google-
  // validated), else a "legacy, no coordinates" note so the reviewer knows the
  // pin is only approximate. Region/postcode appended when we have them.
  const summaryBits = [
    hasCoords ? `📍 ${item.latitude}, ${item.longitude}` : '📍 No coordinates (legacy — approx.)',
    item.region || null,
    item.postcode || null,
  ].filter(Boolean);

  return (
    <div className="mt-2">
      <div className="small text-muted d-flex align-items-center gap-2 flex-wrap">
        <span>{summaryBits.join(' · ')}</span>
        <button
          type="button"
          className="btn btn-link btn-sm text-muted p-0"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Hide map' : 'Show map'}
        </button>
      </div>
      {open && (
        <div className="mt-2" style={{ maxWidth: 420 }}>
          <div className="ratio ratio-16x9 rounded overflow-hidden border">
            <iframe
              title={`Map showing ${item.venue_name || item.name || mapQuery}`}
              src={mapSrc}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              style={{ border: 0 }}
              allowFullScreen
            />
          </div>
          <p className="mt-1 mb-0 small">
            <a href={directionsUrl} target="_blank" rel="noopener noreferrer">
              Get directions ↗
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

export default AdminLocationMap;
