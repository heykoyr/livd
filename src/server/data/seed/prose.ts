import type { CategoryRating, PropertyTypeKey, ResidencyStatus } from '@/types/domain';
import type { MarketFlavour } from './flavour';
import { pick, pickSome } from './random';

/**
 * Review prose for sample data.
 *
 * A body is assembled from the categories its resident actually rated well or
 * badly, so the words agree with the numbers beside them: a review that gives
 * maintenance a one says so, and one that gives it a five does not complain
 * about repairs. Around that sit an optional line of context, a trade-off
 * connector where the ratings pull both ways, occasional advice, and a
 * closing verdict — in three lengths, so a property page reads like several
 * people rather than one template.
 *
 * WHAT THE TEXT MUST NEVER CONTAIN
 *
 * It passes the same content linter real submissions do, and the seed test
 * holds every generated body to that. Concretely:
 *
 *   - no digits at all — a number after "flat" or "room" is a unit number;
 *   - no person, no company, no landlord or building that exists;
 *   - no word the linter reads as contact details ("signal" is a messaging
 *     app to it, so phone coverage is "reception");
 *   - nothing capitalised straight after a role word ("the agent", "the
 *     owner"), which reads as a name.
 *
 * TEMPLATES
 *
 *   {token}     market vocabulary: {home} {building} {lift} {bins} {common}
 *               {neighbours} {manager} {backup} {heating} {cooling} {charges}
 *               {transit}; capitalised ({Manager}) at the start of a sentence
 *   [a|b|c]     one of the alternatives, chosen per review
 *   former: / current:   the line only suits that residency
 */

type Polarity = 'good' | 'bad' | 'mixed';
type Bank = Partial<Record<Polarity, readonly string[]>>;

/* -------------------------------------------------------------------------
 * By category
 * ---------------------------------------------------------------------- */

