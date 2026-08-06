/**
 * El vocabulario del catálogo, en español de Costa Rica.
 *
 * ── WHY THIS IS THE MOST VALUABLE TRANSLATION ON THE SITE ───────────────────
 * This is the teaching copy — what a washed process tastes like, why a light
 * roast punishes a coarse grind, how to read a roast date. It is what makes a
 * catalogue page a landing page rather than a database row (§23.1), and in
 * Spanish it is competing for queries nobody else in the region answers well.
 *
 * ── VOSEO, AND THE TERMS THAT STAY ENGLISH ──────────────────────────────────
 * Vos, not tú — "probá", "anotá", "tu molino". And the trade's loanwords stay:
 * a Costa Rican barista says "el pour-over", "el espresso", "el body", "cold
 * brew", "French press". Translating those would be less clear, not more, and
 * would make the page unfindable for the people searching them.
 *
 * Where a term genuinely has Spanish currency it is used: "molino" not
 * "grinder", "tueste" not "roast", "cuerpo" alongside body where it reads
 * naturally.
 */
import type {
  CoffeeStatus,
  EquipmentCategory,
  GrindCategory,
  IntendedUse,
  LotProcess,
  RoastLevel,
} from './catalog-api';

export const PROCESS_LABEL_ES: Record<LotProcess, string> = {
  washed: 'Lavado',
  natural: 'Natural',
  honey: 'Honey',
  anaerobic: 'Anaeróbico',
  experimental: 'Experimental',
};

export const PROCESS_COPY_ES: Record<LotProcess, string> = {
  washed:
    'La fruta se le quita al grano antes de secarlo, así que lo que probás es sobre todo el café en sí: normalmente más limpio, más brillante y más parecido al té.',
  natural:
    'La cereza se seca entera alrededor del grano, lo que mete fruta en la taza: pensá en mora, mermelada y vino. Más intenso y casi siempre más dulce que un lavado.',
  honey:
    'Parte de la capa dulce de la fruta se queda durante el secado. Queda entre el lavado y el natural: con fruta al frente, pero con más estructura que un natural.',
  anaerobic:
    'La cereza fermenta en un tanque sellado, sin oxígeno, antes de secarse. Puede dar sabores intensos y poco comunes: licorosos, tropicales, a veces salados.',
  experimental:
    'Un proceso que el productor está probando y que todavía no tiene un nombre asentado. Vale la pena preguntarle al tostador qué hicieron.',
};

export const ROAST_LEVEL_LABEL_ES: Record<RoastLevel, string> = {
  light: 'Claro',
  'medium-light': 'Medio-claro',
  medium: 'Medio',
  'medium-dark': 'Medio-oscuro',
  dark: 'Oscuro',
};

export const ROAST_LEVEL_COPY_ES: Record<RoastLevel, string> = {
  light:
    'Tostado para dejar al frente el carácter del origen: acidez, notas florales y fruta. Los tuestes claros perdonan menos una molienda gruesa; si sabe aguado o ácido, molé más fino antes de culpar al café.',
  'medium-light':
    'El carácter del origen sigue mandando, con un poco más de dulzor y cuerpo que un tueste claro completo. Un buen punto de partida para pour-over.',
  medium:
    'Balanceado: algo de carácter del origen y algo de dulzor del tueste (caramelo, cacao). Suele ser el que más perdona los errores pequeños, y eso es una virtud de verdad.',
  'medium-dark':
    'Los sabores del tueste (chocolate, nuez tostada, melaza) pasan al frente y la acidez se suaviza. Es una elección común para espresso y para café con leche.',
  dark:
    'Profundo, entre dulce y amargo, y con poca acidez. Se extrae rápido, así que una molienda un poco más gruesa y una preparación más corta suelen saber mejor que la receta de la bolsa.',
};

export const INTENDED_USE_LABEL_ES: Record<IntendedUse, string> = {
  filter: 'Filtrado',
  espresso: 'Espresso',
  omni: 'Filtrado o espresso',
};

export const INTENDED_USE_COPY_ES: Record<IntendedUse, string> = {
  filter:
    'El tostador lo pensó para pour-over, inmersión y cafetera de goteo. Podés sacarlo como espresso sin problema: esperá un shot más brillante y con más acidez.',
  espresso:
    'Tostado pensando en espresso: con suficiente desarrollo para mantenerse dulce bajo presión. Normalmente pide una o dos semanas de reposo antes de asentarse.',
  omni:
    'Tostado para funcionar de las dos formas. Buena opción si preparás filtrado entre semana y sacás shots el fin de semana: una sola bolsa, sin tener que decidir nada.',
};

export const STATUS_COPY_ES: Record<CoffeeStatus, string> = {
  active: 'Está en la línea actual del tostador.',
  seasonal:
    'Un lote de temporada: va y viene con la cosecha. Las calificaciones y recetas de aquí pertenecen a este lote, no al del próximo año.',
  discontinued:
    'Ya no se ofrece. Lo dejamos porque las recetas y notas de preparación que tiene siguen sirviendo, y porque las cosechas rotan: puede volver un lote parecido.',
};

