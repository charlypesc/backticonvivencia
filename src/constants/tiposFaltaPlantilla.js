// Catálogo base de tipos de falta con que parte un establecimiento nuevo.
//
// TIPO_FALTA es por establecimiento (id_establecimiento NOT NULL): cada colegio
// tiene su propio catálogo y lo edita según su reglamento interno. Sin una
// siembra inicial, un colegio recién dado de alta no puede registrar nada,
// porque el formulario de registros exige un id_tipo_falta y la lista está
// vacía.
//
// Esta plantilla vive en el código y no en una tabla porque es un punto de
// partida, no una fuente de verdad: una vez copiada, el colegio la modifica y
// nunca más se vuelve a leer desde acá. Cambiar esta lista solo afecta a los
// establecimientos que se den de alta después.
//
// La clasificación leve / grave / gravísima y los ejemplos provienen de
// reglamentos internos de convivencia escolar publicados en el CDN del MINEDUC
// y del Ord. 476 de la Superintendencia de Educación Escolar.
const TIPOS_FALTA_PLANTILLA = [
  // ── LEVES ────────────────────────────────────────────────────────────────
  // Actitud que dificulta el desarrollo normal de una actividad escolar, sin
  // intención de dañar a otro.
  {
    nombre: 'Atraso reiterado',
    gravedad: 'leve',
    descripcion: 'Llegar atrasado al inicio de la jornada, después de recreos o en cambios de hora.',
    medida_sugerida: 'Registro en el libro de clases y comunicación al apoderado',
  },
  {
    nombre: 'Interrupción de la clase',
    gravedad: 'leve',
    descripcion: 'No permitir u obstaculizar el desarrollo normal de la clase: gritar, deambular o cambiarse de puesto sin autorización.',
    medida_sugerida: 'Diálogo personal formativo y amonestación verbal',
  },
  {
    nombre: 'No traer materiales o tareas',
    gravedad: 'leve',
    descripcion: 'Presentarse sin los materiales solicitados o sin las tareas asignadas, sin justificación escrita.',
    medida_sugerida: 'Registro en el libro de clases y comunicación al apoderado',
  },
  {
    nombre: 'Uso no autorizado del celular',
    gravedad: 'leve',
    descripcion: 'Uso de celular u otros dispositivos electrónicos sin un propósito pedagógico solicitado por el docente.',
    medida_sugerida: 'Amonestación verbal y retiro del dispositivo hasta el término de la jornada',
  },
  {
    nombre: 'Presentación personal',
    gravedad: 'leve',
    descripcion: 'Uso incompleto del uniforme sin justificación o presentación personal con evidente falta de higiene.',
    medida_sugerida: 'Amonestación verbal y comunicación al apoderado',
  },
  {
    nombre: 'No portar agenda o comunicaciones',
    gravedad: 'leve',
    descripcion: 'No traer la agenda escolar o devolver comunicaciones sin la firma del apoderado.',
    medida_sugerida: 'Registro en el libro de clases',
  },

  // ── GRAVES ───────────────────────────────────────────────────────────────
  // Hecho intencionado con daño físico o moral sobre sí mismo, sobre otra
  // persona o sobre bienes ajenos.
  // Las dos formas de cimarra van separadas porque se detectan por vías
  // distintas: la interna la ve el profesor de aula (el estudiante está en el
  // colegio pero no en la sala), y la otra aparece al cruzar la asistencia con
  // el apoderado, que creía que había asistido. Se nombran por lo que pasó y no
  // como "interna/externa" para que quien registra no tenga que acordarse cuál
  // era cuál.
  {
    nombre: 'No entra a la sala de clases',
    gravedad: 'grave',
    descripcion: 'Estando dentro del establecimiento, no ingresa a la sala y se ausenta de una o más horas de clase (cimarra interna).',
    medida_sugerida: 'Citación al apoderado y trabajo formativo dentro del colegio',
  },
  {
    nombre: 'Cimarra',
    gravedad: 'grave',
    descripcion: 'No llega al establecimiento en la jornada escolar sin justificación del apoderado, que cree que el estudiante sí asistió.',
    medida_sugerida: 'Citación al apoderado, verificación de asistencia y plan de acompañamiento',
  },
  {
    nombre: 'Incumplimiento de medida o acuerdo',
    gravedad: 'grave',
    descripcion: 'No cumplir una sanción, medida formativa o acuerdo reparatorio sin justificación.',
    medida_sugerida: 'Citación al apoderado y nueva medida formativa',
  },
  {
    nombre: 'Manipulación del libro de clases',
    gravedad: 'grave',
    descripcion: 'Revisar, rayar o sacar hojas del libro de clases o de la agenda escolar sin autorización.',
    medida_sugerida: 'Citación al apoderado y reparación del daño',
  },
  {
    nombre: 'Negarse a rendir evaluación',
    gravedad: 'grave',
    descripcion: 'Rehusarse a responder una prueba o evaluación, en forma individual o colectiva.',
    medida_sugerida: 'Citación al apoderado y recalendarización con la nota mínima si corresponde',
  },
  {
    nombre: 'Consumo de tabaco o vapeo',
    gravedad: 'grave',
    descripcion: 'Fumar o vapear dentro del establecimiento o en cualquier actividad escolar, dentro o fuera de él.',
    medida_sugerida: 'Citación al apoderado y derivación psicosocial',
  },
  {
    nombre: 'Falta de respeto',
    gravedad: 'grave',
    descripcion: 'Trato irrespetuoso, gestos obscenos o desacato hacia un compañero o funcionario del establecimiento.',
    medida_sugerida: 'Citación al apoderado, servicio comunitario y medida reparatoria',
  },
  {
    nombre: 'Reiteración de faltas leves',
    gravedad: 'grave',
    descripcion: 'Acumulación de faltas leves registradas (habitualmente cinco anotaciones) sin cambio de conducta.',
    medida_sugerida: 'Carta de compromiso y citación al apoderado',
  },

  // ── GRAVÍSIMAS ───────────────────────────────────────────────────────────
  // Conducta consciente y deliberada que daña la integridad física o psíquica
  // de un miembro de la comunidad educativa, o que constituye delito.
  {
    nombre: 'Agresión física',
    gravedad: 'gravísima',
    descripcion: 'Golpes o agresión corporal a cualquier miembro de la comunidad educativa, dentro o fuera del establecimiento.',
    medida_sugerida: 'Suspensión de clases y citación al apoderado',
  },
  {
    nombre: 'Agresión verbal o amenazas',
    gravedad: 'gravísima',
    descripcion: 'Insultos, amenazas graves y explícitas o acciones que deshonren a un miembro de la comunidad educativa, por cualquier medio.',
    medida_sugerida: 'Suspensión de clases, citación al apoderado y medida reparatoria',
  },
  {
    nombre: 'Acoso escolar (bullying)',
    gravedad: 'gravísima',
    descripcion: 'Hostigamiento sistemático hacia un compañero, incluido el ciberbullying por redes sociales, chats o mensajería.',
    medida_sugerida: 'Activación de protocolo, derivación psicosocial y suspensión si corresponde',
  },
  {
    nombre: 'Acoso o abuso sexual',
    gravedad: 'gravísima',
    descripcion: 'Acoso o abuso sexual hacia cualquier miembro de la comunidad educativa.',
    medida_sugerida: 'Activación de protocolo y denuncia a la autoridad competente dentro de 24 horas',
  },
  {
    nombre: 'Discriminación arbitraria',
    gravedad: 'gravísima',
    descripcion: 'Trato discriminatorio hacia una persona por su origen, género, orientación, religión, discapacidad u otra condición.',
    medida_sugerida: 'Activación de protocolo, medida reparatoria y derivación psicosocial',
  },
  {
    nombre: 'Robo o hurto',
    gravedad: 'gravísima',
    descripcion: 'Sustraer dinero o bienes de cualquier miembro de la comunidad educativa o del establecimiento.',
    medida_sugerida: 'Restitución del bien, citación al apoderado y denuncia si constituye delito',
  },
  {
    nombre: 'Adulteración de documentos',
    gravedad: 'gravísima',
    descripcion: 'Adulterar notas, firmas, comunicaciones o cualquier documento oficial del establecimiento.',
    medida_sugerida: 'Suspensión de clases y citación al apoderado',
  },
  {
    nombre: 'Copia o plagio en evaluación',
    gravedad: 'gravísima',
    descripcion: 'Copiar, plagiar o sustraer evaluaciones en cualquiera de sus formas.',
    medida_sugerida: 'Aplicación del reglamento de evaluación y citación al apoderado',
  },
  {
    nombre: 'Fuga del establecimiento',
    gravedad: 'gravísima',
    descripcion: 'Retirarse o salir del establecimiento sin la autorización correspondiente.',
    medida_sugerida: 'Citación inmediata al apoderado y suspensión de clases',
  },
  {
    nombre: 'Daño a la infraestructura',
    gravedad: 'gravísima',
    descripcion: 'Daño grave e intencionado a dependencias, mobiliario o bienes del establecimiento o de terceros, incluidos rayados ofensivos.',
    medida_sugerida: 'Reposición o reparación del daño y suspensión de clases',
  },
  {
    nombre: 'Grabar o difundir sin consentimiento',
    gravedad: 'gravísima',
    descripcion: 'Fotografiar, grabar o filmar a personas de la comunidad educativa sin su consentimiento, o difundir ese material.',
    medida_sugerida: 'Suspensión de clases, citación al apoderado y eliminación del material',
  },
  {
    nombre: 'Alcohol o drogas',
    gravedad: 'gravísima',
    descripcion: 'Ingresar, consumir o participar bajo los efectos de alcohol o drogas en actividades del establecimiento.',
    medida_sugerida: 'Activación de protocolo, derivación a red de apoyo y suspensión de clases',
  },
  {
    nombre: 'Porte de armas',
    gravedad: 'gravísima',
    descripcion: 'Ingresar o fabricar armas o municiones al interior del establecimiento.',
    medida_sugerida: 'Denuncia a la autoridad competente y procedimiento de expulsión',
  },
  {
    nombre: 'Riesgo grave para la seguridad',
    gravedad: 'gravísima',
    descripcion: 'Provocar incendios o explosiones, dar falsas alarmas de emergencia o cualquier conducta que ponga en riesgo evidente la integridad de otros.',
    medida_sugerida: 'Suspensión de clases, citación al apoderado y denuncia si corresponde',
  },
];

module.exports = { TIPOS_FALTA_PLANTILLA };
