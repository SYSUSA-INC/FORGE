// Stub for next/headers — returns sensible no-ops so server modules
// can be imported and called in a vitest (Node) context.
// Individual tests can override with vi.mock("next/headers", factory).
export const cookies = () => ({
  get: (_name: string) => undefined as undefined,
  set: (_name: string, _value: string, _opts?: unknown) => {},
  delete: (_name: string) => {},
});

export const headers = () => ({
  get: (_name: string) => null as string | null,
});
