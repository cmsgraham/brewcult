import { brand } from '../lib/brand';

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: '3rem',
          fontWeight: 700,
          letterSpacing: '0.01em',
          color: brand.espresso,
        }}
      >
        BrewCult
      </h1>
      <p style={{ margin: 0, opacity: 0.75 }}>Brewing intelligence, brewing.</p>
    </main>
  );
}
