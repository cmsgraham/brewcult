/**
 * The cupping guide's content, in both languages.
 *
 * Separated from the page so the page stays a renderer and the copy stays
 * readable as copy — this is a page whose entire value IS the words, and they
 * are worth editing without stepping over JSX.
 *
 * ── ON THE SPANISH ──────────────────────────────────────────────────────────
 * Voseo throughout ("probá", "fijate", "buscá"), because that is how somebody
 * in San José actually talks. The SCA's attribute names are kept as the trade
 * uses them here — a Costa Rican cupper says "el body", "el clean cup",
 * "fragancia/aroma" — and translating those would make the page less findable
 * for the people searching them, not more welcoming.
 *
 * The physical instructions matter most and are translated most carefully: this
 * is a coffee-growing country, and a page that explains cupping badly in
 * Spanish is worse than no page at all.
 */
export interface Attribute {
  id: string;
  name: string;
  what: string;
  how: string;
  ends: string;
}

export interface ScaleRow {
  score: string;
  word: string;
  meaning: string;
}

export interface GuideContent {
  title: string;
  lede: string;
  scaleHeading: string;
  scaleIntro: string;
  scaleColumns: { score: string; word: string; meaning: string };
  onlyOverall: string;
  attributesHeading: string;
  howToFind: string;
  defectsHeading: string;
  defectsIntro: string;
  defectsBody: string;
  tryHeading: string;
  tryBody: string;
  tryThen: string;
  browseLink: string;
  scale: ScaleRow[];
  attributes: Attribute[];
}

