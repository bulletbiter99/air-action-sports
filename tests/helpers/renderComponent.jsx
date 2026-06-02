// M8 Batch A — shared render helper for React component tests (RTL + jsdom).
//
// Component tests opt into a jsdom environment per-file with a
// `// @vitest-environment jsdom` pragma (see vitest.config.js). This helper
// centralizes everything those tests need so the test files stay declarative:
//   * extends vitest's `expect` with @testing-library/jest-dom matchers
//     (toBeInTheDocument / toHaveAttribute / …) via the import side effect,
//   * unmounts rendered trees after every test (afterEach cleanup) so DOM
//     state never leaks between cases — vitest has no `globals: true`, so RTL's
//     auto-cleanup does not self-register and we wire it explicitly,
//   * stubs ResizeObserver — jsdom doesn't implement it and
//     @tanstack/react-virtual's useVirtualizer needs it to initialize, which
//     matters for VirtualizedList and its consuming admin pages.
//
// Import from HERE (not @testing-library/react directly) in *.test.jsx files so
// the matchers + cleanup + stub are always wired. Named exports only, matching
// the tests/helpers/ house convention.

import { afterEach } from 'vitest';
import {
    render as rtlRender,
    cleanup,
    screen,
    within,
    fireEvent,
    waitFor,
    act,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver; TanStack Virtual observes the scroll element on
// mount. A no-op stub lets useVirtualizer initialize (it then measures
// zero-size elements, which is fine for role/attribute assertions).
if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
}

afterEach(() => {
    cleanup();
});

// Bare render — for self-contained components that need no router / helmet.
export function render(ui, options) {
    return rtlRender(ui, options);
}

// Render inside the providers most admin pages assume: react-router (Link,
// useNavigate, useParams, useSearchParams) and react-helmet-async (<Helmet>).
// `route` seeds the initial history entry so route params / search params
// resolve. Used from Batch C onward (page-level component tests).
export function renderWithRouter(ui, { route = '/', ...options } = {}) {
    return rtlRender(ui, {
        wrapper: ({ children }) => (
            <HelmetProvider>
                <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
            </HelmetProvider>
        ),
        ...options,
    });
}

export { screen, within, fireEvent, waitFor, act, cleanup, userEvent };
