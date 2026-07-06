-- ep2-location.sql — EP-2 (Eventbrite-parity) location & geo migration.
--
-- HAND-APPLY THIS TO THE LIVE DATABASE (there is no migration framework — SPEC
-- §A3). It is idempotent-friendly (IF NOT EXISTS guards) so a re-run is safe.
-- Local dev does NOT need this file: schema.sql already contains the same DDL +
-- seed and is auto-applied on a fresh `docker compose up` (re-seed with
-- `docker compose down -v`). This directory is a SUBFOLDER of ./database so the
-- Postgres init hook (top-level *.sql only) never auto-runs it.
--
--   psql "$DATABASE_URL" -f database/migrations/ep2-location.sql
--
-- It (1) adds 5 nullable columns to event_versions (no backfill — existing
-- events keep NULL coords), and (2) creates + seeds the countries and
-- country_regions reference tables.

BEGIN;

-- 1) New nullable location columns on event_versions.
ALTER TABLE event_versions
    ADD COLUMN IF NOT EXISTS latitude  NUMERIC(9, 6),
    ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6),
    ADD COLUMN IF NOT EXISTS place_id  TEXT,
    ADD COLUMN IF NOT EXISTS postcode  VARCHAR(32),
    ADD COLUMN IF NOT EXISTS region    VARCHAR(255);

-- 2) Geo reference tables.
-- countries — canonical country list: the SINGLE source of truth for the
-- submission form's required country dropdown AND server-side validation (EP-2).
-- Replaces the former hardcoded frontend list so "US / USA / United States" drift
-- is impossible. requires_region = TRUE means the form must also collect a
-- State/Territory/Region from country_regions (large federal countries, plus
-- Hong Kong / Macau / Taiwan whose region resolves to themselves).
CREATE TABLE IF NOT EXISTS countries (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL UNIQUE,
    requires_region BOOLEAN NOT NULL DEFAULT FALSE,
    active          BOOLEAN NOT NULL DEFAULT TRUE
);

-- country_regions — the standard subdivisions (states / provinces / regions) for
-- the countries where requires_region = TRUE (ISO 3166-2 style names). The FK is
-- ON DELETE CASCADE — NOT the app-wide SET NULL — because a subdivision is
-- meaningless without its country and these are static reference rows that never
-- join the versioned listing graph (flagged deliberately, same spirit as the
-- TIMESTAMPTZ note above).
CREATE TABLE IF NOT EXISTS country_regions (
    id         SERIAL PRIMARY KEY,
    country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    name       VARCHAR(255) NOT NULL,
    active     BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (country_id, name)
);

CREATE INDEX IF NOT EXISTS idx_country_regions_country_id ON country_regions (country_id);   -- region dropdown lookups