const CATEGORY_LINES: Record<string, Bank> = {
  building_maintenance: {
    good: [
      'Repairs were handled quickly, usually within a couple of days of reporting them.',
      'Anything that broke got fixed without much chasing, which is rarer than it should be.',
      'The {building} is clearly looked after; the {common} were repainted while I was there.',
      'When [the kitchen tap|a pipe under the sink|the shower] went, someone came out the next morning.',
      'Maintenance is the strong point here. Small jobs get done without a fuss.',
      'The place has been kept in good condition, and it shows.',
      'Nothing major went wrong, and the one thing that did was sorted within the week.',
      'Whoever does the maintenance takes pride in it. Jobs were done properly, not patched.',
    ],
    bad: [
      'Repairs took weeks and usually needed chasing more than once.',
      'The same leak came back [again and again|every few months] and was never properly fixed.',
      'former:The {common} were visibly neglected by the time I left.',
      'Small problems were left until they became big ones.',
      'Getting anything fixed felt like a negotiation.',
      'The [windows|doors|kitchen units] were in poor shape and nothing was done about it.',
      'A broken [{lift}|entry door|stair light] can sit for weeks here.',
      'Repairs were patch jobs; the underlying problem was never dealt with.',
      'current:I have an open repair request that is older than some of my furniture.',
    ],
    mixed: [
      'Maintenance was hit and miss: some things were fixed quickly, others dragged on.',
      'Repairs happen eventually, but you learn to follow up.',
      'The {building} is tired in places, though the basics work.',
    ],
  },
  management: {
    good: [
      '{Manager} actually answers messages, which turned out to be rarer than I expected.',
      'former:The deposit came back in full without any argument.',
      'Rent reviews were reasonable and explained well in advance.',
      'Dealing with {manager} was straightforward from the viewing to the handover.',
      '{Manager} was fair and quick to respond when something came up.',
      'Paperwork was clear, and nothing appeared on a bill without an explanation.',
      'I never had to chase {manager} twice for the same thing.',
    ],
    bad: [
      'Getting a reply from {manager} took days, and often a second message.',
      'Charges appeared that nobody would explain.',
      'former:The deposit took months to come back and needed a formal letter.',
      '{Manager} was friendly at the viewing and hard to reach afterwards.',
      'Promises made before signing were quietly forgotten once I moved in.',
      'Every request turned into a back-and-forth with {manager}.',
      'Communication was poor. Notices about works arrived the day before, when they arrived.',
      'It was never clear who was actually responsible for the {building}.',
    ],
    mixed: [
      '{Manager} was pleasant enough but slow.',
      'Management is fine when things are going well and less so when they are not.',
      'Responsive on small things, harder work on anything that cost money.',
    ],
  },
  value: {
    good: [
      'For what you pay in this area it is good value.',
      'The rent stayed sensible while prices around it went up.',
      'You get more space for the money than most places nearby.',
      'The rent went up once in my time here, and by a fair amount.',
      'Not cheap, but you can see where the money goes.',
    ],
    bad: [
      'The rent rose well beyond what the place was worth.',
      'Once you add the {charges}, it stops being competitive for the area.',
      'You are paying for the address more than the {home}.',
      'Every renewal came with an increase that was hard to justify.',
      'Expensive for what it is, especially next to newer places nearby.',
    ],
    mixed: [
      'The rent is on the high side, though not unusual for the area.',
      'Fair value to begin with; less so after the last increase.',
    ],
  },
  safety: {
    good: [
      'I came home late often and never felt uneasy on the street or at the entrance.',
      'Entry is properly controlled and the lighting outside is good.',
      'It feels safe. People are around at most hours and the entrance is secure.',
      'Parcels left downstairs were still there when I got home.',
    ],
    bad: [
      'The main door lock was broken for long stretches and anyone could walk in.',
      'The lighting at the entrance was out for months.',
      "I didn't feel comfortable walking back from {transit} after dark.",
      'There were a couple of break-ins in the {building} while I lived there.',
    ],
    mixed: [
      'The {building} itself feels secure; the street outside less so after dark.',
      "Safe enough, but I wouldn't leave anything valuable in a car.",
    ],
  },
  noise: {
    good: [
      'Surprisingly quiet for how central it is. You rarely hear the {neighbours}.',
      'The walls are thicker than they look and traffic noise never carried up.',
      'Quiet at night, which mattered more to me than I expected.',
      "You forget you're in the city once the windows are shut.",
    ],
    bad: [
      'You hear everything through the floors: footsteps, conversations, all of it.',
      'Traffic noise from the main road carries straight into the bedroom.',
      'Weekend noise from nearby venues made sleeping difficult.',
      'Construction next door went on for most of my tenancy.',
      "Thin walls. I knew my {neighbours}' routines better than my own.",
    ],
    mixed: [
      'Mostly quiet, apart from the odd loud weekend.',
      'Street noise is there, but you stop noticing it after a while.',
    ],
  },
  utilities: {
    good: [
      'Water, power and hot water all just worked.',
      'Bills were reasonable for the size of the place.',
      'Utilities were never something I had to think about here.',
    ],
    bad: [
      'Service interruptions were frequent enough that you learned to plan around them.',
      'Hot water was unreliable: some mornings fine, others barely lukewarm.',
      'Something was always off, whether it was the water pressure or the hot water.',
    ],
    mixed: ['Utilities are fine most of the time, with the occasional bad week.'],
  },
  neighbours: {
    good: [
      'The other residents are friendly without being in your business.',
      "People hold doors and take in parcels, which sounds small until you live somewhere they don't.",
      "There's a proper sense of community in the {building}.",
      'Good {neighbours} made up for a lot.',
    ],
    bad: [
      'There were ongoing disputes in the {building} that made it uncomfortable.',
      'A few residents treated the {common} as their own storage.',
      'Parties in the {building} went on late with no consideration for anyone else.',
    ],
    mixed: ['Most of the {neighbours} are fine; one or two made life harder than it needed to be.'],
  },
  location: {
    good: [
      'You can walk to almost everything and {transit} is a few minutes away.',
      'The location is the main reason I stayed as long as I did.',
      'Shops, markets and {transit} are all close.',
      'Easy to get anywhere in the city from here.',
    ],
    bad: [
      "It's a long way from anything, and you need a car or a lot of patience.",
      'The commute was the hardest part of living here.',
      'Nothing much within walking distance.',
    ],
    mixed: ['Good for some things, awkward for others. It depends where you need to be.'],
  },
  water_supply: {
    good: [
      'Water ran reliably the entire time I lived there.',
      'Water pressure was strong on every floor.',
      'Clean water every day, which is not a given in this part of town.',
    ],
    bad: [
      'The water supply was unreliable: some weeks fine, others nothing for days.',
      'Pressure dropped to nothing whenever the {building} was busy.',
      'When the pump broke down it was days before water came back.',
    ],
    mixed: ['Water is mostly fine, but there are dry days every so often.'],
  },
  power_reliability: {
    good: [
      'Backup power came on within seconds and covered the whole {home}.',
      'Power was steadier here than anywhere else I have lived in the city.',
      'Between the grid and the {backup}, I rarely lost power for long.',
    ],
    bad: [
      'Power cuts were routine and the {backup} did not cover much.',
      'Outages during the day were common and nothing was ever done about it.',
      'The {backup} was switched off at night to save fuel, whatever the heat.',
    ],
    mixed: ["Power is better than average for the area, which isn't saying much."],
  },
  heating_cooling: {
    good: [
      'The {home} stayed comfortable through the year without the bills getting silly.',
      'Heating and cooling both work properly, which is less common than it should be.',
    ],
    bad: [
      'Keeping the place at a comfortable temperature was a constant fight.',
      'The {home} is freezing in one season and stifling in the other.',
    ],
    mixed: ['Fine in spring and autumn; less so at either extreme.'],
  },
  damp_mould: {
    good: [
      "No damp at all, which I can't say for my last few places.",
      'Well ventilated, and the bathroom dried out properly.',
    ],
    bad: [
      'Damp came back every winter in the same corner no matter what I did.',
      'Mould around the windows was a constant battle.',
      'Condensation on the windows every morning from autumn to spring.',
      'The bathroom ceiling grew mould faster than I could clean it.',
    ],
    mixed: ['A bit of condensation in winter, nothing serious.'],
  },
  internet: {
    good: [
      'Fibre was already installed and it never dropped.',
      'Fast, stable internet. I worked from home without any issues.',
      'Good mobile reception everywhere in the {home}.',
    ],
    bad: [
      'Mobile reception is poor at the back of the {building}.',
      'The broadband options are limited and the connection drops often.',
      'Working from home was a struggle with the connection here.',
    ],
  },
  cleanliness: {
    good: [
      'The {common} were cleaned properly every week, {bins} included.',
      'The shared spaces are kept spotless.',
      'Cleaners come regularly and it shows.',
    ],
    bad: [
      'The {bins} area was left to overflow and nobody took responsibility.',
      'The {common} were dirty for most of my time there.',
      'Collections were unreliable and the entrance often smelled.',
    ],
  },
  parking: {
    good: [
      'Parking was never a problem.',
      'There is allocated parking, which is a real bonus around here.',
    ],
    bad: [
      'Parking is difficult and the permit process was a headache.',
      'There were more cars than spaces, every evening.',
      'Visitors had nowhere to park.',
    ],
  },
  accessibility: {
    good: [
      'Step-free from the street to the {lift}, which made moving in easy.',
      'The {lift} is reliable, which matters on the upper floors.',
    ],
    bad: [
      'The {lift} was out often enough to be a real problem on the upper floors.',
      "Lots of stairs and no {lift}. Fine until you're carrying shopping.",
      'Not a building for anyone with mobility issues.',
    ],
  },
  drainage: {
    good: [
      'The area drains well even in heavy rain.',
      'Never had any flooding, even in the worst of the rainy season.',
    ],
    bad: [
      'The yard flooded whenever it rained heavily and it took days to drain.',
      'The road outside turns into a river in the rainy season.',
      'Water came into the ground floor during a heavy storm.',
    ],
  },
  pests: {
    good: ['Never had a pest problem.', 'Pest control came round regularly, and it worked.'],
    bad: [
      'There was a recurring pest problem that treatment only ever paused.',
      'Cockroaches were a constant, whatever I did.',
      'Mice in the kitchen most winters.',
    ],
  },
  natural_light: {
    good: [
      'The light through the main rooms is excellent from the morning onwards.',
      'Big windows and a proper cross-breeze.',
      'Bright even on grey days.',
    ],
    bad: [
      'The rooms are dark for most of the day.',
      'Small windows, and a lot of lamps on during the day.',
    ],
  },
  laundry: {
    good: [
      'Laundry in the {building} actually works, and there are enough machines.',
      "A washer and dryer in the {home}, which I won't live without now.",
    ],
    bad: [
      'The shared laundry was often out of service.',
      'The laundry room had two working machines for the whole {building}.',
      'No laundry in the {building}, and the nearest laundromat is a trek.',
    ],
  },
  bike_storage: {
    good: ['Secure bike storage that actually had space in it.', 'The bike store is covered and locked.'],
    bad: [
      'Bike storage was full and not very secure.',
      'I kept my bike in the hallway because there was nowhere else.',
    ],
  },
};

