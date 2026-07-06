# geo_reference.py — loads the canonical geo reference data (countries + their
# subdivisions) from the DB into the shape the validators and the /geo endpoint
# need (EP-2). Kept separate from submission_validation.py so that module stays
# Flask/DB-free and unit-testable: the callers load this dict and pass it in.
#
# The DB is the SINGLE source of truth (owner decision): there is no hardcoded
# country list on the backend or the frontend any more.


def load_geo(cursor):
    """Return {country_name: {"requires_region": bool, "regions": set[str]}} for
    every ACTIVE country. `regions` is the set of that country's active
    subdivisions (empty unless requires_region). The cursor is the caller's — this
    runs read-only inside the caller's transaction."""
    cursor.execute(
        "SELECT id, name, requires_region FROM countries WHERE active = TRUE"
    )
    countries = cursor.fetchall()

    cursor.execute(
        "SELECT country_id, name FROM country_regions WHERE active = TRUE"
    )
    regions_by_country = {}
    for row in cursor.fetchall():
        regions_by_country.setdefault(row["country_id"], set()).add(row["name"])

    geo = {}
    for c in countries:
        geo[c["name"]] = {
            "requires_region": c["requires_region"],
            "regions": regions_by_country.get(c["id"], set()),
        }
    return geo
