import type { PropertyTypeKey } from '@/types/domain';
import { hashSeed } from './random';
import type { MarketFlavour } from './flavour';
import { MAX_PER_NEIGHBOURHOOD } from './geography/types';

/**
 * Building names for sample properties.
 *
 * Invented, from generic words — trees, materials, weather, landforms — in the
 * naming conventions each market actually uses: "Iroko Court" in Lagos,
 * "Lindenhof" in Berlin, "Résidence les Tilleuls" in Lyon, "Neem Residency" in
 * Pune. None is taken from a listing, a developer or a map, and none carries a
 * person's name, so no sample property is presented as a real building or as
 * belonging to anybody.
 *
 * UNIQUE BY CONSTRUCTION
 *
 * Two active sample properties in one city may not share a name (0052's
 * `properties_demo_address_unique`). Rather than draw a name and retry on a
 * clash — which makes a property's name depend on every property generated
 * before it — each property owns a slot: its neighbourhood's position in the
 * city times `MAX_PER_NEIGHBOURHOOD`, plus its index within the neighbourhood.
 * A fixed permutation per city maps slots onto the space of names. Distinct
 * slots can only produce distinct names, and adding properties never renames
 * one that exists.
 */

interface NameBank {
  /** Distinctive first words. */
  heads: readonly string[];
  /** The kind-of-building word and where it goes. */
  forms: ReadonlyArray<(head: string) => string>;
}

const ENGLISH: NameBank = {
  heads: [
    'Alder', 'Ashgrove', 'Aspen', 'Beacon', 'Beech', 'Birchfield', 'Bramble', 'Brook',
    'Canal', 'Cedar', 'Chalk', 'Chestnut', 'Clover', 'Copper', 'Cotton', 'Cygnet',
    'Elder', 'Elm', 'Ember', 'Fairfield', 'Fern', 'Flint', 'Foundry', 'Garnet',
    'Granary', 'Hawthorn', 'Hazel', 'Heron', 'Holly', 'Ivy', 'Juniper', 'Kestrel',
    'Kiln', 'Lark', 'Laurel', 'Linden', 'Lumen', 'Maple', 'Marlowe', 'Meadow',
    'Millbrook', 'Moss', 'Northgate', 'Oakridge', 'Orchard', 'Osprey', 'Pembury', 'Pinewood',
    'Quarry', 'Quill', 'Redbrick', 'Ridgeway', 'Rowan', 'Saddler', 'Sable', 'Slate',
    'Sorrel', 'Southbank', 'Spruce', 'Stonegate', 'Sycamore', 'Tannery', 'Teasel', 'Thistle',
    'Timber', 'Vale', 'Weaver', 'Wharfside', 'Whitethorn', 'Willow', 'Windmill', 'Wren',
  ],
  forms: [
    (h) => `${h} Court`,
    (h) => `${h} House`,
    (h) => `${h} Place`,
    (h) => `${h} Apartments`,
    (h) => `${h} Mansions`,
    (h) => `${h} Lofts`,
    (h) => `${h} Works`,
    (h) => `${h} Terrace`,
    (h) => `${h} Point`,
    (h) => `${h} Yard`,
    (h) => `${h} Residences`,
    (h) => `${h} Gardens`,
    (h) => `${h} Heights`,
    (h) => `${h} Row`,
    (h) => `${h} Lodge`,
    (h) => `${h} Buildings`,
    (h) => `${h} Wharf`,
    (h) => `${h} Hall`,
    (h) => `The ${h}`,
    (h) => `${h} Studios`,
    (h) => `${h} Mews`,
    (h) => `${h} View`,
    (h) => `${h} Rise`,
    (h) => `${h} Quarter`,
    (h) => `${h} Walk`,
  ],
};

