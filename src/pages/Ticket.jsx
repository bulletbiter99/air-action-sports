import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';

// Print-friendly per-attendee ticket. Loaded via /booking/ticket?token=<qrToken>.
// Auto-triggers window.print() once QR renders. Browser handles the PDF save.
export default function Ticket() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const auto = params.get('auto') !== '0'; // auto-print unless ?auto=0

  const [attendee, setAttendee] = useState(null);
  const [event, setEvent] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [error, setError] = useState(null);
  const printedRef = useRef(false);

  useEffect(() => {
    if (!token) { setError('No token provided'); return; }
    (async () => {
      try {
        const res = await fetch(`/api/waivers/${encodeURIComponent(token)}`, { cache: 'no-store' });
        if (!res.ok) { setError('Ticket not found'); return; }
        const data = await res.json();
        setAttendee(data.attendee);
        setEvent(data.event);
        const url = await QRCode.toDataURL(token, { width: 512, margin: 1 });
        setQrDataUrl(url);
      } catch {
        setError('Network error');
      }
    })();
  }, [token]);

  useEffect(() => {
    if (auto && attendee && event && qrDataUrl && !printedRef.current) {
      printedRef.current = true;
      setTimeout(() => window.print(), 400);
    }
  }, [auto, attendee, event, qrDataUrl]);

  if (error) {
    return (
      <div style={errorShell}>
        <p>{error}</p>
      </div>
    );
  }

  if (!attendee || !event || !qrDataUrl) {
    return <div style={errorShell}><p>Loading ticket…</p></div>;
  }

  return (
    <div style={page}>
      <style>{`
        @media print {
          @page { size: letter; margin: 0.5in; }
          body { background: #fff; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print" style={{ maxWidth: 640, margin: '20px auto', padding: '0 16px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={() => window.print()} style={printBtn}>Print / Save as PDF</button>
      </div>

      <div style={ticket}>
        <div style={ticketHeader}>
          <div style={brand}>AIR ACTION SPORTS</div>
          <div style={eyebrow}>Event Ticket</div>
        </div>

        <h1 style={eventTitle}>{event.title}</h1>
        <div style={eventMeta}>
          <div><strong>Date</strong><br />{event.displayDate || event.dateIso?.slice(0, 10)}</div>
          <div><strong>Location</strong><br />{event.location || '—'}</div>
          <div><strong>Check-in</strong><br />{event.checkIn || event.timeRange || '—'}</div>
          <div><strong>First game</strong><br />{event.firstGame || '—'}</div>
        </div>

        <div style={divider} />

        <div style={playerSection}>
          <div style={eyebrow}>Player</div>
          <div style={playerName}>{attendee.firstName} {attendee.lastName || ''}</div>
          {attendee.alreadySigned && <div style={signedPill}>✓ Waiver signed</div>}
          {!attendee.alreadySigned && <div style={pendingPill}>⚠ Waiver pending — sign before arrival</div>}
        </div>

        <div style={qrWrap}>
          <img src={qrDataUrl} alt="QR code" style={qrImg} />
          <div style={qrCaption}>Show this code at check-in</div>
        </div>

        <div style={instructions}>
          <div style={eyebrow}>Before you arrive</div>
          <ol style={{ margin: '6pt 0 0', paddingLeft: 18, fontSize: '11pt', lineHeight: 1.5 }}>
            <li>Sign your waiver online if you haven't: <strong>{event.title ? `airactionsport.com/waiver?token=${(attendee.qrToken || '').slice(0, 8)}…` : ''}</strong></li>
            <li>Bring photo ID (for the booking buyer)</li>
            <li>Wear clothes for outdoor activity and the day's weather</li>
            <li>Arrive during the check-in window for safety briefing</li>
          </ol>
        </div>

        <div style={footer}>
          <span>airactionsport.com</span>
          <span>Ticket token {String(attendee.qrToken || '').slice(0, 8)}…</span>
        </div>
      </div>
    </div>
  );
}

const page = { background: '#eee', minHeight: '100vh', padding: '20px 0' };
const ticket = {
  background: '#fff', color: '#222', maxWidth: 640, margin: '0 auto',
  padding: '0.75in', border: '1px solid #ccc',
  fontFamily: 'Arial, Helvetica, sans-serif',
};
const ticketHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25in' };
const brand = { fontWeight: 900, fontSize: '12pt', letterSpacing: '2pt', color: '#d4541a' };
const eyebrow = { fontSize: '8pt', fontWeight: 700, letterSpacing: '2pt', textTransform: 'uppercase', color: '#777' };
const eventTitle = { fontSize: '22pt', fontWeight: 900, margin: '0 0 12pt', lineHeight: 1.1 };
const eventMeta = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10pt', fontSize: '10pt', lineHeight: 1.4 };
const divider = { borderTop: '1px dashed #ccc', margin: '18pt 0' };
const playerSection = { marginBottom: '14pt' };
const playerName = { fontSize: '18pt', fontWeight: 700, marginTop: '2pt' };
const signedPill = { display: 'inline-block', marginTop: '4pt', padding: '2pt 8pt', background: '#e6f5ea', color: '#1a7333', fontSize: '9pt', fontWeight: 700 };
const pendingPill = { display: 'inline-block', marginTop: '4pt', padding: '2pt 8pt', background: '#fff3e0', color: '#8a4b00', fontSize: '9pt', fontWeight: 700 };
const qrWrap = { textAlign: 'center', margin: '12pt 0' };
const qrImg = { width: '2.5in', height: '2.5in', border: '1px solid #ddd' };
const qrCaption = { marginTop: '4pt', fontSize: '10pt', color: '#555' };
const instructions = { marginTop: '14pt', padding: '12pt', background: '#fafafa', border: '1px solid #eee' };
const footer = { marginTop: '16pt', paddingTop: '10pt', borderTop: '1px solid #eee', fontSize: '8pt', color: '#999', display: 'flex', justifyContent: 'space-between' };
const errorShell = { textAlign: 'center', padding: '4rem', color: '#555', fontFamily: 'Arial, sans-serif', background: '#eee', minHeight: '100vh' };
const printBtn = { padding: '10px 18px', background: '#d4541a', color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, letterSpacing: 1, cursor: 'pointer' };
