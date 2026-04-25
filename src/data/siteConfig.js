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
  // Peek Pro booking widget URL — external link, opens in new tab.
  // Pre-launch task: replace with internal /booking once Stripe flips to live.
  bookingLink: 'https://book.peek.com/s/d574de43-d3b6-435c-a6d9-88e23b3131e7/j08xx',
  bookingIsExternal: true,
  ga4Id: 'G-XXXXXXXXXX', // TODO: Replace with real GA4 ID
  // NOTE: countdownTarget / countdownEventName / nextEvent were removed 2026-04 \u2014
  // TickerBar and the Home countdown now read the earliest upcoming event from D1
  // via useEvents(). Don't reintroduce; they go stale on every event change.
};
