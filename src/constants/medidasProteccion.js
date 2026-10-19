// Catálogo de tipos de medida de protección (Ley 21.809, art. 16 E letra j).
//
// Vive acá y no en el controller porque el job de vencimientos también escribe
// el nombre del tipo en la bitácora del caso, y una copia del catálogo en cada
// archivo es cómo terminan divergiendo.
//
// Mismo orden que el ENUM de MEDIDA_PROTECCION.tipo, de la medida menos gravosa
// a la más gravosa, que es el orden en que la ley pide considerarlas: la
// suspensión va última porque solo procede "cuando no sea posible resguardar a
// la persona afectada mediante otra medida".
//
// Las dos primeras son las únicas que el art. 16 E letra j nombra por su nombre
// ("la separación de aula entre denunciante y denunciado, o la suspensión"); el
// resto sale de los protocolos de medidas de resguardo inmediato e
// institucional del RICE adaptado a la Ley 21.809. 'separacion_funciones' y
// 'teletrabajo' aplican solo cuando el denunciado es un adulto de la comunidad
// educativa.
const TIPOS_MEDIDA = [
  'separacion_aula', 'prohibicion_contacto', 'cambio_curso', 'cambio_jornada',
  'acompanamiento', 'derivacion_red', 'resguardo_confidencialidad',
  'reorganizacion_espacios', 'separacion_funciones', 'teletrabajo',
  'suspension', 'otra',
];

// El backend no tiene el ETIQUETAS del front, pero las descripciones que arma
// se guardan en la bitácora del caso y se leen tal cual en pantalla y en el
// expediente: escribir ahí 'separacion_aula' es mostrarle al usuario un código
// crudo de la base.
const ETIQUETA_TIPO = {
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
  otra: 'Otra medida',
};

const etiquetaTipo = (tipo) => ETIQUETA_TIPO[tipo] ?? String(tipo ?? '').replace(/_/g, ' ');

// Sobre quién RECAE cada medida. La medida es siempre "para la persona
// afectada" (art. 16 E letra j), pero muchas se aplican al señalado: la ley
// pone de ejemplo "la suspensión, cuando se trate de un estudiante", y a quien
// se suspende es al denunciado, no a la víctima. Anotarla en la tarjeta del
// afectado dejaba constando que se suspendió a la víctima.
//
//  - Solo al afectado: las de apoyo y resguardo de su persona.
//  - Solo al señalado: la suspensión (si es estudiante) y, si es un adulto del
//    establecimiento, la separación de funciones y el teletrabajo.
//  - A cualquiera de los dos: las que separan a las partes. Lo esperable es que
//    recaigan sobre el señalado, pero puede corresponder moverse al afectado
//    (lo pide él o su familia), y eso lo decide el establecimiento.
const SOLO_AFECTADO = ['acompanamiento', 'derivacion_red', 'resguardo_confidencialidad'];
const SOLO_SENALADO_ESTUDIANTE = ['suspension'];
const SOLO_SENALADO_ADULTO = ['separacion_funciones', 'teletrabajo'];

/** Las medidas de protección que pueden recaer sobre esta persona del caso. */
const tiposProteccionPara = ({ rol, tipo_persona }) =>
  TIPOS_MEDIDA.filter((t) => {
    if (SOLO_AFECTADO.includes(t)) return rol === 'afectado';
    if (SOLO_SENALADO_ESTUDIANTE.includes(t)) return rol === 'senalado' && tipo_persona === 'estudiante';
    if (SOLO_SENALADO_ADULTO.includes(t)) return rol === 'senalado' && tipo_persona === 'funcionario';
    return rol === 'afectado' || rol === 'senalado';
  });

/** Mensaje si la medida no puede recaer sobre esta persona; null si puede. */
const errorDeDestinatario = (tipo, involucrado) => {
  if (!involucrado || tiposProteccionPara(involucrado).includes(tipo)) return null;
  const nombre = etiquetaTipo(tipo);
  if (SOLO_AFECTADO.includes(tipo))
    return `${nombre} es una medida de apoyo para la persona afectada, no para ${involucrado.nombre}.`;
  if (SOLO_SENALADO_ESTUDIANTE.includes(tipo))
    return 'La suspensión como medida de protección recae sobre el estudiante señalado, no sobre la ' +
      'persona afectada (art. 16 E letra j).';
  if (SOLO_SENALADO_ADULTO.includes(tipo))
    return `${nombre} se aplica a un funcionario señalado.`;
  return `Las medidas de protección se aplican a las partes del caso (afectado o señalado), no a ${involucrado.nombre}.`;
};

module.exports = { TIPOS_MEDIDA, ETIQUETA_TIPO, etiquetaTipo, tiposProteccionPara, errorDeDestinatario };
