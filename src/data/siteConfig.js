export const siteConfig = {
  name: 'Air Action Sports',
  tagline: 'Real terrain. Real tactics. Real fun.',
  phone: '(801) 833-5127',
  phoneLink: 'tel:8018335127',
  email: 'actionairsport@gmail.com',
  url: 'https://airactionsport.com',
  social: {
    facebook: 'https://www.facebook.com/groups/2545278778822344/',
    instagram: 'https://www.instagram.com/kaysaircombat/',
  },
  // Internal booking flow path. All "Book Now" CTAs route here via <Link>.
  // Migrated from the Peek Pro widget on 2026-04-30 — see HANDOFF §10.
  bookingLink: '/booking',
  bookingIsExternal: false,
  ga4Id: 'G-XXXXXXXXXX', // TODO: Replace with real GA4 ID
  // NOTE: countdownTarget / countdownEventName / nextEvent were removed 2026-04 \u2014
  // TickerBar and the Home countdown now read the earliest upcoming event from D1
  // via useEvents(). Don't reintroduce; they go stale on every event change.
};
