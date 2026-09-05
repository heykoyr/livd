-- ===========================================================================
-- Livd — 0001 · Foundation
--
-- Extensions, enumerated types, reference tables and the identity table.
--
-- Reference tables hold what differs between markets: address structure, the
-- word a country uses for its subdivisions, which review categories apply
-- where. That is deliberate — adding a country is a data change, never a code
-- branch, which is the property that keeps Livd genuinely global rather than
-- one market with special cases bolted on.
-- ===========================================================================

create extension if not exists "pgcrypto";     -- gen_random_uuid()
create extension if not exists "pg_trgm";      -- typo-tolerant search
create extension if not exists "unaccent";     -- accent-insensitive matching

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type property_status   as enum ('active', 'pending_review', 'merged', 'removed');
create type residency_status  as enum ('current', 'former');
create type verification_level as enum ('unverified', 'verified_resident', 'disputed');
create type review_status     as enum ('published', 'pending_moderation', 'held', 'removed');
create type rent_period       as enum ('month', 'year');
create type user_role         as enum ('resident', 'owner', 'moderator', 'admin');
create type user_status       as enum ('active', 'restricted', 'suspended');
create type report_reason     as enum (
  'inappropriate', 'false_information', 'privacy', 'spam',
  'harassment', 'not_a_resident', 'other'
);
create type report_status     as enum ('open', 'under_review', 'upheld', 'dismissed');
create type claim_status      as enum ('pending', 'approved', 'rejected', 'revoked');
create type claim_role        as enum ('owner', 'manager', 'agent');
create type tag_polarity      as enum ('positive', 'problem');

-- ---------------------------------------------------------------------------
-- Shared trigger
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reference: countries and currencies
-- ---------------------------------------------------------------------------

create table currencies (
  code        char(3) primary key,
  name        text        not null,
  minor_unit  smallint    not null default 2,
  symbol      text
);

create table countries (
  code             char(2) primary key,
  name             text        not null,
  default_currency char(3)     not null references currencies(code),
  locale           text        not null default 'en',
  -- Token template; a line whose tokens all resolve empty is dropped when rendered.
  address_format   text        not null,
  region_label     text        not null default 'Region',
  locality_label   text        not null default 'City',
  postal_code_label text       not null default 'Postal code',
  uses_postal_code boolean     not null default true,
  is_active        boolean     not null default true
);

insert into currencies (code, name, minor_unit, symbol) values
  ('USD', 'US Dollar', 2, '$'),
  ('GBP', 'Pound Sterling', 2, '£'),
  ('EUR', 'Euro', 2, '€'),
  ('NGN', 'Nigerian Naira', 2, '₦'),
  ('CAD', 'Canadian Dollar', 2, '$'),
  ('AUD', 'Australian Dollar', 2, '$'),
  ('ZAR', 'South African Rand', 2, 'R'),
  ('AED', 'UAE Dirham', 2, 'د.إ'),
  ('INR', 'Indian Rupee', 2, '₹');

insert into countries
  (code, name, default_currency, locale, address_format, region_label, locality_label, postal_code_label, uses_postal_code)
values
  ('US', 'United States', 'USD', 'en-US', E'{buildingName}\n{streetAddress}\n{locality}, {adminArea} {postalCode}', 'State', 'City', 'ZIP code', true),
  ('GB', 'United Kingdom', 'GBP', 'en-GB', E'{buildingName}\n{streetAddress}\n{locality}\n{postalCode}', 'County', 'Town or city', 'Postcode', true),
  ('NG', 'Nigeria', 'NGN', 'en-NG', E'{buildingName}\n{streetAddress}\n{neighbourhood}\n{locality}, {adminArea}', 'State', 'City', 'Postal code', false),
  ('CA', 'Canada', 'CAD', 'en-CA', E'{buildingName}\n{streetAddress}\n{locality}, {adminArea} {postalCode}', 'Province', 'City', 'Postal code', true),
  ('AU', 'Australia', 'AUD', 'en-AU', E'{buildingName}\n{streetAddress}\n{locality} {adminArea} {postalCode}', 'State', 'Suburb', 'Postcode', true),
  ('IE', 'Ireland', 'EUR', 'en-IE', E'{buildingName}\n{streetAddress}\n{locality}\n{adminArea}\n{postalCode}', 'County', 'Town or city', 'Eircode', true),
  ('DE', 'Germany', 'EUR', 'de-DE', E'{buildingName}\n{streetAddress}\n{postalCode} {locality}', 'State', 'City', 'Postal code', true),
  ('NL', 'Netherlands', 'EUR', 'nl-NL', E'{buildingName}\n{streetAddress}\n{postalCode} {locality}', 'Province', 'City', 'Postcode', true),
  ('FR', 'France', 'EUR', 'fr-FR', E'{buildingName}\n{streetAddress}\n{postalCode} {locality}', 'Region', 'City', 'Postal code', true),
  ('ZA', 'South Africa', 'ZAR', 'en-ZA', E'{buildingName}\n{streetAddress}\n{neighbourhood}\n{locality}\n{postalCode}', 'Province', 'City', 'Postal code', true),
  ('AE', 'United Arab Emirates', 'AED', 'en-AE', E'{buildingName}\n{streetAddress}\n{neighbourhood}\n{locality}', 'Emirate', 'City', 'PO Box', false),
  ('IN', 'India', 'INR', 'en-IN', E'{buildingName}\n{streetAddress}\n{neighbourhood}\n{locality}, {adminArea} {postalCode}', 'State', 'City', 'PIN code', true);