/**
 * Where a market's concerns change what a category is about.
 *
 * "Utilities" means the generator and the borehole in Lagos, load-shedding in
 * Johannesburg, the boiler in Manchester and the chiller in Dubai. These are
 * added to the category's own lines for markets with that concern.
 */
const CONCERN_LINES: Record<string, Partial<Record<string, Bank>>> = {
  power: {
    utilities: {
      good: [
        'The {backup} covers the whole {home}, so outages barely register.',
        'Public power here is better than most of the city, and the {backup} fills the gaps.',
      ],
      bad: [
        'Outages were routine and the {backup} only ran for a few hours each evening.',
        'Fuel for the {backup} became a running argument about who pays.',
      ],
    },
    noise: {
      bad: ['The generators around the {building} run most evenings and you hear every minute.'],
    },
  },
  water: {
    utilities: {
      good: ['Water was steady all year, even in the dry season.'],
      bad: ['We bought water in more often than anyone should have to.'],
    },
  },
  flooding: {
    location: {
      bad: ['Getting in and out after heavy rain is a real problem on the approach road.'],
    },
  },
  heating: {
    utilities: {
      good: ['The {heating} was reliable and the place warms up quickly.'],
      bad: ['The {heating} broke down [every winter|twice in one winter] and took days to fix.'],
    },
    heating_cooling: {
      good: ['The heating works well and the place holds its warmth.', 'Warm in winter without the bills getting silly.'],
      bad: [
        'Heating struggled badly in winter and the bills were brutal.',
        'The {heating} was temperamental, and cold showers were a regular thing.',
      ],
    },
  },
  cooling: {
    heating_cooling: {
      good: [
        'The {cooling} kept the place comfortable even at the height of summer.',
        'Good cross-ventilation meant I barely needed the {cooling}.',
      ],
      bad: [
        'The place is impossible to keep cool in summer.',
        'The {cooling} units are old and noisy, and one never worked properly.',
      ],
    },
    utilities: {
      bad: ['Cooling costs in summer were far higher than I was told at the viewing.'],
    },
  },
  security: {
    safety: {
      good: [
        'The gate is manned day and night and visitors are checked in.',
        'Access control is taken seriously here, which is a big part of why I chose it.',
      ],
      bad: [
        'Security at the gate was more relaxed than it should have been.',
        'Access control was more of an idea than a practice.',
      ],
    },
  },
  charges: {
    value: {
      bad: ['The {charges} went up every year with very little explanation of what they covered.'],
      good: ['The {charges} are reasonable and you can see what they pay for.'],
    },
  },
  laundry: {},
  damp: {},
  transit: {
    location: {
      good: ['Being close to {transit} made the commute easy.'],
    },
  },
};

