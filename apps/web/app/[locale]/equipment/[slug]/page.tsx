import { type Metadata } from 'next';
import { localeParam, translator } from '../../../../lib/locale-server';
import type { Translator } from '../../../../lib/i18n';
import { LocaleLink as Link } from '../../../../components/locale-link';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '../../../../components/catalog/breadcrumbs';
import {
  loadEquipment,
  loadGrindConversions,
  loadRecipes,
  type EquipmentDetail,
} from '../../../../components/catalog/catalog-api';
import styles from '../../../../components/catalog/catalog.module.css';
import { catalogCopy, humanize } from '../../../../components/catalog/copy';
import { GrindConversionSection } from '../../../../components/catalog/grind-conversion';
import { JsonLd, readCspNonce } from '../../../../components/catalog/json-ld';
import { RecipesSection } from '../../../../components/catalog/recipes-section';
import { SpecList, type SpecRow } from '../../../../components/catalog/spec-list';
import { equipmentMetadata, notFoundMetadata } from '../../../../lib/seo';
import { breadcrumbJsonLd, equipmentProductJsonLd } from '../../../../lib/structured-data';

/**
 * Equipment detail (CAT-09) — and, for grinders, the highest-intent page on the
 * site.
 *
 * "[grinder] setting for espresso" is the query §23.1 singles out as high
 * volume with weak incumbents, and §6.4 is the reason we can answer it
 * credibly: crowd-sourced conversions with their uncertainty attached. The
 * grind-conversion section therefore renders for every grinder, including ones
 * with no data yet — "0 data points, here is the coarse category instead" is a
 * better answer than silence, and it is an honest one.
 */
export const revalidate = 300;

