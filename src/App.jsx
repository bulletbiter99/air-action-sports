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
const Contact = lazy(() => import('./pages/Contact'));
const Waiver = lazy(() => import('./pages/Waiver'));
const About = lazy(() => import('./pages/About'));
const NewPlayers = lazy(() => import('./pages/NewPlayers'));
const Privacy = lazy(() => import('./pages/Privacy'));
const NotFound = lazy(() => import('./pages/NotFound'));

// Admin
const AdminLayout = lazy(() => import('./admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./admin/AdminDashboard'));
const AdminLogin = lazy(() => import('./admin/AdminLogin'));

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
            <Route path="contact" element={<Contact />} />
            <Route path="waiver" element={<Waiver />} />
            <Route path="about" element={<About />} />
            <Route path="new-players" element={<NewPlayers />} />
            <Route path="privacy" element={<Privacy />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="login" element={<AdminLogin />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
