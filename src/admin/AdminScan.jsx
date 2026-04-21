import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrowserMultiFormatReader, BrowserCodeReader } from '@zxing/browser';
import { useAdmin } from './AdminContext';

export default function AdminScan() {
  const { isAuthenticated, loading } = useAdmin();
  const navigate = useNavigate();

  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const controlsRef = useRef(null);
  const lastScanRef = useRef({ token: null, at: 0 });

  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(null); // { kind: 'ok'|'warn'|'err', msg }
  const [current, setCurrent] = useState(null); // { type, data }
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [rentalItems, setRentalItems] = useState([]);
  const [showAssignPicker, setShowAssignPicker] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  const stopScan = useCallback(() => {
    try { controlsRef.current?.stop?.(); } catch {}
    controlsRef.current = null;
    setScanning(false);
  }, []);

  const startScan = useCallback(async (overrideDeviceId) => {
    setError('');
    if (!videoRef.current) return;
    try {
      if (!readerRef.current) readerRef.current = new BrowserMultiFormatReader();
      stopScan();
      const useId = overrideDeviceId || deviceId || undefined;
      const constraints = useId
        ? { video: { deviceId: { exact: useId } } }
        : { video: { facingMode: { ideal: 'environment' } } };
      const controls = await readerRef.current.decodeFromConstraints(
        constraints,
        videoRef.current,
        (result, err) => {
          if (result) handleScan(result.getText());
        }
      );
      controlsRef.current = controls;
      setScanning(true);
    } catch (e) {
      setError(e.message || 'Unable to start camera. Grant camera permission and retry.');
      setScanning(false);
    }
  }, [deviceId, stopScan]);

  useEffect(() => {
    // Populate camera list
    (async () => {
      try {
        const list = await BrowserCodeReader.listVideoInputDevices();
        setDevices(list);
        const back = list.find((d) => /back|rear|environment/i.test(d.label)) || list[list.length - 1];
        if (back) setDeviceId(back.deviceId);
      } catch {}
    })();
    return () => stopScan();
  }, [stopScan]);

  const showFlash = (kind, msg, ms = 1600) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), ms);
  };

  const handleScan = async (text) => {
    const now = Date.now();
    const last = lastScanRef.current;
    // Debounce identical reads for 2s
    if (last.token === text && now - last.at < 2000) return;
    lastScanRef.current = { token: text, at: now };

    try {
      const res = await fetch(`/api/admin/rentals/lookup/${encodeURIComponent(text)}`, {
        credentials: 'include', cache: 'no-store',
      });
      if (!res.ok) {
        showFlash('err', 'QR not recognized');
        return;
      }
      const data = await res.json();
      if (data.type === 'attendee') {
        await loadAttendee(data.qrToken);
      } else if (data.type === 'item') {
        setCurrent({ type: 'item', data: data.item });
        setHistory((h) => [{ at: now, label: `Item: ${data.item.name} (${data.item.sku})` }, ...h].slice(0, 10));
        showFlash('ok', 'Item scanned');
      }
    } catch (e) {
      showFlash('err', 'Scan failed');
    }
  };

  const loadAttendee = async (qrToken) => {
    const res = await fetch(`/api/admin/attendees/by-qr/${encodeURIComponent(qrToken)}`, {
      credentials: 'include', cache: 'no-store',
    });
    if (!res.ok) { showFlash('err', 'Attendee lookup failed'); return; }
    const data = await res.json();
    setCurrent({ type: 'attendee', data });
    setHistory((h) => [{ at: Date.now(), label: `Player: ${data.attendee.firstName} ${data.attendee.lastName || ''}` }, ...h].slice(0, 10));
    if (!data.attendee.waiverSigned) showFlash('warn', 'Waiver not signed');
    else if (data.attendee.checkedInAt) showFlash('ok', 'Already checked in');
    else showFlash('ok', 'Ready to check in');
  };

  const checkIn = async () => {
    if (current?.type !== 'attendee') return;
    setBusy(true);
    const id = current.data.attendee.id;
    const res = await fetch(`/api/admin/attendees/${id}/check-in`, {
      method: 'POST', credentials: 'include',
    });
    setBusy(false);
    if (res.ok) {
      await loadAttendee(current.data.attendee.qrToken);
      showFlash('ok', 'Checked in');
    } else showFlash('err', 'Check-in failed');
  };

  const checkOut = async () => {
    if (current?.type !== 'attendee') return;
    if (!window.confirm('Undo check-in?')) return;
    setBusy(true);
    const id = current.data.attendee.id;
    const res = await fetch(`/api/admin/attendees/${id}/check-out`, {
      method: 'POST', credentials: 'include',
    });
    setBusy(false);
    if (res.ok) {
      await loadAttendee(current.data.attendee.qrToken);
      showFlash('ok', 'Check-in undone');
    }
  };

  const openAssignPicker = async () => {
    setShowAssignPicker(true);
    const res = await fetch('/api/admin/rentals/items?status=available', {
      credentials: 'include', cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      setRentalItems(data.items || []);
    }
  };

  const assignItem = async (itemId) => {
    if (current?.type !== 'attendee') return;
    setBusy(true);
    const res = await fetch('/api/admin/rentals/assignments', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rentalItemId: itemId, attendeeId: current.data.attendee.id }),
    });
    setBusy(false);
    setShowAssignPicker(false);
    if (res.ok) {
      await loadAttendee(current.data.attendee.qrToken);
      showFlash('ok', 'Rental assigned');
    } else {
      const data = await res.json().catch(() => ({}));
      showFlash('err', data.error || 'Assignment failed');
    }
  };

  const returnItem = async (assignmentId) => {
    const condition = window.prompt('Condition on return? (good / fair / damaged / lost)', 'good');
    if (!condition) return;
    const cond = condition.toLowerCase().trim();
    if (!['good', 'fair', 'damaged', 'lost'].includes(cond)) { showFlash('err', 'Invalid condition'); return; }
    const notes = cond === 'damaged' || cond === 'lost' ? window.prompt('Damage notes (optional)') || '' : '';
    setBusy(true);
    const res = await fetch(`/api/admin/rentals/assignments/${assignmentId}/return`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditionOnReturn: cond, damageNotes: notes || undefined }),
    });
    setBusy(false);
    if (res.ok) {
      if (current?.type === 'attendee') await loadAttendee(current.data.attendee.qrToken);
      else if (current?.type === 'item') {
        // reload item via lookup
        const r = await fetch(`/api/admin/rentals/lookup/${current.data.id}`, { credentials: 'include', cache: 'no-store' });
        if (r.ok) setCurrent({ type: 'item', data: (await r.json()).item });
      }
      showFlash('ok', 'Item returned');
    } else showFlash('err', 'Return failed');
  };

  if (loading || !isAuthenticated) return null;

  return (
    <div style={container}>
      <h1 style={h1}>QR Scanner</h1>

      <div style={videoBox}>
        <video ref={videoRef} style={videoEl} playsInline muted />
        {!scanning && (
          <div style={videoOverlay}>
            <button style={startBtn} onClick={() => startScan()}>Start Camera</button>
            {error && <div style={{ color: '#e74c3c', marginTop: 12, fontSize: 12 }}>{error}</div>}
          </div>
        )}
        {scanning && <div style={scanFrame} />}
        {flash && (
          <div style={{ ...flashBanner, background: flashBg[flash.kind] }}>{flash.msg}</div>
        )}
      </div>

      <div style={controls}>
        {devices.length > 1 && (
          <select
            value={deviceId}
            onChange={(e) => { setDeviceId(e.target.value); if (scanning) startScan(e.target.value); }}
            style={input}
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>
            ))}
          </select>
        )}
        {scanning ? (
          <button onClick={stopScan} style={stopBtn}>Stop</button>
        ) : (
          <button onClick={() => startScan()} style={startBtnSmall}>Start</button>
        )}
      </div>

      {current?.type === 'attendee' && (
        <AttendeeCard
          data={current.data}
          busy={busy}
          onCheckIn={checkIn}
          onCheckOut={checkOut}
          onAssignRental={openAssignPicker}
          onReturnRental={returnItem}
        />
      )}

      {current?.type === 'item' && (
        <ItemCard data={current.data} busy={busy} onReturn={returnItem} />
      )}

      {showAssignPicker && (
        <AssignPicker
          items={rentalItems}
          onPick={assignItem}
          onClose={() => setShowAssignPicker(false)}
          busy={busy}
        />
      )}

      {history.length > 0 && (
        <div style={historyBox}>
          <div style={historyTitle}>Recent scans</div>
          {history.map((h, i) => (
            <div key={i} style={historyRow}>
              <span style={{ color: 'var(--olive-light)', fontSize: 11 }}>
                {new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span style={{ color: 'var(--cream)' }}>{h.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AttendeeCard({ data, busy, onCheckIn, onCheckOut, onAssignRental, onReturnRental }) {
  const { attendee, event, rentalAssignments } = data;
  const openRentals = (rentalAssignments || []).filter((r) => !r.checkedInAt);
  return (
    <div style={card}>
      <div style={cardHeader}>
        <div>
          <div style={cardLabel}>Player</div>
          <div style={cardTitle}>{attendee.firstName} {attendee.lastName || ''}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={cardLabel}>{event?.title || ''}</div>
          <div style={{ fontSize: 12, color: 'var(--tan-light)' }}>{event?.displayDate || ''}</div>
        </div>
      </div>

      <div style={badges}>
        {attendee.checkedInAt ? (
          <span style={{ ...badge, background: '#1e6b3a', color: '#a7ebb6' }}>
            ✓ Checked in {new Date(attendee.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        ) : (
          <span style={{ ...badge, background: '#333', color: 'var(--tan-light)' }}>Not checked in</span>
        )}
        {attendee.waiverSigned ? (
          <span style={{ ...badge, background: '#1e6b3a', color: '#a7ebb6' }}>✓ Waiver signed</span>
        ) : (
          <span style={{ ...badge, background: '#7a3a1a', color: '#ffce99' }}>⚠ Waiver pending</span>
        )}
        {attendee.isMinor && <span style={{ ...badge, background: '#7a3a1a', color: '#ffce99' }}>MINOR</span>}
        {attendee.ticketType && <span style={{ ...badge, background: '#2a3a5a', color: '#cfdcff' }}>{attendee.ticketType}</span>}
      </div>

      <div style={actions}>
        {!attendee.checkedInAt ? (
          <button onClick={onCheckIn} disabled={busy} style={primaryBtn}>Check In</button>
        ) : (
          <button onClick={onCheckOut} disabled={busy} style={subtleBtn}>Undo Check-in</button>
        )}
        <button onClick={onAssignRental} disabled={busy} style={secondaryBtn}>Assign Rental</button>
      </div>

      {openRentals.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={cardLabel}>Open rentals</div>
          {openRentals.map((r) => (
            <div key={r.id} style={rentalRow}>
              <span>{r.itemName} <span style={{ color: 'var(--olive-light)', fontSize: 11 }}>({r.itemSku})</span></span>
              <button onClick={() => onReturnRental(r.id)} disabled={busy} style={subtleBtn}>Return</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemCard({ data, busy, onReturn }) {
  return (
    <div style={card}>
      <div style={cardHeader}>
        <div>
          <div style={cardLabel}>Rental Item</div>
          <div style={cardTitle}>{data.name}</div>
          <div style={{ fontSize: 12, color: 'var(--olive-light)', fontFamily: 'monospace' }}>{data.sku}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={cardLabel}>{data.category}</div>
          <div style={{ fontSize: 12, color: 'var(--tan-light)' }}>{data.condition}</div>
        </div>
      </div>

      <div style={badges}>
        {data.status === 'assigned' && (
          <span style={{ ...badge, background: '#7a3a1a', color: '#ffce99' }}>
            Assigned to {data.currentAssignment?.attendeeName}
          </span>
        )}
        {data.status === 'available' && (
          <span style={{ ...badge, background: '#1e6b3a', color: '#a7ebb6' }}>Available</span>
        )}
        {data.status === 'retired' && (
          <span style={{ ...badge, background: '#555', color: '#ccc' }}>Retired</span>
        )}
      </div>

      {data.status === 'assigned' && (
        <div style={actions}>
          <button onClick={() => onReturn(data.currentAssignment.id)} disabled={busy} style={primaryBtn}>Mark Returned</button>
        </div>
      )}
    </div>
  );
}

function AssignPicker({ items, onPick, onClose, busy }) {
  const [q, setQ] = useState('');
  const filtered = items.filter((i) => {
    if (!q.trim()) return true;
    const h = `${i.name} ${i.sku} ${i.category}`.toLowerCase();
    return h.includes(q.toLowerCase());
  });
  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: 'var(--cream)', fontSize: 14, letterSpacing: 1.5, textTransform: 'uppercase' }}>Assign rental</h3>
          <button onClick={onClose} style={subtleBtn}>Close</button>
        </div>
        <input
          autoFocus
          type="search"
          placeholder="Search name, SKU, category…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ ...input, width: '100%', marginBottom: 10 }}
        />
        <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {filtered.length === 0 && <div style={{ color: 'var(--olive-light)', padding: 12 }}>No available items.</div>}
          {filtered.map((i) => (
            <div key={i.id} style={rentalRow}>
              <div>
                <div style={{ color: 'var(--cream)' }}>{i.name}</div>
                <div style={{ color: 'var(--olive-light)', fontSize: 11, fontFamily: 'monospace' }}>{i.sku} · {i.category}</div>
              </div>
              <button onClick={() => onPick(i.id)} disabled={busy} style={primaryBtn}>Assign</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const container = { maxWidth: 720, margin: '0 auto', padding: '1.5rem' };
const h1 = { fontSize: 24, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.5px', color: 'var(--cream)', margin: '0 0 1rem' };
const videoBox = { position: 'relative', background: '#000', aspectRatio: '4/3', overflow: 'hidden', borderRadius: 4, border: '1px solid rgba(200,184,154,0.15)' };
const videoEl = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const videoOverlay = { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' };
const scanFrame = { position: 'absolute', top: '15%', left: '15%', right: '15%', bottom: '15%', border: '2px solid var(--orange)', pointerEvents: 'none', borderRadius: 8 };
const flashBanner = { position: 'absolute', left: 0, right: 0, top: 12, margin: '0 auto', maxWidth: 260, padding: '10px 16px', textAlign: 'center', fontSize: 13, fontWeight: 800, color: '#fff', borderRadius: 4, letterSpacing: 1 };
const flashBg = { ok: '#2e8b3a', warn: '#c27613', err: '#b83434' };
const controls = { display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' };
const startBtn = { padding: '14px 28px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const startBtnSmall = { ...startBtn, padding: '10px 18px', fontSize: 11 };
const stopBtn = { ...startBtnSmall, background: '#333' };
const input = { padding: '10px 12px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit' };
const card = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.15)', padding: '1.25rem', marginTop: 16 };
const cardHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 };
const cardLabel = { fontSize: 10, fontWeight: 800, letterSpacing: 2, color: 'var(--orange)', textTransform: 'uppercase' };
const cardTitle = { fontSize: 20, fontWeight: 800, color: 'var(--cream)' };
const badges = { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 };
const badge = { padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 3 };
const actions = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const primaryBtn = { padding: '10px 18px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const secondaryBtn = { padding: '10px 18px', background: 'var(--olive)', color: 'var(--cream)', border: '1px solid var(--olive-light)', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const subtleBtn = { padding: '6px 12px', background: 'transparent', border: '1px solid rgba(200,184,154,0.25)', color: 'var(--tan-light)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' };
const rentalRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(200,184,154,0.08)', color: 'var(--cream)', fontSize: 13 };
const historyBox = { marginTop: 18, background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)', padding: '1rem' };
const historyTitle = { fontSize: 10, fontWeight: 800, letterSpacing: 2, color: 'var(--orange)', textTransform: 'uppercase', marginBottom: 8 };
const historyRow = { display: 'flex', gap: 12, padding: '4px 0', fontSize: 12 };
const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.2)', padding: '1.25rem', width: '100%', maxWidth: 560, borderRadius: 4 };
