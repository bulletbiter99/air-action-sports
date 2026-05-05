// Compute the SHA-256 of the actual stored body_html for wd_v2 and patch
// the publish_waiver_v2.sql file with the real hash. The body inside the
// SQL has single-quote SQL escaping ('' → '), so we have to un-escape
// before hashing — the hash must match what the integrity check on
// /api/waivers/:qrToken recomputes against the stored value.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sqlPath = path.join(__dirname, 'publish_waiver_v2.sql');
let sql = fs.readFileSync(sqlPath, 'utf8');

// Body lives between the opening single-quote of the body literal in INSERT
// and the closing 'PENDING_HASH_PATCH' marker. Locate by finding the literal
// '<div class="waiver-doc">' and then the matching closing '</div>',  then
// reverse-find the closing single-quote of the SQL literal.
const startMarker = "'<div class=\"waiver-doc\">";
const startIdx = sql.indexOf(startMarker);
if (startIdx < 0) throw new Error('Could not locate body start in SQL file');

// The end of the body literal is the last "</div>'," before the line with
// the hash placeholder.
const endIdx = sql.indexOf("</div>',\n    'PENDING_HASH_PATCH'");
if (endIdx < 0) throw new Error('Could not locate body end / hash placeholder');

const escapedBody = sql.substring(startIdx + 1, endIdx + '</div>'.length);
const rawBody = escapedBody.replace(/''/g, "'");
const hash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');

console.log('Body length (escaped):', escapedBody.length);
console.log('Body length (raw):    ', rawBody.length);
console.log('SHA-256:              ', hash);

// Patch the placeholder with the real hash.
const patched = sql.replace("'PENDING_HASH_PATCH'", "'" + hash + "'");
if (patched === sql) throw new Error('Hash placeholder was not replaced');

fs.writeFileSync(sqlPath, patched, 'utf8');
console.log('Patched scripts/publish_waiver_v2.sql with computed hash.');