const NIGERIAN: NameBank = {
  heads: [
    'Iroko', 'Baobab', 'Harmattan', 'Savanna', 'Mahogany', 'Ebony', 'Obeche', 'Shea',
    'Palmview', 'Coral', 'Emerald', 'Sapphire', 'Amber', 'Onyx', 'Ivory', 'Crystal',
    'Unity', 'Heritage', 'Pinnacle', 'Summit', 'Horizon', 'Sunrise', 'Serenity', 'Tranquil',
    'Goldcrest', 'Silverbird', 'Kingfisher', 'Egret', 'Hornbill', 'Weaverbird', 'Sunbird', 'Eagle',
    'Cedarwood', 'Tamarind', 'Mango', 'Cashew', 'Almond', 'Orchid', 'Hibiscus', 'Jasmine',
    'Lily', 'Magnolia', 'Frangipani', 'Bougainvillea', 'Acacia', 'Cypress', 'Juniper', 'Rosewood',
    'Riverside', 'Hillcrest', 'Greenfield', 'Parkside', 'Brookside', 'Lakeview', 'Crescent', 'Meadow',
    'Oakwood', 'Pinewood', 'Royal', 'Regal', 'Crown', 'Diamond', 'Pearl', 'Topaz',
  ],
  forms: [
    (h) => `${h} Court`,
    (h) => `${h} Apartments`,
    (h) => `${h} Gardens`,
    (h) => `${h} Terraces`,
    (h) => `${h} House`,
    (h) => `${h} Residences`,
    (h) => `${h} Villa`,
    (h) => `${h} Heights`,
    (h) => `${h} Place`,
    (h) => `${h} Towers`,
    (h) => `${h} Mansion`,
    (h) => `${h} Suites`,
    (h) => `${h} Homes`,
    (h) => `${h} Lodge`,
    (h) => `${h} Close Apartments`,
    (h) => `${h} Point`,
    (h) => `${h} View`,
    (h) => `${h} Flats`,
    (h) => `${h} Haven`,
    (h) => `${h} Plaza Residences`,
    (h) => `${h} Duplexes`,
    (h) => `${h} Hall`,
    (h) => `${h} Annex`,
    (h) => `${h} Row`,
    (h) => `${h} Chambers`,
    (h) => `${h} Retreat`,
    (h) => `${h} Enclave`,
    (h) => `${h} Square`,
  ],
};

const GERMAN: NameBank = {
  heads: [
    'Linden', 'Kastanien', 'Ahorn', 'Birken', 'Eichen', 'Buchen', 'Erlen', 'Weiden',
    'Ulmen', 'Eschen', 'Holunder', 'Flieder', 'Rosen', 'Tulpen', 'Nelken', 'Mohn',
    'Sonnen', 'Mond', 'Stern', 'Wolken', 'Regen', 'Wind', 'Nebel', 'Morgen',
    'Kanal', 'Brunnen', 'Mühlen', 'Brücken', 'Hafen', 'Speicher', 'Ziegel', 'Kupfer',
    'Glas', 'Eisen', 'Stein', 'Sand', 'Wiesen', 'Garten', 'Park', 'Hügel',
    'Falken', 'Lerchen', 'Schwalben', 'Kranich', 'Reiher', 'Eulen', 'Finken', 'Meisen',
  ],
  forms: [
    (h) => `${h}hof`,
    (h) => `${h}haus`,
    (h) => `${h}höfe`,
    (h) => `${h}carré`,
    (h) => `Wohnpark ${h}`,
    (h) => `Haus ${h}`,
    (h) => `${h}quartier`,
    (h) => `${h}palais`,
    (h) => `${h}terrassen`,
    (h) => `${h}blick`,
    (h) => `${h}werk`,
    (h) => `${h}loft`,
  ],
};

const DUTCH: NameBank = {
  heads: [
    'Linde', 'Kastanje', 'Esdoorn', 'Berk', 'Eik', 'Beuk', 'Wilg', 'Iep',
    'Zwaluw', 'Reiger', 'Meeuw', 'Kievit', 'Merel', 'Lijster', 'Kraai', 'Specht',
    'Tulp', 'Roos', 'Anjer', 'Iris', 'Lelie', 'Klaproos', 'Madelief', 'Zonnebloem',
    'Molen', 'Brug', 'Sluis', 'Gracht', 'Dijk', 'Haven', 'Kade', 'Werf',
    'Zon', 'Maan', 'Ster', 'Wolk', 'Wind', 'Duin', 'Polder', 'Weide',
  ],
  forms: [
    (h) => `De ${h}`,
    (h) => `${h}hof`,
    (h) => `${h}huis`,
    (h) => `Residentie ${h}`,
    (h) => `${h}staete`,
    (h) => `${h}poort`,
    (h) => `${h}hoeve`,
    (h) => `Het ${h}huys`,
    (h) => `${h}flat`,
    (h) => `${h}park`,
    (h) => `${h}toren`,
  ],
};

