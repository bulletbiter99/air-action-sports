import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import '../styles/pages/gallery.css';

const galleryItems = [
  { category: 'delta', label: 'Ghost Town \u2014 Overview', bg: '#3a4232', wide: true },
  { category: 'delta', label: 'Ghost Town \u2014 Streets', bg: '#2c3127', wide: false },
  { category: 'echo', label: 'Echo Urban \u2014 CQB Corridor', bg: '#2e3229', wide: false },
  { category: 'echo', label: 'Echo Urban \u2014 Multi-Floor', bg: '#353a30', wide: false },
  { category: 'events', label: 'Operation Nightfall \u2014 Squad Advance', bg: '#1a1c18', wide: true },
  { category: 'action', label: 'Game Day \u2014 Tactical Movement', bg: '#3a4232', wide: false },
  { category: 'delta', label: 'Ghost Town \u2014 Bunker System', bg: '#2c3127', wide: false },
  { category: 'action', label: 'Game Day \u2014 Gear Check', bg: '#353a30', wide: false },
  { category: 'foxtrot', label: 'Foxtrot Fields \u2014 Open Terrain', bg: '#3a4232', wide: true },
  { category: 'events', label: 'Shadow Protocol \u2014 Night Ops', bg: '#1a1c18', wide: false },
  { category: 'echo', label: 'Echo Urban \u2014 Low Light', bg: '#2e3229', wide: false },
  { category: 'action', label: 'Game Day \u2014 Victory', bg: '#353a30', wide: false },
];

const tabs = [
  { filter: 'all', label: 'All' },
  { filter: 'delta', label: 'Ghost Town' },
  { filter: 'echo', label: 'Echo Urban' },
  { filter: 'foxtrot', label: 'Foxtrot Fields' },
  { filter: 'events', label: 'Events' },
  { filter: 'action', label: 'Action Shots' },
];

export default function Gallery() {
  const [activeTab, setActiveTab] = useState('all');
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);

  const visibleItems = activeTab === 'all'
    ? galleryItems
    : galleryItems.filter((item) => item.category === activeTab);

  const openLightbox = (index) => {
    setCurrentIndex(index);
    setLightboxOpen(true);
    document.body.style.overflow = 'hidden';
  };

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    setCurrentIndex(-1);
    document.body.style.overflow = '';
  }, []);

  const showPrev = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : visibleItems.length - 1));
  }, [visibleItems.length]);

  const showNext = useCallback(() => {
    setCurrentIndex((prev) => (prev < visibleItems.length - 1 ? prev + 1 : 0));
  }, [visibleItems.length]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (!lightboxOpen) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') showPrev();
      if (e.key === 'ArrowRight') showNext();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [lightboxOpen, closeLightbox, showPrev, showNext]);

  return (
    <>
      <SEO
        title="Gallery | Air Action Sports"
        description="Photos and videos from Air Action Sports airsoft events. See our locations, game days, and tactical operations in action."
        canonical="https://airactionsport.com/gallery"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      <div className="page-content">
        <div className="section-label">&#9632; Gallery</div>
        <h1 className="section-title">See the Battlefield.</h1>
        <div className="divider"></div>

        {/* Filter Tabs */}
        <div className="gallery-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.filter}
              className={`gallery-tab ${activeTab === tab.filter ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.filter)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Photo Grid */}
        <div className="photo-grid">
          {visibleItems.map((item, index) => (
            <div
              key={index}
              className={`photo-item ${item.wide ? 'wide' : ''}`}
              data-category={item.category}
              aria-label={item.label}
              role="img"
              tabIndex="0"
              style={{ background: item.bg }}
              onClick={() => openLightbox(index)}
            >
              <div className="photo-label">
                <span>{item.label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Lightbox */}
        <div
          className={`lightbox ${lightboxOpen ? 'active' : ''}`}
          onClick={(e) => { if (e.target === e.currentTarget) closeLightbox(); }}
        >
          <button className="lightbox-close" aria-label="Close lightbox" onClick={closeLightbox}>
            &times;
          </button>
          <button className="lightbox-nav lightbox-prev" aria-label="Previous photo" onClick={showPrev}>
            &#8249;
          </button>
          <button className="lightbox-nav lightbox-next" aria-label="Next photo" onClick={showNext}>
            &#8250;
          </button>
          <div className="lightbox-placeholder">
            {currentIndex >= 0 && visibleItems[currentIndex]
              ? visibleItems[currentIndex].label
              : 'Photo Placeholder'}
          </div>
          <div className="lightbox-caption">
            {currentIndex >= 0 && visibleItems[currentIndex]
              ? visibleItems[currentIndex].label
              : ''}
          </div>
        </div>

        {/* Submit Photos CTA */}
        <div className="submit-cta">
          <h3>Got Photos?</h3>
          <p>Tag us @airactionsports or email your best shots to be featured.</p>
          <Link to="/contact" className="btn-primary">&#9658; Submit Photos</Link>
        </div>
      </div>

      {/* CTA Band */}
      <div className="cta-band">
        <h2>Ready to Deploy?</h2>
        <p>Secure your spot at the next game day.</p>
        <Link to="/booking" className="btn-white">Book Now</Link>
      </div>
    </>
  );
}