/* -------------------------------------------------------------------------
 * Framing
 * ---------------------------------------------------------------------- */

const OPENERS: Record<ResidencyStatus, readonly string[]> = {
  current: [
    "I've been here {tenure} now.",
    'Coming up on {tenure} in this {home}.',
    'Writing this {tenure} into my tenancy.',
    'Still here after {tenure}, so take this as a work in progress.',
    '{Tenure} in, and I have a fair sense of the place.',
    'I moved in {tenure} ago.',
    'current:Current tenant, {tenure} in.',
    'Renting here for {tenure} so far.',
  ],
  former: [
    'Lived here for {tenure} before moving on.',
    'I rented here for {tenure}.',
    'Spent {tenure} in this {home}.',
    'This was home for {tenure}.',
    'I moved out {left} after {tenure}.',
    'We were here for {tenure}.',
    'I lived in this {home} for {tenure}.',
    'Former tenant; {tenure} here in total.',
  ],
};

const CONTRAST = [
  'That said,',
  'On the other hand,',
  'Against that,',
  'The downside is that',
  'Where it falls short is that',
  'Still,',
  'But',
];

const CONCESSION = ['To be fair,', 'In its favour,', 'The one good thing is that', 'Credit where it is due:'];

const CLOSERS: Record<'positive' | 'negative' | 'neutral', readonly string[]> = {
  positive: [
    'I would live here again if the timing worked out.',
    'former:I left for reasons that had nothing to do with the {building}.',
    "I'd recommend it to a friend without hesitating.",
    'Would happily rent here again.',
    "current:I'm in no rush to leave.",
    'Hard to fault, honestly.',
    "One of the better rentals I've had.",
    'Easy recommendation.',
    'If you get the chance to rent here, take it.',
  ],
  negative: [
    'I would not sign here again.',
    'Ask hard questions at the viewing and get the answers in writing.',
    'former:By the end I was counting down the months.',
    "current:I'm already looking for somewhere else.",
    'Look elsewhere if you can.',
    "Not somewhere I'd recommend.",
    'I would think very carefully before signing here.',
    'former:Glad to be out.',
  ],
  neutral: [
    'Worth viewing, but go in with your eyes open.',
    'Fine for a year or two, less so beyond that.',
    'It does the job.',
    'Decent, with caveats.',
    'current:Good enough for now.',
    "former:I don't regret living there, but I wouldn't go back.",
    'Some good, some bad, about what you would expect for the price.',
    'Right for some people; it depends what you can live with.',
  ],
};

