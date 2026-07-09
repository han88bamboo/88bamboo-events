// ExplorePageShell — the shared chrome for every Explore page (EXPLORE-LAYER-PLAN §6):
// breadcrumbs, the H1 (from facetH1 / the D9 place template, computed by the page),
// templated intro copy, and a search box that deep-links into the main board at
// /a/events?q=. The page passes the resolved strings + crumbs; the results grid
// (ExploreFilters) is rendered as {children} below the intro.
import { useState } from 'react';
import { useRouter } from 'next/router';

import Breadcrumbs from './Breadcrumbs';

function ExplorePageShell({ crumbs, h1, intro, children }) {
  const router = useRouter();
  const [q, setQ] = useState('');

  const search = (e) => {
    e.preventDefault();
    const term = q.trim();
    // Deep-link into the main board's keyword search (basePath '/a/events' is added
    // by the router). An empty term just opens the board.
    router.push({ pathname: '/', query: term ? { q: term } : {} });
  };

  return (
    <main className="page-width py-5">
      <Breadcrumbs items={crumbs} />

      <h1 className="mb-2">{h1}</h1>
      {intro && <p className="text-muted mb-4" style={{ maxWidth: '48rem' }}>{intro}</p>}

      {/* Search prompt — jumps to the full board's keyword search. */}
      <form className="input-group mb-4" style={{ maxWidth: '32rem' }} onSubmit={search}>
        <input
          type="search"
          className="form-control"
          placeholder="Search all events, venues, keywords…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search all events"
        />
        <button type="submit" className="btn bamboo-btn">
          Search
        </button>
      </form>

      {children}
    </main>
  );
}

export default ExplorePageShell;
