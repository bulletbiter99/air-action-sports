import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import { events } from '../data/events';
import { locations } from '../data/locations';

// TODO: Replace with API calls when backend is ready

const faqCategories = [
  'General',
  'Booking & Payment',
  'Safety & Rules',
  'Gear & Equipment',
  'Private Hire',
];

const pricingItems = [
  { label: 'Walk-on (Skirmish)', price: '$25' },
  { label: 'Standard Event', price: '$35' },
  { label: 'Milsim Event', price: '$45-55' },
  { label: 'Gear Hire Bundle', price: '$15' },
];

export default function AdminDashboard() {
  const { isAuthenticated, logout } = useAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/admin/login');
    }
  }, [isAuthenticated, navigate]);

  if (!isAuthenticated) return null;

  const handleEdit = () => {
    // TODO: Wire to backend API
    alert('TODO: Wire to backend API');
  };

  const sectionStyle = {
    background: 'var(--mid, #2a2a2a)',
    border: '1px solid rgba(200,184,154,0.1)',
    padding: '1.5rem',
    marginBottom: '2rem',
  };

  const headingStyle = {
    fontSize: '14px',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '2px',
    color: 'var(--orange, #d4541a)',
    marginBottom: '1rem',
  };

  const itemStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 0',
    borderBottom: '1px solid rgba(200,184,154,0.08)',
    fontSize: '14px',
    color: 'var(--tan-light, #d4cfc5)',
  };

  const editBtnStyle = {
    padding: '6px 16px',
    background: 'none',
    border: '1px solid rgba(200,184,154,0.3)',
    color: 'var(--tan, #c8b89a)',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '1px',
    textTransform: 'uppercase',
    cursor: 'pointer',
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
        }}
      >
        <h1
          style={{
            fontSize: '24px',
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: '-1px',
            color: 'var(--cream, #f5f0e8)',
          }}
        >
          Dashboard
        </h1>
        <button
          onClick={logout}
          style={{
            ...editBtnStyle,
            borderColor: '#e74c3c',
            color: '#e74c3c',
          }}
        >
          Logout
        </button>
      </div>

      {/* Events Section */}
      {/* TODO: Replace with API calls when backend is ready */}
      <div style={sectionStyle}>
        <h2 style={headingStyle}>Events</h2>
        {events.map((event) => (
          <div style={itemStyle} key={event.id}>
            <span>
              {event.title} &mdash; {event.date.day} {event.date.month}
              {event.past ? ' (past)' : ''}
            </span>
            <button style={editBtnStyle} onClick={handleEdit}>
              Edit
            </button>
          </div>
        ))}
      </div>

      {/* Locations Section */}
      {/* TODO: Replace with API calls when backend is ready */}
      <div style={sectionStyle}>
        <h2 style={headingStyle}>Locations</h2>
        {locations.map((loc) => (
          <div style={itemStyle} key={loc.id}>
            <span>
              {loc.name} &mdash; {loc.address}
            </span>
            <button style={editBtnStyle} onClick={handleEdit}>
              Edit
            </button>
          </div>
        ))}
      </div>

      {/* FAQ Section */}
      {/* TODO: Replace with API calls when backend is ready */}
      <div style={sectionStyle}>
        <h2 style={headingStyle}>FAQ</h2>
        {faqCategories.map((cat) => (
          <div style={itemStyle} key={cat}>
            <span>{cat}</span>
            <button style={editBtnStyle} onClick={handleEdit}>
              Edit
            </button>
          </div>
        ))}
      </div>

      {/* Pricing Section */}
      {/* TODO: Replace with API calls when backend is ready */}
      <div style={sectionStyle}>
        <h2 style={headingStyle}>Pricing</h2>
        {pricingItems.map((item) => (
          <div style={itemStyle} key={item.label}>
            <span>
              {item.label}: {item.price}
            </span>
            <button style={editBtnStyle} onClick={handleEdit}>
              Edit
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
