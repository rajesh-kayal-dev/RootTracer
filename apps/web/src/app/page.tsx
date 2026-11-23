import type { JSX } from 'react';

export default function HomePage(): JSX.Element {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-3xl font-semibold">RootTracer</h1>
      <p className="mt-4 text-muted">
        Application error monitoring and investigation.
      </p>
    </main>
  );
}