-- 3) Seed the reference data. ON CONFLICT DO NOTHING so a re-run is a no-op.
-- Countries (canonical, controlled dropdown source). requires_region
-- drives the dependent State/Territory/Region select on the forms.
INSERT INTO countries (name, requires_region) VALUES
    ('Argentina', FALSE),
    ('Australia', TRUE),
    ('Austria', FALSE),
    ('Bahrain', FALSE),
    ('Bangladesh', FALSE),
    ('Belgium', FALSE),
    ('Brazil', TRUE),
    ('Bulgaria', FALSE),
    ('Cambodia', FALSE),
    ('Canada', TRUE),
    ('Chile', TRUE),
    ('Mainland China', TRUE),
    ('Colombia', FALSE),
    ('Croatia', FALSE),
    ('Cyprus', FALSE),
    ('Czech Republic', FALSE),
    ('Denmark', TRUE),
    ('Egypt', FALSE),
    ('Estonia', FALSE),
    ('Finland', FALSE),
    ('France', TRUE),
    ('Georgia', FALSE),
    ('Germany', FALSE),
    ('Greece', FALSE),
    ('Hong Kong', TRUE),
    ('Hungary', FALSE),
    ('Iceland', FALSE),
    ('India', FALSE),
    ('Indonesia', TRUE),
    ('Ireland', FALSE),
    ('Israel', FALSE),
    ('Italy', FALSE),
    ('Japan', FALSE),
    ('Jordan', FALSE),
    ('Kenya', FALSE),
    ('Kuwait', FALSE),
    ('Laos', FALSE),
    ('Latvia', FALSE),
    ('Lebanon', FALSE),
    ('Lithuania', FALSE),
    ('Luxembourg', FALSE),
    ('Macau', TRUE),
    ('Malaysia', FALSE),
    ('Malta', FALSE),
    ('Mexico', TRUE),
    ('Monaco', FALSE),
    ('Morocco', FALSE),
    ('Myanmar', FALSE),
    ('Nepal', FALSE),
    ('Netherlands', TRUE),
    ('New Zealand', TRUE),
    ('Nigeria', FALSE),
    ('Norway', FALSE),
    ('Oman', FALSE),
    ('Pakistan', FALSE),
    ('Peru', FALSE),
    ('Philippines', FALSE),
    ('Poland', FALSE),
    ('Portugal', TRUE),
    ('Qatar', FALSE),
    ('Romania', FALSE),
    ('Russia', TRUE),
    ('Saudi Arabia', FALSE),
    ('Serbia', FALSE),
    ('Singapore', FALSE),
    ('Slovakia', FALSE),
    ('Slovenia', FALSE),
    ('South Africa', TRUE),
    ('South Korea', FALSE),
    ('Spain', TRUE),
    ('Sri Lanka', FALSE),
    ('Sweden', FALSE),
    ('Switzerland', FALSE),
    ('Taiwan', TRUE),
    ('Thailand', FALSE),
    ('Turkey', FALSE),
    ('Ukraine', FALSE),
    ('United Arab Emirates', FALSE),
    ('United Kingdom', TRUE),
    ('United States', TRUE),
    ('Uruguay', FALSE),
    ('Vietnam', FALSE)
ON CONFLICT (name) DO NOTHING;

