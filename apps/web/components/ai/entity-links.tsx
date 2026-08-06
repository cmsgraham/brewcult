/**
 * Entity references under an AI answer (second_draft §5, §7.2.1; EF §3.4).
 *
 * The grounding claim made visible: an answer that cites the graph shows *which*
 * nodes it stood on, and each one is a real page the reader can go check. Trust
 * in the AI is the product, and a citation you cannot click is not a citation.
 *
 * The hard rule: these come only from the API's `entities[]`. Nothing here ever
 * looks at the answer's prose. A URL the model wrote is a string, and it stays a
 * string (see markdown.tsx). An entity whose type or slug we cannot resolve to a
 * BrewCult route renders as plain text rather than a broken link.
 */
import { LocaleLink as Link } from '../../components/locale-link';
import { entityHref, type AiEntity } from '../../lib/ai-client';
import styles from './ai.module.css';
import { useTranslate } from '../locale-provider';

const TYPE_LABEL: Record<AiEntity['type'], string> = {
  coffee: 'Coffee',
  roaster: 'Roaster',
  equipment: 'Equipment',
  recipe: 'Recipe',
};

export interface EntityLinksProps {
  entities: AiEntity[];
  /** Screen-reader label for the list; defaults to the visible one. */
  label?: string;
}

export function EntityLinks({ entities, label }: EntityLinksProps) {
  const t = useTranslate();
  const heading = label ?? t('ai.basedOn');
  if (entities.length === 0) return null;

  return (
    <div className={styles.entities}>
      <span className={styles.entitiesLabel}>{heading}</span>
      <ul className={styles.entitiesList}>
        {entities.map((entity) => {
          const href = entityHref(entity);
          const key = `${entity.type}:${entity.slug ?? entity.id ?? entity.name}`;
          return (
            <li key={key} className={styles.entity}>
              {href ? (
                <Link href={href} className={styles.entityLink}>
                  {entity.name}
                </Link>
              ) : (
                <span>{entity.name}</span>
              )}
              <span className={styles.entityType}> · {TYPE_LABEL[entity.type]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
