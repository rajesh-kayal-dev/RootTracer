import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'RootTracer',
  description: 'Application error monitoring and investigation.',
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
