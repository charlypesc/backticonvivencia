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

module.exports = { TIPOS_MEDIDA, ETIQUETA_TIPO, etiquetaTipo };
