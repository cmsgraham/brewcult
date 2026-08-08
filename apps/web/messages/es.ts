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
    menu: 'Menú',
    primary: 'Principal',
    homeAria: 'BrewCult — inicio',
    home: 'Inicio',
    logIn: 'Iniciar sesión',
    news: 'Noticias',
    community: 'Comunidad',
    marketplace: 'Tienda',
    discoverShort: 'Descubrir',
    discover: 'Descubrir café',
    equipment: 'Equipo',
    recipes: 'Recetas',
    brew: 'Preparar',
    learn: 'Aprender',
    ai: 'IA',
  },

  auth: {
    signInTitle: 'Iniciar sesión',
    signInDescription: 'Iniciá sesión en BrewCult.',
    // "Welcome back" con género neutro: nada de "bienvenido/a".
    signInHeading: 'Qué bueno verte de vuelta',
    signInLede: 'Tus preparaciones están donde las dejaste.',

    googleUnavailable:
      'Ahora mismo no se puede iniciar sesión con Google. Podés entrar con tu correo.',
    googleDenied:
      'No pudimos completar el inicio de sesión con Google. Probá de nuevo, o usá tu correo y contraseña.',
    googleNotActive: 'Esa cuenta no está activa. Escribinos y lo resolvemos.',
    googleNoEmail:
      'Google no nos compartió una dirección de correo, así que no pudimos iniciar tu sesión. Usá tu correo y contraseña.',
    googleUnverified:
      'Esa cuenta de Google tiene el correo sin verificar. Verificalo con Google primero, o iniciá sesión con tu correo y contraseña.',
    googleUnknown:
      'No pudimos completar ese inicio de sesión. Probá de nuevo, o usá tu correo y contraseña.',

    // Traducciones oficiales de Google, no nuestras. No reformular.
    googleSignIn: 'Iniciar sesión con Google',
    googleSignUp: 'Registrarse con Google',
    orUseEmail: 'o usá tu correo',

    emailLabel: 'Correo',
    passwordLabel: 'Contraseña',
    // Entra en `validation.required`, que en español dice "Necesitamos {label}."
    passwordNoun: 'tu contraseña',
    signingIn: 'Iniciando sesión…',
    forgotPassword: '¿Olvidaste tu contraseña?',
    newHere: '¿Primera vez?',
    createAnAccount: 'Creá una cuenta',
    somethingWrong: 'Algo salió mal de nuestro lado. Probá de nuevo en un momento.',

    mfaRecoveryPrompt:
      'Poné uno de los códigos de recuperación que guardaste cuando activaste la verificación en dos pasos.',
    mfaCodePrompt: 'Abrí tu app de autenticación y poné el código de 6 dígitos actual.',
    mfaRecoveryLabel: 'Código de recuperación',
    mfaCodeLabel: 'Código de autenticación',
    mfaRecoveryMissing: 'Poné un código de recuperación.',
    mfaCodeMissing: 'Poné el código de 6 dígitos.',
    mfaChecking: 'Revisando…',
    mfaVerify: 'Verificar e iniciar sesión',
    mfaUseApp: 'Mejor usar tu app de autenticación',
    mfaUseRecovery: '¿Perdiste tu dispositivo? Usá un código de recuperación',
    mfaStartOver: 'Empezar de nuevo',

    registerTitle: 'Crear una cuenta',
    registerDescription:
      'Unite a BrewCult. Principiantes bienvenidos: todo buen barista empezó con café amargo.',
    registerHeading: 'Empezá donde estás',
    registerLede:
      'Todo buen barista empezó con café amargo. Las preguntas de principiante son bienvenidas aquí, sea cual sea el equipo que tenés en la cocina.',
    handleLabel: 'Handle',
    handleHint: 'Letras minúsculas, números y guiones bajos. Este es tu @nombre.',
    displayNameLabel: 'Nombre visible (opcional)',
    displayNameHint: 'Lo que ve la gente. Lo podés cambiar cuando querás.',
    newPasswordHint:
      'Al menos {min} caracteres. Una frase corta funciona mejor que un garabato ingenioso.',
    ageUnconfirmed: 'Confirmá que tenés 16 años o más.',
    agePre: 'Tengo 16 años o más y acepto los',
    ageTerms: 'Términos',
    ageMid: 'y la',
    agePrivacy: 'Política de Privacidad',
    personalisationHeading: 'Qué hacemos con tus preparaciones',
    personalisationBody:
      'Lo que anotás arma un perfil de gusto que usamos para sugerirte cafés y ajustes de molienda. Ese es todo el truco: no se vende nada, y hay un interruptor para apagarlo en tu perfil. Apagarlo hace que las sugerencias sean más genéricas; no te bloquea nada. Podés exportar o borrar todo cuando querás.',
    creating: 'Creando tu cuenta…',
    createAccount: 'Crear cuenta',
    haveAccount: '¿Ya tenés una cuenta?',
    registeredTitle: 'Revisá tu correo.',
    registeredOne:
      'Te enviamos un enlace para confirmar tu dirección. Cuando le des clic ya podés',
    registeredSignIn: 'iniciar sesión',
    registeredTwo: '. ¿No llegó nada después de unos minutos? Revisá spam y después',
    registeredRetry: 'probá de nuevo',

    forgotTitle: 'Restablecer tu contraseña',
    forgotDescription: 'Pedí un enlace para restablecer tu contraseña de BrewCult.',
    forgotLede: 'Le pasa a todo el mundo. Decinos tu correo y te mandamos un enlace.',
    forgotEmailHint: 'Te mandamos un enlace para que pongás una contraseña nueva.',
    forgotSending: 'Enviando…',
    forgotSubmit: 'Enviar el enlace',
    forgotRemembered: '¿Ya te acordaste?',
    forgotBackToSignIn: 'Volver a iniciar sesión',
    forgotSentTitle: 'Revisá tu correo.',
    forgotSentBody:
      'Si esa dirección tiene una cuenta de BrewCult, el enlace ya va en camino. El enlace sirve una sola vez y vence pronto: pedí otro cuando querás.',

    resetTitle: 'Elegí una nueva contraseña',
    resetDescription: 'Poné una contraseña nueva para tu cuenta de BrewCult.',
    resetNewLabel: 'Nueva contraseña',
    resetNewHint: 'Al menos {min} caracteres.',
    resetConfirmLabel: 'Confirmá la nueva contraseña',
    resetMismatch: 'Todavía no coinciden.',
    resetSubmit: 'Guardar la nueva contraseña',
    resetNoTokenTitle: 'A este enlace le falta el token.',
    resetNoTokenOne: 'Abrí el enlace directamente desde el correo, o',
    resetNoTokenLink: 'pedí uno nuevo',
    resetDoneTitle: 'Contraseña cambiada.',
    resetDoneOne: 'Todo listo:',
    resetDoneLink: 'iniciá sesión',
    resetDoneTwo: 'con tu contraseña nueva.',

    verifyTitle: 'Confirmá tu correo',
    verifyDescription: 'Confirmá tu dirección de correo de BrewCult.',
    verifyWorking: 'Confirmando tu correo…',
    verifyDoneTitle: 'Correo confirmado.',
    verifyDoneOne: 'Ya estás adentro.',
    verifyDoneLink: 'Iniciá sesión',
    verifyDoneTwo: 'y anotá tu primera preparación: toma unos diez segundos.',
    verifyFailedTitle: 'Ese enlace no funcionó.',
    verifyFailedOne: 'Podés',
    verifyFailedLink: 'iniciar sesión',
    verifyFailedTwo: 'y pedir uno nuevo desde tu perfil.',
    verifyIdleTitle: 'Buscá el enlace en tu bandeja de entrada.',
    verifyIdleOne:
      'Los enlaces de confirmación abren esta página y terminan el trabajo solos. ¿No hay nada en tu bandeja después de unos minutos? Revisá spam y después',
    verifyIdleLink: 'iniciá sesión',
    verifyIdleTwo: 'y pedí otro.',
  },

  validation: {
    emailMissing: 'Necesitamos tu correo para iniciar tu sesión.',
    emailMalformed: 'Eso todavía no parece una dirección de correo.',
    required: 'Necesitamos {label}.',
    passwordMissing: 'Elegí una contraseña para que tu cuenta siga siendo tuya.',
    passwordShort:
      'Un poquito más larga, por favor: al menos {min} caracteres. Una frase corta funciona bien.',
    handleMissing: 'Elegí un handle: así te va a encontrar la gente.',
    handleMalformed: 'Los handles usan de 3 a 30 letras minúsculas, números o guiones bajos.',
  },

  home: {
    tagline: 'Inteligencia de preparación para quienes aman el café',
    lede: 'Anotá tus preparaciones, ajustá tu molino y encontrá café que vale la pena tomar. Principiantes bienvenidos: todo buen barista empezó con café amargo.',
    headline: 'El café mejora cuando le ponés atención.',
    intro:
      'BrewCult se pega al hábito que ya tenés. Anotá la preparación que ibas a hacer de todos modos y llevate algo útil a cambio: qué cambió, qué probar después y cuáles cafés valen lo que cuestan.',
    welcome:
      'Todo buen barista empezó con café amargo. Traé el equipo que tengás: una gran taza es totalmente posible con lo que ya usás, y aquí nadie te va a decir que primero comprés un molino de $700.',
    discoverCta: 'Descubrir café',
    profileCta: 'Tu perfil',
    registerCta: 'Crear una cuenta',
    lookAroundCta: 'Primero ver un poco',
    logTitle: 'Una bitácora, no una tarea',
    logBody:
      'Diez segundos, un toque para repetir lo de ayer. Funciona con una barra de wifi en la cocina, porque ahí es donde se prepara el café.',
    suggestionsTitle: 'Sugerencias, nunca órdenes',
    suggestionsBody:
      '“Probá moliendo más fino”, y después decidís vos. Los experimentos son el punto, y uno que sale mal igual son datos útiles.',
    questionsTitle: 'Las preguntas son bienvenidas',
    questionsBody:
      'Sin votos negativos y sin burlarse del equipo de nadie. Aquí lo que da estatus es explicar con paciencia.',
  },

  brew: {
    title: 'Anotar una preparación',
    description:
      'Anotá una preparación con un toque: tu última receta ya cargada, con botones en vez de un formulario.',
    footnote:
      'Por ahora filtrado e inmersión. El espresso llega cuando esta tarjeta pase su prueba de quince segundos con gente de verdad.',
    loggerLabel: 'Bitácora de preparación',
    loading: 'Buscando tu última preparación…',
    resumed: 'Retomamos donde lo dejaste: no se perdió nada.',
    queueOne: '1 preparación esperando sincronizar. Está segura en este dispositivo.',
    queueMany: '{count} preparaciones esperando sincronizar. Están seguras en este dispositivo.',

    offlineTitle: 'Estás sin conexión',
    offlineBody:
      'No se pierde nada. Cualquier preparación que hayás anotado queda guardada en este dispositivo y se sincroniza sola apenas volvás a tener señal; no tenés que hacer nada.',
    offlineDescription: 'BrewCult funciona sin conexión.',
    backToLogger: 'Volver a la bitácora',

    noBag: 'Todavía no elegiste bolsa',
    switchBag: 'Cambiar de bolsa',
    newCoffee: 'Estoy preparando un café nuevo…',

    basisLast: 'Igual que tu última preparación',
    basisOfficial: 'La receta del tostador para este café',
    basisCommunity: 'Una receta de la comunidad para tu equipo',
    basisDefaults: 'Un punto de partida: cambiá lo que querás',

    // "Pour over" y "brewer" se dicen así en el gremio; el resto sí se traduce.
    brewer: 'Método',
    pourOver: 'Pour over',
    doseWater: 'Dosis → agua',
    temperature: 'Temperatura',
    time: 'Tiempo',
    grind: 'Molienda',
    dose: 'Dosis',
    water: 'Agua',
    brewAgain: 'Preparar este otra vez',
    logThis: 'Anotar esta preparación',
    tweak: 'Ajustar',

    changeCoffee: 'Cambiar de café',
    applyIt: 'Aplicarlo',
    followsWater: 'sigue al agua',
    followsDose: 'sigue a la dosis',
    waterFollowsDose: 'el agua sigue a la dosis',
    doseFollowsWater: 'la dosis sigue al agua',
    ratioWaterFollows:
      'Proporción {ratio}. El agua sigue a la dosis. Activá esto para que la dosis siga al agua.',
    ratioDoseFollows:
      'Proporción {ratio}. La dosis sigue al agua. Activá esto para que el agua siga a la dosis.',
    more: 'Más',
    grindCategory: 'Categoría de molienda',
    grindCategoryHint: 'El único valor de molienda que sobrevive a un cambio de molino.',
    logBrew: 'Anotar',
    back: 'Volver',

    decrease: 'Bajar {label}',
    increase: 'Subir {label}',
    exactValue: '{label}, valor exacto',
    grams: '{value} gramos',
    degrees: '{value} grados centígrados',
    brewTime: 'Tiempo de preparación',
    startTimer: 'Iniciar cronómetro',
    stopTimer: 'Parar cronómetro',

    howWasIt: '¿Cómo quedó?',
    rateWhenTasted: 'Calificalo cuando lo probés',
    tasteBitter: 'Amargo',
    // "Agrio", no "ácido": la acidez en café es algo bueno y esto no lo es.
    tasteSour: 'Agrio',
    tasteWeak: 'Aguado',
    tasteGood: 'Bueno',
    hintOverExtracted: 'casi siempre sobreextraído',
    hintUnderExtracted: 'casi siempre subextraído',
    hintKeeper: 'para repetir',

    logged: 'Anotado.',
    remindMe: 'Recordámelo mañana',
    reminded: 'Te va a estar esperando en la tarjeta de mañana.',
    synced: 'Sincronizado.',
    savedOffline: 'Guardado en este dispositivo. Se sincroniza solo cuando tengás señal.',
    savedLocally: 'Guardado en este dispositivo.',
    logAnother: 'Anotar otra',
    share: 'Compartir esta preparación',
    thisBrew: 'Esta preparación',

    // El español tiene ordinales cómodos hasta "décima"; de ahí en adelante
    // "preparación 27" es lo que alguien diría, y para eso está `paybackNthPlain`.
    paybackNth: '{ordinal} preparación de esta bolsa',
    paybackNthPlain: 'Preparación {n} de esta bolsa',
    paybackTrending: '{nth}: tus calificaciones van subiendo.',
    paybackGood: '{nth}, y de las buenas. Vale la pena repetirla.',
    paybackOneThing: '{nth}. Cambió una sola cosa; la comparamos con la anterior por vos.',
    paybackPlain: '{nth}.',
    paybackWith: '{nth}. {suggestion}',
    suggestBitter:
      'Pasa: el amargo casi siempre significa sobreextracción. ¿Probás 0.5 más grueso mañana?',
    suggestSour: 'El agrio casi siempre significa subextracción. ¿Probás 0.5 más fino mañana?',
    suggestWeak:
      'Aguado casi siempre significa subextracción. ¿Un poquito más fino, o un toque más de café?',

    chooseCoffee: 'Elegir un café',
    whichCoffee: '¿Cuál café?',
    searchPlaceholder: 'Empezá a escribir: con “chelb” aparece',
    noMatch: 'Todavía no hay coincidencias; podés agregarlo en tres campos aquí abajo.',
    matchOne: '1 coincidencia.',
    matchMany: '{count} coincidencias.',
    searchOffline:
      'La búsqueda necesita conexión. Agregalo en tres campos aquí abajo y anotá igual.',
    recentBags: 'Bolsas recientes',
    addInThree: 'Agregalo en tres campos',
    roaster: 'Tostador',
    coffeeName: 'Nombre del café',
    roastLevel: 'Nivel de tueste',
    roastLight: 'Claro',
    roastMediumLight: 'Medio claro',
    roastMedium: 'Medio',
    roastMediumDark: 'Medio oscuro',
    roastDark: 'Oscuro',
    useThisCoffee: 'Usar este café',
    matchLater:
      'Después lo emparejamos con el catálogo. Tus preparaciones quedan ligadas a él de todos modos.',
    notInList: '¿No está en la lista? Agregalo en tres campos',
    backToBrewing: 'Volver a preparar',

    photoOf: 'Foto de esta preparación',
    addPhotoOf: 'Agregar una foto de esta preparación',
    photoCta: 'Tomar o elegir una foto',
    addPhotoOptional: 'Agregar una foto (opcional)',
    photoNote: 'Nunca atrasa la anotación: anotá la preparación y la foto la alcanza.',
  },

  history: {
    title: 'Tus preparaciones',
    description: 'Todas las preparaciones que has anotado, de la más reciente a la más vieja.',
    lede: 'Todo lo que has anotado, de lo más nuevo a lo más viejo: qué usaste y cómo te quedó.',
    loading: 'Buscando tus preparaciones…',
    loadingMore: 'Buscando más…',
    more: 'Ver más',
    empty: 'Todavía no hay preparaciones. La primera toma unos quince segundos.',
    logFirst: 'Anotar una preparación',
    unnamedCoffee: 'Un café que agregaste vos',
    pending: 'En este dispositivo; se sincroniza sola apenas tengás señal.',
    loadError:
      'No pudimos alcanzar tus preparaciones en este momento: eso es culpa nuestra, no tuya. Lo que anotaste en este dispositivo sigue aquí.',
    partial:
      'Mostrando lo que hay en este dispositivo. El resto aparece apenas volvamos a alcanzar el servidor.',
    rating: 'Calificada {rating}/5',
    unrated: 'Sin calificar.',
    delete: 'Borrar',
    deleteConfirm: '¿Borrar esta preparación?',
    deleteYes: 'Borrarla',
    deleting: 'Borrando…',
    signedOutOne: 'Tus preparaciones están ligadas a tu cuenta.',
    signedOutLink: 'Iniciá sesión',
    signedOutTwo: ' para verlas.',
  },

  ai: {
    title: 'Asistente de preparación',
    description:
      'Preguntá sobre tus preparaciones, tu equipo y el café que tenés enfrente: respuestas basadas en tus propias anotaciones y en el catálogo de BrewCult.',
    lede: 'Lee tus anotaciones, tu equipo y el catálogo de BrewCult antes de responder; y cuando el grafo no tiene nada que decir sobre tu café, te lo dice en vez de inventar algo.',
    footnote:
      'Una sugerencia a la vez, a propósito: cambiar tres cosas de una no te enseña cuál funcionó. Las respuestas son un punto de partida; tu paladar decide.',

    chatLabel: 'Asistente de preparación',
    emptyPrompt:
      'Preguntá sobre un café, un método o la taza que acabás de tomarte. Las respuestas salen de tus preparaciones y del catálogo de BrewCult, y lo dicen cuando no es así.',
    you: 'Vos',
    thinking: 'Pensando…',
    placeholder: 'Preguntá sobre tu preparación…',
    ask: 'Preguntar',
    stop: 'Parar',
    openerSour: '¿Por qué mi café sabe agrio?',
    openerSweet: '¿Qué cambio para que quede más dulce?',
    openerV60: 'Dame una receta de partida para un V60.',

    leadGood: 'Muy bien. Si querés llevarlo más lejos:',
    leadFix: 'Pasa. Este es el arreglo de siempre.',
    confidenceLow: 'Aquí estoy adivinando más de lo normal: vale la pena probarlo, pero no es una regla.',
    confidenceMedium: 'Bastante seguro, aunque tu paladar tiene la última palabra.',
    noData: 'Todavía no hay datos de la comunidad para este café; esto es un punto de partida general.',
    basisBoth: 'Basado en tus {mine} y en {theirs}.',
    basisMine: 'Basado en tus {mine}.',
    basisTheirs: 'Basado en {theirs} de este café.',
    brewCountOne: '1 preparación de este café',
    brewCountMany: '{count} preparaciones de este café',
    communityCountOne: '1 preparación de la comunidad',
    communityCountMany: '{count} preparaciones de la comunidad',

    basedOn: 'Basado en',
    workingOut: 'Buscando un punto de partida…',
    getStarting: 'Conseguir una receta de partida para mi equipo',
    lookingAt: 'Revisando las notas del tostador y las preparaciones de la comunidad…',

    startingTitle: '¿No sabés por dónde empezar?',
    startingBodyNamed:
      'Un punto de partida para {coffee} con tu equipo: la receta del tostador si la hay, lo que prepara la comunidad si no, y una nota honesta sobre cuál de las dos es.',
    startingBody:
      'Un punto de partida para este café con tu equipo: la receta del tostador si la hay, lo que prepara la comunidad si no, y una nota honesta sobre cuál de las dos es.',
    startingUnavailable:
      'El asistente de recetas no está disponible en este momento; las recetas de abajo son un buen lugar para empezar.',
    logWithThis: 'Anotar una preparación con esta receta',
    retry: 'Probá de nuevo',
  },

  media: {
    uploading: 'Subiendo tu foto…',
    photoAdded: 'Foto agregada.',
    photoQueued: 'Guardada en este dispositivo: se sube cuando tengás señal.',
    chooseDifferent: 'Elegir otra foto',
    addPhoto: 'Agregar una foto',
    takeOrPick: 'Tomá una, o elegí un archivo. Hasta {limit}.',
    dropOrPick: 'Soltá una aquí o elegí un archivo. Hasta {limit}.',
    tryAnother: 'Probar con otra foto',
    replacePhoto: 'Reemplazar la foto',
    removePhoto: 'Quitar la foto',
    privacyNote: 'Los datos de ubicación se eliminan de las fotos al subirlas.',
    notAnImage: 'Ese archivo no es una imagen. JPEG, PNG, WebP o HEIC funcionan.',
    tooBigExact:
      'Esa foto pesa {size}; cualquiera por debajo de {limit} sirve. Una exportación más pequeña o una captura lo resuelve.',
    emptyFile: 'Ese archivo llegó vacío. Probá eligiéndolo de nuevo.',
    tooBig: 'Esa foto pasa el límite de {limit}. Una exportación más pequeña sí entra.',
    wrongType: 'Ese tipo de archivo no está soportado. JPEG, PNG, WebP o HEIC funcionan.',
    unreadable: 'No pudimos leer esa imagen. Probá con otro archivo, o exportala de nuevo como JPEG.',
    outOfRoom: 'Tu almacenamiento de fotos está lleno. Si quitás una foto vieja, cabe esta.',
    notSwitchedOn: 'Las fotos todavía no están activadas. Todo lo demás se guardó normal.',
    offline:
      'Estás sin conexión, así que la foto queda esperando en este dispositivo. Se sube cuando tengás señal.',
    uploadFailed: 'Esa subida no pasó. Probá de nuevo en un momento.',

    avatarLabel: 'Foto de perfil',
    avatarHint: 'Una cara, una taza, una bolsa: lo que querás que la gente vea junto a tu nombre.',
    avatarCta: 'Agregar una foto de perfil',
    avatarSet: 'Esa es tu foto de perfil ahora.',
    avatarRemoved: 'Foto quitada. Volvieron tus iniciales.',
    avatarNotSwitchedOn:
      'Las fotos de perfil todavía no están encendidas. Nada más en esta página se ve afectado.',
    avatarAltNamed: 'Foto de perfil de {name}',
    avatarAlt: 'Foto de perfil',
    avatarNoPhoto: 'Todavía sin foto',
  },

  coffeePage: {
    eyebrow: 'Café',
    notFound: 'Café',
    loadErrorTitle: 'No pudimos cargar este café',
    loadErrorBody: 'Es culpa nuestra, no tuya. Probá de nuevo en un momento, o',
    browseRest: 'mirá el resto del catálogo',
    roastedBy: 'Tostado por',
    breadcrumbHome: 'Inicio',
    breadcrumbCoffee: 'Café',

    // La entrada se arma con lo que este café realmente tiene, así que no hay
    // dos páginas que empiecen con la misma frase.
    ledeFrom: 'Un café {process}de {origin},',
    ledePlain: 'Un café',
    ledeRoaster: 'tostado por {roaster}.',
    ledeNotes: 'El tostador le encuentra {notes}.',
    anIndependentRoaster: 'un tostador independiente',

    tastingNotes: 'Notas de cata',
    tastingNotesCaveat:
      'Estas son las palabras del tostador para lo que él encontró. Si vos sentís otra cosa, no estás equivocado: las notas son un mapa, no un examen.',

    provenance: 'De dónde viene',
    origin: 'Origen',
    farm: 'Finca o beneficio',
    process: 'Proceso',
    processDetail: 'Detalle del proceso',
    varietals: 'Variedades',
    altitude: 'Altura',
    masl: '{value} msnm',
    harvest: 'Cosecha',
    roastLevel: 'Nivel de tueste',
    bestFor: 'Mejor para',
    noLot:
      'Todavía no tenemos la procedencia a nivel de lote para este café: faltan la finca, la variedad y la altura. Eso es un hueco en nuestros datos, no en el café.',

    whatItMeans: 'Qué significa eso en la taza',
    processHeading: 'Proceso {process}',
    roastHeading: 'Tueste {roast}',
    brewedAs: 'Preparado como {use}',

    recipesHeading: 'Recetas para este café',
    recipesSubject: 'este café',
    gearHeading: 'Equipo con el que la gente lo prepara',
    moreFrom: 'Más de {roaster}',
    seeEverything: 'Ver todo lo de {roaster} →',
    keepLooking: 'Seguí buscando',
    moreFromOrigin: 'Más cafés de {country}',
    moreProcess: 'Más cafés {process}',
    browseWhole: 'Ver todo el catálogo',
  },

  profile: {
    title: 'Tu perfil',
    description: 'Tu cuenta de BrewCult, tu equipo y el control de tus datos.',
    emailUnconfirmed: 'correo sin confirmar',
    verifyTitle: 'Una cosita.',
    verifyBody:
      'Confirmá tu correo para que podamos mandarte enlaces de recuperación y avisos de pedidos. El enlace está en tu bandeja de entrada:',
    verifyLink: 'aquí los detalles',
    photoHeading: 'Tu foto',
    emailHeading: 'Correo',
    emailBody:
      'Mandamos un resumen semanal de tus propias preparaciones y un aviso cuando alguien construye sobre una de tus recetas. Los dos se apagan con un clic, y nunca mandamos publicidad.',
    emailSettings: 'Ajustes de correo',
    securityHeading: 'Entrar de forma segura',
    securityBody:
      'La autenticación de dos factores hace que entrar necesite tu contraseña y un código de un aparato que tengás en la mano. Toma como un minuto configurarla, y la podés apagar cuando querrás.',
    twoFactorLink: 'Autenticación de dos factores →',
    equipmentHeading: 'Tu equipo',
    equipmentBody:
      'Lo que tengás es el punto de partida correcto. Si nos contás cuál es, las sugerencias te hablan en los números de tu molino y no en los de otra persona.',
    seeBrews: 'Ver tus preparaciones',
    coffeeHeading: 'Tu café',
    coffeeBody: 'Las bolsas que estás tomando. Fotografiá una y la etiqueta llena el resto.',
    personalisationHeading: 'Personalización, en palabras sencillas',
    personalisationOne:
      'Cada preparación que anotás — café, molienda, proporción, a qué supo — arma un perfil de gusto que es tuyo. Lo usamos para tres cosas: sugerirte cafés que probablemente te gusten, sugerirte ajustes, y ordenar lo que ves primero. Esa es la lista completa. No lo vendemos, y no alimenta la publicidad de nadie.',
    personalisationTwo:
      'Podés apagar la personalización. Las sugerencias se vuelven más genéricas; nada más cambia, y no se bloquea ninguna función. El interruptor llega junto con el perfil de gusto: va a estar en esta página, y va a ser un switch, no un formulario.',
    personalisationThree:
      'El correo de servicio siempre te llega (estado de pedidos, recuperación de contraseña). El correo de marketing es solo si lo pedís, y el resumen semanal se para con un clic. Leé la',
    privacyLink: 'política de privacidad',
    personalisationThreeEnd: 'completa para el detalle de cuánto guardamos.',
    dataHeading: 'Tus datos son tuyos',
    dataBody:
      'Exportar te da todo en un archivo que las máquinas leen: preparaciones, recetas, publicaciones y perfil de gusto. Borrar significa borrar. Los dos los hacés vos mismo, porque los datos con los que te podés ir son datos que vale la pena cuidar.',
  },

  account: {
    somethingWrong: 'Algo salió mal de nuestro lado. Probá de nuevo en un momento.',
    exportStarted:
      'Estamos empacando tus datos. Te va a llegar un correo con un enlace de descarga; incluye tus preparaciones, recetas, publicaciones y perfil de gusto.',
    exportSoon:
      'La exportación está casi lista: el botón va a empezar a funcionar sin que hagás nada. Mientras tanto, tus datos no se van a ningún lado.',
    deletionScheduled:
      'Tu cuenta quedó programada para borrarse. Las recetas públicas que otras personas hayan bifurcado se quedan, pero sin tu nombre; todo lo personal se elimina en 30 días.',
    deletionSoon:
      'El borrado autoservicio está casi listo. Mientras tanto, escribinos y una persona lo hace; sin vueltas para retenerte.',
    preparing: 'Preparando…',
    exportMine: 'Exportar mis datos',
    deleteMine: 'Borrar mi cuenta',
    confirmLabel: 'Confirmar el borrado de la cuenta',
    confirmBody:
      'Esto borra tu cuenta, tus preparaciones, tus recetas y tu perfil de gusto. Las recetas públicas que otras personas hayan bifurcado se quedan, pero sin tu nombre, para que su trabajo no se rompa. Los registros de pedidos se guardan solo lo que la ley tributaria exige. No se puede deshacer.',
    deleting: 'Borrando…',
    yesDelete: 'Sí, borrala',
    keepMine: 'Mejor la dejo',
  },

  notifications: {
    title: 'Ajustes de correo',
    description: 'Elegí cuáles correos de BrewCult querés recibir.',
    back: '← Volver a tu perfil',
    lede: 'Todo esto se apaga con un clic, y se queda apagado. No mandamos publicidad.',
    loadFailed: 'No pudimos cargar tus ajustes. Recargá para probar de nuevo.',
    saveFailed: 'Eso no se guardó. Probá de nuevo en un momento.',
    loading: 'Cargando tus ajustes…',
    securityAlways:
      'Los correos de seguridad —códigos de inicio de sesión, cambios de contraseña, cambios de dos factores— siempre se mandan, y estos ajustes no los afectan.',
    weeklyLabel: 'Resumen semanal de preparaciones',
    weeklyBody:
      'Un resumen corto de lo que preparaste, una vez por semana. Tus propios datos, los de nadie más. Una semana sin preparaciones no manda nada.',
    forkedLabel: 'Alguien construye sobre tu receta',
    forkedBody:
      'Cuando otra persona bifurca una receta que publicaste, para que veás a dónde llegó.',
  },

  security: {
    title: 'Autenticación de dos factores',
    description: 'Agregá un segundo paso a tu inicio de sesión en BrewCult.',
    back: '← Tu perfil',
    heading: 'Entrar de forma segura',
    lede: 'La autenticación de dos factores hace que entrar necesite dos cosas: tu contraseña y un código que cambia cada treinta segundos en un aparato que tenés en la mano. Es lo más efectivo que podés hacer por tu cuenta, y la podés apagar cuando querrás.',
    honestHeading: 'La versión honesta',
    honestOne:
      'Lo de dos factores no es que no confiemos en vos. Las contraseñas se reciclan, y la filtración casi siempre pasó en otro lado: un foro de 2014, una tienda que las guardó mal. Un segundo factor hace que esa filtración deje de ser tu problema.',
    honestTwo:
      'Si tenés un rol de staff te lo exigimos, y la razón es concreta: todo lo que se hace en la consola de operación queda escrito en una bitácora que solo crece, con un nombre al lado. Ese registro sirve de algo únicamente si la persona nombrada es la única que pudo haberlo hecho.',
    honestThree:
      'Nunca vemos tus códigos y no los podemos generar. Si perdés el teléfono, los códigos de recuperación son la forma de volver a entrar; por eso la configuración insiste tanto en que los guardés.',

    roles: {
      user: 'Miembro',
      moderator: 'Moderador',
      editor: 'Editor',
      seller_owner: 'Dueño de tienda',
      admin: 'Admin',
    },

    mfa: {
      panelHeading: 'Autenticación de dos factores',
      on: 'Activada',
      off: 'Desactivada',
      sessionDidNotUseIt: 'Este inicio de sesión no la usó',
      freshSignInHeading: 'Un paso más para entrar a las áreas de staff',
      freshSignInOne:
        'Los dos factores están activados en tu cuenta, pero el inicio de sesión que estás usando ahora se hizo sin ellos, así que esta sesión sigue contando como de solo contraseña. Por eso la consola de operación te rechaza aunque todo se vea encendido.',
      freshSignInTwo:
        'Salir y volver a entrar, con un código de tu app, lo arregla. Nada cambia en tu cuenta y no vas a tener que configurar nada de nuevo.',
      signingOut: 'Cerrando sesión…',
      signOutAndBack: 'Cerrar sesión y volver a entrar',
      goToSignIn: 'Ir a iniciar sesión',
      verifiedNote:
        'Los inicios de sesión piden un código de tu app de autenticación. Esta sesión usó uno, así que las áreas de staff están abiertas para vos.',
      offPitch:
        'Ahora mismo tu contraseña es lo único que hay entre alguien y tu cuenta. Los dos factores agregan un segundo código, de vida corta, desde una app en tu teléfono, así que una contraseña filtrada o reciclada no alcanza por sí sola. Configurarlo toma unos dos minutos.',
      staffAlertTitle: 'Tenés el rol de {role}.',
      staffAlertBody:
        'Las áreas de staff lo necesitan. Suspender una cuenta, cambiar un rol o resolver un reporte queda escrito en una bitácora que solo crece, con tu nombre al lado, y esa firma vale algo únicamente si nadie más la puede producir. La consola de operación no se va a abrir hasta que esto esté activado y hayás iniciado sesión con ello.',
      gettingReady: 'Preparando todo…',
      turnOn: 'Activar los dos factores',
      backToProfile: 'Volver a tu perfil',
      noticeOn: 'Los dos factores están activados en tu cuenta.',
      noticeCodesReplaced: 'Tus códigos de recuperación fueron reemplazados.',
      noticeOff:
        'Los dos factores están desactivados. Tu cuenta volvió a ser de solo contraseña, y los códigos de recuperación que tenías ya no funcionan.',
    },

    enrol: {
      heading: 'Emparejá tu app de autenticación',
      intro:
        'Sirve cualquier app de autenticación: 1Password, Bitwarden, Authy, Google Authenticator, la que ya trae tu teléfono. Escaneá el código, o escribí la clave a mano si te resulta más fácil.',
      qrLabel:
        'Código QR de configuración para la autenticación de dos factores de BrewCult. Si no lo podés escanear, usá la clave de configuración que aparece al lado.',
      meta: 'Códigos de {digits} dígitos, que se renuevan cada {seconds} segundos.',
      cantScanHeading: '¿No lo podés escanear?',
      cantScanBody:
        'Elegí «ingresar una clave de configuración» en tu app y escribí esto. Los espacios están para que se lea mejor; las apps los ignoran.',
      copyKey: 'Copiar la clave',
      codeLabel: 'Código de seis dígitos de tu app',
      codeHint:
        'Esto comprueba que el emparejamiento funcionó. Si dice que el código no es válido, esperá el siguiente y probá otra vez: no se pierde nada.',
      checking: 'Revisando…',
      submit: 'Activar los dos factores',
      cancel: 'Ahora no',
    },

    manage: {
      regenHeading: 'Códigos de recuperación nuevos',
      regenBody:
        'Hace un juego nuevo de diez y retira los viejos. Vale la pena si ya usaste varios, o si no estás seguro de dónde quedó el juego anterior.',
      codeLabel: 'Código de tu app',
      generating: 'Generando…',
      generate: 'Generar códigos nuevos',
      disableHeading: 'Desactivar los dos factores',
      disableBody:
        'Tu cuenta vuelve a ser de solo contraseña. La podés volver a activar cuando querás.',
      disableStart: 'Desactivar los dos factores',
      consequenceStaff:
        'Vas a perder el acceso a las áreas de staff. La consola de operación revisa que la sesión tenga dos factores antes de abrirse, así que /admin va a dejar de funcionarte hasta que los volvás a activar e inicies sesión de nuevo.',
      consequenceMember:
        'Tus códigos de recuperación también dejan de funcionar, y una contraseña robada bastaría para entrar a tu cuenta por sí sola. Si alguna vez tomás un rol de staff, vas a necesitar los dos factores de vuelta antes de que la consola de operación se abra.',
      passwordLabel: 'Tu contraseña',
      disableCodeLabel: 'Código actual de tu app',
      disableCodeHint:
        'Se necesitan los dos, para que alguien que solo tenga tu contraseña, o que solo tenga tu computadora abierta, no pueda apagar esto.',
      turningOff: 'Desactivando…',
      confirmOff: 'Sí, desactivalo',
      keepOn: 'Mejor dejalos activados',
    },

    codes: {
      headingEnrolled:
        'Los dos factores están activados. Guardá estos códigos de recuperación.',
      headingRegenerated: 'Aquí está tu juego nuevo de códigos de recuperación.',
      warnTitle: 'No los vas a volver a ver.',
      warnBody:
        'Los guardamos revueltos, así que de verdad no te los podemos mostrar una segunda vez. Si perdés tanto tu app de autenticación como estos códigos, volver a entrar implica demostrarle a una persona quién sos, y eso toma días.',
      regeneratedNote:
        'Tus códigos viejos dejaron de funcionar en el momento en que se hicieron estos. Si los tenías anotados en algún lado, reemplazalos ya.',
      listLabel: 'Tus códigos de recuperación',
      keepNote:
        'Cada uno funciona una sola vez, en lugar de un código de tu app. Guardalos en un lugar que no sea el teléfono donde vive tu app de autenticación: un gestor de contraseñas, o papel en una gaveta.',
      copyAll: 'Copiar todos los códigos',
      download: 'Descargar como archivo de texto',
      downloadBlocked:
        'Tu navegador bloqueó la descarga. Mejor copiá los códigos de arriba, o anotalos: están en pantalla y esta es la única vez que te los podemos mostrar.',
      ack: 'Ya guardé mis códigos de recuperación en un lugar seguro.',
      done: 'Listo',
      fileTitle: 'Códigos de recuperación de BrewCult',
      fileAccount: 'Cuenta: @{handle}',
      fileOnce: 'Cada código funciona una sola vez, en lugar de tu app de autenticación.',
      fileWhere:
        'Guardalos en un lugar que no sea el aparato donde tenés tu app de autenticación.',
      fileReplace: 'Generar un juego nuevo reemplaza todos los códigos de abajo.',
    },

    copy: {
      copied: 'Copiado',
      copiedAnnounce: '{label}: ya está en tu portapapeles.',
      failed:
        'Tu navegador no nos dejó llegar al portapapeles. Seleccioná el texto de arriba y copialo a mano.',
    },
  },

  kit: {
    loadFailed: 'No pudimos cargar tu equipo. Recargá para probar de nuevo.',
    saveFailed: 'Eso no se guardó. Probá de nuevo en un momento.',
    loading: 'Cargando tu equipo…',
    empty:
      'Todavía no hay nada aquí. Agregá el molino y el método que más usás; con eso basta para que las sugerencias te hablen en tus números.',
    badgeDefault: 'Predeterminado',
    badgeYours: 'Tuyo',
    scaleSuffix: 'escala {scale}',
    makeDefault: 'Dejarlo por defecto',
    addLabel: 'Agregar equipo',
    searchPlaceholder: 'Buscá molinos, métodos, chorreadores, balanzas…',
    hintType: 'Escribí una marca o un modelo: “niche”, “v60”, “stagg”.',
    hintSearching: 'Buscando…',
    hintNothing:
      'No hubo coincidencias. Si falta tu equipo lo agregamos; el catálogo todavía está creciendo.',
    hintMatchOne: '1 coincidencia',
    hintMatchMany: '{count} coincidencias',
    addAsOwn: 'Agregar “{query}” como tuyo',
    customNote:
      'Esto queda solo en tu cuenta: no aparece en la búsqueda ni en ninguna página pública. Igual podés anotar preparaciones con él de una vez.',
    brand: 'Marca',
    model: 'Modelo',
    type: 'Tipo',
    addToMine: 'Agregar a mi equipo',
    added: 'Agregado',
    add: 'Agregar',
  },

  suggestKit: {
    noClipboardImage: 'No hay ninguna imagen en el portapapeles: copiá una primero, o elegí un archivo.',
    clipboardBlocked:
      'El navegador no nos dejó leer el portapapeles. Mejor presioná Ctrl+V (o ⌘V).',
    sendFailed: 'Eso no se envió. Probá de nuevo en un momento.',
    publishedTitle: '{label} ya está en el catálogo.',
    queuedTitle: 'Gracias, ya lo tenemos.',
    publishedBody: 'También se agregó a tu equipo, así que lo podés usar de una vez.',
    queuedBody:
      'El asistente no quedó lo bastante seguro como para agregarlo, así que lo va a ver una persona. Lo que ya hayás registrado por tu cuenta sigue funcionando mientras tanto.',
    prompt: '¿Creés que debería estar en el catálogo compartido?',
    suggestIt: 'Sugerilo',
    awaitingOne: ' — tenés 1 esperando revisión.',
    awaitingMany: ' — tenés {count} esperando revisión.',
    intro:
      'Describilo, o pegá la descripción del fabricante. Si el asistente reconoce el producto, entra al catálogo y a tu equipo de una vez. Lo que no tenga claro espera a una persona en vez de adivinar.',
    whatIsIt: '¿Qué es?',
    descriptionPlaceholder:
      'p. ej. Option-O Lagom P100 — molino de muelas planas de 64 mm, single-dose, sin pasos…',
    photo: 'Foto',
    photoAlt: 'La foto que adjuntaste',
    paste: 'Pegar del portapapeles',
    pasteHintCan: 'O presioná Ctrl+V (⌘V) en cualquier parte de este cuadro.',
    pasteHintCannot:
      'Copiá una captura y después presioná Ctrl+V (⌘V) en cualquier parte de este cuadro.',
    sending: 'Enviando…',
    send: 'Enviar sugerencia',
    historyOne: 'Tus sugerencias (1)',
    historyMany: 'Tus sugerencias ({count})',
    statusPending: 'esperando',
    statusApproved: 'agregado',
    statusRejected: 'no agregado',
  },

  search: {
    label: 'Buscar cafés, tostadores y equipo',
    placeholder: 'Yirgacheffe, Kalita, un tostador que te guste…',
    suggestions: 'Sugerencias de búsqueda',
    noMatches: 'Todavía no hay coincidencias; probá con menos letras.',
    matchOne: '1 coincidencia. Usá las flechas para recorrerlas.',
    matchMany: '{count} coincidencias. Usá las flechas para recorrerlas.',
    hiccup: 'La búsqueda anda con problemas. Podés seguir viendo lo de abajo.',
  },

  discover: {
    title: 'Descubrir café',
    metaDescription:
      'Explorá cafés de especialidad por origen, proceso y nivel de tueste, con las notas de cata y los tostadores detrás de cada uno.',
    ogTitle: 'Descubrir café · BrewCult',
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
    clipboardEmpty: 'No hay ninguna imagen en el portapapeles: copiá una primero, o elegí un archivo.',
    clipboardBlocked:
      'El navegador no nos dejó leer el portapapeles. Presioná Ctrl+V (o ⌘V) en su lugar.',
    thatCoffee: 'Ese café',
    notABag: 'Eso no parecía una bolsa de café.',
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

  catalog: {
    breadcrumbLabel: 'Ruta de navegación',
    results: 'Resultados',
    keepLooking: 'Seguí buscando',

    crumbs: {
      home: 'Inicio',
      coffee: 'Café',
      roasters: 'Tostadores',
      equipment: 'Equipo',
      recipes: 'Recetas',
    },

    elsewhere: {
      heading: 'En otras partes del catálogo',
      coffees: 'Cafés',
      roasters: 'Tostadores',
      equipment: 'Cafeteras y molinos',
      recipes: 'Recetas de preparación',
    },

    filters: {
      apply: 'Aplicar filtros',
      clear: 'Limpiar',
      coffeeLegend: 'Filtrar cafés',
      equipmentLegend: 'Filtrar equipo',
      recipeLegend: 'Filtrar recetas',
      origin: 'Origen',
      anyOrigin: 'De cualquier lado',
      process: 'Proceso',
      anyProcess: 'Cualquier proceso',
      roastLevel: 'Nivel de tueste',
      anyRoast: 'Cualquier tueste',
      brewedAs: 'Preparado como',
      anyUse: 'Cualquiera',
      category: 'Categoría',
      anyCategory: 'Todo',
      brand: 'Marca',
      anyBrand: 'Cualquier marca',
      method: 'Método',
      anyMethod: 'Cualquier método',
    },

    pagination: {
      label: 'Paginación',
      back: '← Volver al inicio',
      next: 'Página siguiente →',
      countOne: '1 resultado en esta página',
      countOther: '{count} resultados en esta página',
    },

    cards: {
      tastesLike: 'Sabe a: {notes}',
      discontinued: 'Ya no se tuesta: lo mantenemos por las recetas que tiene asociadas.',
      coffeeCountOne: '1 café en el catálogo',
      coffeeCountOther: '{count} cafés en el catálogo',
      adjustment: 'ajuste {scale}',
      onThe: 'En ',
      byRoaster: 'Publicada por el tostador',
      byAuthor: 'Por {author}',
      communityMember: 'alguien de la comunidad',
    },

    coffeeHub: {
      /**
       * En español los calificativos van DESPUÉS del sustantivo y en el otro
       * orden: «café lavado claro», no «claro lavado café». De ahí
       * `qualifierOrder`.
       */
      noun: 'café',
      qualifiedNoun: 'café {qualifiers}',
      qualifierOrder: 'process roast',
      fromOrigin: ' de {origin}',
      forUse: ' para {use}',
      metaDescription:
        'Explorá {noun}: origen, finca, proceso, variedad, altura y nivel de tueste de cada bolsa, con el tostador detrás y recetas de preparación de la comunidad.',
      lede: 'Cada café aquí dice dónde creció, cómo se procesó y qué tan lejos se tostó, en palabras normales, porque nada de eso es obvio y fingir lo contrario no le sirve a nadie.',
      loadError:
        'No pudimos cargar el catálogo en este momento: eso es culpa nuestra, no tuya. Recargá en un momento.',
      emptyBody:
        'Nada coincide con esos filtros todavía. El catálogo sigue creciendo, así que un resultado vacío casi siempre significa «aún no está en el índice» y no «no existe».',
      emptyClear: 'Limpiá los filtros',
      emptyOr: ' o ',
      emptyRoaster: 'empezá por un tostador',
    },

    roasterHub: {
      title: 'Tostadores de café',
      metaDescription:
        'Tostadores de café de especialidad y los cafés que tuestan: orígenes, procesos, notas de cata y las recetas de la comunidad para prepararlos.',
      lede: 'La gente que decide a qué sabe un café verde para cuando te llega. Cada perfil lista sus cafés con toda su procedencia, y las preparaciones que la comunidad ha anotado con ellos.',
      sectionHeading: 'Tostadores',
      loadError:
        'No pudimos cargar la lista de tostadores en este momento: eso es culpa nuestra, no tuya. Probá de nuevo en un momento.',
      emptyBody:
        'Todavía no hay tostadores en la lista. Seguimos llenando los estantes, y preferimos mostrarte una página vacía con honestidad antes que rellenarla.',
      emptyLink: 'Mejor explorá los cafés',
    },

    roasterDetail: {
      eyebrow: 'Tostador',
      loadErrorTitle: 'No pudimos cargar este tostador',
      loadErrorBody: 'Eso es culpa nuestra, no tuya. Probá de nuevo en un rato, o ',
      loadErrorLink: 'explorá los otros tostadores',
      ledeOne:
        '{name} tiene un café en el catálogo de BrewCult{where}. Trae su origen, su proceso y su nivel de tueste, más todo lo que la comunidad ha ido descubriendo sobre cómo prepararlo.',
      ledeOther:
        '{name} tiene {count} cafés en el catálogo de BrewCult{where}. Cada uno trae su origen, su proceso y su nivel de tueste, más todo lo que la comunidad ha ido descubriendo sobre cómo prepararlos.',
      ledeWhere: ', tostado en {location}',
      profile: 'Perfil',
      location: 'Ubicación',
      coffeesListed: 'Cafés en la lista',
      originsBought: 'Orígenes que compran',
      verified: 'Verificado',
      verifiedYes: 'Reclamado y verificado por el tostador',
      verifiedNo: 'Todavía sin reclamar: este perfil lo mantiene la redacción',
      website: 'Sitio web',
      theirCoffees: 'Sus cafés',
      noCoffees:
        'Todavía no hay cafés de {name} en la lista. Si tenés una bolsa de ellos, el catálogo es justo donde va.',
      retiredHeading: 'Ya no se tuestan',
      retiredBody:
        'Los lotes rotan con la cosecha. Estas páginas siguen aquí porque las recetas y las notas que tienen asociadas siguen sirviendo, y porque un lote parecido suele volver.',
      originsHeading: 'Orígenes con los que trabajan',
      allCountryCoffees: 'Todos los cafés de {country}',
      filterToRoaster: 'Filtrar el catálogo a {name}',
      allRoasters: 'Todos los tostadores',
    },

    equipmentHub: {
      noun: 'equipo de café',
      fromBrand: ' de {brand}',
      metaDescription:
        'Especificaciones, recetas de preparación y datos de molienda de la comunidad para {noun}. Cada página de molino trae conversiones de ajuste hechas por la comunidad, con su confianza y su tamaño de muestra a la vista.',
      title: 'Cafeteras, molinos y equipo',
      brandTitle: 'Equipo de {brand}',
      lede: 'Las páginas de equipo existen para responder una sola pregunta con honestidad: ¿qué cambia esto de verdad en la taza? Sin rankings de marcas, sin «necesitás mejorar tu equipo»: especificaciones, recetas y lo que la comunidad ha medido.',
      loadError:
        'No pudimos cargar la lista de equipo en este momento: eso es culpa nuestra, no tuya. Probá de nuevo en un rato.',
      emptyBody:
        'Nada coincide con esos filtros todavía. Si tu molino o tu cafetera no aparece, eso es un hueco en nuestro catálogo, no una señal de que sea el equipo equivocado.',
      emptyClear: 'Limpiá los filtros',
      byCategory: 'Explorá por categoría',
      byCategoryNote:
        'Las páginas de molinos traen conversiones de ajuste de molienda hechas por la comunidad: lo más cercano que existe a una respuesta directa a «¿qué número uso en el mío?», con la incertidumbre dicha en voz alta en vez de escondida.',
    },

    equipmentDetail: {
      loadErrorTitle: 'No pudimos cargar este equipo',
      loadErrorBody: 'Eso es culpa nuestra, no tuya. Probá de nuevo en un momento, o ',
      loadErrorLink: 'explorá el resto del equipo',
      madeBy: 'Hecho por ',
      specifications: 'Especificaciones',
      category: 'Categoría',
      brand: 'Marca',
      grindAdjustment: 'Ajuste de molienda',
      yes: 'Sí',
      no: 'No',
      noSpecs:
        'Todavía no tenemos especificaciones detalladas de este modelo. Las recetas y los datos de molienda de abajo no dependen de eso: vienen de la gente que lo usa, no de una ficha técnica.',
      recipesHeading: 'Recetas para {name}',
      recipesSubject: '{name}',
      allOfCategory: '{category} en el catálogo',
      moreFromBrand: 'Más de {brand}',
      coffeeToBrew: 'Café para preparar en él',
      allRecipes: 'Todas las recetas de preparación',
    },

    recipeHub: {
      title: 'Recetas de preparación',
      metaTitleMethod: 'Recetas de preparación en {method}',
      metaDescription:
        'Recetas de la comunidad y de tostadores con dosis, agua, proporción, temperatura, molienda y el esquema completo de vertidos: cada una es un punto de partida para calibrar, no una regla.',
      headingMethod: 'Recetas de {method}',
      headingForCoffee: 'para {coffee}',
      headingOnBrewer: 'en {brewer}',
      sectionHeading: 'Recetas',
      lede: 'Cada receta aquí trae su dosis, su agua, su proporción, su temperatura y su molienda, y además una categoría gruesa de molienda, porque el número del dial del molino de otra persona no se traslada al tuyo. Tomá una como punto de partida y cambiá una sola cosa a la vez.',
      unknownCoffee: 'No encontramos un café con el slug «{slug}», así que ese filtro se ignoró.',
      unknownBrewer: 'No encontramos equipo con el slug «{slug}», así que ese filtro se ignoró.',
      notReadyBody:
        'Las recetas todavía no están encendidas: la API de preparación se está construyendo justo ahora. Cuando llegue, esta página se va a llenar de recetas de la comunidad y de tostadores, cada una ligada al café y al equipo con el que se escribió.',
      notReadyMeanwhile: 'Mientras tanto, ',
      notReadyCatalogue: 'el catálogo de cafés',
      notReadyAnd: ' y ',
      notReadyEquipment: 'las páginas de equipo',
      notReadyTail:
        ' ya están en vivo, incluidas las conversiones de molienda de la comunidad para molinos.',
      loadError:
        'No pudimos cargar las recetas en este momento: eso es culpa nuestra, no tuya. Probá de nuevo en un momento.',
      emptyBody:
        'Todavía no hay recetas que coincidan con eso. Vacío es una respuesta real aquí: preferimos no mostrarte nada antes que rellenar la página con recetas de otro café.',
      emptyClear: 'Limpiá los filtros',
      emptyStart: 'Mejor empezá por un café',
      howToReadHeading: 'Cómo leer una receta aquí',
      howToReadRatio: 'La proporción',
      howToReadRatioBody:
        ' es la parte que viaja: 1:16 significa un gramo de café por dieciséis de agua, sin importar cuánto prepares. ',
      howToReadGrind: 'La categoría de molienda',
      howToReadGrindBody:
        ' (fina, medio-fina, media…) es la única información de molienda que sobrevive a un cambio de molino; un número de dial siempre se muestra pegado al molino del que salió.',
      howToReadNote:
        'A nadie le sabe igual el primer intento de la receta de otra persona. Eso es el agua, los granos y las muelas, no vos.',
    },

    recipeDetail: {
      notReadyTitle: 'Las recetas todavía no están encendidas',
      notReadyBody:
        'Las páginas de recetas se están construyendo justo ahora. Si alguien te compartió este enlace, va a empezar a funcionar en breve: el enlace en sí está bien.',
      loadErrorTitle: 'No pudimos cargar esta receta',
      loadErrorBody: 'Eso es culpa nuestra, no tuya. Probá de nuevo en un momento.',
      allRecipes: 'Todas las recetas',
      browseCoffees: 'Explorar cafés',
      browseEquipment: 'Explorar equipo',
      eyebrow: 'Receta de {method}',
      byRoaster: 'Publicada por el tostador',
      byAuthor: 'Por {author}',
      byCommunity: 'Por alguien de la comunidad',
      forCoffee: ' · para ',
      onBrewer: ' · en ',
      startingPoint: 'Esto es un punto de partida, no una regla.',
      numbersHeading: 'Los números',
      ratioNote:
        'La proporción es la parte que vale la pena conservar cuando subís o bajás la cantidad: los números absolutos importan menos que la relación entre ellos.',
      grindHeading: 'Molienda',
      grindConversionsLink: 'Ver conversiones de molienda para {name} →',
      poursHeading: 'Esquema de vertidos',
      poursNote:
        'Los tiempos cuentan desde que el agua toca el café por primera vez. Los pesos son acumulados: el número en la balanza, no la cantidad de ese vertido.',
      puckPrepHeading: 'Preparación del pastel',
      tastesOffHeading: 'Si no te sabe bien',
      tastesOffBody:
        'Cambiá una sola cosa a la vez: esa es toda la técnica. Si sale ácido, aguado o flojo, lo más probable es que esté subextraído: molé más fino, o usá agua más caliente, o dale más tiempo. Si sale amargo, áspero o seca la boca, seguramente está sobreextraído: molé más grueso, o bajale un poco a la temperatura, o cortá la preparación antes.',
      tastesOffNote:
        'Que la primera taza no dé en el clavo es el resultado normal, no un veredicto sobre tu equipo ni sobre vos.',
      aboutCoffee: 'Sobre {name}',
      moreBrewerRecipes: 'Más recetas de {name}',
      moreMethodRecipes: 'Más recetas de {method}',
    },

    recipeJsonLd: {
      coffeeGrams: '{grams} g de café',
      waterGrams: '{grams} g de agua',
      waterAt: 'Agua a {temp} °C',
      filterType: 'Filtro {type}',
      espressoOut: '{grams} g de espresso de salida',
      brewTemperature: 'Temperatura de preparación {temp} °C',
      groundAs: 'Molido {category}',
      bloom: 'Floración',
      pourN: 'Vertido {n}',
      pourStep: 'A los {at}, verté hasta {to} g en total.',
      pullShot: 'Sacá el shot',
      pullShotStep: 'Dosis de {dose} g, apuntá a {yield} g de salida.',
      pullShotStepTimed: 'Dosis de {dose} g, apuntá a {yield} g de salida en unos {seconds} segundos.',
      brew: 'Preparar',
      brewStep: 'Prepará {dose} g de café con {water} g de agua.',
      brewStepTimed:
        'Prepará {dose} g de café con {water} g de agua, apuntando a un tiempo total de unos {time}.',
      yieldEspresso: '{grams} g de espresso',
      yieldFilter: '{grams} g de café preparado',
    },

    freshness: {
      heading: 'Fecha de tueste y frescura',
      batchesIntro: 'Lotes de tueste que conocemos de este café:',
      today: 'Hoy',
      dayOne: '1 día',
      dayOther: '{count} días',
      ageNote:
        'Los días se cuentan desde hoy, así que se mueven conforme la página envejece: de eso se trata.',
      future: 'Tostado en el futuro, aparentemente. Eso es un problema de datos, no de café.',
      veryFreshEspresso:
        'Muy fresco y todavía desgasificando. Un espresso de esto seguramente se va a correr y a saber filoso: dale una semana.',
      veryFreshFilter:
        'Muy fresco y todavía desgasificando. Esperá una floración grande y un drenado más lento; por lo general se pone más fácil como al quinto día.',
      restingEspresso:
        'Acercándose a su ventana para espresso: los últimos días de reposo suelen asentar el shot.',
      inWindow: 'En la ventana que la mayoría encuentra mejor para filtrado.',
      pastPeak:
        'Ya pasó su punto más brillante, pero está lejos de estar malo: esperá algo más dulce, más redondo, menos aromático. Probá una molienda un poco más fina o agua más caliente.',
      wellPast:
        'Bastante pasado de su punto. Todavía se toma, y honestamente sigue siendo mejor que la mayoría del café: solo no juzgués el lote por esta bolsa.',
    },

    grindConversion: {
      heading: 'Ajustes de molienda en otros molinos',
      intro:
        'Un número en el dial de un molino solo significa algo en ese molino: hasta dos unidades del mismo modelo son distintas. Así que en vez de fingir que «18» viaja, BrewCult anota en qué terminó cayendo la gente después de cambiarse, y te muestra la dispersión.',
      caption:
        'Ajustes anotados por la comunidad, equivalentes a un ajuste en {name}. Cada fila es un punto de partida aproximado.',
      colOn: 'En {name}',
      colGrinder: 'Molino',
      colApprox: 'Punto de partida aproximado',
      colTrust: 'Cuánto confiar',
      thenAdjust: 'después ajustá al gusto',
      bandLow: 'Confianza baja',
      bandMedium: 'Confianza media',
      bandHigh: 'Confianza alta',
      bandWithPercent: '{band} ({percent})',
      unknownPercent: 'desconocida',
      samplesOne: '1 dato de la comunidad',
      samplesOther: '{count} datos de la comunidad',
      sourceUnknown: 'Fuente no registrada.',
      unavailable:
        'No pudimos cargar las conversiones en este momento: eso es culpa nuestra, no tuya.',
      noneYet: 'Nadie ha registrado todavía una conversión confirmada desde {name}.',
      zeroPoints: '0 datos de la comunidad',
      zeroPointsMid: ', así que la confianza es ',
      zeroPointsNone: 'ninguna por ahora',
      zeroPointsTail:
        '. Cuando bifurqués una receta a otro molino y anotés una preparación que te gustó, ese par queda registrado aquí: de ahí sale cada número de esta página.',
      useCategory:
        'Mientras tanto, usá la categoría gruesa de la receta (fina, medio-fina, media y así). Es la única parte de un ajuste de molienda que sobrevive a un cambio de molino.',
      whyApproximate: 'Por qué son aproximados:',
    },

    recipesSection: {
      startingPoints:
        'Las recetas de la comunidad son puntos de partida, no veredictos. Prepará una tal como está escrita y después cambiá una sola cosa.',
      browseAll: 'Ver todas las recetas para {subject} →',
      loadError:
        'No pudimos cargar las recetas en este momento: eso es culpa nuestra, no tuya. Todo lo demás en esta página sigue siendo correcto.',
      notReady:
        'Las recetas todavía no están encendidas. Ya vienen, y cuando lleguen vas a encontrar aquí mismo las preparaciones de la comunidad para {subject}.',
      empty:
        'Todavía no hay recetas para {subject}, lo que significa que quien escriba la primera marca el tono. Si ya lo preparaste, hasta un punto de partida rústico le sirve a la siguiente persona más de lo que creerías.',
    },

    recipeBody: {
      noNumbers:
        'Esta receta todavía no anotó sus números. El método y la molienda de abajo siguen sirviendo: el resto queda a tu criterio.',
      doseIn: 'Dosis de entrada',
      yieldOut: 'Salida',
      ratio: 'Proporción',
      ratioEspressoNote: 'dosis a salida',
      ratioFilterNote: 'café a agua',
      shotTime: 'Tiempo del shot',
      temperature: 'Temperatura',
      preInfusion: 'Preinfusión',
      basket: 'Canasta',
      coffee: 'Café',
      water: 'Agua',
      totalTime: 'Tiempo total',
      grind: 'Molienda',
      notRecorded: 'Sin registrar',
      dialSetting: 'Ajuste del dial',
      onGrinder: 'en {name}',
      onAuthorsGrinder: 'en el molino de quien la escribió',
      dialAppliesTo: 'Ese número del dial solo aplica a ',
      authorsGrinder: 'el molino de quien la escribió',
      dialAdviceBefore: '. En el tuyo, arrancá desde la categoría ',
      dialAdviceAfter:
        ' y ajustá al gusto: la molienda es el ajuste que más vale la pena cambiar primero.',
      noDial:
        'No se registró ningún número de dial, y está bien: la categoría es la parte que se traslada entre molinos de todos modos.',
      upTo: 'hasta {grams} g',
      bloomNote: 'Floración: mojá la cama de café parejo y esperá.',
      puckPrepLabel: 'Preparación del pastel',
      forkedFrom: 'Bifurcada de ',
      forkedBy: ' por {author}',
      changeOne: ' — 1 cambio: {fields}.',
      changeOther: ' — {count} cambios: {fields}.',
      grindSummary: 'molienda {category}',
    },
  },

  footer: {
    tagline: 'BrewCult: todo gran preparador empezó con café amargo.',
    privacy: 'Privacidad',
    terms: 'Términos',
    discover: 'Descubrir',
  },

  notFoundPage: {
    metaTitle: 'No encontrado',
    title: 'Esa página no está aquí',
    lede: 'Enlace equivocado, o algo que movimos. En cualquier caso, no es culpa tuya.',
    discover: 'Descubrir café',
    home: 'Volver al inicio',
  },

  privacyPage: {
    title: 'Privacidad',
    metaDescription:
      'Qué recoge BrewCult, para qué, cuánto lo guardamos y cómo recuperarlo.',
    lede: 'La versión corta: recogemos lo que hace que tu café sea mejor, te decimos para qué es, y podés llevártelo todo o borrarlo cuando querás.',
    whatHeading: 'Qué recogemos',
    whatBody:
      'Los datos de tu cuenta (correo, usuario, nombre visible), las preparaciones y recetas que anotás, el equipo que nos contás, lo que publicás y, si más adelante comprás algo, los registros de pedido que la ley tributaria nos obliga a guardar. La analítica es propia y agregada.',
    whyHeading: 'Para qué',
    whyBody:
      'Las bitácoras de preparación construyen un perfil de gusto, y ese perfil impulsa las sugerencias de café y los consejos de calibración. Ese es el producto. Los correos nos sirven para mandarte actualizaciones de pedidos y restablecimientos de contraseña. El correo de marketing es opcional; el resumen semanal se detiene con un clic.',
    howLongHeading: 'Cuánto tiempo',
    howLongBody:
      'Los datos de la cuenta viven mientras viva la cuenta. Borrar tu cuenta elimina de forma definitiva los datos personales en un plazo de 30 días. Las recetas públicas que otra gente ha bifurcado se anonimizan en vez de destruirse, para que su trabajo no se rompa; te lo decimos claro en el momento de borrar, no después.',
    controlsHeading: 'Tus controles',
    controlsBefore: 'La exportación y el borrado se hacen por tu cuenta desde ',
    controlsLink: 'tu perfil',
    controlsAfter:
      '. La personalización tiene un interruptor para apagarla; apagarla vuelve las sugerencias más sosas y no te bloquea nada. Las cuentas son para mayores de 16 años.',
    whoHeading: 'Quién más lo ve',
    whoBody:
      'Solo los procesadores que necesitamos para operar el servicio: hospedaje, correo, pagos (más adelante) y el proveedor de IA para los consejos de preparación, con cargas de datos mínimas. Cada uno está listado en nuestro inventario de procesadores, con qué guarda y por cuánto tiempo.',
    note: 'Este es el resumen en lenguaje claro. La política completa y revisada se publica antes del lanzamiento público; nada en ella va a contradecir esta página.',
  },

  termsPage: {
    title: 'Términos',
    metaDescription: 'Las reglas de BrewCult, en lenguaje claro.',
    lede: 'Las reglas, en lenguaje claro. El texto legal revisado llega antes del lanzamiento público; nada de ahí va a contradecir lo que está en esta página.',
    whoHeading: 'Quién puede entrar',
    whoBody: 'Necesitás tener 16 años o más para tener una cuenta de BrewCult.',
    behaviourHeading: 'Cómo esperamos que la gente se trate',
    behaviourBody:
      'Las preguntas de principiante son bienvenidas, siempre. Avergonzar a alguien por su equipo o por su presupuesto, y las respuestas de «solo comprate un molino mejor», no son para lo que existe este lugar. Aquí no hay votos negativos públicos, y es a propósito: la calidad sube por utilidad, por guardados y por bifurcaciones. Explicar con paciencia es lo que da estatura.',
    contentHeading: 'Tu contenido',
    contentBody:
      'Tus recetas, tus preparaciones y tus publicaciones siguen siendo tuyas. Nos das permiso para mostrarlas en la plataforma y para que otros miembros bifurquen recetas con atribución. Si borrás tu cuenta, tus datos personales se van; las recetas públicas sobre las que otros construyeron se quedan, con tu nombre quitado, para que su trabajo no se rompa.',
    ourSideHeading: 'Nuestra parte',
    ourSideBefore: 'Mantenemos el servicio funcionando, te decimos qué hacemos con tus datos (ver ',
    ourSideLink: 'Privacidad',
    ourSideAfter:
      '), y no dejamos que un pago cambie lo que la IA recomienda. Las sugerencias son sugerencias: un consejo de preparación no es una garantía sobre una taza de café.',
    endingHeading: 'Terminar las cosas',
    endingBefore: 'Podés borrar tu cuenta cuando querás desde ',
    endingLink: 'tu perfil',
    endingAfter:
      '. Podemos suspender cuentas que rompan las reglas de conducta de arriba, y vamos a decir cuál regla y por qué.',
  },

  unsubscribePage: {
    metaTitle: 'Suscripción cancelada',
    metaDescription: 'No vas a volver a recibir ese tipo de correo de BrewCult.',
    title: 'Ajustes de correo',
    noteBefore: '¿Cambiaste de opinión, o querés un control más fino? ',
    noteLink: 'Tus ajustes de correo',
    noteAfter: ' tienen un interruptor para cada tipo.',
    noTokenTitle: 'Nada que cambiar.',
    noTokenBody:
      'A ese enlace le falta su código. Abrí tus ajustes de correo para elegir qué mensajes recibís.',
    working: 'Actualizando tus ajustes…',
    doneTitle: 'Listo: cancelaste la suscripción.',
    doneBody:
      'No vas a volver a recibir ese tipo de correo de nuestra parte. Los correos de seguridad, como los códigos de inicio de sesión y los cambios de contraseña, sí siguen llegando: así es como te enterás si alguien más está usando tu cuenta.',
  },
};