const ADVICE: Record<string, readonly string[]> = {
  power: [
    'Ask how many hours the {backup} runs before you sign.',
    'Check who pays for fuel and how it is split.',
  ],
  water: ['Ask about the water situation in the dry season.'],
  flooding: ['Visit after heavy rain if you can.'],
  heating: ['Ask to see the {heating} running before you sign.'],
  damp: ["Look behind the furniture at the viewing; that's where the damp hides."],
  security: ['Walk the route from {transit} after dark before deciding.'],
  charges: ['Get the {charges} in writing before you sign.', 'Ask what the {charges} actually cover.'],
  general: [
    'Talk to someone already living here if you get the chance.',
    'Check the water pressure and the phone reception at the viewing.',
    'See it at a busy time of day, not just a quiet one.',
  ],
};

/** A former resident's reason for leaving, in their words. */
const DEPARTURE_LINES: Record<string, readonly string[]> = {
  rent_increase: ['In the end the rent increase is what pushed me out.', 'I left when the rent went up again.'],
  maintenance: ['Unresolved repairs are what finally made me leave.'],
  management: ['Dealing with {manager} is ultimately why I moved.'],
  utilities: ['In the end I left because the utilities never improved.'],
  noise: ['The noise is why I left.'],
  safety: ['I moved because I stopped feeling safe coming home.'],
  neighbours: ['Problems in the {building} are why I moved on.'],
  condition: ['The state of the place is ultimately why I left.'],
  space: ['I needed more space, otherwise I might have stayed.'],
  lease_ended: ["The lease ended and wasn't renewed."],
  relocation: ['I left because I moved cities, not because of the {home}.'],
  work_study: ['A new job took me elsewhere.'],
  life_change: ['Circumstances changed and I had to move.'],
  bought_home: ['I left to buy a place of my own.'],
  commute: ['The commute is what eventually wore me down.'],
};

/** Whole reviews in a line or two, for the residents who do not write much. */
const COMPACT: Record<'positive' | 'negative' | 'neutral', readonly string[]> = {
  positive: [
    'Well run, in a good spot. Nothing worth complaining about.',
    'Quiet, clean and properly maintained.',
    'Solid all round. Nothing spectacular, nothing to worry about.',
    'Easy place to live. Problems, when there were any, got sorted.',
  ],
  negative: [
    'Constant maintenance problems, and {manager} rarely helped.',
    'More trouble than it was worth for the rent.',
    'Avoid if you can. Too much went wrong and too little got fixed.',
  ],
  neutral: [
    'Great location, tired {building}.',
    'Good {home}, but dealing with {manager} was hard work.',
    'Nice area, but the {building} needs work.',
    'Fine, not memorable.',
  ],
};

/* -------------------------------------------------------------------------
 * Composition
 * ---------------------------------------------------------------------- */

export interface ProseContext {
  random: () => number;
  flavour: MarketFlavour;
  propertyType: PropertyTypeKey;
  residency: ResidencyStatus;
  tenureMonths: number;
  /** Months between moving out and writing, for former residents. */
  monthsSinceLeaving: number;
  overallRating: number;
  ratings: readonly CategoryRating[];
  departureReason: string | null;
  /**
   * Templates already used on this property. A property page showing the same
   * sentence twice is the tell that gives generated text away, so each
   * property draws without replacement until a bank runs dry.
   */
  used: Set<string>;
}

