// Signed-out / not-signed-in landing for the staff portal.
//
// This route used to render PortalConsume, the magic-link handler. PortalConsume
// reads ?token= on mount and, finding none, sets status='invalid' — so a staff
// member who signed out SUCCESSFULLY was told, in danger red, "Invalid link.
// Please use the URL from your invitation email." The same route backs the
// header's "Sign in" link, so anyone arriving signed-out saw an error too.
//
// Portal access is magic-link only — there is no password form to send people
// to — so the useful thing to say is how to get a new link.

import { Link } from 'react-router-dom';

export default function PortalSignedOut() {
    return (
        <div style={page}>
            <h1 style={h1}>AAS Portal</h1>
            <p style={ok}>&#10003; You&rsquo;re signed out.</p>
            <p style={muted}>
                Portal access is by invitation link. To sign back in, open the most
                recent invitation email from your admin, or ask them to send a new
                link &mdash; each one is single-use and valid for 24 hours.
            </p>
            <p style={{ marginTop: 24 }}>
                <Link to="/" style={backLink}>&larr; Back to airactionsport.com</Link>
            </p>
        </div>
    );
}

const page = {
    minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    color: 'var(--cream)', padding: 24, textAlign: 'center',
};
const h1 = { fontSize: 28, fontWeight: 900, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--orange)', marginBottom: 24 };
const muted = { color: 'var(--olive-light)', fontSize: 14, maxWidth: 460, lineHeight: 1.7 };
const ok = { color: 'var(--color-success)', fontSize: 16, fontWeight: 700, marginBottom: 12 };
const backLink = { color: 'var(--orange)', textDecoration: 'none', fontSize: 13 };
