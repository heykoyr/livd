import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll } from 'vitest';

// The local data adapter refuses to run when NODE_ENV is production; tests run
// against it deliberately, with demo seed data switched off so fixtures are
// explicit.
beforeAll(() => {
  process.env.LIVD_SHOW_DEMO_DATA = 'false';
  process.env.LIVD_SESSION_SECRET = 'test-secret-not-used-anywhere-real';
});

afterEach(() => {
  cleanup();
});

// jsdom implements neither of these, and components legitimately call both.
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
}
