// Post-M6 Track C — public past-games archive page.
//
// Lists past events (events.past=1) with their embedded YouTube videos +
// photo gallery links. Backed by GET /api/events?include_past=1&archive=1
// which attaches an `archiveLinks` array per event with computed embedUrl.
// Phase 1 = external links only (no R2 hosting).

import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../components/SEO';

export default function GameArchive() {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filterYear, setFilterYear] = useState('all');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/events?include_past=1&archive=1', { cache: 'no-store' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (!cancelled) setEvents(data.events || []);
            } catch (e) {
                if (!cancelled) setError(String(e.message || e));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const pastEvents = useMemo(
        () => events.filter((e) => e.past && (e.archiveLinks || []).length > 0),
        [events],
    );

    const yearOptions = useMemo(() => {
        const set = new Set(pastEvents.map((e) => (e.dateIso || '').slice(0, 4)).filter(Boolean));
        return Array.from(set).sort().reverse();
    }, [pastEvents]);

    const filtered = useMemo(() => {
        if (filterYear === 'all') return pastEvents;
        return pastEvents.filter((e) => (e.dateIso || '').startsWith(filterYear));
    }, [pastEvents, filterYear]);

    return (
        <>
            <SEO
                title="Past Games | Air Action Sports"
                description="Browse highlight videos and photo galleries from past airsoft operations at Air Action Sports. Recap the action from previous events."
                canonical="https://airactionsport.com/games"
                ogImage="https://airactionsport.com/images/og-image.jpg"
            />

            <div className="page-content" style={pageWrap}>
                <div className="section-label">&#9632; Past Games</div>
                <h1 className="section-title">After-Action Reports.</h1>
                <div className="divider"></div>
                <p className="section-sub">
                    Highlight reels and photos from past operations. Catch the action you missed —
                    or relive the one you were in.
                </p>

                {yearOptions.length > 1 && (
                    <div className="filter-bar" style={filterBar}>
                        <span className="filter-label">&#9632; Filter by Year</span>
                        <div className="filter-controls">
                            <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)}>
                                <option value="all">All Years</option>
                                {yearOptions.map((y) => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                )}

                {loading && <p style={loadingMsg}>Loading past games…</p>}
                {error && <p style={errorMsg}>Error loading archive: {error}</p>}

                {!loading && !error && filtered.length === 0 && (
                    <p style={emptyMsg}>
                        No archived games yet. Check back after the next operation wraps.
                    </p>
                )}

                {!loading && !error && filtered.map((event) => (
                    <article key={event.id} style={eventCard}>
                        <header style={eventHeader}>
                            <h2 style={eventTitle}>
                                <Link to={`/events/${event.slug || event.id}`} style={titleLink}>
                                    {event.title}
                                </Link>
                            </h2>
                            <div style={eventMeta}>
                                <span>{formatDate(event.dateIso)}</span>
                                {event.location && <span> · {event.location}</span>}
                            </div>
                        </header>

                        {event.archiveLinks?.filter((l) => l.kind === 'video' && l.embedUrl).length > 0 && (
                            <div style={videoSection}>
                                <h3 style={sectionLabel}>Highlights</h3>
                                <div style={videoGrid}>
                                    {event.archiveLinks
                                        .filter((l) => l.kind === 'video' && l.embedUrl)
                                        .map((link) => (
                                            <div key={link.id} style={videoWrap}>
                                                <iframe
                                                    src={link.embedUrl}
                                                    title={link.title || `${event.title} highlight`}
                                                    style={videoFrame}
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                    allowFullScreen
                                                />
                                                {link.title && <p style={videoCaption}>{link.title}</p>}
                                            </div>
                                        ))}
                                </div>
                            </div>
                        )}

                        {event.archiveLinks?.filter((l) => l.kind === 'photo').length > 0 && (
                            <div style={photoSection}>
                                <h3 style={sectionLabel}>Photos</h3>
                                <div style={photoGrid}>
                                    {event.archiveLinks
                                        .filter((l) => l.kind === 'photo')
                                        .map((link) => (
                                            <a
                                                key={link.id}
                                                href={link.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={photoCard}
                                            >
                                                {link.thumbnailUrl ? (
                                                    <img src={link.thumbnailUrl} alt={link.title || 'Photo gallery'} style={photoImg} />
                                                ) : (
                                                    <div style={photoPlaceholder}>📷</div>
                                                )}
                                                <span style={photoTitle}>{link.title || 'View gallery'}</span>
                                            </a>
                                        ))}
                                </div>
                            </div>
                        )}
                    </article>
                ))}
            </div>
        </>
    );
}

function formatDate(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso + 'T00:00:00Z');
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    } catch {
        return iso;
    }
}

// ── Inline styles (matches /events page conventions) ────────────────
const pageWrap = { maxWidth: 1200, margin: '0 auto', padding: '2rem 1rem' };
const filterBar = { display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' };
const loadingMsg = { color: 'var(--olive-light)', textAlign: 'center', padding: '2rem' };
const errorMsg = { color: 'var(--orange)', textAlign: 'center', padding: '2rem' };
const emptyMsg = { color: 'var(--olive-light)', textAlign: 'center', padding: '3rem 1rem', fontStyle: 'italic' };
const eventCard = { background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', padding: '1.5rem', marginBottom: '2rem', borderRadius: 4 };
const eventHeader = { marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' };
const eventTitle = { margin: 0, fontSize: '1.75rem', color: 'var(--white)', letterSpacing: 'var(--letter-spacing-wide)' };
const titleLink = { color: 'inherit', textDecoration: 'none' };
const eventMeta = { color: 'var(--olive-light)', fontSize: '0.9rem', marginTop: '0.25rem' };
const sectionLabel = { color: 'var(--orange)', fontSize: '0.85rem', letterSpacing: 'var(--letter-spacing-wider)', textTransform: 'uppercase', marginBottom: '1rem' };
const videoSection = { marginBottom: '1.5rem' };
const videoGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' };
const videoWrap = { position: 'relative' };
const videoFrame = { width: '100%', aspectRatio: '16/9', border: 0, borderRadius: 4, display: 'block' };
const videoCaption = { color: 'var(--olive-light)', fontSize: '0.85rem', marginTop: '0.5rem', textAlign: 'center' };
const photoSection = { marginBottom: '0.5rem' };
const photoGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' };
const photoCard = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', padding: '1rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--white)', textDecoration: 'none', borderRadius: 4, transition: 'background 0.15s' };
const photoImg = { width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 2 };
const photoPlaceholder = { width: '100%', aspectRatio: '4/3', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', borderRadius: 2 };
const photoTitle = { fontSize: '0.85rem', textAlign: 'center' };
