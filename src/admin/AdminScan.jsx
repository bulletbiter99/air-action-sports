import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrowserMultiFormatReader, BrowserCodeReader } from '@zxing/browser';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';

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
  const [flash, setFlash] = useState(null);
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [rentalItems, setRentalItems] = useState([]);
  const [showAssignPicker, setShowAssignPicker] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  const stopScan = useCallback(() => {
    try { controlsRef.current?.stop?.(); } catch { /* ignore */ }
    controlsRef.current = null;
    setScanning(false);
  }, []);

  const handleScan = useCallback(async (text) => {
    const now = Date.now();
    const last = lastScanRef.current;
    if (last.token === text && now - last.at < 2000) return;
    lastScanRef.current = { token: text, at: now };

    const showFlashLocal = (kind, msg, ms = 1600) => {
      setFlash({ kind, msg });
      setTimeout(() => setFlash(null), ms);
    };

    try {
      const res = await fetch(`/api/admin/rentals/lookup/${encodeURIComponent(text)}`, {
        credentials: 'include', cache: 'no-store',
      });
      if (!res.ok) {
        showFlashLocal('err', 'QR not recognized');
        return;
      }
      const data = await res.json();
      if (data.type === 'attendee') {
        const aRes = await fetch(`/api/admin/attendees/by-qr/${encodeURIComponent(data.qrToken)}`, {
          credentials: 'include', cache: 'no-store',
        });
        if (!aRes.ok) { showFlashLocal('err', 'Attendee lookup failed'); return; }
        const aData = await aRes.json();
        setCurrent({ type: 'attendee', data: aData });
        setHistory((h) => [{ at: Date.now(), label: `Player: ${aData.attendee.firstName} ${aData.attendee.lastName || ''}` }, ...h].slice(0, 10));
        if (!aData.attendee.waiverSigned) showFlashLocal('warn', 'Waiver not signed');
        else if (aData.attendee.checkedInAt) showFlashLocal('ok', 'Already checked in');
        else showFlashLocal('ok', 'Ready to check in');
      } else if (data.type === 'item') {
        setCurrent({ type: 'item', data: data.item });
        setHistory((h) => [{ at: now, label: `Item: ${data.item.name} (${data.item.sku})` }, ...h].slice(0, 10));
        showFlashLocal('ok', 'Item scanned');
      }
    } catch {
      showFlashLocal('err', 'Scan failed');
    }
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
        (result) => {
          if (result) handleScan(result.getText());
        }
      );
      controlsRef.current = controls;
      setScanning(true);
    } catch (e) {
      setError(e.message || 'Unable to start camera. Grant camera permission and retry.');
      setScanning(false);
    }
  }, [deviceId, stopScan, handleScan]);

  useEffect(() => {
    (async () => {
      try {
        const list = await BrowserCodeReader.listVideoInputDevices();
        setDevices(list);
        const back = list.find((d) => /back|rear|environment/i.test(d.label)) || list[list.length - 1];
        if (back) setDeviceId(back.deviceId);
      } catch { /* ignore */ }
    })();
    return () => stopScan();
  }, [stopScan]);

  const showFlash = (kind, msg, ms = 1600) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), ms);
  };

  const loadAttendee = async (qrToken) => {
    const res = await fetch(`/api/admin/attendees/by-qr/${encodeURIComponent(qrToken)}`, {
      credentials: 'include', cache: 'no-store',
    });
    if (!res.ok) { showFlash('err', 'Attendee lookup failed'); return; }
    const data = await res.json();
    setCurrent({ type: 'attendee', data });
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
        const r = await fetch(`/api/admin/rentals/lookup/${current.data.id}`, { credentials: 'include', cache: 'no-store' });
        if (r.ok) setCurrent({ type: 'item', data: (await r.json()).item });
      }
      showFlash('ok', 'Item returned');
    } else showFlash('err', 'Return failed');
  };

  if (loading || !isAuthenticated) return null;

  return (
    <div style={container}>
      <AdminPageHeader
        title="QR Scanner"
        description="Scan player QR codes to check them in, view their info, or assign rental equipment."
      />

      <div style={videoBox}>
        <video ref={videoRef} style={videoEl} playsInline muted />
        {!scanning && (
          <div style={videoOverlay}>
            <button style={startBtn} onClick={() => startScan()}>Start Camera</button>
            {error && <div style={cameraError}>{error}</div>}
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
              <span style={historyTime}>
                {new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span style={{ color: 'var(--color-text)' }}>{h.label}</span>
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
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>{event?.displayDate || ''}</div>
        </div>
      </div>

      <div style={badges}>
        {attendee.checkedInAt ? (
          <span style={{ ...badge, background: 'rgba(45,165,90,0.2)', color: 'var(--color-success)' }}>
            ✓ Checked in {new Date(attendee.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        ) : (
          <span style={{ ...badge, background: 'var(--color-bg-sunken)', color: 'var(--color-text-muted)' }}>Not checked in</span>
        )}
        {attendee.waiverSigned ? (
          <span style={{ ...badge, background: 'rgba(45,165,90,0.2)', color: 'var(--color-success)' }}>✓ Waiver signed</span>
        ) : (
          <span style={{ ...badge, background: 'rgba(240,160,64,0.2)', color: 'var(--color-warning)' }}>⚠ Waiver pending</span>
        )}
        {attendee.isMinor && <span style={{ ...badge, background: 'rgba(240,160,64,0.2)', color: 'var(--color-warning)' }}>MINOR</span>}
        {attendee.ticketType && <span style={{ ...badge, background: 'rgba(74,144,194,0.2)', color: 'var(--color-info)' }}>{attendee.ticketType}</span>}
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
        <div style={{ marginTop: 'var(--space-12)' }}>
          <div style={cardLabel}>Open rentals</div>
          {openRentals.map((r) => (
            <div key={r.id} style={rentalRow}>
              <span>{r.itemName} <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}>({r.itemSku})</span></span>
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
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{data.sku}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={cardLabel}>{data.category}</div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>{data.condition}</div>
        </div>
      </div>

      <div style={badges}>
        {data.status === 'assigned' && (
          <span style={{ ...badge, background: 'rgba(240,160,64,0.2)', color: 'var(--color-warning)' }}>
            Assigned to {data.currentAssignment?.attendeeName}
          </span>
        )}
        {data.status === 'available' && (
          <span style={{ ...badge, background: 'rgba(45,165,90,0.2)', color: 'var(--color-success)' }}>Available</span>
        )}
        {data.status === 'retired' && (
          <span style={{ ...badge, background: 'var(--color-bg-sunken)', color: 'var(--color-text-muted)' }}>Retired</span>
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
        <div style={modalHeader}>
          <h3 style={modalTitle}>Assign rental</h3>
          <button onClick={onClose} style={subtleBtn}>Close</button>
        </div>
        <input
          autoFocus
          type="search"
          placeholder="Search name, SKU, category…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ ...input, width: '100%', marginBottom: 'var(--space-8)' }}
        />
        <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <EmptyState
              isFiltered={Boolean(q.trim())}
              title={q.trim() ? 'No items match' : 'No available items'}
              description={q.trim() ? 'Try a shorter search.' : 'All items are currently assigned or retired.'}
              compact
            />
          )}
          {filtered.map((i) => (
            <div key={i.id} style={rentalRow}>
              <div>
                <div style={{ color: 'var(--color-text)' }}>{i.name}</div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', fontFamily: 'monospace' }}>{i.sku} · {i.category}</div>
              </div>
              <button onClick={() => onPick(i.id)} disabled={busy} style={primaryBtn}>Assign</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const container = { maxWidth: 720, margin: '0 auto', padding: 'var(--space-24)' };
const videoBox = {
  position: 'relative',
  background: '#000',
  aspectRatio: '4/3',
  overflow: 'hidden',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border-strong)',
};
const videoEl = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const videoOverlay = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--color-overlay-strong)',
};
const scanFrame = {
  position: 'absolute',
  top: '15%',
  left: '15%',
  right: '15%',
  bottom: '15%',
  border: '2px solid var(--color-accent)',
  pointerEvents: 'none',
  borderRadius: 'var(--radius-xl)',
};
const flashBanner = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: 'var(--space-12)',
  margin: '0 auto',
  maxWidth: 260,
  padding: 'var(--space-8) var(--space-16)',
  textAlign: 'center',
  fontSize: 'var(--font-size-base)',
  fontWeight: 'var(--font-weight-extrabold)',
  color: '#fff',
  borderRadius: 'var(--radius-md)',
  letterSpacing: 'var(--letter-spacing-wide)',
};
// Domain-specific flash banner colors stay raw — the kind→color mapping
// is intentional information density (green = ok, orange = warn, red = err).
const flashBg = {
  ok: 'var(--color-success)',
  warn: 'var(--color-warning)',
  err: 'var(--color-danger)',
};
const cameraError = {
  color: 'var(--color-danger)',
  marginTop: 'var(--space-12)',
  fontSize: 'var(--font-size-sm)',
};
const controls = {
  display: 'flex',
  gap: 'var(--space-8)',
  marginTop: 'var(--space-12)',
  alignItems: 'center',
  flexWrap: 'wrap',
};
const startBtn = {
  padding: 'var(--space-12) var(--space-32)',
  background: 'var(--color-accent)',
  color: 'var(--color-accent-on-accent)',
  border: 'none',
  fontSize: 'var(--font-size-base)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wider)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const startBtnSmall = { ...startBtn, padding: 'var(--space-8) var(--space-16)', fontSize: 'var(--font-size-sm)' };
const stopBtn = { ...startBtnSmall, background: 'var(--color-bg-sunken)', color: 'var(--color-text)' };
const input = {
  padding: 'var(--space-8) var(--space-12)',
  background: 'var(--color-bg-page)',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-base)',
  fontFamily: 'inherit',
};
const card = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border-strong)',
  padding: 'var(--space-16)',
  marginTop: 'var(--space-16)',
};
const cardHeader = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 'var(--space-12)',
  marginBottom: 'var(--space-8)',
};
const cardLabel = {
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wider)',
  color: 'var(--color-accent)',
  textTransform: 'uppercase',
};
const cardTitle = {
  fontSize: 'var(--font-size-xl)',
  fontWeight: 'var(--font-weight-extrabold)',
  color: 'var(--color-text)',
};
const badges = {
  display: 'flex',
  gap: 'var(--space-4)',
  flexWrap: 'wrap',
  marginBottom: 'var(--space-12)',
};
const badge = {
  padding: 'var(--space-4) var(--space-8)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-bold)',
  borderRadius: 'var(--radius-sm)',
};
const actions = { display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap' };
const primaryBtn = {
  padding: 'var(--space-8) var(--space-16)',
  background: 'var(--color-accent)',
  color: 'var(--color-accent-on-accent)',
  border: 'none',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const secondaryBtn = {
  padding: 'var(--space-8) var(--space-16)',
  background: 'var(--color-bg-sunken)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-strong)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const subtleBtn = {
  padding: 'var(--space-4) var(--space-12)',
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const rentalRow = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: 'var(--space-8) 0',
  borderBottom: '1px solid var(--color-border-subtle)',
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-base)',
};
const historyBox = {
  marginTop: 'var(--space-16)',
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border)',
  padding: 'var(--space-16)',
};
const historyTitle = {
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wider)',
  color: 'var(--color-accent)',
  textTransform: 'uppercase',
  marginBottom: 'var(--space-8)',
};
const historyRow = {
  display: 'flex',
  gap: 'var(--space-12)',
  padding: 'var(--space-4) 0',
  fontSize: 'var(--font-size-sm)',
};
const historyTime = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-xs)',
};
const modalBg = {
  position: 'fixed',
  inset: 0,
  background: 'var(--color-overlay-strong)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 'var(--space-16)',
};
const modal = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border-strong)',
  padding: 'var(--space-16)',
  width: '100%',
  maxWidth: 560,
  borderRadius: 'var(--radius-md)',
};
const modalHeader = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 'var(--space-12)',
};
const modalTitle = {
  margin: 0,
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-md)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
};
