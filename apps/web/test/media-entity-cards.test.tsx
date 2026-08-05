/**
 * Catalog and discover cards, with and without an image field.
 *
 * The catalogue is text-only today and every entity payload lacks a picture, so
 * the important half of this file is the "without" half: adding image support
 * must not change a single card that has no image.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  CoffeeCard as CatalogCoffeeCard,
  EquipmentCard,
  RoasterCard,
} from '../components/catalog/entity-cards';
import { CoffeeCard as DiscoverCoffeeCard } from '../components/discover/coffee-card';
import { EntityImage } from '../components/media/entity-image';

const CATALOG_COFFEE = {
  id: 'c1',
  slug: 'ethiopia-chelbesa',
  name: 'Ethiopia Chelbesa',
  roast_level: 'light' as const,
  intended_use: 'filter' as const,
  tasting_notes: ['peach', 'jasmine'],
  status: 'active' as const,
  roaster: { id: 'r1', slug: 'nomad', name: 'Nomad Roasters' },
  origin: { id: 'o1', country: 'Ethiopia', region: 'Gedeb' },
  process: 'washed' as const,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const ROASTER = {
  id: 'r1',
  slug: 'nomad',
  name: 'Nomad Roasters',
  location: 'Barcelona',
  verified: true,
  coffee_count: 12,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const EQUIPMENT = {
  id: 'e1',
  slug: 'fellow-ode-2',
  name: 'Ode Gen 2',
  category: 'grinder' as const,
  grind_scale_type: 'stepped' as const,
  brand: { id: 'b1', name: 'Fellow' },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('catalog cards without an image', () => {
  it('renders the coffee card exactly as it does today', () => {
    render(
      <ul>
        <CatalogCoffeeCard coffee={CATALOG_COFFEE} />
      </ul>,
    );

    expect(screen.getByRole('link', { name: 'Ethiopia Chelbesa' })).toBeInTheDocument();
    expect(screen.getByText(/tastes like: peach, jasmine/i)).toBeInTheDocument();
    // No empty rectangle, no broken-image icon — nothing at all.
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders roaster and equipment cards unchanged', () => {
    render(
      <ul>
        <RoasterCard roaster={ROASTER} />
        <EquipmentCard equipment={EQUIPMENT} />
      </ul>,
    );

    expect(screen.getByRole('link', { name: 'Nomad Roasters' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fellow Ode Gen 2' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('catalog cards with an image', () => {
  it('renders the picture the API sent, named after the entity', () => {
    render(
      <ul>
        <CatalogCoffeeCard
          coffee={{ ...CATALOG_COFFEE, image_url: 'https://media.brewcult.test/bag.jpg' } as never}
        />
      </ul>,
    );

    const image = screen.getByRole('img', { name: 'Ethiopia Chelbesa' });
    expect(image).toHaveAttribute('src', 'https://media.brewcult.test/bag.jpg');
    expect(image).toHaveAttribute('loading', 'lazy');
  });

  it('prefers the thumbnail derivative on a card', () => {
    render(
      <ul>
        <RoasterCard
          roaster={
            {
              ...ROASTER,
              image: {
                url: 'https://media.brewcult.test/full.jpg',
                thumbnail_url: 'https://media.brewcult.test/thumb.jpg',
              },
            } as never
          }
        />
      </ul>,
    );

    expect(screen.getByRole('img', { name: 'Nomad Roasters' })).toHaveAttribute(
      'src',
      'https://media.brewcult.test/thumb.jpg',
    );
  });

  it('tolerates a camelCase spelling without breaking', () => {
    render(
      <ul>
        <EquipmentCard
          equipment={{ ...EQUIPMENT, imageUrl: 'https://media.brewcult.test/ode.jpg' } as never}
        />
      </ul>,
    );

    expect(screen.getByRole('img', { name: 'Fellow Ode Gen 2' })).toBeInTheDocument();
  });
});

describe('discover cards', () => {
  const summary = {
    id: 'c1',
    slug: 'ethiopia-chelbesa',
    name: 'Ethiopia Chelbesa',
    roaster: { id: 'r1', slug: 'nomad', name: 'Nomad Roasters' },
    origin: { country: 'Ethiopia', region: 'Gedeb' },
    process: 'washed',
    roast_level: 'light',
    tasting_notes: ['peach'],
  };

  it('stays text-only when there is no image', () => {
    render(
      <ul>
        <DiscoverCoffeeCard coffee={summary} />
      </ul>,
    );
    expect(screen.getByText(/nomad roasters/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders the image when there is one', () => {
    render(
      <ul>
        <DiscoverCoffeeCard
          coffee={{ ...summary, image_url: 'https://media.brewcult.test/bag.jpg' } as never}
        />
      </ul>,
    );
    expect(screen.getByRole('img', { name: 'Ethiopia Chelbesa' })).toBeInTheDocument();
  });
});

describe('EntityImage', () => {
  it('renders nothing at all when asked for no fallback', () => {
    const { container } = render(<EntityImage entity={{}} alt="Ethiopia Chelbesa" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an intentional monogram when a grid asks for one', () => {
    render(<EntityImage entity={{}} alt="Ethiopia Chelbesa" fallback="monogram" />);
    const monogram = screen.getByRole('img', { name: /ethiopia chelbesa — no photo yet/i });
    expect(monogram).toHaveTextContent('EC');
  });
});
