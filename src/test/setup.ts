import '@testing-library/jest-dom/vitest';

if (typeof window !== 'undefined') {
  // React Router builds a Request for every navigation. Under jsdom it is given
  // jsdom's AbortSignal, which Node's Request rejects, and every redirect fails.
  // This app has no loaders for the signal to cancel, so in tests the signal is
  // dropped. Browsers have one AbortSignal and need none of this.
  const NodeRequest = globalThis.Request;
  globalThis.Request = class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      if (init?.signal) {
        const { signal: _signal, ...rest } = init;
        super(input, rest);
      } else {
        super(input, init);
      }
    }
  } as typeof Request;
}