-- ---------------------------------------------------------------------------
-- Reference: property types
--
-- One underlying type, per-market labels — so the same record renders as
-- "flat" in the UK and "apartment" in the US without duplicating the data.
-- ---------------------------------------------------------------------------

create table property_type_defs (
  key        text primary key,
  base_label text not null,
  sort_order int  not null default 0,
  is_active  boolean not null default true
);

insert into property_type_defs (key, base_label, sort_order) values
  ('apartment', 'Apartment', 10),
  ('house',     'House',     20),
  ('townhouse', 'Townhouse', 30),
  ('duplex',    'Duplex',    40),
  ('studio',    'Studio',    50),
  ('shared',    'Shared home', 60),
  ('room',      'Room',      70),
  ('bungalow',  'Bungalow',  80),
  ('building',  'Building',  90);

create table property_type_labels (
  type_key     text    not null references property_type_defs(key) on delete cascade,
  country_code char(2) not null references countries(code) on delete cascade,
  label        text    not null,
  primary key (type_key, country_code)
);

insert into property_type_labels (type_key, country_code, label) values
  ('apartment', 'GB', 'Flat'),
  ('shared',    'GB', 'Houseshare'),
  ('townhouse', 'GB', 'Terraced house'),
  ('duplex',    'GB', 'Maisonette'),
  ('apartment', 'IN', 'Flat'),
  ('shared',    'IN', 'Shared flat'),
  ('shared',    'AU', 'Sharehouse'),
  ('duplex',    'CA', 'Condo'),
  ('shared',    'DE', 'Shared flat'),
  ('shared',    'NL', 'Shared house');

-- ---------------------------------------------------------------------------
-- Reference: review categories
--
-- `weight` is the category's contribution to the Livd Score. `applies_to_countries`
-- null means globally relevant.
-- ---------------------------------------------------------------------------

create table review_category_defs (
  key                  text primary key,
  label                text    not null,
  description          text    not null,
  prompt               text    not null,
  is_core              boolean not null default false,
  weight               numeric(4,2) not null default 1.00 check (weight > 0),
  applies_to_countries char(2)[],
  sort_order           int     not null default 0
);