const FRENCH: NameBank = {
  heads: [
    'les Tilleuls', 'les Platanes', 'les Marronniers', 'les Acacias', 'les Cèdres', 'les Pins', 'les Chênes', 'les Érables',
    'les Lilas', 'les Glycines', 'les Mimosas', 'les Iris', 'les Lavandes', 'les Roses', 'les Jasmins', 'les Magnolias',
    'du Parc', 'du Canal', 'du Moulin', 'de la Fontaine', 'du Belvédère', 'des Jardins', 'des Vignes', 'du Verger',
    'du Soleil', "de l'Aube", 'des Alizés', 'du Mistral', 'des Étoiles', 'de la Source', 'des Coteaux', 'du Val',
    'Saint-Clair', 'Beausoleil', 'Bellevue', 'Montplaisir', 'Belair', 'Clairefontaine', 'Mirabeau', 'Florian',
  ],
  forms: [
    (h) => `Résidence ${h}`,
    (h) => `Le Clos ${h}`,
    (h) => `Les Terrasses ${h}`,
    (h) => `Villa ${h}`,
    (h) => `Le Carré ${h}`,
    (h) => `L'Orée ${h}`,
    (h) => `Les Jardins ${h}`,
    (h) => `Le Domaine ${h}`,
    (h) => `Les Hauts ${h}`,
    (h) => `Le Patio ${h}`,
  ],
};

const SOUTHERN_AFRICAN: NameBank = {
  heads: [
    'Protea', 'Jacaranda', 'Yellowwood', 'Fynbos', 'Karoo', 'Aloe', 'Marula', 'Stinkwood',
    'Acacia', 'Baobab', 'Kiaat', 'Wild Olive', 'Coral Tree', 'Strelitzia', 'Agapanthus', 'Clivia',
    'Sunbird', 'Hadeda', 'Hornbill', 'Weaver', 'Kingfisher', 'Oriole', 'Loerie', 'Egret',
    'Highveld', 'Seaview', 'Mountainview', 'Ridge', 'Kloof', 'Vlei', 'Koppie', 'Ravine',
    'Amber', 'Ironstone', 'Sandstone', 'Granite', 'Quartz', 'Flint', 'Garnet', 'Onyx',
    'Summit', 'Horizon', 'Parkside', 'Lakeside', 'Riverside', 'Hillcrest', 'Oakdene', 'Beechwood',
  ],
  forms: [
    (h) => `${h} Court`,
    (h) => `${h} Mansions`,
    (h) => `${h} Place`,
    (h) => `${h} Gardens`,
    (h) => `${h} Village`,
    (h) => `${h} Estate Apartments`,
    (h) => `${h} Heights`,
    (h) => `${h} House`,
    (h) => `${h} Lofts`,
    (h) => `${h} Terraces`,
    (h) => `${h} Manor`,
    (h) => `${h} Views`,
    (h) => `${h} Close`,
    (h) => `${h} Residences`,
    (h) => `${h} Villas`,
    (h) => `${h} Square`,
  ],
};

const GULF: NameBank = {
  heads: [
    'Sidra', 'Ghaf', 'Samar', 'Yasmin', 'Warda', 'Noor', 'Sahab', 'Bahar',
    'Nakhla', 'Rimth', 'Arfaj', 'Qamar', 'Najma', 'Shams', 'Hilal', 'Burhan',
    'Mawj', 'Sahel', 'Khor', 'Wadi', 'Rawda', 'Bustan', 'Janna', 'Zahra',
    'Lulu Al Bahr', 'Dana', 'Marjan Al Sahil', 'Fairouz', 'Zumurud', 'Yaqoot', 'Almas', 'Fidda',
    'Oasis', 'Dune', 'Palm', 'Falcon', 'Pearl', 'Coral', 'Harbour', 'Skyline',
  ],
  forms: [
    (h) => `${h} Residence`,
    (h) => `${h} Tower`,
    (h) => `${h} Heights`,
    (h) => `${h} Court`,
    (h) => `${h} Building`,
    (h) => `${h} Apartments`,
    (h) => `${h} Views`,
    (h) => `${h} Gardens`,
    (h) => `${h} Suites`,
    (h) => `${h} Plaza`,
    (h) => `${h} Villas`,
    (h) => `${h} Point`,
  ],
};

