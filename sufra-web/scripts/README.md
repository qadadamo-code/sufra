# Data scripts

`data/restaurants.json` (`{ attribution, areas[], cuisines{}, restaurants[] }`) is what the site imports
(`src/lib/data.ts`). It can be built two ways.

## 1. Real places from OpenStreetMap (default)

```sh
node scripts/fetch-osm.mjs          # download → data/osm-places.json   (~90 HTTP requests, ~2 min)
node scripts/build-real-data.mjs    # data/osm-places.json → data/restaurants.json (offline, deterministic)
node scripts/validate-data.mjs      # schema checks + coverage report (exit 1 on errors)
```

- **fetch-osm.mjs** tiles each area in `BOXES` (the 12 site areas plus El Manial, Mokattam, Sheraton
  and a few suburb fringes) into ≤ 0.02° × 0.02° boxes and calls the OSM editing API
  `https://api.openstreetmap.org/api/0.6/map` (Overpass is blocked from the build machine). Dense tiles
  that hit the API node limit are split in four. It keeps named `amenity=restaurant|cafe|fast_food|ice_cream`
  and `shop=bakery|pastry` nodes/ways (ways → centroid) with a whitelist of tags, plus thinned named-street
  points used for addresses. Requests are ≤ 1/s with the User-Agent `SufraDemo/0.1 (qadadamo@gmail.com)`.
  Raw responses are cached gzipped in `$OSM_CACHE` (default: the session scratchpad `osm-cache/`), so a
  rerun is offline; pass `--refresh` to re-download, `--only=zamalek,maadi` to fetch some areas.
- **build-real-data.mjs** filters (nameless, disused/closed, non-food, duplicates by name within 150 m),
  ranks by how much real information a place has, caps chains (3 branches, 1 per area) and areas
  (`--perArea=40`), keeps up to `--max=360`, and writes the site schema. Per field:
  - **Real (OSM):** `ar`/`en` (from `name:ar`/`name:en`/`name`; a missing language keeps the original
    name — only well-known brands are transliterated), `lat`/`lng`, `area` (nearest area centre among the
    fetch boxes containing the point), `addressAr/En` (`addr:*`, else nearest mapped street, else area
    name; `addressSource` says which), `cuisine` (OSM `cuisine` mapped to the 15 site keys, else name
    keywords / place type — `cuisineSource`), `hours` (parsed `opening_hours`; `hoursSource: "osm"` or
    `"estimated"` = typical hours for the cuisine), `phone`, `website`, `instagram`, `brand`,
    `amenitiesReal` (wifi / outdoor / wheelchair / shisha from tags), `takeaway`, `deliveryReal`.
  - **Sample (generated, deterministic per place, flagged in `sample`):** price level, `avg`, menu,
    photos (`cover`/`gallery` from `public/img`), Sufra in-app `rating`/`ratingCount`, `visits`, `busy`,
    reviews, offers, moods, description, `since`, delivery fee/ETA, and amenities other than `amenitiesReal`.
  - `google` / `googleCount` are `null`: real Google ratings may only be shown live via the Google Places
    API, so the site fetches them when a key is configured.
  - Provenance: `source: { kind: "osm", type, id, url }`, `verified` (≥ 3 of cuisine, opening_hours,
    phone, website, addr), `openingHoursRaw`, `osmCuisine`, `osmType`, `lastEdited`. ids are `osm-n<id>` /
    `osm-w<id>`; slugs are ASCII and unique.
  - Missing phone / instagram are `""` (never invented).

### Licence obligations (ODbL 1.0)

OpenStreetMap data is © OpenStreetMap contributors and licensed under the
[Open Database Licence](https://opendatacommons.org/licenses/odbl/1-0/). Using it here requires:

1. **Attribution** wherever the data is shown: “Restaurant data © OpenStreetMap contributors (ODbL)”
   linking to <https://www.openstreetmap.org/copyright>. The strings are exported from
   `src/data/osm-attribution.ts` (`OSM_ATTRIBUTION`) and stored in `restaurants.json` → `attribution`.
2. **Share-alike** for the derived database: `data/osm-places.json` and `data/restaurants.json` are
   derivatives of OSM. If they (or a database made from them) are distributed publicly, they must be
   offered under ODbL, with this file documenting how they were produced. Mixing in sample data does not
   change that; the generated sample fields are our own and may be shared under the same terms.
3. Keep the OSM API usage policy: identify the client (User-Agent), stay ≤ 1 request/s, use the cache
   instead of re-downloading, and never bulk-scrape — refresh at most occasionally.

## 2. Fictional fallback

```sh
node scripts/gen-data.mjs           # 120 invented restaurants → data/restaurants.json (seeded)
```

`gen-data.mjs` still works standalone (byte-identical output) and exports its helpers, word lists and
`setSeed()`; `build-real-data.mjs` imports them (and the menu templates in `menus.mjs`) for the sample
fields. Note: this overwrites `data/restaurants.json`; rerun `build-real-data.mjs` to restore the real data.
