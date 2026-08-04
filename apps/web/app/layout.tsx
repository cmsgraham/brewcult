import { type Metadata } from 'next';
import { type ReactNode } from 'react';
import { brand } from '../lib/brand';

export const metadata: Metadata = {
  title: 'BrewCult',
  description: 'Brewing intelligence for people who take coffee seriously.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          backgroundColor: brand.cream,
          color: brand.espresso,
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
