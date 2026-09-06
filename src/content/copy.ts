/**
 * Every user-facing string in Livd.
 *
 * Components import from here rather than writing text inline. Adding a locale
 * means adding a sibling object with the same shape and a resolver — not
 * touching a single component. `as const` makes the shape the contract, so a
 * translation that omits a key fails typechecking.
 *
 * Voice: plain, exact, unhurried. Sentence case. No exclamation marks. Numbers
 * always stated with their basis.
 */

export const copy = {
  brand: {
    name: 'Livd',
    tagline: "Know what it's really like to live there.",
  },

  nav: {
    search: 'Search',
    places: 'Places',
    howItWorks: 'How it works',
    trust: 'Trust & safety',
    shortlist: 'Shortlist',
    account: 'Account',
    signIn: 'Sign in',
    signOut: 'Sign out',
    writeReview: 'Share your experience',
    admin: 'Admin',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    skipToContent: 'Skip to main content',
    theme: 'Change theme',
  },

  home: {
    heroTitle: "Know what it's really like to live there.",
    heroLead:
      'Photos and viewings only tell you so much. Livd collects what people who actually lived at a property say about it — including why they left.',
    searchCta: 'Search a property',
    contributeCta: 'Share your experience',
    searchPlaceholder: 'Search an address, building or neighbourhood',
    searchLabel: 'Search for a property',
    trustNote: 'Reviews are anonymous. Property owners can reply, but they can never remove a review.',

    valueTitle: 'What a listing will not tell you',
    values: [
      {
        title: 'Why people left',
        body: 'The single most useful thing a former resident knows. Captured as structured data, so it can be counted across a property’s whole history rather than buried in prose.',
      },
      {
        title: 'What keeps going wrong',
        body: 'One complaint is an anecdote. The same complaint from nine residents across four years is a pattern — and a question to ask before you sign anything.',
      },
      {
        title: 'Whether it is getting better',
        body: 'Buildings change hands and standards move. Livd compares recent residents with earlier ones, so you see the direction, not just an average.',
      },
    ],

    howTitle: 'How Livd works',
    howSteps: [
      {
        title: 'Search the address',
        body: 'Find a specific property, or browse a neighbourhood you are considering.',
      },
      {
        title: 'Read the resident record',
        body: 'A score you can interrogate: category by category, with the confidence stated and the sample size shown.',
      },
      {
        title: 'Take questions to the viewing',
        body: 'Livd turns the weak points into questions you can ask the landlord directly.',
      },
      {
        title: 'Add yours when you move',
        body: 'Four minutes, anonymous, and it is the reason the next person can make a better decision.',
      },
    ],

    discoverTitle: 'Recently reviewed',
    discoverLead: 'Properties residents have written about most recently.',
    browseAll: 'Browse all properties',
    exploreLocations: 'Explore by location',
  },

  search: {
    title: 'Search',
    heading: 'Search properties',
    placeholder: 'Address, building name, or neighbourhood',
    inputLabel: 'Search properties',
    submit: 'Search',
    clear: 'Clear search',
    resultsFor: (q: string) => `Results for “${q}”`,
    resultCount: (n: number) =>
      n === 1 ? '1 property' : `${new Intl.NumberFormat().format(n)} properties`,
    correctedFrom: (original: string) => `Showing results for a close match to “${original}”.`,
    noResultsTitle: 'No properties match that search',
    noResultsBody:
      'Try a shorter search — a street name or neighbourhood usually works better than a full address. If the property is not on Livd yet, you can add it.',
    addProperty: 'Add this property',
    suggestionsLabel: 'Search suggestions',
    recentSearches: 'Recent searches',
    clearRecent: 'Clear',
    filters: 'Filters',
    applyFilters: 'Apply filters',
    resetFilters: 'Reset',
    sortLabel: 'Sort by',
    sorts: {
      relevance: 'Most relevant',
      score_desc: 'Highest rated',
      score_asc: 'Lowest rated',
      reviews_desc: 'Most reviewed',
      recent: 'Recently reviewed',
    },
    filterCountry: 'Country',
    filterType: 'Property type',
    filterMinScore: 'Minimum score',
    filterMinReviews: 'Minimum reviews',
    filterVerified: 'Verified reviews only',
    anyCountry: 'Any country',
    anyScore: 'Any score',
    searching: 'Searching',
  },

  property: {
    reviewCount: (n: number) => (n === 1 ? '1 review' : `${n} reviews`),
    verifiedCount: (n: number) => `${n} verified`,
    residentVerdict: 'Resident verdict',
    verdictBasis: (n: number, confidence: string) =>
      `Based on ${n} ${n === 1 ? 'review' : 'reviews'} · ${confidence} confidence`,
    strengths: 'What residents consistently praise',
    concerns: 'What residents consistently raise',
    categoryTitle: 'How residents rate it',
    categoryLead: 'Each category is scored only where residents actually rated it.',
    categoryRatedBy: (n: number) => `${n} ${n === 1 ? 'resident' : 'residents'}`,
    coreCategories: 'Core',
    extendedCategories: 'Also rated here',

    departuresTitle: 'Why residents leave',
    departuresLead: (n: number) =>
      `Reported by ${n} former ${n === 1 ? 'resident' : 'residents'} who told us why they moved out.`,
    departuresSuppressedTitle: 'Not enough data yet',
    departuresSuppressedBody:
      'Livd publishes this breakdown once at least four former residents have shared why they left. Publishing it earlier would turn one person’s answer into a statistic.',
    departuresPropertyRelated: 'Related to the property',
    departuresPersonal: 'Personal circumstances',

    checksTitle: 'Check before you visit',
    checksLead:
      'Questions drawn from what residents raised here. Ask them at the viewing and you will learn more in five minutes than a listing will tell you in an hour.',

    timelineTitle: 'How this property has changed',
    timelineLead: 'Built only from what residents reported. Nothing here is inferred.',

    reviewsTitle: 'Resident reviews',
    reviewsEmptyTitle: 'No reviews yet',
    reviewsEmptyBody:
      'Nobody has written about this property on Livd yet. If you live here or used to, you would be the first.',
    beFirst: 'Be the first to review',

    learningTitle: 'We are still learning about this property',
    learningBody: (n: number) =>
      `${n} ${n === 1 ? 'person has' : 'people have'} reviewed this property so far — not yet enough for Livd to publish a score. Individual reviews are below, and they are worth reading.`,

    recommendRate: (pct: number) => `${pct}% would live here again`,
    currentResidents: (n: number) => `${n} current`,
    formerResidents: (n: number) => `${n} former`,
    reportedRent: 'Rent residents reported',
    rentBasis: (n: number) => `Median of ${n} ${n === 1 ? 'report' : 'reports'}`,

    save: 'Save to shortlist',
    saved: 'Saved to shortlist',
    share: 'Share',
    linkCopied: 'Link copied',
    report: 'Report this property',
    claim: 'Claim this property',
    claimed: 'Claimed property',
    claimedNote:
      'A verified owner or manager has claimed this property. They can respond to reviews. They cannot edit or remove them.',
    ownerResponse: 'Response from the property',
    resolutionNotice: 'Marked as resolved by the property',
    writeReview: 'Share your experience',

    filterAll: 'All reviews',
    filterCurrent: 'Current residents',
    filterFormer: 'Former residents',
    filterVerified: 'Verified only',
    sortRecent: 'Most recent',
    sortHelpful: 'Most helpful',
    sortHighest: 'Highest rated',
    sortLowest: 'Lowest rated',
    noMatchingReviews: 'No reviews match these filters.',

    demoBadge: 'Sample data',
    demoNote:
      'This is seeded demonstration data, not real resident reviews. It exists so the product can be evaluated before launch.',
  },

  score: {
    outOf: 'out of 100',
    label: 'Livd Score',
    confidence: {
      insufficient: 'Not enough data',
      limited: 'Limited confidence',
      moderate: 'Moderate confidence',
      strong: 'Strong confidence',
    },
    confidenceShort: {
      insufficient: 'Insufficient',
      limited: 'Limited',
      moderate: 'Moderate',
      strong: 'Strong',
    },
    confidenceExplainer: {
      insufficient:
        'Too few reviews to produce a score that would mean anything. Read the individual reviews instead.',
      limited:
        'Based on a small number of reviews. Treat it as a signal, not a verdict, and weigh the reviews themselves.',
      moderate: 'Based on enough reviews to be a reasonable guide.',
      strong: 'Based on a substantial and reasonably recent body of resident reviews.',
    },
    noScoreTitle: 'No score yet',
    trend: {
      improving: 'Improving',
      stable: 'Stable',
      declining: 'Declining',
      unknown: 'Not enough history',
    },
    trendExplainer: {
      improving: (d: number) => `Recent residents rate this property ${d} points higher than earlier ones.`,
      declining: (d: number) => `Recent residents rate this property ${d} points lower than earlier ones.`,
      stable: 'Recent residents rate this property about the same as earlier ones.',
      unknown: 'There are not yet enough reviews across two periods to show a direction.',
    },
    weightingNote:
      'Recent reviews count for more than old ones, verified residents count for more than unverified, and a small number of reviews is pulled toward the middle rather than allowed to produce an extreme score.',
  },

  review: {
    title: 'Share your experience',
    lead: 'Anonymous, about four minutes. Your name is never shown.',
    stepOf: (current: number, total: number) => `Step ${current} of ${total}`,
    next: 'Continue',
    back: 'Back',
    submit: 'Publish review',
    submitting: 'Publishing',
    saveDraft: 'Save and finish later',
    exit: 'Leave',

    steps: {
      property: {
        title: 'Which property did you live in?',
        lead: 'Search for the address. If it is not listed, you can add it.',
      },
      residency: {
        title: 'Do you live there now?',
        lead: 'Former residents can tell the next renter something nobody else can — why you left.',
        current: 'I live there now',
        currentHint: 'You are a current resident',
        former: 'I used to live there',
        formerHint: 'You have moved out',
      },
      dates: {
        title: 'When did you live there?',
        lead: 'Month and year is enough. Livd never stores exact dates.',
        movedIn: 'Moved in',
        movedOut: 'Moved out',
        month: 'Month',
        year: 'Year',
      },
      overall: {
        title: 'Overall, how was living there?',
        lead: 'Your instinct is the right answer here. The detail comes next.',
      },
      categories: {
        title: 'Rate what mattered',
        lead: 'Skip anything that did not apply to you. Skipped categories are not scored.',
        addMore: 'Rate something else',
        notApplicable: 'Did not apply',
      },
      positives: {
        title: 'What was good about living there?',
        lead: 'Choose anything that applied. This is what the next renter is hoping to hear.',
      },
      problems: {
        title: 'What was difficult?',
        lead: 'Choose anything that applied. Be honest — this is the part people come to Livd for.',
      },
      departure: {
        title: 'Why did you leave?',
        lead: 'The most valuable question on Livd. Pick the main reason first.',
        primary: 'Main reason',
        secondary: 'Anything else that contributed',
        secondaryOptional: 'Optional',
      },
      words: {
        title: 'In your own words',
        lead: 'Optional, but this is what people read first. A few specific sentences beat a paragraph of general impressions.',
        placeholder: 'What would you want to know before paying to live here?',
        prompts: 'Not sure where to start?',
        promptList: [
          'What surprised you after you moved in?',
          'What do you wish you had known before signing?',
          'What was the single biggest problem?',
          'What was genuinely good about living there?',
          'Would you live there again?',
        ],
        counter: (used: number, max: number) => `${used} of ${max} characters`,
        recommendQuestion: 'Would you live there again?',
        recommendYes: 'Yes',
        recommendNo: 'No',
        rentQuestion: 'What was the rent? (optional)',
        rentHint: 'Helps other renters judge value. Shown only as a median across residents.',
      },
      confirm: {
        title: 'Before you publish',
        lead: 'A quick check on the things that keep Livd useful and safe.',
        rules: [
          'This is about the property and what living there was like — not about any individual person.',
          'No names, phone numbers, email addresses or unit numbers.',
          'Everything you write here is something you experienced yourself.',
        ],
        agree: 'I understand and confirm the above',
      },
    },

    successTitle: 'Your review is published',
    successBody:
      'Thank you. It is live on the property page now, and it is what makes the next person’s decision a better one.',
    successView: 'View the property',
    successAnother: 'Review another property',
    pendingTitle: 'Your review has been submitted for review',
    pendingBody:
      'A moderator will look at it shortly. This happens with a small number of reviews and does not mean anything is wrong.',
    editWindow: (hours: number) =>
      `You can correct this review for the next ${hours} hours. After that it becomes part of the property’s permanent record.`,
  },

  safety: {
    blockedTitle: 'This needs a small change before it can be published',
    contactDetails:
      'Remove the contact details. Phone numbers, email addresses and links are never published on Livd.',
    namedIndividual:
      'Remove the name. Reviews on Livd are about the property, not about identifiable people — this protects you as much as anyone else.',
    unitNumber:
      'Remove the unit or apartment number. It could identify the household that lived there.',
    threat: 'This reads as a threat. Livd does not publish content that threatens anyone.',
    harassment: 'This targets an individual. Please write about the property and the experience instead.',
    discrimination:
      'This includes content targeting people based on who they are. Livd does not publish it.',
    allegation:
      'Serious allegations must be stated as your experience rather than as established fact — for example, "I was told" or "in my experience" rather than a flat accusation.',
    tooShort: (min: number) => `Please write at least ${min} characters, or leave the written review blank.`,
    genericFix: 'Edit your review',

    reportTitle: 'Report this review',
    reportLead:
      'Tell us what is wrong with it. Reports go to a moderator, and every decision is logged.',
    reportReason: 'What is the problem?',
    reportDetail: 'Anything else we should know?',
    reportDetailHint: 'Optional',
    reportSubmit: 'Submit report',
    reportSuccessTitle: 'Report received',
    reportSuccessBody:
      'A moderator will review it. We do not tell the reviewer who reported them.',
    reportReasons: {
      inappropriate: 'Offensive or inappropriate content',
      false_information: 'Contains false information',
      privacy: 'Contains private or identifying information',
      spam: 'Spam or advertising',
      harassment: 'Harassment or targeting a person',
      not_a_resident: 'This person did not live here',
      other: 'Something else',
    },
  },

  auth: {
    signInTitle: 'Sign in to Livd',
    signInLead:
      'We will email you a link. There is no password to remember, and none for us to lose.',
    email: 'Email address',
    sendLink: 'Email me a sign-in link',
    sending: 'Sending',
    linkSentTitle: 'Check your email',
    linkSentBody: (email: string) => `We sent a sign-in link to ${email}. It expires in 15 minutes.`,
    continueWithGoogle: 'Continue with Google',
    or: 'or',
    whyAccount: 'Why do I need an account?',
    whyAccountBody:
      'An account keeps the record honest — one review per person per tenancy. Your identity is never attached to what you publish.',
    signedOut: 'You have been signed out.',
    requiredTitle: 'Sign in to continue',
    requiredBody: 'You need an account to do this. It takes about twenty seconds.',
    devNotice:
      'Development sign-in. No email is sent and no password is required — this adapter is disabled in production.',
  },

  shortlist: {
    title: 'Shortlist',
    lead: 'Properties you are considering, side by side.',
    emptyTitle: 'Nothing saved yet',
    emptyBody:
      'Save properties as you research and Livd will line them up here — scores, categories and what residents raised, in one table.',
    findProperties: 'Search properties',
    compare: 'Compare',
    compareLimit: (n: number) => `Compare up to ${n} at once.`,
    remove: 'Remove from shortlist',
    removed: 'Removed from shortlist',
    added: 'Added to shortlist',
    noteLabel: 'Your note',
    notePlaceholder: 'Viewing on Thursday, ask about the boiler',
    bestIn: 'Best of the four',
  },

  account: {
    title: 'Account',
    myReviews: 'My reviews',
    myReviewsEmpty: 'You have not published any reviews yet.',
    settings: 'Settings',
    country: 'Country',
    countryHint: 'Sets how addresses and currency are shown to you.',
    deleteAccount: 'Delete account',
    deleteAccountBody:
      'Your account and saved properties are deleted. Published reviews stay, permanently unlinked from you, because the property record they belong to is what other renters rely on.',
  },

  admin: {
    title: 'Admin',
    dashboard: 'Dashboard',
    queue: 'Moderation queue',
    reports: 'Reports',
    flags: 'Signals',
    properties: 'Properties',
    reviews: 'Reviews',
    users: 'Users',
    claims: 'Property claims',
    verification: 'Verification',
    emptyQueue: 'Nothing waiting. The queue is clear.',
    approve: 'Approve',
    reject: 'Reject',
    uphold: 'Uphold report',
    dismiss: 'Dismiss report',
    removeReview: 'Remove review',
    restoreReview: 'Restore review',
    actionReason: 'Reason for this decision',
    actionReasonHint: 'Recorded in the audit log. Not shown to the reviewer.',
    auditTrail: 'Audit trail',
  },

  common: {
    loading: 'Loading',
    error: 'Something went wrong',
    retry: 'Try again',
    cancel: 'Cancel',
    close: 'Close',
    confirm: 'Confirm',
    optional: 'Optional',
    required: 'Required',
    showMore: 'Show more',
    showLess: 'Show less',
    seeAll: 'See all',
    previous: 'Previous',
    next: 'Next',
    page: (n: number) => `Page ${n}`,
    of: 'of',
    yes: 'Yes',
    no: 'No',
    skip: 'Skip',
  },

  errors: {
    notFoundTitle: 'We could not find that page',
    notFoundBody:
      'The link may be wrong, or the page may have moved. Searching for the property is usually the fastest way back.',
    propertyNotFoundTitle: 'We could not find that property',
    propertyNotFoundBody:
      'It may have been merged with a duplicate listing, or removed. Try searching for the address.',
    genericTitle: 'Something went wrong at our end',
    genericBody:
      'This is a problem on Livd, not something you did. Trying again usually works; if it does not, it is already logged.',
    unauthorisedTitle: 'You do not have access to this',
    unauthorisedBody: 'If you think that is wrong, sign in with the account that has access.',
    networkTitle: 'No connection',
    networkBody: 'Livd could not reach the server. Check your connection and try again.',
    rateLimitedTitle: 'Too many attempts',
    rateLimitedBody: 'Please wait a moment before trying that again.',
    validationTitle: 'Please check the highlighted fields',
    removedTitle: 'This content was removed',
    removedBody: 'A moderator removed this content because it broke Livd’s content rules.',
  },

  footer: {
    tagline: 'A record of what it is like to live somewhere, built by the people who lived there.',
    product: 'Product',
    company: 'Company',
    legal: 'Legal',
    about: 'About',
    privacy: 'Privacy',
    terms: 'Terms',
    contentPolicy: 'Content policy',
    forOwners: 'For property owners',
    rights: (year: number) => `© ${year} Livd`,
  },
} as const;

export type Copy = typeof copy;
