// Traducción de los códigos de la base al texto que ve la persona.
//
// Copia del diccionario de front-ticonvivencia/src/app/shared/pipes/etiqueta.pipe.ts,
// que sigue siendo el que usan las pantallas. Vive también acá desde que los
// PDF se arman en el servidor: un código nuevo (tipo_evento, estado, opción de
// campo) hay que agregarlo en los DOS lados, o el PDF lo imprime humanizado.

const ETIQUETAS = {
  tipo_paso: {
    informativo: 'Informativo',
    formulario: 'Formulario',
    adjunto: 'Adjunto',
    aprobacion: 'Aprobación',
    notificacion_externa: 'Notificación externa',
    // Trámites concretos que el editor precarga enteros. Ver PLANTILLAS en
    // features/protocolo-flujo.
    seguimiento: 'Seguimiento',
    notificacion_apoderado: 'Notificación al apoderado',
    notificacion_estudiante: 'Notificación al estudiante',
    medida_proteccion: 'Medidas de protección',
    medida_disciplinaria: 'Medidas disciplinarias',
    medida_cautelar: 'Medida cautelar',
  },

  // En minúscula: se leen dentro de una frase ("2 días hábiles").
  plazo_unidad: {
    horas: 'horas',
    dias_habiles: 'días hábiles',
    dias_corridos: 'días corridos',
  },

  accion_al_vencer: {
    notificar: 'notificar',
    escalar: 'escalar',
    marcar_alerta: 'marcar alerta',
  },

  tipo_participacion: {
    ejecutor: 'Ejecutor',
    aprobador: 'Aprobador',
    notificado: 'Notificado',
  },

  // Rol de una persona en el caso. Deliberadamente no dice "víctima" ni
  // "agresor": son calificaciones que el establecimiento no puede hacer antes
  // de investigar, y el rol se asigna al activar el protocolo.
  rol_involucrado: {
    afectado: 'Afectado',
    senalado: 'Señalado',
    testigo: 'Testigo',
    denunciante: 'Denunciante',
  },

  // Qué es la persona respecto del establecimiento. Cambia el procedimiento
  // aplicable: un funcionario señalado no se tramita como un estudiante.
  tipo_persona: {
    estudiante: 'Estudiante',
    funcionario: 'Funcionario',
    externo: 'Externo',
  },

  // Cumplimiento de un paso para UNA persona del caso.
  estado_gestion: {
    pendiente: 'Pendiente',
    cumplido: 'Cumplido',
    no_aplica: 'No corresponde',
  },

  // Los dos deberes del art. 16 E letra j sobre el estudiante suspendido. Se
  // distinguen porque en una fiscalización se preguntan por separado.
  tipo_seguimiento: {
    monitoreo_pedagogico: 'Monitoreo pedagógico',
    continuidad_trayectoria: 'Continuidad de la trayectoria educativa',
    otro: 'Otro',
  },

  // Suspensión cautelar del art. 6 letra d) del DFL 2/1998.
  estado_suspension_cautelar: {
    vigente: 'Vigente',
    resuelta: 'Resuelta',
    ampliada_por_reconsideracion: 'Ampliada por reconsideración',
    vencida: 'Vencida sin resolver',
  },

  resultado_reconsideracion: {
    acogida: 'Acogida',
    rechazada: 'Rechazada',
  },

  // A quiénes alcanza un paso. Vacío = al caso, una sola vez.
  // Qué clase de medida da por cumplido un paso. Una por instituto: la cautelar
  // recae sobre el señalado y no descarga el deber de proteger a la persona
  // afectada, así que no cumple un paso de protección.
  tipo_medida_requerida: {
    proteccion: 'De protección, para la persona afectada',
    cautelar: 'Suspensión cautelar, sobre el señalado',
    disciplinaria: 'Disciplinaria (la sanción)',
    cualquiera: 'Cualquiera de las tres',
  },
  por_involucrado_rol: {
    afectado: 'Una vez por cada afectado',
    senalado: 'Una vez por cada señalado',
    testigo: 'Una vez por cada testigo',
    denunciante: 'Una vez por cada denunciante',
    todos: 'Una vez por cada parte (sin testigos)',
  },

  medio_notificacion: {
    presencial: 'Presencial',
    correo: 'Correo',
    telefono: 'Teléfono',
    plataforma: 'Plataforma',
    carta: 'Carta',
  },

  tipo_campo: {
    texto: 'Texto',
    numero: 'Número',
    fecha: 'Fecha',
    seleccion: 'Selección',
  },

  // Opciones de los campos `seleccion` de los pasos de protocolo. El valor
  // guardado es el código y así tiene que quedarse: las condiciones de las
  // transiciones lo comparan literal (`organismo == 'tribunal_familia'`), o sea
  // que renombrar el dato rompería los flujos. Lo que se traduce es solo lo que
  // se muestra. Un código nuevo que el ADMIN invente cae en humanizar().
  opcion_campo: {
    ambas: 'Ambas',
    apoderado_apoderado: 'Entre apoderados',
    apoderado_funcionario: 'Apoderado y funcionario',
    arma_de_fuego: 'Arma de fuego',
    autolesion: 'Autolesión',
    carabineros: 'Carabineros',
    cesfam: 'CESFAM',
    cibernetica: 'Cibernética',
    consumado: 'Consumado',
    consumo: 'Consumo',
    convivencia: 'Convivencia',
    disciplinaria: 'Disciplinaria',
    elemento_incendiario: 'Elemento incendiario',
    embarazo: 'Embarazo',
    expulsion_o_cancelacion: 'Expulsión o cancelación de matrícula',
    fiscalia: 'Fiscalía',
    fisica: 'Física',
    formativa: 'Formativa',
    funcionario_funcionario: 'Entre funcionarios',
    gira: 'Gira de estudio',
    grave: 'Grave',
    gravisima: 'Gravísima',
    ideacion: 'Ideación',
    intento: 'Intento',
    laboral: 'Laboral',
    leve: 'Leve',
    maternidad: 'Maternidad',
    mensajeria: 'Mensajería',
    moderado: 'Moderado',
    no: 'No',
    observacion: 'Observación',
    oln: 'OLN (Oficina Local de la Niñez)',
    opd: 'OPD (Oficina de Protección de Derechos)',
    otro: 'Otro',
    paternidad: 'Paternidad',
    pdi: 'PDI',
    pdi_cibercrimen: 'PDI — Cibercrimen',
    porte: 'Porte',
    psicologica: 'Psicológica',
    red_social: 'Red social',
    relato: 'Relato',
    robo: 'Robo',
    salida_pedagogica: 'Salida pedagógica',
    senda: 'SENDA',
    si: 'Sí',
    // Resolver que no corresponde medida es una respuesta válida, no un
    // descuido: es la que apaga el aviso de medida pendiente del paso.
    sin_medida: 'No corresponde medida',
    suspension_cautelar: 'Suspensión cautelar',
    tercero: 'Tercero',
    trafico: 'Tráfico',
    tribunal_familia: 'Tribunal de Familia',
  },

  estado_flujo: {
    borrador: 'Borrador',
    publicado: 'Publicado',
  },

  estado_caso: {
    activo: 'Activo',
    cerrado: 'Cerrado',
    anulado: 'Anulado',
  },

  estado_paso: {
    pendiente: 'Pendiente',
    en_curso: 'En curso',
    completado: 'Completado',
    omitido: 'Omitido',
    vencido: 'Vencido',
  },

  tipo_evento: {
    activacion: 'Activación',
    inicio_paso: 'Inicio de paso',
    completado_paso: 'Paso completado',
    omitido_paso: 'Paso omitido',
    paso_en_curso: 'Paso en curso',
    paso_reasignado: 'Paso reasignado',
    paso_vencido: 'Paso vencido',
    transicion: 'Transición',
    vencimiento: 'Vencimiento',
    cierre: 'Cierre',
    anulacion: 'Anulación',
    protocolo_cerrado: 'Protocolo cerrado',
    protocolo_anulado: 'Protocolo anulado',
    involucrado_agregado: 'Involucrado agregado',
    involucrado_editado: 'Involucrado editado',
    involucrado_eliminado: 'Involucrado eliminado',
    gestion_involucrado: 'Gestión con un involucrado',
    medida_proteccion_vencida: 'Medida de protección vencida',
    medida_disciplinaria_aplicada: 'Medida disciplinaria aplicada',
    medida_disciplinaria_cumplida: 'Medida disciplinaria cumplida',
    condicionalidad_por_revisar: 'Condicionalidad por revisar',
    expediente_exportado: 'Expediente exportado',
    nota: 'Nota',
  },

  // Medida de protección del art. 16 E letra j: resguarda a la persona
  // afectada mientras corre el procedimiento, y por eso no es ni sanción ni
  // cautelar. Mismo orden que TIPOS_MEDIDA en medidasProteccion.controller.js,
  // de la menos gravosa a la más gravosa.
  tipo_medida_proteccion: {
    separacion_aula: 'Separación de aula',
    prohibicion_contacto: 'Prohibición de contacto',
    cambio_curso: 'Cambio de curso',
    cambio_jornada: 'Cambio de jornada',
    acompanamiento: 'Acompañamiento psicosocial',
    derivacion_red: 'Derivación a red externa',
    resguardo_confidencialidad: 'Resguardo de confidencialidad',
    reorganizacion_espacios: 'Reorganización de espacios y supervisión',
    separacion_funciones: 'Separación de funciones',
    teletrabajo: 'Teletrabajo',
    suspension: 'Suspensión',
    otra: 'Otra',
  },

  // Medidas de protección y disciplinarias: el estado que llevan mientras
  // corren, y en qué terminaron.
  estado_medida: {
    vigente: 'Vigente',
    cumplida: 'Cumplida',
    vencida: 'Vencida',
    revocada: 'Revocada',
    pendiente: 'Pendiente',
  },

  // Sanción del RICE (Circular 482 p. 47). Distinta de la suspensión cautelar
  // (DFL 2 art. 6 d) y de la medida de protección (16 E letra j): esta se
  // aplica DESPUÉS de resolver, no mientras se investiga. Los cuatro después
  // de 'condicionalidad' son las medidas excepcionales, las únicas con plazo
  // en días hábiles.
  tipo_medida_disciplinaria: {
    amonestacion: 'Amonestación',
    citacion_apoderado: 'Citación al apoderado',
    medida_formativa: 'Medida formativa',
    medida_reparatoria: 'Medida reparatoria',
    servicio_comunitario: 'Servicio comunitario',
    derivacion: 'Derivación',
    retiro_sala: 'Retiro de la sala de clases',
    suspension_actividades: 'Suspensión de actividades o ceremonias',
    condicionalidad: 'Condicionalidad de matrícula',
    suspension: 'Suspensión',
    reduccion_jornada: 'Reducción de jornada',
    separacion_temporal: 'Separación temporal de actividades',
    asistencia_solo_evaluaciones: 'Asistencia solo a evaluaciones',
    otra: 'Otra',
  },

  // Los dos de abajo son el catálogo de permisos: cada fila de PERMISOS tiene
  // un recurso y una acción, y la pantalla de roles los agrupa por recurso.
  recurso: {
    comuna: 'Comunas',
    curso: 'Cursos',
    dashboard: 'Panel',
    documento: 'Documentos',
    establecimiento: 'Establecimientos',
    estudiante: 'Estudiantes',
    mi_establecimiento: 'Mi establecimiento',
    pais: 'Países',
    protocolo_activado: 'Protocolos activados',
    protocolo_establecimiento: 'Protocolos del establecimiento',
    protocolo_flujo: 'Flujo de protocolos del catálogo',
    protocolo_flujo_establecimiento: 'Flujo de protocolos del establecimiento',
    protocolo_generico: 'Protocolos del catálogo',
    provincia: 'Provincias',
    region: 'Regiones',
    registro: 'Registros',
    rol: 'Roles y permisos',
    sostenedor: 'Sostenedores',
    tipo_falta: 'Tipos de falta',
    usuario: 'Usuarios',
  },

  accion: {
    activar: 'Activar',
    anular: 'Anular',
    aprobar_paso: 'Aprobar paso',
    asignar_establecimiento: 'Asignar establecimiento',
    asignar_permiso: 'Asignar permisos',
    asignar_rol: 'Asignar roles',
    buscar: 'Buscar',
    cerrar: 'Cerrar',
    completar_paso: 'Completar paso',
    confirmar: 'Confirmar',
    crear: 'Crear',
    crear_propio: 'Crear propios',
    editar: 'Editar',
    editar_confidencialidad: 'Editar confidencialidad',
    eliminar: 'Eliminar',
    eliminar_masivo: 'Eliminar en masa',
    importar: 'Importar',
    omitir_paso: 'Omitir paso',
    personalizar: 'Personalizar',
    publicar: 'Publicar',
    reasignar_paso: 'Reasignar paso',
    restablecer_password: 'Restablecer contraseña',
    restaurar: 'Restaurar',
    subir: 'Subir',
    validar: 'Validar',
    ver: 'Ver',
    ver_bitacora: 'Ver bitácora',
    ver_confidencial: 'Ver confidenciales',
    ver_todos: 'Ver todos',
  },
};

/** `hay_senales_fisicas` → `Hay senales fisicas`. Último recurso cuando no hay etiqueta. */
const humanizar = (codigo) => {
  const texto = String(codigo).replace(/_/g, ' ').trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

const etiquetaDe = (codigo, dominio) => {
  if (codigo === null || codigo === undefined || codigo === '') return '';
  const valor = String(codigo);
  return (dominio ? ETIQUETAS[dominio]?.[valor] : undefined) ?? humanizar(valor);
};

module.exports = { ETIQUETAS, etiquetaDe, humanizar };