export const EQUIPMENT_CATEGORY_LABEL_ES: Record<EquipmentCategory, string> = {
  brewer: 'Cafetera',
  grinder: 'Molino',
  kettle: 'Hervidor',
  scale: 'Balanza',
  machine: 'Máquina de espresso',
  accessory: 'Accesorio',
};

export const EQUIPMENT_CATEGORY_PLURAL_ES: Record<EquipmentCategory, string> = {
  brewer: 'Cafeteras',
  grinder: 'Molinos',
  kettle: 'Hervidores',
  scale: 'Balanzas',
  machine: 'Máquinas de espresso',
  accessory: 'Accesorios',
};

export const EQUIPMENT_CATEGORY_COPY_ES: Record<EquipmentCategory, string> = {
  brewer:
    'El recipiente donde el café realmente se prepara. La forma, el tamaño del orificio y el material del filtro cambian el tiempo de contacto, y por eso la misma receta sabe distinto en cada cafetera.',
  grinder:
    'El equipo que más mueve la taza. Un tamaño de partícula consistente es lo que hace que una receta se pueda repetir; el número del dial solo significa algo en ese modelo.',
  kettle:
    'Controla cómo llega el agua, y qué tan rápido. Un pico de ganso te da precisión, no sabor por sí solo.',
  scale: 'Convierte la adivinanza en una receta que podés repetir mañana.',
  machine:
    'Empuja agua caliente a presión a través de un pastilla compactada. La estabilidad de temperatura y poder sostener el flujo son lo que las diferencia en la taza.',
  accessory:
    'Equipo de apoyo: útil, a veces transformador, nunca la historia completa.',
};

export const GRIND_SCALE_COPY_ES: Record<string, string> = {
  stepped:
    'Un dial con pasos: los ajustes caen en posiciones fijas, así que un ajuste se repite igual, pero no podés quedarte entre dos.',
  stepless:
    'Un ajuste sin pasos: infinitas posiciones entre marcas, así que podés hacer cambios muy pequeños, y por eso mismo necesitás anotar dónde lo dejaste.',
  rotational:
    'Vueltas más clics (por ejemplo "2.6" = 2 vueltas completas y 6 clics). Anotá siempre los dos números; los clics solos no significan nada.',
};

export const GRIND_CATEGORY_LABEL_ES: Record<GrindCategory, string> = {
  extra_fine: 'Extra fina',
  fine: 'Fina',
  medium_fine: 'Media-fina',
  medium: 'Media',
  medium_coarse: 'Media-gruesa',
  coarse: 'Gruesa',
};

export const GRIND_CATEGORY_HINT_ES: Record<GrindCategory, string> = {
  extra_fine: 'Azúcar en polvo: territorio de café turco.',
  fine: 'Sal de mesa: territorio de espresso.',
  medium_fine: 'Entre sal de mesa y arena: aquí vive la mayoría de los pour-over de cono.',
  medium: 'Arena gruesa: cafeteras de fondo plano y máquinas de goteo.',
  medium_coarse: 'Arena áspera: Chemex e inmersiones largas.',
  coarse: 'Sal marina: French press y cold brew.',
};

export const METHOD_LABEL_ES: Record<string, string> = {
  filter: 'Filtrado',
  immersion: 'Inmersión',
  espresso: 'Espresso',
};

export const CONFIDENCE_BAND_COPY_ES: Record<'low' | 'medium' | 'high', string> = {
  low: 'Confianza baja: tomalo como una dirección aproximada, no como un ajuste.',
  medium: 'Confianza media: un punto de partida razonable desde el cual ajustar.',
  high: 'Confianza alta: sigue siendo un punto de partida, pero uno bien respaldado.',
};

export const CONVERSION_SOURCE_COPY_ES: Record<'user_confirmed' | 'seeded', string> = {
  user_confirmed:
    'De preparaciones que la gente anotó y calificó como buenas después de cambiar de molino.',
  seeded:
    'De tablas publicadas por la comunidad, todavía sin confirmar con preparaciones anotadas aquí.',
};

export const FRESHNESS_EXPLAINER_ES =
  'La fecha de tueste importa más que la fecha de vencimiento. La mayoría del café filtrado sabe mejor entre los 4 y los 21 días después del tueste, y el espresso suele querer de 7 a 14 días de reposo antes de dejar de saber áspero. El café recién tostado no es “mejor”: todavía está desgasificando, y eso hace difícil extraerlo parejo.';

export const FRESHNESS_NO_BATCH_COPY_ES =
  'Todavía no tenemos fechas de tueste para este café. Cuando lo compres, la bolsa debería traer una; si solo muestra fecha de vencimiento, vale la pena preguntarle al tostador.';

export const RECIPE_STARTING_POINT_COPY_ES =
  'Tomá esto como un punto de partida, no como una regla. Tu molino, tu agua y tu bolsa de café son todos un poco distintos de los que se usaron para escribirla: prepará una vez tal cual está y después cambiá una sola cosa a la vez.';
