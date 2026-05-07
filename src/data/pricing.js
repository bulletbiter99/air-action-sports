export const pricingPlans = [
  {
    id: 'walk-in',
    name: 'Walk-In',
    price: '$80',
    unit: '/per player',
    description: 'BYO gear, show up and play',
    featured: false,
    features: [
      'Full-day gameplay',
      'Safety briefing included',
      'Trained marshals on field',
      'Free parking',
      'Tea/coffee at staging',
    ],
    cta: { label: 'Book Now', href: '' }, // Uses siteConfig.bookingLink via PricingCard
  },
  {
    id: 'walk-in-gear',
    name: 'Walk-In + Gear Hire',
    price: '$50',
    unit: '/per player',
    description: 'Everything included \u2014 just turn up',
    featured: true,
    features: [
      'Everything in Walk-In PLUS',
      'Full replica weapon hire',
      'Face mask & eye protection',
      'Tactical vest',
      'BBs included (500 rounds)',
    ],
    cta: { label: 'Book Now', href: '' }, // Uses siteConfig.bookingLink via PricingCard
  },
  {
    id: 'private-hire',
    name: 'Private Hire',
    price: '$500',
    unit: '/per event',
    description: 'Exclusive site access for your group',
    featured: false,
    features: [
      'Full site for up to 30 players',
      'Dedicated marshals',
      'Custom game modes',
      'Gear hire available (extra)',
      'Choose your site & date',
    ],
    cta: { label: 'Enquire Now', href: '/contact' },
  },
];

export const groupDiscounts = [];

export const addOns = [
  { name: 'Extra BBs', detail: '500 rounds', price: '$5' },
  { name: 'Smoke Grenades', detail: 'Pack of 2', price: '$10' },
  { name: 'Upgraded Replica', detail: 'DMR or Sniper', price: '$15' },
  { name: 'Ghillie Suit Hire', detail: 'Full day', price: '$20' },
];