const EN: GuideContent = {
  title: 'How coffee is scored',
  lede: 'Every score on BrewCult uses the SCA cupping form — the same ten attributes a professional cupping table scores, on the same 6-to-10 scale. We did not invent it, and that is the point: an 86 here means what an 86 means everywhere. This page explains each attribute, and how to actually find it in your cup.',
  scaleHeading: 'The scale',
  scaleIntro:
    'Each attribute is scored from 6.00 to 10.00, in quarter-point steps. The scale starts at 6 because the form exists to grade specialty coffee — an attribute that would score lower has a defect, and defects are counted separately. Ten attributes summed give a score out of 100, and 80 or above is what the word “specialty” formally means.',
  scaleColumns: { score: 'Score', word: 'The form’s word', meaning: 'What it means in practice' },
  onlyOverall:
    'On BrewCult only Overall is required — it is the one attribute that is honestly answerable from an armchair, and it is the same attribute a judge fills in. The other nine are there when you want to score properly, and only a complete form produces a score out of 100. Nine invented numbers would be worse data than one real one.',
  attributesHeading: 'The ten attributes',
  howToFind: 'How to find it:',
  defectsHeading: 'Taints and faults',
  defectsIntro:
    'Defects are subtracted from the total rather than hidden inside low attribute scores, so a defective cup of otherwise great coffee is recorded as exactly that.',
  defectsBody:
    'A taint is an off-note you can smell but that does not ruin the taste — a whiff of ferment, a papery edge. Each tainted cup costs 2 points. A fault is an off-flavour you can taste — mould, phenol (medicinal), sour ferment, the raw-potato flavour some East African coffees can carry. Each faulty cup costs 4.',
  tryHeading: 'Try it at home',
  tryBody:
    'You do not need a lab. Grind 8.25 g of coffee coarsely into a cup, pour 150 ml of water just off the boil straight onto the grounds, and wait four minutes. Break the crust with a spoon and smell as you do — that is your aroma score. Skim the foam, wait until it is cool enough, and taste with a decisive slurp. Then taste again as it cools: coffee shows its flaws warm and its sweetness cool, and a score given at one temperature is half a score.',
  tryThen: 'Then go and score something —',
  browseLink: 'any coffee in the catalogue',
  scale: [
    { score: '6.00–6.75', word: 'Good', meaning: 'Solid specialty-grade quality; the floor of the scale, not an insult.' },
    { score: '7.00–7.75', word: 'Very good', meaning: 'Clearly enjoyable, with real character.' },
    { score: '8.00–8.75', word: 'Excellent', meaning: 'Distinctive and memorable. Most coffees never score here.' },
    { score: '9.00–9.75', word: 'Outstanding', meaning: 'Exceptional character; competition territory.' },
    { score: '10.00', word: 'Exceptional', meaning: 'As good as the attribute gets. Almost never given.' },
  ],
  attributes: [
    {
      id: 'fragrance-aroma',
      name: 'Fragrance / aroma',
      what: 'How the coffee smells — fragrance is the DRY grounds before water touches them, aroma is the wet coffee after. They are scored together as one attribute.',
      how: 'Smell the grounds the moment you grind: that is fragrance. Pour water, wait, then smell again while stirring the surface: that is aroma. Sweet, floral, fruity, nutty and chocolatey smells score well; flat, papery or musty ones do not.',
      ends: 'High: you would know this was good coffee with your eyes closed, before tasting. Low: it smells of little, or of cardboard.',
    },
    {
      id: 'flavour',
      name: 'Flavour',
      what: 'The main event — taste and smell working together in the middle of the sip. Not any single note, but the combined character of the coffee.',
      how: 'Take a sip with some air (cuppers slurp to spray the coffee across the whole palate) and pay attention to the middle of the experience, after the first impression and before the finish. Can you name what you taste — a fruit, a sweetness, a chocolate? Distinct, nameable character scores higher than generic "coffee flavour".',
      ends: 'High: distinct, expressive, you could describe it to a friend. Low: vague, woody, or unpleasant.',
    },
    {
      id: 'aftertaste',
      name: 'Aftertaste',
      what: 'What stays behind after you swallow — both how long it lasts and whether you are glad it did.',
      how: 'Swallow, wait ten seconds, and notice what is still there. Good coffee leaves sweetness or pleasant flavour that fades slowly. Lesser coffee vanishes instantly, or worse, leaves bitterness, dryness or a chemical edge that outstays the good part.',
      ends: 'High: a long, sweet, pleasant finish. Low: short, or lingering in a way you wish it would not.',
    },
    {
      id: 'acidity',
      name: 'Acidity',
      what: 'The brightness or liveliness of the cup — the quality that makes coffee taste vivid rather than flat. This is not "sourness", and more is not better: the score is for how PLEASANT the acidity is, not how much there is.',
      how: 'Notice the sensation at the sides of your tongue right after the sip, the same place a bite of green apple or a squeeze of lime registers. Ask: does it sparkle, like fruit? Or does it bite, like vinegar? A great washed Ethiopian dances; an underripe or under-roasted coffee just puckers.',
      ends: 'High: bright, sweet, fruit-like, integrated. Low: either lifeless and flat, or harsh and sour.',
    },
    {
      id: 'body',
      name: 'Body',
      what: 'The weight and texture of the coffee in your mouth — thin like tea, or heavy like cream. As with acidity, the score is for quality: a delicate body can be excellent, a heavy one can be muddy.',
      how: 'Press your tongue against the roof of your mouth mid-sip and notice the thickness, the way you would compare skimmed milk with whole milk. Then notice the texture: silky, creamy, syrupy — or thin, gritty, astringent (that drying, sandpaper feeling is a texture fault, not a taste).',
      ends: 'High: a texture that suits the coffee, from silky to syrupy. Low: watery, rough, or drying.',
    },
    {
      id: 'uniformity',
      name: 'Uniformity',
      what: 'Whether the coffee tastes the same cup after cup. At a cupping table five cups of each coffee are brewed, and each consistent cup earns two of the ten points.',
      how: 'At home you rarely brew five cups at once, so judge consistency across sips and across brews: does the same bag, brewed the same way, taste the same on Tuesday as it did on Sunday? Inconsistency usually points to uneven roasting or mixed beans.',
      ends: 'High: every cup is the same cup. Low: one brew is lovely and the next is oddly different.',
    },
    {
      id: 'balance',
      name: 'Balance',
      what: 'How the other attributes get along. Flavour, aftertaste, acidity and body in proportion, with nothing shouting over the rest and nothing missing.',
      how: 'After scoring the parts, step back and ask about the whole: does the acidity overwhelm the sweetness? Does big body smother the delicate flavours? Or does every element support the others? Imagine a band — balance is nobody drowning out the singer.',
      ends: 'High: everything in proportion; removing anything would hurt it. Low: one attribute dominates, or something feels absent.',
    },
    {
      id: 'clean-cup',
      name: 'Clean cup',
      what: 'The absence of anything that does not belong — no off-flavours from first sip to last. "Transparency" is a good synonym: nothing between you and the coffee.',
      how: 'Taste from the first sip through the aftertaste asking one question: is there anything here that is not coffee? Mustiness, earthiness where it does not belong, fermented sharpness, mould, medicine. Each of the five cups free of interference earns two points.',
      ends: 'High: nothing but coffee, start to finish. Low: off-notes interrupt, even briefly.',
    },
    {
      id: 'sweetness',
      name: 'Sweetness',
      what: 'The pleasing fullness that comes from ripe, well-developed cherries — closer to the sweetness of a ripe peach than of table sugar. Its opposites are sourness, astringency and "green", grassy flavours.',
      how: 'Let a sip sit a moment and notice whether the coffee feels generous and ripe, or thin and vegetal. Black coffee never tastes like sugar water; what you are looking for is the ripeness that makes fruit taste ready rather than early.',
      ends: 'High: ripe, full, generous. Low: green, grassy, astringent — the taste of cherries picked too soon.',
    },
    {
      id: 'overall',
      name: 'Overall',
      what: 'The honest, holistic verdict — the one place the form asks for your opinion rather than an analysis. It is also the one score everybody on this site gives, cupping or not.',
      how: 'Ask the simplest question in coffee: how good was this, really? Would you buy it again? Does it deliver what its origin and roaster promise? A technically correct but boring coffee loses points here; a distinctive one that you could not stop drinking gains them.',
      ends: 'High: you would seek this out again. Low: correct at best, forgettable at worst.',
    },
  ],
};