insert into review_category_defs (key, label, description, prompt, is_core, weight, applies_to_countries, sort_order) values
  ('building_maintenance', 'Building & maintenance', 'Condition of the building and how quickly repairs get done', 'How well was the building maintained, and how quickly were repairs handled?', true, 1.35, null, 10),
  ('management',           'Management & landlord',  'Responsiveness, fairness and how issues were handled',        'How was the landlord or property manager to deal with?',                   true, 1.35, null, 20),
  ('value',                'Value for money',        'What you got for the rent you paid',                          'Was the rent fair for what you got?',                                      true, 1.15, null, 30),
  ('safety',               'Safety & security',      'How safe the building and immediate area felt',               'How safe did the building and the immediate area feel?',                   true, 1.25, null, 40),
  ('noise',                'Noise',                  'Sound from neighbours, traffic and the surrounding area',     'How quiet was it, day and night?',                                         true, 1.00, null, 50),
  ('utilities',            'Utilities & services',   'Reliability of the essential services the home depends on',   'How reliable were the essential services — water, power, heating?',        true, 1.20, null, 60),
  ('neighbours',           'Neighbours & community', 'What the people around you were like to live alongside',      'What was it like living alongside the other residents?',                   true, 0.90, null, 70),
  ('location',             'Location & transport',   'Getting around, and what is within reach day to day',         'How was the location for getting around and day-to-day needs?',            true, 1.00, null, 80),
  ('water_supply',         'Water supply',           'Availability, pressure and quality of water',                 'How reliable was the water supply?',                                       false, 1.10, '{NG,ZA,IN,AE}', 100),
  ('power_reliability',    'Power reliability',      'How often the electricity supply failed, and backup provision','How reliable was the electricity supply?',                                false, 1.10, '{NG,ZA,IN}', 110),
  ('heating_cooling',      'Heating & cooling',      'Keeping the home comfortable through the year',               'How well did heating and cooling keep the home comfortable?',              false, 1.00, '{US,GB,CA,AU,DE,NL,FR,IE,AE}', 120),
  ('damp_mould',           'Damp & mould',           'Moisture problems affecting the home',                        'Were there problems with damp, condensation or mould?',                    false, 1.05, '{GB,IE,NL,DE,FR,AU,ZA}', 130),
  ('internet',             'Internet & connectivity','Broadband and mobile signal in the home',                     'How was internet and mobile signal inside the home?',                      false, 0.85, null, 140),
  ('cleanliness',          'Cleanliness & waste',    'Shared areas, bins and general upkeep',                       'How clean and well kept were the shared areas and bin facilities?',        false, 0.90, null, 150),
  ('parking',              'Parking',                'Availability and security of parking',                        'How was parking — availability, cost and security?',                       false, 0.70, null, 160),
  ('accessibility',        'Accessibility',          'Step-free access, lifts and getting around the building',     'How accessible was the building — entrances, lifts, stairs?',              false, 0.80, null, 170),
  ('drainage',             'Drainage & flooding',    'How the property handles heavy rain',                         'Did the property have drainage or flooding problems in heavy rain?',       false, 1.05, '{NG,IN,ZA,US,AU}', 180),
  ('pests',                'Pests',                  'Infestations and how they were dealt with',                   'Were there pest problems, and were they dealt with?',                      false, 1.00, null, 190),
  ('natural_light',        'Natural light & ventilation', 'Daylight and airflow through the home',                  'How was natural light and ventilation in the home?',                       false, 0.75, null, 200),
  ('laundry',              'Laundry',                'In-home or shared laundry provision',                         'How was the laundry provision?',                                           false, 0.60, '{US,CA,AU,GB}', 210),
  ('bike_storage',         'Bike storage',           'Secure space for bicycles',                                    'How was secure bike storage?',                                             false, 0.55, '{NL,DE,GB,DK}', 220);

-- ---------------------------------------------------------------------------
-- Reference: departure reasons
--
-- `is_property_related` separates what the property caused from what the
-- resident's life caused. A building everyone left because they bought a house
-- is not a bad building, and the aggregate must never imply that it is.
--
-- `is_sensitive` reasons are counted but never rendered as a headline statistic
-- against a specific address.
-- ---------------------------------------------------------------------------

create table departure_reason_defs (
  key                 text primary key,
  label               text    not null,
  phrase              text    not null,
  is_property_related boolean not null default true,
  is_sensitive        boolean not null default false,
  related_category    text references review_category_defs(key),
  sort_order          int     not null default 0
);

insert into departure_reason_defs (key, label, phrase, is_property_related, is_sensitive, related_category, sort_order) values
  ('rent_increase',    'Rent increase',                 'a rent increase',             true,  false, 'value', 10),
  ('maintenance',      'Maintenance and repairs',       'unresolved maintenance',      true,  false, 'building_maintenance', 20),
  ('management',       'Landlord or management',        'problems with management',    true,  false, 'management', 30),
  ('utilities',        'Utilities and services',        'unreliable utilities',        true,  false, 'utilities', 40),
  ('noise',            'Noise',                         'noise',                       true,  false, 'noise', 50),
  ('safety',           'Safety or security concerns',   'safety concerns',             true,  true,  'safety', 60),
  ('neighbours',       'Neighbours',                    'problems with neighbours',    true,  true,  'neighbours', 70),
  ('condition',        'Condition of the home',         'the condition of the home',   true,  false, 'building_maintenance', 80),
  ('space',            'Needed more or less space',     'needing different space',     false, false, null, 90),
  ('deposit_dispute',  'Deposit or contract dispute',   'a deposit or contract dispute', true, false, 'management', 100),
  ('lease_ended',      'Lease ended or was not renewed','the lease ending',            true,  false, null, 110),
  ('relocation',       'Moved city or country',         'relocating',                  false, false, null, 120),
  ('work_study',       'Work or study change',          'a change of work or study',   false, false, null, 130),
  ('life_change',      'Personal or household change',  'a change in circumstances',   false, false, null, 140),
  ('bought_home',      'Bought a home',                 'buying a home',               false, false, null, 150),
  ('commute',          'Commute or location',           'the commute',                 true,  false, 'location', 160),
  ('other',            'Something else',                'other reasons',               false, false, null, 999);

