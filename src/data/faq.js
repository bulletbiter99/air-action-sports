import { cancellationPolicy } from './policies';

export const faqCategories = [
  {
    title: 'Before You Book',
    items: [
      {
        question: 'What age do I need to be to play?',
        answer: 'Minimum age is 12. Players aged 12 to 17 need a parent or legal guardian to sign the waiver, and must be accompanied on site by a trusted adult with a vehicle available in case of early pickup. There is no separate age limit for milsim events.',
      },
      {
        question: 'Do I need my own gear?',
        answer: "Not necessarily — gear rental is available at selected events, and we're adding more rental stock. Rental packages include a replica weapon, full face protection, and a tactical vest. Check the event page or contact us to confirm rental before you book. You're welcome to bring your own gear if you prefer.",
      },
      {
        question: 'Can I come as a complete beginner?',
        answer: 'Absolutely. Our skirmish sessions are designed to be beginner-friendly. Every game starts with a full safety briefing, and our marshals are always on hand to help new players get comfortable.',
      },
      {
        question: 'How far in advance should I book?',
        answer: 'We recommend booking at least 48 hours in advance. Popular events sell out fast, especially weekends and milsim days. Walk-ins are accepted if slots are still available on the day.',
      },
      {
        question: 'How do I find your locations?',
        answer: 'Our Locations page describes each of our sites and what you\u2019ll find there. For security reasons, exact addresses are shared in your booking confirmation email \u2014 some of our sites are on private rural roads. If you need directions before booking, reach out via the Contact page and we\u2019ll help.',
      },
      {
        question: 'When do you run events?',
        answer: 'Most of our public events run on Saturdays. Milsim ops and special events are scheduled throughout the year and posted on our Events page. Follow us on social media to stay in the loop.',
      },
      {
        question: 'Do I need to sign a waiver?',
        answer: 'Yes, all players must complete a liability waiver before stepping on the field. After you book, we will email you the waiver to complete before game day. Players under 18 must have a parent or guardian sign on their behalf.',
      },
    ],
  },
  {
    title: 'On the Day',
    items: [
      {
        question: 'What should I wear?',
        answer: 'Wear long sleeves, sturdy boots, and dark or neutral colors. No shorts allowed on the field. Face protection is included with every rental package.',
      },
      {
        question: 'What time should I arrive?',
        answer: 'Please arrive at least 30 minutes before the game start time. This gives you time to complete registration, collect any rental gear, and attend the mandatory safety briefing.',
      },
      {
        question: 'Is there parking on site?',
        answer: 'Yes, free parking is available at all of our locations. Follow the signs from the main road to the designated parking areas.',
      },
      {
        question: 'Are there toilets and refreshments on site?',
        answer: 'Portable toilets are available at all sites. Some locations have refreshment stands, but we recommend bringing your own water and snacks to stay fueled throughout the day.',
      },
      {
        question: 'Can I bring my own BBs?',
        answer: 'Yes, you are welcome to bring your own BBs. All weapons are chrono tested with .20g BBs on entry regardless of what weight you plan to use during the game.',
      },
      {
        question: 'Are grenades and smoke grenades allowed?',
        answer: 'Non-pyrotechnic grenades (such as gas or spring BB grenades) are allowed on the field. Fireworks, pyrotechnics, and smoke grenades are not permitted — our sites sit on fire-restricted land.',
      },
      {
        question: 'Do I need a flashlight or tracer for night games?',
        answer: 'Yes, a flashlight or tracer unit is required to participate in night games. We have flashlights and tracers available for purchase at the field while supplies last, so we recommend bringing your own to be safe.',
      },
    ],
  },
  {
    title: 'Safety',
    items: [
      {
        question: 'Is airsoft safe?',
        answer: 'Yes, airsoft is safe when played with proper protection. ANSI Z87.1+ rated full-seal eye protection is required at all times in any active game zone — prescription glasses alone do not meet this requirement. Players under 18 must also wear a full-face mask covering mouth and teeth; players 18 and over must wear a mask, lower-face shield, or mouth guard. We enforce strict FPS limits and have fully trained marshals supervising every game.',
      },
      {
        question: 'What protective gear is provided?',
        answer: 'Rental packages include a full face mask and eye protection. We strongly recommend wearing gloves as well. If you are bringing your own protection, it must be ANSI Z87.1+ rated full-seal eye protection.',
      },
      {
        question: 'Are there marshals on the field?',
        answer: 'Yes, fully trained marshals are present at every event. They enforce the rules, manage game flow, and ensure fair play across all teams.',
      },
      {
        question: 'What is your FPS limit?',
        answer: 'Limits are set by weapon class, measured with 0.20g BBs: Rifle 350 FPS (full auto, no minimum engagement distance), DMR 450 FPS (semi-auto only, 50 ft MED), LMG 450 FPS (full auto at 20 RPS max, 50 ft MED), and Sniper 550 FPS (bolt-action only, 100 ft MED). All weapons are chrono tested on entry before any game begins.',
      },
      {
        question: 'Are real firearms allowed on site?',
        answer: 'Absolutely not. Real firearms are strictly prohibited at all of our sites, no exceptions. Anyone found with a real firearm will be permanently banned. This is a zero-tolerance policy.',
      },
      {
        question: 'What are the basic rules of engagement?',
        answer: 'Call your hits honestly, no blind firing around corners, and observe the minimum engagement distance for high-powered replicas. The bang rule applies at close range. Full rules are covered in the safety briefing before every game.',
      },
    ],
  },
  {
    title: 'Bookings & Payments',
    items: [
      {
        question: 'How do I cancel or reschedule?',
        answer: cancellationPolicy.faqCancel,
      },
      {
        question: 'Do you offer refunds?',
        answer: cancellationPolicy.faqRefund,
      },
      {
        question: 'Can I book for a large group?',
        answer: 'Yes, groups of 10 or more receive priority booking and can request custom game modes tailored to your group. Get in touch with your requirements and we\'ll put a package together.',
      },
      {
        question: 'Do you offer gift vouchers?',
        answer: 'Gift vouchers are coming soon. In the meantime, contact us directly and we can arrange a pre-paid booking for someone else.',
      },
      {
        question: 'What payment methods do you accept?',
        answer: 'We accept both cash and card at the field. Online bookings can be paid by card at the time of booking.',
      },
      {
        question: "What's included in gear rental?",
        answer: 'Our gear rental package includes a full replica weapon, face mask with eye protection, a tactical vest, and 500 rounds of BBs. Extra BBs and upgraded replicas are available as add-ons.',
      },
    ],
  },
  {
    title: 'Private Rental',
    items: [
      {
        question: 'Can I book a whole site for a private event?',
        answer: 'Yes, our sites are available for exclusive private rental. You\'ll have the entire venue to yourselves with dedicated staff on hand. Get in touch and we\'ll confirm which site best suits your group and date.',
      },
      {
        question: "What's included in private rental?",
        answer: 'Private rental includes exclusive site access, dedicated marshals, and custom game modes designed for your group. Gear rental can be arranged where it is available at your chosen site — just ask when you get in touch.',
      },
      {
        question: 'Do you do corporate events?',
        answer: 'Yes, we offer team-building packages designed for corporate groups. Contact us for tailored corporate pricing and event planning.',
      },
      {
        question: 'Do you do birthday parties?',
        answer: 'Absolutely. We run birthday battle packages for ages 12 and up. Contact us with your preferred date and group size and we\'ll put together a package for you.',
      },
    ],
  },
];