const INDIAN: NameBank = {
  heads: [
    'Neem', 'Gulmohar', 'Tulsi', 'Lotus', 'Kamal', 'Champa', 'Mogra', 'Chameli',
    'Ashoka Tree', 'Banyan', 'Peepal', 'Silver Oak', 'Palash', 'Amaltas', 'Kadamba', 'Parijat',
    'Sapphire', 'Emerald', 'Ruby', 'Pearl', 'Coral', 'Topaz', 'Crystal', 'Diamond',
    'Sunrise', 'Sunshine', 'Moonlight', 'Starlight', 'Rainbow', 'Horizon', 'Skyline', 'Harmony',
    'Shanti', 'Anand', 'Sukh', 'Sampada', 'Samriddhi', 'Prakriti', 'Vasundhara', 'Aakash',
    'Green Valley', 'Palm Grove', 'Lake View', 'Hill View', 'River Side', 'Park View', 'Garden City', 'Orchid',
  ],
  forms: [
    (h) => `${h} Residency`,
    (h) => `${h} Heights`,
    (h) => `${h} Apartments`,
    (h) => `${h} Enclave`,
    (h) => `${h} Towers`,
    (h) => `${h} Nest`,
    (h) => `${h} Homes`,
    (h) => `${h} Villa`,
    (h) => `${h} Court`,
    (h) => `${h} Arcade`,
    (h) => `${h} Paradise`,
    (h) => `${h} Classic`,
    (h) => `${h} Elite`,
    (h) => `${h} Plaza`,
    (h) => `${h} Gardens`,
    (h) => `${h} Mansion`,
  ],
};

const BANKS: Record<MarketFlavour['nameStyle'], NameBank> = {
  english: ENGLISH,
  nigerian: NIGERIAN,
  german: GERMAN,
  dutch: DUTCH,
  french: FRENCH,
  'southern-african': SOUTHERN_AFRICAN,
  gulf: GULF,
  indian: INDIAN,
};

/** How many distinct names a style can produce in one city. */
export function nameSpace(style: MarketFlavour['nameStyle']): number {
  const bank = BANKS[style];
  return bank.heads.length * bank.forms.length;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * The name for a slot in a city.
 *
 * `(multiplier × slot + offset) mod size` with a multiplier coprime to the
 * size is a bijection on [0, size), so distinct slots give distinct names. The
 * multiplier and offset come from the city, so Lagos and Abuja order their
 * names differently and neighbouring slots do not read as a sequence.
 */
export function buildingName(
  style: MarketFlavour['nameStyle'],
  cityKey: string,
  slot: number,
): string {
  const bank = BANKS[style];
  const size = bank.heads.length * bank.forms.length;
  if (slot >= size) {
    throw new Error(
      `Name space exhausted for ${cityKey}: slot ${slot} of ${size}. Add words to the ${style} bank.`,
    );
  }

  const hash = hashSeed(`names:${cityKey}`);
  let multiplier = 7 + (hash % Math.max(1, size - 7));
  while (gcd(multiplier, size) !== 1) multiplier += 1;
  const offset = hashSeed(`offset:${cityKey}`) % size;

  const index = (multiplier * slot + offset) % size;
  const head = bank.heads[Math.floor(index / bank.forms.length)]!;
  const form = bank.forms[index % bank.forms.length]!;

  return form(head);
}

const MULTI_UNIT_NAME =
  /\b(Apartments|Towers?|Flats|Suites|Mansions|Lofts|Studios|Residences?|Residency|Heights|Buildings?|Plaza|Chambers|Arcade|Duplexes|Enclave|flat|toren|loft|palais|quartier|carré)\b/i;

/**
 * Whether a name could belong to a single dwelling. "Cedar Towers" cannot be a
 * detached house; the generator changes the property's type rather than its
 * name, because the name is what keeps it unique.
 */
export function nameSuitsSingleDwelling(name: string): boolean {
  return !MULTI_UNIT_NAME.test(name);
}

/** The property types that are one household in one dwelling. */
export const SINGLE_DWELLING: ReadonlySet<PropertyTypeKey> = new Set([
  'house',
  'bungalow',
  'townhouse',
]);

/** The slot a property occupies in its city. See the file comment. */
export function slotFor(neighbourhoodIndex: number, indexInNeighbourhood: number): number {
  return neighbourhoodIndex * MAX_PER_NEIGHBOURHOOD + indexInNeighbourhood;
}
