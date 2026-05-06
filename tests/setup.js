import { vi, beforeEach } from 'vitest';

// Per-test reset of all mock state. Implementations that helpers install via
// `globalThis.fetch.mockImplementation(...)` are also reset, so each test
// starts from the throw-on-unmocked default below.
beforeEach(() => {
    vi.clearAllMocks();
    if (globalThis.fetch && vi.isMockFunction(globalThis.fetch)) {
        globalThis.fetch.mockImplementation(unmocked);
    }
});

// Outbound HTTP must be explicitly mocked per-test via tests/helpers/mockStripe.js
// or tests/helpers/mockResend.js. Default behavior is to throw — surfaces any
// accidental real network call as an obvious test failure.
function unmocked() {
    throw new Error(
        'Unmocked fetch call in tests. Install a handler via mockStripeFetch() or mockResendFetch().'
    );
}

globalThis.fetch = vi.fn(unmocked);
