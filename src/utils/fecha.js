// Formato único de fecha para lo que ve la persona: dd/MM/yyyy.
//
// Misma regla que front-ticonvivencia/src/app/shared/utils/fecha.ts, portada
// al servidor desde que los PDF se arman acá. Con una diferencia que importa:
// el navegador corre en Chile y el servidor no (Render y Aiven están en UTC).
// Por eso un instante (un Date, o un string con 'Z') se lleva siempre a
// America/Santiago antes de sacarle el día y la hora; si no, un evento de las
// 22:00 del lunes salía impreso como del martes.
//
// Un 'yyyy-MM-dd' sin zona (las columnas DATE, que el pool trae como string)
// se toma literal: es un día, no un instante, y convertirlo lo correría.

const ZONA = 'America/Santiago';

const enChile = new Intl.DateTimeFormat('es-CL', {
  timeZone: ZONA,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const partes = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;

  if (typeof valor === 'string') {
    const limpio = valor.trim();
    const conZona = /(?:Z|[+-]\d{2}:?\d{2})$/.test(limpio);
    const m = conZona ? null : /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(limpio);
    if (m) return { dia: m[3], mes: m[2], anio: m[1], hora: m[4] ? `${m[4]}:${m[5]}` : null };
  }

  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d.getTime())) return null;
  const p = Object.fromEntries(enChile.formatToParts(d).map((x) => [x.type, x.value]));
  return { dia: p.day, mes: p.month, anio: p.year, hora: `${p.hour}:${p.minute}` };
};

/** `dd/MM/yyyy`, o `dd/MM/yyyy HH:mm` con `conHora`. '' si no es una fecha. */
const formatearFecha = (valor, conHora = false) => {
  const p = partes(valor);
  if (!p) return '';
  const fecha = `${p.dia}/${p.mes}/${p.anio}`;
  return conHora && p.hora ? `${fecha} ${p.hora}` : fecha;
};

/** Reemplaza las fechas ISO que vienen pegadas dentro de una frase. */
const formatearFechasEnTexto = (texto) =>
  String(texto ?? '').replace(
    /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g,
    (iso) => formatearFecha(iso, /[T ]\d{2}:\d{2}/.test(iso)) || iso,
  );

module.exports = { formatearFecha, formatearFechasEnTexto };