export function composeReviewBody(ctx: ProseContext): string {
  const { random } = ctx;
  const tone: 'positive' | 'negative' | 'neutral' =
    ctx.overallRating >= 4 ? 'positive' : ctx.overallRating <= 2 ? 'negative' : 'neutral';

  const length = random();
  // Roughly a fifth of residents write a line or two, a fifth write at length.
  if (length < 0.2) return compact(ctx, tone);
  const long = length > 0.78;

  const praised = ctx.ratings.filter((r) => r.rating >= 4);
  const complained = ctx.ratings.filter((r) => r.rating <= 2);
  const middling = ctx.ratings.filter((r) => r.rating === 3);

  const sentences: string[] = [];

  if (random() < (long ? 0.85 : 0.5)) {
    const opener = draw(ctx, OPENERS[ctx.residency]);
    if (opener) sentences.push(opener);
  }

  const themeCount = long ? 3 + Math.floor(random() * 3) : 2 + Math.floor(random() * 2);

  // Lead with whatever the overall verdict says, then let the other side in.
  const lead = tone === 'negative' ? complained : praised;
  const other = tone === 'negative' ? praised : complained;
  const leadPolarity: Polarity = tone === 'negative' ? 'bad' : 'good';
  const otherPolarity: Polarity = tone === 'negative' ? 'good' : 'bad';

  const leadCount = tone === 'neutral' ? Math.ceil(themeCount / 2) : Math.max(1, themeCount - 1);
  for (const rating of pickSome(random, lead, leadCount)) {
    const line = categoryLine(ctx, rating.categoryKey, leadPolarity);
    if (line) sentences.push(line);
  }

  const otherPicks = pickSome(random, other, Math.max(0, themeCount - leadCount));
  otherPicks.forEach((rating, index) => {
    const line = categoryLine(ctx, rating.categoryKey, otherPolarity);
    if (!line) return;
    // The first line of the other side is where the trade-off is named.
    if (index === 0 && sentences.length > 0) {
      const joiner = pick(random, tone === 'negative' ? CONCESSION : CONTRAST);
      sentences.push(`${joiner} ${lowerFirst(line)}`);
    } else {
      sentences.push(line);
    }
  });

  if (sentences.length < 2 && middling.length > 0 && random() < 0.6) {
    const line = categoryLine(ctx, pick(random, middling).categoryKey, 'mixed');
    if (line) sentences.push(line);
  }

  if (ctx.residency === 'former' && ctx.departureReason && random() < (long ? 0.7 : 0.35)) {
    const line = draw(ctx, DEPARTURE_LINES[ctx.departureReason] ?? []);
    if (line) sentences.push(line);
  }

  if (random() < (long ? 0.5 : 0.18)) {
    const concern = pick(random, [...ctx.flavour.concerns.filter((c) => ADVICE[c]), 'general']);
    const line = draw(ctx, ADVICE[concern] ?? ADVICE.general!);
    if (line) sentences.push(line);
  }

  if (random() < 0.6 || sentences.length < 2) {
    const closer = draw(ctx, CLOSERS[tone]);
    if (closer) sentences.push(closer);
  }

  return sentences.join(' ');
}

function compact(ctx: ProseContext, tone: 'positive' | 'negative' | 'neutral'): string {
  const line = draw(ctx, COMPACT[tone]) ?? draw(ctx, CLOSERS[tone]) ?? 'It does the job.';
  // Now and then, one concrete detail after the verdict.
  const extremes = ctx.ratings.filter((r) => r.rating <= 1 || r.rating >= 5);
  if (extremes.length > 0 && ctx.random() < 0.5) {
    const rating = pick(ctx.random, extremes);
    const detail = categoryLine(ctx, rating.categoryKey, rating.rating >= 5 ? 'good' : 'bad');
    if (detail) return `${line} ${detail}`;
  }
  return line;
}

function categoryLine(ctx: ProseContext, categoryKey: string, polarity: Polarity): string | null {
  const own = CATEGORY_LINES[categoryKey]?.[polarity] ?? [];
  const local = ctx.flavour.concerns.flatMap(
    (concern) => CONCERN_LINES[concern]?.[categoryKey]?.[polarity] ?? [],
  );
  // Market-specific lines first in the pool twice over, so they come up often
  // enough to be noticed without crowding out everything else.
  return draw(ctx, [...local, ...local, ...own]);
}

