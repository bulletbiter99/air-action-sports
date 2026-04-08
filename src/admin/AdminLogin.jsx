import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';

export default function AdminLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAdmin();
  const navigate = useNavigate();

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    const success = login(username, password);
    if (success) {
      navigate('/admin');
    } else {
      setError('Invalid credentials. Try again.');
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - 60px)',
        padding: '2rem',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--mid, #2a2a2a)',
          border: '1px solid rgba(200,184,154,0.15)',
          padding: '2.5rem',
          maxWidth: '400px',
          width: '100%',
        }}
      >
        <h2
          style={{
            fontSize: '22px',
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            color: 'var(--cream, #f5f0e8)',
            marginBottom: '1.5rem',
            textAlign: 'center',
          }}
        >
          Admin Login
        </h2>

        {error && (
          <p
            style={{
              color: '#e74c3c',
              fontSize: '13px',
              marginBottom: '1rem',
              textAlign: 'center',
            }}
          >
            {error}
          </p>
        )}

        <div style={{ marginBottom: '1rem' }}>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: 'var(--tan, #c8b89a)',
              marginBottom: '0.5rem',
            }}
          >
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            required
            style={{
              width: '100%',
              padding: '12px 14px',
              background: 'var(--dark, #1a1a1a)',
              border: '1px solid rgba(200,184,154,0.2)',
              color: 'var(--cream, #f5f0e8)',
              fontSize: '14px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: 'var(--tan, #c8b89a)',
              marginBottom: '0.5rem',
            }}
          >
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            style={{
              width: '100%',
              padding: '12px 14px',
              background: 'var(--dark, #1a1a1a)',
              border: '1px solid rgba(200,184,154,0.2)',
              color: 'var(--cream, #f5f0e8)',
              fontSize: '14px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <button
          type="submit"
          style={{
            width: '100%',
            padding: '14px',
            background: 'var(--orange, #d4541a)',
            color: 'white',
            border: 'none',
            fontSize: '13px',
            fontWeight: 700,
            letterSpacing: '3px',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          Log In
        </button>
      </form>
    </div>
  );
}
