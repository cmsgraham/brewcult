/**
 * Español — Costa Rica.
 *
 * ── VOSEO ───────────────────────────────────────────────────────────────────
 * Costa Rica uses **vos**, not tú, in everything short of a legal notice. So:
 * "anotá", "probá", "tomate", "tu café". Writing tú at somebody in San José
 * reads like a dubbed telenovela; writing usted at them reads like a bank
 * letter. Vos is how a person actually talks to another person here.
 *
 * ── TRANSLATED, NOT TRANSLITERATED ──────────────────────────────────────────
 * The English is the meaning, not the wording. Where a phrase does not travel
 * ("dial in your grinder", "catching its breath") the Spanish says the same
 * thing the way somebody here would say it, rather than a word-for-word version
 * that is technically accurate and reads like a machine.
 *
 * ── TERMS LEFT IN ENGLISH ON PURPOSE ────────────────────────────────────────
 * "specialty" (café de especialidad is the phrase, but the SCA term is used as
 * a loanword in the trade), the cupping-form attribute names where the industry
 * itself uses them, and every proper noun. A Costa Rican barista says "el
 * cupping" and "el body"; pretending otherwise would be less clear, not more.
 */
import type { Messages } from '../lib/i18n';

export const es: Messages = {
  common: {
    signIn: 'Iniciar sesión',
    signUp: 'Crear cuenta',
    signOut: 'Cerrar sesión',
    profile: 'Perfil',
    cancel: 'Cancelar',
    save: 'Guardar',
    saving: 'Guardando…',
    remove: 'Quitar',
    optional: '(opcional)',
    loading: 'Cargando…',
    tryAgain: 'Eso no funcionó. Probá de nuevo en un momento.',
    language: 'Idioma',
  },

  nav: {
    skipToContent: 'Saltar al contenido',
    discover: 'Descubrir café',
    equipment: 'Equipo',
    recipes: 'Recetas',
    brew: 'Anotar una preparación',
    learn: 'Aprender',
    ai: 'Preguntarle al asistente',
  },

  home: {
    tagline: 'Inteligencia de preparación para quienes aman el café',
    lede: 'Anotá tus preparaciones, ajustá tu molino y encontrá café que vale la pena tomar. Principiantes bienvenidos: todo buen barista empezó con café amargo.',
  },

  discover: {
    title: 'Descubrir café',
    lede: 'Orígenes, procesos y tostadores, explicados en palabras sencillas. Nada aquí asume que ya sabés a qué sabe un Yirgacheffe lavado: para eso están las notas.',
    coffees: 'Cafés',
    empty:
      'Todavía estamos llenando los estantes, y la forma más rápida de llenarlos es una foto de lo que estés tomando. Usá “Agregar un café” arriba.',
    loadError:
      'Eso es culpa nuestra, no tuya. Recargá en un momento; el buscador de arriba quizá siga funcionando.',
  },

  addCoffee: {
    action: 'Agregar un café',
    openBags: '{count} bolsas abiertas en tu estante',
    openBag: '1 bolsa abierta en tu estante',
    intro:
      'Fotografiá la bolsa: la etiqueta lo tiene todo. Ambos lados ayudan: el frente dice el tostador y el café, y atrás suele estar la fecha de tueste y el proceso. El asistente los lee juntos, agrega la bolsa a tu estante y la pone en el catálogo si la etiqueta se ve clara.',
    front: 'Frente de la bolsa',
    frontHint: 'El tostador y el nombre del café.',
    back: 'Reverso de la bolsa',
    backHint: 'Fecha de tueste, proceso, peso: lo que esté impreso ahí.',
    pasteButton: 'Pegar del portapapeles',
    pasteHint: 'O presioná Ctrl+V (⌘V) en cualquier parte de este cuadro: llena el siguiente espacio vacío.',
    publishNotice: 'Si este café entra al catálogo, tu primera foto pasa a ser su imagen en el sitio.',
    noteLabel: 'Algo que la foto no muestre',
    notePlaceholder: 'p. ej. la fecha de tueste está en el borde de abajo',
    submit: 'Agregar este café',
    reading: 'Leyendo la etiqueta…',
    typeInstead: 'Mejor escribirlo',
    manualIntro:
      'Directo a tu estante. No se publica nada y no se lee nada: es solo para que tengás con qué anotar tus preparaciones.',
    roaster: 'Tostador',
    coffee: 'Café',
    addToShelf: 'Agregar a mi estante',
    usePhoto: 'Usar una foto',
    yoursOnly: 'solo tuyo',
    finished: 'Se acabó',
    publishedTitle: '{name} está en tu estante.',
    publishedBody:
      'También quedó en el catálogo, así que otras personas pueden encontrarlo, y el tostador aparece como no verificado hasta que alguien lo confirme.',
    shelvedTitle: '{name} está en tu estante.',
    shelvedBody:
      'La etiqueta no se veía lo bastante clara como para publicarlo, así que este queda solo para vos. Funciona igual para anotar preparaciones.',
  },

  offers: {
    heading: 'Dónde comprarlo',
    empty:
      'Nadie ha agregado un precio todavía. Si sabés cuánto cuesta y dónde, eso es lo más útil que puede tener esta página.',
    add: 'Agregar un precio',
    shop: 'Tienda o tostaduría',
    town: 'Ciudad',
    size: 'Tamaño de la bolsa',
    priceCrc: 'Precio en colones',
    priceUsd: 'Precio en dólares',
    currencyHint:
      'El que la tienda cotice de verdad; con uno basta. La otra moneda se muestra como una aproximación con ≈, para que el número de la tienda siempre sea el que está en negrita.',
    contacts: 'Cómo contactarlos (opcional)',
    phone: 'Teléfono',
    whatsapp: 'WhatsApp',
    website: 'Sitio web',
    instagram: 'Instagram',
    facebook: 'Facebook',
    maps: 'Enlace del mapa',
    linkLabel: 'Enlace a este café en su sitio',
    submit: 'Agregar este precio',
    unverified: 'sin verificar',
    quotedOn: 'cotizado el {date}',
    outOfStock: 'agotado',
    approxTitle: 'Convertido a ₡{rate}/$: la tienda cotiza en {quoted}',
    needAPrice: 'Poné un precio en colones, en dólares o en ambos.',
  },

  notes: {
    heading: 'Qué opinó la gente',
    summary: '{score} general de {count} personas',
    summaryOne: '{score} general de 1 persona',
    cupping: '{score} de puntaje de cupping de {count}',
    signedOutPrompt: 'para calificarlo o dejar una nota.',
    rate: 'Calificar este café',
    edit: 'Editar mi nota',
    overallLabel: 'General — la escala SCA, de 6 a 10',
    pickScore: 'Elegí un puntaje…',
    scaleHint:
      'La misma escala que se usa en una mesa de cupping: 80 o más en la ficha completa es lo que significa “specialty”.',
    whatEachMeans: 'Qué significa cada factor',
    openFullForm: 'Llenar la ficha de cupping completa',
    fullFormHint: '— nueve atributos más, para un puntaje sobre 100.',
    howToIdentify: 'Cómo identificar cada uno',
    taints: 'Tazas con taint',
    faults: 'Tazas con fault',
    minusTwo: '(−2 cada una)',
    minusFour: '(−4 cada una)',
    partialFormHint:
      'Los nueve más General dan un puntaje sobre 100. Si dejás alguno en blanco la nota igual cuenta: simplemente no tiene total, lo cual es honesto en vez de aproximado.',
    bodyLabel: 'Algo que valga la pena decir',
    bodyPlaceholder: 'A qué sabía, qué funcionó, qué cambiarías.',
    methodLabel: 'Cómo lo preparaste',
    methodPlaceholder: 'V60, 1:16, 94 °C',
    methodHint: 'El contexto resuelve discusiones que una nota sola empieza.',
    post: 'Publicar mi nota',
    update: 'Actualizar mi nota',
    deleteMine: 'Borrar mi nota',
    emptyList:
      'Nadie ha dicho nada todavía. Si ya probaste este, sabés más de él que cualquiera que lea esta página.',
    useful: 'Útil',
    usefulDone: 'Útil ✓',
    foundUseful: '{count} lo encontraron útil',
    noVotes: 'Sin votos todavía',
    you: 'vos',
    cupped: 'catado',
    someone: 'Alguien',
    outOf100: '{score}/100',
    overallOnly: '{score} general',
  },

  scale: {
    good: 'Bueno',
    veryGood: 'Muy bueno',
    excellent: 'Excelente',
    outstanding: 'Sobresaliente',
    exceptional: 'Excepcional',
  },

  session: {
    restoring: 'Volviendo a iniciar tu sesión…',
    noScript: 'Esta página necesita JavaScript para restaurar tu sesión.',
  },

  errors: {
    forbidden: 'No tenés acceso a eso.',
    notFound: 'No encontramos eso.',
    unauthorized: 'Iniciá sesión de nuevo para continuar.',
    conflict: 'Eso ya existe: probá iniciando sesión.',
    rateLimited: 'Fueron muchos intentos seguidos. Esperá un minuto y volvé a probar.',
    invalidCredentials:
      'Ese correo y esa contraseña no coinciden. Probá de nuevo, o restablecé tu contraseña.',
    emailNotVerified: 'Ya casi: confirmá tu correo primero. Podemos reenviarte el enlace.',
    invalidToken: 'Ese enlace venció o ya se usó. Pedí uno nuevo.',
    network: 'No pudimos conectar con BrewCult. Revisá tu conexión: nada de lo que escribiste se perdió.',
    server: 'Algo se rompió de nuestro lado, no del tuyo. Probá de nuevo en un momento.',
    form: 'Algo en el formulario necesita un ajuste.',
    tooLong: 'Eso tardó demasiado. ¿Probamos de nuevo?',
    busy: 'BrewCult está tomando aire. Probá de nuevo en un momento.',
  },
};