interface PageProps {
  params: Promise<{ slug: string; locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = localeParam((await params).locale);
  const copy = catalogCopy(locale);
  const t = translator(locale);
  const { slug } = await params;
  const result = await loadEquipment(slug);
  if (result.status !== 'ok') return notFoundMetadata(t('catalog.crumbs.equipment'));

  const equipment = result.data;
  return equipmentMetadata({
    slug: equipment.slug,
    name: equipment.name,
    brandName: equipment.brand?.name ?? '',
    categoryLabel: copy.EQUIPMENT_CATEGORY_LABEL[equipment.category] ?? equipment.category,
    isGrinder: equipment.category === 'grinder',
  });
}

/** Spec rows from the API's free-form `specs` object. Scalars only — a nested
 *  object would render as "[object Object]", which is worse than omitting it. */
function specRows(specs: EquipmentDetail['specs'], t: Translator): SpecRow[] {
  return Object.entries(specs ?? {})
    .filter(([, value]) => typeof value !== 'object' || value === null)
    .map(([key, value]) => ({
      // The KEY is the manufacturer's own field name and stays as it is; only
      // the boolean rendering is ours to translate.
      label: humanize(key),
      value:
        value === null || value === undefined
          ? null
          : typeof value === 'boolean'
            ? value
              ? t('catalog.equipmentDetail.yes')
              : t('catalog.equipmentDetail.no')
            : String(value),
    }));
}

export default async function EquipmentDetailPage({ params }: PageProps) {
  const locale = localeParam((await params).locale);
  const copy = catalogCopy(locale);
  const t = translator(locale);
  const { slug } = await params;
  const result = await loadEquipment(slug);

  if (result.status === 'missing') notFound();
  if (result.status === 'error') {
    return (
      <div className="bc-stack">
        <h1>{t('catalog.equipmentDetail.loadErrorTitle')}</h1>
        <p className="bc-lede">
          {t('catalog.equipmentDetail.loadErrorBody')}
          <Link href="/equipment">{t('catalog.equipmentDetail.loadErrorLink')}</Link>.
        </p>
      </div>
    );
  }

  const equipment = result.data;
  const isGrinder = equipment.category === 'grinder';
  const isBrewer = equipment.category === 'brewer' || equipment.category === 'machine';
  const fullName = `${equipment.brand?.name ?? ''} ${equipment.name}`.trim();

  const [recipes, conversions, nonce] = await Promise.all([
    // Only brewers carry a `brewer_model_id` on a recipe; asking for a grinder's
    // recipes would filter on a field the API does not index.
    isBrewer
      ? loadRecipes({ brewer_model_id: equipment.id, limit: 6 })
      : Promise.resolve({ status: 'missing' } as const),
    isGrinder
      ? loadGrindConversions(equipment.id)
      : Promise.resolve({ status: 'missing' as const, items: [], disclaimer: '' }),
    readCspNonce(),
  ]);

  const categoryLabel = copy.EQUIPMENT_CATEGORY_LABEL[equipment.category] ?? equipment.category;
  const breadcrumbs = [
    { name: t('catalog.crumbs.home'), path: '/' },
    { name: t('catalog.crumbs.equipment'), path: '/equipment' },
    { name: fullName, path: `/equipment/${equipment.slug}` },
  ];

  const description = `${fullName} — ${categoryLabel.toLowerCase()}${
    equipment.grind_scale_type ? ` with a ${equipment.grind_scale_type} adjustment` : ''
  }.`;

  return (
    <div className="bc-stack">
      <JsonLd
        nonce={nonce}
        documents={[
          equipmentProductJsonLd({
            slug: equipment.slug,
            name: equipment.name,
            description,
            brand: { name: equipment.brand?.name ?? '' },
            category: categoryLabel,
            grindScaleType: equipment.grind_scale_type,
            specs: equipment.specs ?? {},
          }),
          breadcrumbJsonLd(breadcrumbs),
        ]}
      />

      <Breadcrumbs entries={breadcrumbs} locale={locale} />

      <header className={styles.header}>
        <p className={styles.eyebrow}>{categoryLabel}</p>
        <h1>{fullName}</h1>
        {equipment.brand ? (
          <p className={styles.byline}>
            {t('catalog.equipmentDetail.madeBy')}
            <Link href={`/equipment?brand=${encodeURIComponent(equipment.brand.name)}`}>
              {equipment.brand.name}
            </Link>
          </p>
        ) : null}
        <p className="bc-lede">{copy.EQUIPMENT_CATEGORY_COPY[equipment.category]}</p>
      </header>

      <section aria-labelledby="specs">
        <h2 id="specs">{t('catalog.equipmentDetail.specifications')}</h2>
        <SpecList
          rows={[
            {
              label: t('catalog.equipmentDetail.category'),
              value: categoryLabel,
              href: `/equipment?category=${equipment.category}`,
            },
            {
              label: t('catalog.equipmentDetail.brand'),
              value: equipment.brand?.name ?? null,
              ...(equipment.brand
                ? { href: `/equipment?brand=${encodeURIComponent(equipment.brand.name)}` }
                : {}),
            },
            ...(equipment.grind_scale_type
              ? [
                  {
                    label: t('catalog.equipmentDetail.grindAdjustment'),
                    value: humanize(equipment.grind_scale_type),
                  },
                ]
              : []),
            ...specRows(equipment.specs, t),
          ]}
        />
        {Object.keys(equipment.specs ?? {}).length === 0 ? (
          <p className="bc-muted">{t('catalog.equipmentDetail.noSpecs')}</p>
        ) : null}
        {equipment.grind_scale_type ? (
          <p className="bc-muted">{copy.GRIND_SCALE_COPY[equipment.grind_scale_type]}</p>
        ) : null}
      </section>

      {isGrinder ? (
        <GrindConversionSection
          locale={locale}
          grinderName={fullName}
          grindScaleType={equipment.grind_scale_type}
          conversions={conversions.items}
          disclaimer={conversions.disclaimer}
          unavailable={conversions.status === 'error'}
        />
      ) : null}

      {isBrewer ? (
        <RecipesSection
          result={recipes}
          locale={locale}
          heading={t('catalog.equipmentDetail.recipesHeading', { name: fullName })}
          headingId="recipes"
          subject={t('catalog.equipmentDetail.recipesSubject', { name: fullName })}
          browseHref={`/recipes?brewer=${equipment.slug}`}
        />
      ) : null}

      <section className={styles.section} aria-labelledby="keep-looking">
        <h2 id="keep-looking">{t('catalog.keepLooking')}</h2>
        <ul className={styles.related}>
          <li>
            {/* The PLURAL label, not an English "s" bolted onto the singular —
                "grinders" pluralises that way, "cafeteras" does not. */}
            <Link href={`/equipment?category=${equipment.category}`}>
              {t('catalog.equipmentDetail.allOfCategory', {
                category: copy.EQUIPMENT_CATEGORY_PLURAL[equipment.category] ?? equipment.category,
              })}
            </Link>
          </li>
          {equipment.brand ? (
            <li>
              <Link href={`/equipment?brand=${encodeURIComponent(equipment.brand.name)}`}>
                {t('catalog.equipmentDetail.moreFromBrand', { brand: equipment.brand.name })}
              </Link>
            </li>
          ) : null}
          <li>
            <Link href="/coffee">{t('catalog.equipmentDetail.coffeeToBrew')}</Link>
          </li>
          <li>
            <Link href="/recipes">{t('catalog.equipmentDetail.allRecipes')}</Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
