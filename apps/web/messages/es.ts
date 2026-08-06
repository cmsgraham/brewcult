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