-- ---------------------------------------------------------------------------
-- Reference: tags
-- ---------------------------------------------------------------------------

create table review_tag_defs (
  key          text primary key,
  label        text          not null,
  polarity     tag_polarity  not null,
  category_key text references review_category_defs(key),
  sort_order   int           not null default 0
);

insert into review_tag_defs (key, label, polarity, category_key, sort_order) values
  ('responsive_repairs',      'Repairs handled quickly',        'positive', 'building_maintenance', 10),
  ('fair_landlord',           'Fair, straightforward landlord', 'positive', 'management', 20),
  ('deposit_returned',        'Deposit returned in full',       'positive', 'management', 30),
  ('good_value',              'Good value for the rent',        'positive', 'value', 40),
  ('feels_safe',              'Felt safe',                      'positive', 'safety', 50),
  ('quiet',                   'Quiet',                          'positive', 'noise', 60),
  ('good_light',              'Lots of natural light',          'positive', 'natural_light', 70),
  ('well_connected',          'Well connected for transport',   'positive', 'location', 80),
  ('friendly_neighbours',     'Good neighbours',                'positive', 'neighbours', 90),
  ('clean_shared_areas',      'Shared areas kept clean',        'positive', 'cleanliness', 100),
  ('reliable_utilities',      'Reliable utilities',             'positive', 'utilities', 110),
  ('good_storage',            'Plenty of storage',              'positive', null, 120),
  ('outdoor_space',           'Usable outdoor space',           'positive', null, 130),
  ('good_internet',           'Fast, reliable internet',        'positive', 'internet', 140),
  ('secure_entry',            'Secure entry',                   'positive', 'safety', 150),
  ('easy_parking',            'Easy parking',                   'positive', 'parking', 160),
  ('step_free',               'Step-free access',               'positive', 'accessibility', 170),
  ('slow_repairs',            'Repairs took a long time',       'problem', 'building_maintenance', 200),
  ('unresponsive_management', 'Hard to get hold of management', 'problem', 'management', 210),
  ('deposit_withheld',        'Problems getting the deposit back', 'problem', 'management', 220),
  ('unexpected_charges',      'Unexpected charges',             'problem', 'value', 230),
  ('steep_rent_rises',        'Steep rent increases',           'problem', 'value', 240),
  ('noise_neighbours',        'Noise through walls or floors',  'problem', 'noise', 250),
  ('noise_street',            'Street or traffic noise',        'problem', 'noise', 260),
  ('damp_mould',              'Damp or mould',                  'problem', 'damp_mould', 270),
  ('cold_in_winter',          'Hard to keep warm',              'problem', 'heating_cooling', 280),
  ('hot_in_summer',           'Hard to keep cool',              'problem', 'heating_cooling', 290),
  ('water_interruptions',     'Water interruptions',            'problem', 'water_supply', 300),
  ('power_cuts',              'Frequent power cuts',            'problem', 'power_reliability', 310),
  ('pests',                   'Pests',                          'problem', 'pests', 320),
  ('poor_security',           'Security felt inadequate',       'problem', 'safety', 330),
  ('dirty_shared_areas',      'Shared areas poorly kept',       'problem', 'cleanliness', 340),
  ('waste_issues',            'Bin and waste problems',         'problem', 'cleanliness', 350),
  ('plumbing',                'Recurring plumbing problems',    'problem', 'building_maintenance', 360),
  ('weak_internet',           'Poor internet or signal',        'problem', 'internet', 370),
  ('parking_difficult',       'Parking was difficult',          'problem', 'parking', 380),
  ('flooding',                'Flooding or drainage problems',  'problem', 'drainage', 390),
  ('lift_outages',            'Lift frequently out of service', 'problem', 'accessibility', 400),
  ('dark_rooms',              'Rooms felt dark',                'problem', 'natural_light', 410),
  ('small_space',             'Smaller than it looked',         'problem', null, 420);

-- ---------------------------------------------------------------------------
-- Identity
--
-- Note what is absent: no name, no phone, no address. There is nothing here to
-- leak because nothing beyond an email and a country is ever collected.
-- ---------------------------------------------------------------------------

create table profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  role             user_role   not null default 'resident',
  status           user_status not null default 'active',
  country_code     char(2) references countries(code),
  preferred_locale text        not null default 'en',
  reputation       int         not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- Every authenticated user gets a profile row automatically.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