-- Country subdivisions (ISO 3166-2 style, standard commonly-used names).
-- Looked up by country name so the seed stays readable.
INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Australian Capital Territory',
    'New South Wales',
    'Northern Territory',
    'Queensland',
    'South Australia',
    'Tasmania',
    'Victoria',
    'Western Australia'
]) AS r WHERE name = 'Australia' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Acre',
    'Alagoas',
    'Amapá',
    'Amazonas',
    'Bahia',
    'Ceará',
    'Distrito Federal',
    'Espírito Santo',
    'Goiás',
    'Maranhão',
    'Mato Grosso',
    'Mato Grosso do Sul',
    'Minas Gerais',
    'Pará',
    'Paraíba',
    'Paraná',
    'Pernambuco',
    'Piauí',
    'Rio de Janeiro',
    'Rio Grande do Norte',
    'Rio Grande do Sul',
    'Rondônia',
    'Roraima',
    'Santa Catarina',
    'São Paulo',
    'Sergipe',
    'Tocantins'
]) AS r WHERE name = 'Brazil' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Alberta',
    'British Columbia',
    'Manitoba',
    'New Brunswick',
    'Newfoundland and Labrador',
    'Northwest Territories',
    'Nova Scotia',
    'Nunavut',
    'Ontario',
    'Prince Edward Island',
    'Quebec',
    'Saskatchewan',
    'Yukon'
]) AS r WHERE name = 'Canada' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Antofagasta',
    'Araucanía',
    'Arica y Parinacota',
    'Atacama',
    'Aysén',
    'Biobío',
    'Coquimbo',
    'Los Lagos',
    'Los Ríos',
    'Magallanes',
    'Maule',
    'O''Higgins',
    'Ñuble',
    'Santiago Metropolitan',
    'Tarapacá',
    'Valparaíso'
]) AS r WHERE name = 'Chile' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Anhui',
    'Beijing',
    'Chongqing',
    'Fujian',
    'Gansu',
    'Guangdong',
    'Guangxi',
    'Guizhou',
    'Hainan',
    'Hebei',
    'Heilongjiang',
    'Henan',
    'Hubei',
    'Hunan',
    'Inner Mongolia',
    'Jiangsu',
    'Jiangxi',
    'Jilin',
    'Liaoning',
    'Ningxia',
    'Qinghai',
    'Shaanxi',
    'Shandong',
    'Shanghai',
    'Shanxi',
    'Sichuan',
    'Tianjin',
    'Tibet',
    'Xinjiang',
    'Yunnan',
    'Zhejiang'
]) AS r WHERE name = 'Mainland China' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Capital Region',
    'Central Denmark',
    'North Denmark',
    'Southern Denmark',
    'Zealand'
]) AS r WHERE name = 'Denmark' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Auvergne-Rhône-Alpes',
    'Bourgogne-Franche-Comté',
    'Bretagne',
    'Centre-Val de Loire',
    'Corse',
    'Grand Est',
    'Guadeloupe',
    'Guyane',
    'Hauts-de-France',
    'Île-de-France',
    'La Réunion',
    'Martinique',
    'Mayotte',
    'Normandie',
    'Nouvelle-Aquitaine',
    'Occitanie',
    'Pays de la Loire',
    'Provence-Alpes-Côte d''Azur'
]) AS r WHERE name = 'France' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Hong Kong'
]) AS r WHERE name = 'Hong Kong' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Aceh',
    'Bali',
    'Bangka Belitung Islands',
    'Banten',
    'Bengkulu',
    'Central Java',
    'Central Kalimantan',
    'Central Papua',
    'Central Sulawesi',
    'East Java',
    'East Kalimantan',
    'East Nusa Tenggara',
    'Gorontalo',
    'Highland Papua',
    'Jakarta',
    'Jambi',
    'Lampung',
    'Maluku',
    'North Kalimantan',
    'North Maluku',
    'North Sulawesi',
    'North Sumatra',
    'Papua',
    'Riau',
    'Riau Islands',
    'South Kalimantan',
    'South Papua',
    'South Sulawesi',
    'South Sumatra',
    'Southeast Sulawesi',
    'Southwest Papua',
    'West Java',
    'West Kalimantan',
    'West Nusa Tenggara',
    'West Papua',
    'West Sulawesi',
    'West Sumatra',
    'Yogyakarta'
]) AS r WHERE name = 'Indonesia' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Macau'
]) AS r WHERE name = 'Macau' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Aguascalientes',
    'Baja California',
    'Baja California Sur',
    'Campeche',
    'Chiapas',
    'Chihuahua',
    'Coahuila',
    'Colima',
    'Durango',
    'Guanajuato',
    'Guerrero',
    'Hidalgo',
    'Jalisco',
    'Mexico City',
    'Michoacán',
    'Morelos',
    'México',
    'Nayarit',
    'Nuevo León',
    'Oaxaca',
    'Puebla',
    'Querétaro',
    'Quintana Roo',
    'San Luis Potosí',
    'Sinaloa',
    'Sonora',
    'Tabasco',
    'Tamaulipas',
    'Tlaxcala',
    'Veracruz',
    'Yucatán',
    'Zacatecas'
]) AS r WHERE name = 'Mexico' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Drenthe',
    'Flevoland',
    'Friesland',
    'Gelderland',
    'Groningen',
    'Limburg',
    'North Brabant',
    'North Holland',
    'Overijssel',
    'South Holland',
    'Utrecht',
    'Zeeland'
]) AS r WHERE name = 'Netherlands' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Auckland',
    'Bay of Plenty',
    'Canterbury',
    'Gisborne',
    'Hawke''s Bay',
    'Manawatū-Whanganui',
    'Marlborough',
    'Nelson',
    'Northland',
    'Otago',
    'Southland',
    'Taranaki',
    'Tasman',
    'Waikato',
    'Wellington',
    'West Coast'
]) AS r WHERE name = 'New Zealand' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Açores',
    'Aveiro',
    'Beja',
    'Braga',
    'Bragança',
    'Castelo Branco',
    'Coimbra',
    'Évora',
    'Faro',
    'Guarda',
    'Leiria',
    'Lisboa',
    'Madeira',
    'Portalegre',
    'Porto',
    'Santarém',
    'Setúbal',
    'Viana do Castelo',
    'Vila Real',
    'Viseu'
]) AS r WHERE name = 'Portugal' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Adygea',
    'Altai Krai',
    'Altai Republic',
    'Amur',
    'Arkhangelsk',
    'Astrakhan',
    'Bashkortostan',
    'Belgorod',
    'Bryansk',
    'Buryatia',
    'Chechnya',
    'Chelyabinsk',
    'Chukotka',
    'Chuvashia',
    'Dagestan',
    'Ingushetia',
    'Irkutsk',
    'Ivanovo',
    'Jewish Autonomous Oblast',
    'Kabardino-Balkaria',
    'Kaliningrad',
    'Kalmykia',
    'Kaluga',
    'Kamchatka Krai',
    'Karachay-Cherkessia',
    'Karelia',
    'Kemerovo',
    'Khabarovsk Krai',
    'Khakassia',
    'Khanty-Mansi',
    'Kirov',
    'Komi',
    'Kostroma',
    'Krasnodar Krai',
    'Krasnoyarsk Krai',
    'Kurgan',
    'Kursk',
    'Leningrad',
    'Lipetsk',
    'Magadan',
    'Mari El',
    'Mordovia',
    'Moscow',
    'Moscow Oblast',
    'Murmansk',
    'Nenets',
    'Nizhny Novgorod',
    'North Ossetia–Alania',
    'Novgorod',
    'Novosibirsk',
    'Omsk',
    'Orenburg',
    'Oryol',
    'Penza',
    'Perm Krai',
    'Primorsky Krai',
    'Pskov',
    'Rostov',
    'Ryazan',
    'Saint Petersburg',
    'Sakha (Yakutia)',
    'Sakhalin',
    'Samara',
    'Saratov',
    'Smolensk',
    'Stavropol Krai',
    'Sverdlovsk',
    'Tambov',
    'Tatarstan',
    'Tomsk',
    'Tula',
    'Tuva',
    'Tver',
    'Tyumen',
    'Udmurtia',
    'Ulyanovsk',
    'Vladimir',
    'Volgograd',
    'Vologda',
    'Voronezh',
    'Yamalo-Nenets',
    'Yaroslavl',
    'Zabaykalsky Krai'
]) AS r WHERE name = 'Russia' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Eastern Cape',
    'Free State',
    'Gauteng',
    'KwaZulu-Natal',
    'Limpopo',
    'Mpumalanga',
    'North West',
    'Northern Cape',
    'Western Cape'
]) AS r WHERE name = 'South Africa' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Andalusia',
    'Aragon',
    'Asturias',
    'Balearic Islands',
    'Basque Country',
    'Canary Islands',
    'Cantabria',
    'Castile and León',
    'Castilla-La Mancha',
    'Catalonia',
    'Ceuta',
    'Extremadura',
    'Galicia',
    'La Rioja',
    'Madrid',
    'Melilla',
    'Murcia',
    'Navarre',
    'Valencia'
]) AS r WHERE name = 'Spain' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Taiwan'
]) AS r WHERE name = 'Taiwan' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'England',
    'Northern Ireland',
    'Scotland',
    'Wales'
]) AS r WHERE name = 'United Kingdom' ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Alabama',
    'Alaska',
    'Arizona',
    'Arkansas',
    'California',
    'Colorado',
    'Connecticut',
    'Delaware',
    'District of Columbia',
    'Florida',
    'Georgia',
    'Hawaii',
    'Idaho',
    'Illinois',
    'Indiana',
    'Iowa',
    'Kansas',
    'Kentucky',
    'Louisiana',
    'Maine',
    'Maryland',
    'Massachusetts',
    'Michigan',
    'Minnesota',
    'Mississippi',
    'Missouri',
    'Montana',
    'Nebraska',
    'Nevada',
    'New Hampshire',
    'New Jersey',
    'New Mexico',
    'New York',
    'North Carolina',
    'North Dakota',
    'Ohio',
    'Oklahoma',
    'Oregon',
    'Pennsylvania',
    'Rhode Island',
    'South Carolina',
    'South Dakota',
    'Tennessee',
    'Texas',
    'Utah',
    'Vermont',
    'Virginia',
    'Washington',
    'West Virginia',
    'Wisconsin',
    'Wyoming'
]) AS r WHERE name = 'United States' ON CONFLICT (country_id, name) DO NOTHING;

COMMIT;