const ES: GuideContent = {
  title: 'Cómo se califica el café',
  lede: 'Todas las calificaciones en BrewCult usan la ficha de cupping de la SCA: los mismos diez atributos que se califican en una mesa de cupping profesional, en la misma escala de 6 a 10. No la inventamos nosotros, y ese es justamente el punto: un 86 aquí significa lo mismo que un 86 en cualquier lado. Esta página explica cada atributo y cómo encontrarlo de verdad en tu taza.',
  scaleHeading: 'La escala',
  scaleIntro:
    'Cada atributo se califica de 6.00 a 10.00, en pasos de un cuarto de punto. La escala empieza en 6 porque la ficha existe para calificar café de especialidad: un atributo que calificaría más bajo tiene un defecto, y los defectos se cuentan aparte. Los diez atributos sumados dan un puntaje sobre 100, y 80 o más es lo que la palabra “specialty” significa formalmente.',
  scaleColumns: {
    score: 'Puntaje',
    word: 'La palabra de la ficha',
    meaning: 'Qué significa en la práctica',
  },
  onlyOverall:
    'En BrewCult solo General es obligatorio: es el único atributo que se puede responder honestamente desde un sillón, y es el mismo atributo que llena un juez. Los otros nueve están ahí cuando querás calificar en serio, y solo una ficha completa produce un puntaje sobre 100. Nueve números inventados serían peores datos que uno real.',
  attributesHeading: 'Los diez atributos',
  howToFind: 'Cómo encontrarlo:',
  defectsHeading: 'Taints y faults',
  defectsIntro:
    'Los defectos se restan del total en vez de esconderse en atributos con puntaje bajo, así que una taza defectuosa de un café por lo demás excelente queda registrada exactamente como eso.',
  defectsBody:
    'Un taint es una nota rara que podés oler pero que no arruina el sabor: un dejo a fermento, un filo a papel. Cada taza con taint cuesta 2 puntos. Un fault es un sabor defectuoso que sí se prueba: moho, fenol (a medicina), fermento ácido, o ese sabor a papa cruda que a veces traen algunos cafés de África Oriental. Cada taza con fault cuesta 4.',
  tryHeading: 'Probalo en tu casa',
  tryBody:
    'No necesitás un laboratorio. Molé 8.25 g de café grueso en una taza, echá 150 ml de agua recién salida del hervor directo sobre el molido y esperá cuatro minutos. Rompé la costra con una cuchara y olé mientras lo hacés: ese es tu puntaje de aroma. Quitá la espuma, esperá a que se enfríe lo suficiente y probá con un sorbo decidido. Después probá otra vez mientras se enfría: el café muestra sus defectos caliente y su dulzor frío, y un puntaje dado a una sola temperatura es medio puntaje.',
  tryThen: 'Ahora andá a calificar algo:',
  browseLink: 'cualquier café del catálogo',
  scale: [
    { score: '6.00–6.75', word: 'Bueno', meaning: 'Calidad sólida de especialidad; el piso de la escala, no un insulto.' },
    { score: '7.00–7.75', word: 'Muy bueno', meaning: 'Claramente disfrutable, con carácter real.' },
    { score: '8.00–8.75', word: 'Excelente', meaning: 'Distintivo y memorable. La mayoría de los cafés nunca llega aquí.' },
    { score: '9.00–9.75', word: 'Sobresaliente', meaning: 'Carácter excepcional; territorio de competencia.' },
    { score: '10.00', word: 'Excepcional', meaning: 'Lo mejor que ese atributo puede ser. Casi nunca se da.' },
  ],
  attributes: [
    {
      id: 'fragrance-aroma',
      name: 'Fragancia / aroma',
      what: 'A qué huele el café: la fragancia es el molido SECO antes de que lo toque el agua, y el aroma es el café mojado después. Se califican juntos como un solo atributo.',
      how: 'Olé el molido apenas lo molés: eso es fragancia. Echá el agua, esperá y olé otra vez mientras removés la superficie: eso es aroma. Los olores dulces, florales, frutales, a nuez y a chocolate califican bien; los planos, a papel o a humedad, no.',
      ends: 'Alto: sabrías que es buen café con los ojos cerrados, antes de probarlo. Bajo: huele a poco, o a cartón.',
    },
    {
      id: 'flavour',
      name: 'Sabor (flavour)',
      what: 'El plato fuerte: gusto y olfato trabajando juntos en la mitad del sorbo. No una nota suelta, sino el carácter combinado del café.',
      how: 'Tomá un sorbo con algo de aire (los catadores sorben fuerte para rociar el café por todo el paladar) y prestá atención a la mitad de la experiencia, después de la primera impresión y antes del final. ¿Podés nombrar lo que probás: una fruta, un dulzor, un chocolate? Un carácter definido y nombrable califica más alto que un "sabor a café" genérico.',
      ends: 'Alto: definido, expresivo, se lo podrías describir a un amigo. Bajo: vago, amaderado o desagradable.',
    },
    {
      id: 'aftertaste',
      name: 'Retrogusto (aftertaste)',
      what: 'Lo que queda después de tragar: tanto cuánto dura como si te alegra que dure.',
      how: 'Tragá, esperá diez segundos y fijate qué sigue ahí. El buen café deja dulzor o sabor agradable que se va despacio. El café menor desaparece de una, o peor, deja amargor, sequedad o un filo químico que se queda más que la parte buena.',
      ends: 'Alto: un final largo, dulce y agradable. Bajo: corto, o persistente de una forma que preferirías que no.',
    },
    {
      id: 'acidity',
      name: 'Acidez',
      what: 'El brillo o la vivacidad de la taza: la cualidad que hace que el café sepa vívido en vez de plano. Esto no es "agrio", y más no es mejor: el puntaje es por qué tan AGRADABLE es la acidez, no por cuánta hay.',
      how: 'Fijate en la sensación a los lados de la lengua justo después del sorbo, el mismo lugar donde se registra un mordisco de manzana verde o un chorrito de limón. Preguntate: ¿chispea, como fruta? ¿O muerde, como vinagre? Un lavado etíope excelente baila; un café verde o mal tostado solo frunce la boca.',
      ends: 'Alto: brillante, dulce, frutal, integrada. Bajo: o sin vida y plana, o áspera y agria.',
    },
    {
      id: 'body',
      name: 'Cuerpo (body)',
      what: 'El peso y la textura del café en la boca: liviano como té, o pesado como crema. Igual que con la acidez, el puntaje es por calidad: un cuerpo delicado puede ser excelente y uno pesado puede ser turbio.',
      how: 'Presioná la lengua contra el paladar a media sorbo y fijate en el espesor, como compararías leche descremada con leche entera. Después fijate en la textura: sedosa, cremosa, como jarabe, o bien delgada, arenosa, astringente (esa sensación seca, de lija, es un defecto de textura, no de sabor).',
      ends: 'Alto: una textura que le queda bien al café, de sedosa a jarabosa. Bajo: aguada, áspera o secante.',
    },
    {
      id: 'uniformity',
      name: 'Uniformidad',
      what: 'Si el café sabe igual taza tras taza. En una mesa de cupping se preparan cinco tazas de cada café, y cada taza consistente gana dos de los diez puntos.',
      how: 'En la casa rara vez preparás cinco tazas a la vez, así que juzgá la consistencia entre sorbos y entre preparaciones: ¿la misma bolsa, preparada igual, sabe igual el martes que el domingo? La inconsistencia casi siempre apunta a un tueste disparejo o a granos mezclados.',
      ends: 'Alto: cada taza es la misma taza. Bajo: una preparación queda linda y la siguiente sale rara.',
    },
    {
      id: 'balance',
      name: 'Balance',
      what: 'Cómo se llevan entre sí los demás atributos. Sabor, retrogusto, acidez y cuerpo en proporción, sin que nada grite por encima del resto y sin que falte nada.',
      how: 'Después de calificar las partes, alejate y preguntá por el conjunto: ¿la acidez tapa el dulzor? ¿Un cuerpo grande ahoga los sabores delicados? ¿O cada elemento sostiene a los otros? Pensá en una banda: el balance es que nadie tape al que canta.',
      ends: 'Alto: todo en proporción; quitar cualquier cosa lo empeoraría. Bajo: un atributo domina, o algo se siente ausente.',
    },
    {
      id: 'clean-cup',
      name: 'Taza limpia (clean cup)',
      what: 'La ausencia de todo lo que no pertenece: ningún sabor raro del primer sorbo al último. "Transparencia" es un buen sinónimo: nada entre vos y el café.',
      how: 'Probá desde el primer sorbo hasta el retrogusto con una sola pregunta: ¿hay algo aquí que no sea café? Humedad, sabor a tierra donde no corresponde, filo a fermento, moho, medicina. Cada una de las cinco tazas libre de interferencia gana dos puntos.',
      ends: 'Alto: nada más que café, de principio a fin. Bajo: notas raras interrumpen, aunque sea un momento.',
    },
    {
      id: 'sweetness',
      name: 'Dulzor',
      what: 'La plenitud agradable que viene de cerezas maduras y bien desarrolladas, más cerca del dulzor de un melocotón maduro que del azúcar de mesa. Sus opuestos son lo agrio, lo astringente y los sabores "verdes", a pasto.',
      how: 'Dejá que un sorbo se asiente un momento y fijate si el café se siente generoso y maduro, o delgado y vegetal. El café negro nunca sabe a agua con azúcar; lo que buscás es esa madurez que hace que una fruta sepa lista en vez de temprana.',
      ends: 'Alto: maduro, pleno, generoso. Bajo: verde, a pasto, astringente: el sabor de cerezas cortadas antes de tiempo.',
    },
    {
      id: 'overall',
      name: 'General (overall)',
      what: 'El veredicto honesto y de conjunto: el único lugar donde la ficha te pide tu opinión en vez de un análisis. También es el único puntaje que da todo el mundo en este sitio, esté catando o no.',
      how: 'Hacete la pregunta más simple del café: ¿qué tan bueno estuvo, de verdad? ¿Lo comprarías otra vez? ¿Cumple lo que prometen su origen y su tostador? Un café técnicamente correcto pero aburrido pierde puntos aquí; uno distintivo que no pudiste dejar de tomar los gana.',
      ends: 'Alto: lo buscarías otra vez. Bajo: correcto en el mejor de los casos, olvidable en el peor.',
    },
  ],
};

export function guideContent(locale: string): GuideContent {
  return locale === 'es' ? ES : EN;
}
