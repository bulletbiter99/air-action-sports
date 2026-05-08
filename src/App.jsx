import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import Layout from './components/Layout';
import ScrollToTop from './components/ScrollToTop';

// Lazy-load page components
const Home = lazy(() => import('./pages/Home'));
const Events = lazy(() => import('./pages/Events'));
const EventDetail = lazy(() => import('./pages/EventDetail'));
const Locations = lazy(() => import('./pages/Locations'));
const Gallery = lazy(() => import('./pages/Gallery'));
const Pricing = lazy(() => import('./pages/Pricing'));
const FAQ = lazy(() => import('./pages/FAQ'));
const Booking = lazy(() => import('./pages/Booking'));
const BookingSuccess = lazy(() => import('./pages/BookingSuccess'));
const BookingCancelled = lazy(() => import('./pages/BookingCancelled'));
const Waiver = lazy(() => import('./pages/Waiver'));
const Ticket = lazy(() => import('./pages/Ticket'));
const VendorPackage = lazy(() => import('./pages/VendorPackage'));
const VendorLogin = lazy(() => import('./pages/VendorLogin'));
const VendorDashboard = lazy(() => import('./pages/VendorDashboard'));
const Contact = lazy(() => import('./pages/Contact'));
const About = lazy(() => import('./pages/About'));
const NewPlayers = lazy(() => import('./pages/NewPlayers'));
const RulesOfEngagement = lazy(() => import('./pages/RulesOfEngagement'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Feedback = lazy(() => import('./pages/Feedback'));
const NotFound = lazy(() => import('./pages/NotFound'));

// Admin
const AdminLayout = lazy(() => import('./admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./admin/AdminDashboard'));
const AdminLogin = lazy(() => import('./admin/AdminLogin'));
const AdminSetup = lazy(() => import('./admin/AdminSetup'));
const AdminRoster = lazy(() => import('./admin/AdminRoster'));
const AdminNewBooking = lazy(() => import('./admin/AdminNewBooking'));
const AdminTaxesFees = lazy(() => import('./admin/AdminTaxesFees'));
const AdminForgotPassword = lazy(() => import('./admin/AdminForgotPassword'));
const AdminResetPassword = lazy(() => import('./admin/AdminResetPassword'));
const AdminScan = lazy(() => import('./admin/AdminScan'));
const AdminRentals = lazy(() => import('./admin/AdminRentals'));
const AdminRentalQrSheet = lazy(() => import('./admin/AdminRentals').then((m) => ({ default: m.AdminRentalQrSheet })));
const AdminRentalAssignments = lazy(() => import('./admin/AdminRentalAssignments'));
const AdminEvents = lazy(() => import('./admin/AdminEvents'));
const AdminPromoCodes = lazy(() => import('./admin/AdminPromoCodes'));
const AdminAnalytics = lazy(() => import('./admin/AdminAnalytics'));
const AdminUsers = lazy(() => import('./admin/AdminUsers'));
const AdminAcceptInvite = lazy(() => import('./admin/AdminAcceptInvite'));
const AdminAuditLog = lazy(() => import('./admin/AdminAuditLog'));
const AdminSettings = lazy(() => import('./admin/AdminSettings'));
const AdminEmailTemplates = lazy(() => import('./admin/AdminEmailTemplates'));
const AdminVendors = lazy(() => import('./admin/AdminVendors'));
const AdminVendorPackages = lazy(() => import('./admin/AdminVendorPackages'));
const AdminVendorContracts = lazy(() => import('./admin/AdminVendorContracts'));
const AdminWaivers = lazy(() => import('./admin/AdminWaivers'));
const AdminFeedback = lazy(() => import('./admin/AdminFeedback'));
const AdminCustomers = lazy(() => import('./admin/AdminCustomers'));
const AdminCustomerDetail = lazy(() => import('./admin/AdminCustomerDetail'));
const AdminBookings = lazy(() => import('./admin/AdminBookings'));
const AdminBookingsDetail = lazy(() => import('./admin/AdminBookingsDetail'));
const AdminToday = lazy(() => import('./admin/AdminToday'));
const AdminStaff = lazy(() => import('./admin/AdminStaff'));
const AdminStaffDetail = lazy(() => import('./admin/AdminStaffDetail'));
const AdminStaffLibrary = lazy(() => import('./admin/AdminStaffLibrary'));
const AdminStaffDocumentEditor = lazy(() => import('./admin/AdminStaffDocumentEditor'));
const AdminStaff1099Thresholds = lazy(() => import('./admin/AdminStaff1099Thresholds'));

// Portal (M5 Batch 6) — Tier 3 light-access magic-link portal
const PortalLayout = lazy(() => import('./portal/PortalLayout'));
const PortalHome = lazy(() => import('./portal/PortalHome'));
const PortalDocument = lazy(() => import('./portal/PortalDocument'));
const PortalAccount = lazy(() => import('./portal/PortalAccount'));
const PortalConsume = lazy(() => import('./portal/PortalConsume'));

// Event-day mode (M5 Batches 12-15)
const EventDayLayout = lazy(() => import('./event-day/EventDayLayout'));
const EventDayHome = lazy(() => import('./event-day/EventDayHome'));
const EventDayCheckIn = lazy(() => import('./event-day/CheckIn'));
const EventDayRoster = lazy(() => import('./event-day/RosterLookup'));
const EventDayIncident = lazy(() => import('./event-day/IncidentReport'));
const EventDayEquipment = lazy(() => import('./event-day/EquipmentReturn'));
const EventDayChecklist = lazy(() => import('./event-day/EventChecklist'));
const EventDayHQ = lazy(() => import('./event-day/EventHQ'));
const EventDayAttendeeDetail = lazy(() => import('./event-day/AttendeeDetail'));
const EventDayWalkUp = lazy(() => import('./event-day/WalkUpBooking'));

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={null}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="events" element={<Events />} />
            <Route path="events/:slug" element={<EventDetail />} />
            <Route path="locations" element={<Locations />} />
            <Route path="gallery" element={<Gallery />} />
            <Route path="pricing" element={<Pricing />} />
            <Route path="faq" element={<FAQ />} />
            <Route path="booking" element={<Booking />} />
            <Route path="booking/success" element={<BookingSuccess />} />
            <Route path="booking/cancelled" element={<BookingCancelled />} />
            <Route path="waiver" element={<Waiver />} />
            <Route path="booking/ticket" element={<Ticket />} />
            <Route path="contact" element={<Contact />} />
            <Route path="about" element={<About />} />
            <Route path="new-players" element={<NewPlayers />} />
            <Route path="rules-of-engagement" element={<RulesOfEngagement />} />
            <Route path="privacy" element={<Privacy />} />
            <Route path="feedback" element={<Feedback />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="v/:token" element={<VendorPackage />} />
          <Route path="vendor/login" element={<VendorLogin />} />
          <Route path="vendor/dashboard" element={<VendorDashboard />} />
          <Route path="portal/auth/consume" element={<PortalConsume />} />
          <Route path="event" element={<EventDayLayout />}>
            <Route index element={<EventDayHome />} />
            <Route path="check-in" element={<EventDayCheckIn />} />
            <Route path="attendee/:qrToken" element={<EventDayAttendeeDetail />} />
            <Route path="walkup" element={<EventDayWalkUp />} />
            <Route path="roster" element={<EventDayRoster />} />
            <Route path="incident" element={<EventDayIncident />} />
            <Route path="equipment-return" element={<EventDayEquipment />} />
            <Route path="checklist" element={<EventDayChecklist />} />
            <Route path="hq" element={<EventDayHQ />} />
          </Route>
          <Route path="portal" element={<PortalLayout />}>
            <Route index element={<PortalHome />} />
            <Route path="documents" element={<PortalDocument />} />
            <Route path="documents/:id" element={<PortalDocument />} />
            <Route path="account" element={<PortalAccount />} />
            <Route path="auth/signed-out" element={<PortalConsume />} />
          </Route>
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="login" element={<AdminLogin />} />
            <Route path="setup" element={<AdminSetup />} />
            <Route path="today" element={<AdminToday />} />
            <Route path="roster" element={<AdminRoster />} />
            <Route path="new-booking" element={<AdminNewBooking />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="settings/taxes-fees" element={<AdminTaxesFees />} />
            <Route path="settings/email-templates" element={<AdminEmailTemplates />} />
            <Route path="forgot-password" element={<AdminForgotPassword />} />
            <Route path="reset-password" element={<AdminResetPassword />} />
            <Route path="scan" element={<AdminScan />} />
            <Route path="rentals" element={<AdminRentals />} />
            <Route path="rentals/qr-sheet" element={<AdminRentalQrSheet />} />
            <Route path="rentals/assignments" element={<AdminRentalAssignments />} />
            <Route path="events" element={<AdminEvents />} />
            <Route path="promo-codes" element={<AdminPromoCodes />} />
            <Route path="analytics" element={<AdminAnalytics />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="accept-invite" element={<AdminAcceptInvite />} />
            <Route path="audit-log" element={<AdminAuditLog />} />
            <Route path="vendors" element={<AdminVendors />} />
            <Route path="vendor-packages" element={<AdminVendorPackages />} />
            <Route path="vendor-packages/:id" element={<AdminVendorPackages />} />
            <Route path="vendor-contracts" element={<AdminVendorContracts />} />
            <Route path="waivers" element={<AdminWaivers />} />
            <Route path="feedback" element={<AdminFeedback />} />
            <Route path="customers" element={<AdminCustomers />} />
            <Route path="customers/:id" element={<AdminCustomerDetail />} />
            <Route path="bookings" element={<AdminBookings />} />
            <Route path="bookings/:id" element={<AdminBookingsDetail />} />
            <Route path="staff" element={<AdminStaff />} />
            <Route path="staff/:id" element={<AdminStaffDetail />} />
            <Route path="staff/library" element={<AdminStaffLibrary />} />
            <Route path="staff/library/new" element={<AdminStaffDocumentEditor />} />
            <Route path="staff/library/:id" element={<AdminStaffDocumentEditor />} />
            <Route path="staff/1099-thresholds" element={<AdminStaff1099Thresholds />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
