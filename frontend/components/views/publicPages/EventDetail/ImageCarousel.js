// ImageCarousel — post-go-live "additional images" feature (plan.md backlog).
// Detail page ONLY. Feature image first, then the additional images in upload
// order; left/right arrow nav, no dot indicators. Renders a single plain <img>
// (identical to the pre-feature markup) when there are no additional images, so
// every existing event with just a feature image is visually unchanged.
import { useState } from 'react';

function ImageCarousel({ images, alt }) {
  const [index, setIndex] = useState(0);
  if (!images.length) return null;

  const single = images.length === 1;
  const go = (delta) =>
    setIndex((i) => (i + delta + images.length) % images.length);

  return (
    <div className="position-relative mb-4">
      {/* Same sizing as the pre-feature single <img> so an event with only a
          feature image renders visually unchanged. */}
      <img
        src={images[index].url}
        alt={alt}
        className="img-fluid rounded d-block mx-auto"
        style={{ maxWidth: 600, width: '100%', objectFit: 'cover' }}
      />
      {!single && (
        <>
          <button
            type="button"
            className="btn btn-light border rounded-circle position-absolute top-50 start-0 translate-middle-y ms-2"
            aria-label="Previous image"
            onClick={() => go(-1)}
          >
            &#8249;
          </button>
          <button
            type="button"
            className="btn btn-light border rounded-circle position-absolute top-50 end-0 translate-middle-y me-2"
            aria-label="Next image"
            onClick={() => go(1)}
          >
            &#8250;
          </button>
        </>
      )}
    </div>
  );
}

export default ImageCarousel;