/** A template that suits this review and has not been used on this property. */
function draw(ctx: ProseContext, templates: readonly string[]): string | null {
  const suitable = templates.filter((template) => {
    if (template.startsWith('former:')) return ctx.residency === 'former';
    if (template.startsWith('current:')) return ctx.residency === 'current';
    return true;
  });
  if (suitable.length === 0) return null;

  const fresh = suitable.filter((template) => !ctx.used.has(template));
  const template = pick(ctx.random, fresh.length > 0 ? fresh : suitable);
  ctx.used.add(template);
  return render(ctx, template.replace(/^(former|current):/, ''));
}

function render(ctx: ProseContext, template: string): string {
  const { random, flavour } = ctx;
  const words = vocabularyFor(ctx);

  const text = template
    .replace(/\[([^\]]+)\]/g, (_match, options: string) => pick(random, options.split('|')))
    .replace(/\{(\w+)\}/g, (_match, token: string) => {
      const key = token.toLowerCase();
      const value = key === 'tenure' ? tenurePhrase(ctx.tenureMonths) : words[key];
      if (value === undefined) throw new Error(`Unknown prose token {${token}}`);
      return token[0] === token[0]!.toUpperCase() ? upperFirst(value) : value;
    });

  void flavour;
  return upperFirst(text);
}

function vocabularyFor(ctx: ProseContext): Record<string, string> {
  const v = ctx.flavour.vocabulary;
  const { random } = ctx;
  return {
    home: homeWord(ctx),
    building: buildingWord(ctx),
    lift: v.lift,
    bins: v.bins,
    common: v.american ? 'common areas' : 'communal areas',
    neighbours: v.neighbours,
    manager: pick(random, v.manager),
    backup: v.backup,
    heating: v.heating,
    cooling: v.cooling,
    charges: v.charges,
    transit: pick(random, v.transit),
    left: leftPhrase(ctx.monthsSinceLeaving),
  };
}

function homeWord(ctx: ProseContext): string {
  const { flavour, propertyType, random } = ctx;
  const american = flavour.vocabulary.american;
  switch (propertyType) {
    case 'studio':
      return 'studio';
    case 'shared':
      return american ? 'shared apartment' : flavour.nameStyle === 'english' ? 'houseshare' : 'shared flat';
    case 'room':
      return 'room';
    case 'house':
    case 'bungalow':
      return propertyType === 'bungalow' ? 'bungalow' : 'house';
    case 'townhouse':
      return 'townhouse';
    case 'duplex':
      return flavour.nameStyle === 'nigerian' ? 'duplex' : american ? 'duplex' : 'maisonette';
    default:
      return pick(random, flavour.vocabulary.flat);
  }
}

function buildingWord(ctx: ProseContext): string {
  const { propertyType, flavour, random } = ctx;
  if (propertyType === 'house' || propertyType === 'townhouse' || propertyType === 'bungalow') {
    return flavour.nameStyle === 'nigerian' ? 'compound' : 'house';
  }
  if (flavour.nameStyle === 'southern-african') return pick(random, ['complex', 'block']);
  if (flavour.nameStyle === 'nigerian') return pick(random, ['building', 'compound', 'block']);
  if (flavour.vocabulary.american) return 'building';
  return pick(random, ['building', 'block']);
}

/** How long, in the words a person would use. Never a precise count. */
export function tenurePhrase(months: number): string {
  if (months <= 4) return 'a few months';
  if (months <= 7) return 'about six months';
  if (months <= 10) return 'most of a year';
  if (months <= 14) return 'about a year';
  if (months <= 20) return 'a year and a half';
  if (months <= 23) return 'nearly two years';
  if (months <= 28) return 'two years';
  if (months <= 33) return 'over two years';
  if (months <= 42) return 'about three years';
  if (months <= 47) return 'nearly four years';
  if (months <= 53) return 'four years';
  if (months <= 66) return 'five years';
  return 'more than five years';
}

function leftPhrase(monthsSinceLeaving: number): string {
  if (monthsSinceLeaving <= 1) return 'recently';
  if (monthsSinceLeaving <= 4) return 'a few months ago';
  return 'earlier this year';
}

function upperFirst(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** For a sentence continuing after a connector. "I" and acronyms keep their capitals. */
function lowerFirst(text: string): string {
  if (/^I\b/.test(text) || /^[A-Z]{2}/.test(text)) return text;
  return text[0]!.toLowerCase() + text.slice(1);
}
