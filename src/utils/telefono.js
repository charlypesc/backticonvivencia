// Teléfonos del directorio de colegios → número completo para marcar.
//
// El directorio de MINEDUC trae los teléfonos como se anotaron hace años: casi
// la mitad son fijos de región sin código de área ("2213296" en Temuco), y
// muchos están en formatos anteriores a dos cambios del plan de numeración:
//
//   2013  a todo número fijo se le antepuso un 2 (Santiago pasó de 7 a 8
//         dígitos, las regiones de 6 a 7).
//   2016  a todo celular se le antepuso un 9 (de 8 a 9 dígitos).
//
// Con eso y el código de área de la provincia del colegio se reconstruye el
// número completo. El código va por provincia y no por región porque dentro de
// una misma región hay varios: Osorno es 64 y Puerto Montt 65, Talca 71 y
// Curicó 75.

// id_provincia (tabla PROVINCIA) → código de área.
const CODIGO_AREA = {
  1: '57', 2: '57',                         // Tarapacá
  3: '55', 4: '55', 5: '55',                // Antofagasta
  6: '52', 7: '52', 8: '52',                // Atacama
  9: '51', 10: '53', 11: '53',              // Coquimbo: Elqui / Choapa, Limarí
  12: '32', 13: '32', 15: '32',             // Valparaíso, Isla de Pascua, Marga Marga
  16: '33', 17: '33',                       // Petorca, Quillota
  14: '34', 19: '34', 20: '34',             // Los Andes, San Felipe
  18: '35',                                 // San Antonio
  21: '72', 22: '72', 23: '72',             // O'Higgins
  27: '71', 24: '75', 25: '73', 26: '73',   // Maule: Talca, Curicó, Linares, Cauquenes
  55: '42', 56: '42', 57: '42',             // Ñuble
  28: '41', 29: '41', 30: '43',             // Biobío: Concepción, Arauco / Biobío
  31: '45', 32: '45',                       // Araucanía
  51: '63', 52: '63',                       // Los Ríos
  35: '64', 33: '65', 34: '65', 36: '65',   // Los Lagos: Osorno / Llanquihue, Chiloé, Palena
  37: '67', 38: '67', 39: '67', 40: '67',   // Aysén
  41: '61', 42: '61', 43: '61', 44: '61',   // Magallanes
  45: '2', 46: '2', 47: '2', 48: '2', 49: '2', 50: '2', // Metropolitana
  53: '58', 54: '58',                       // Arica y Parinacota
};

/** "+56 45 221 3296" / "+56 2 2558 2908" / "+56 9 6835 7686". */
const legible = (nacional) => {
  if (nacional[0] === '9' || nacional[0] === '2')
    return `+56 ${nacional[0]} ${nacional.slice(1, 5)} ${nacional.slice(5)}`;
  return `+56 ${nacional.slice(0, 2)} ${nacional.slice(2, 5)} ${nacional.slice(5)}`;
};

/**
 * Los 9 dígitos del número nacional, o null si no se puede reconstruir con
 * seguridad (ceros de relleno, largos que no calzan con ningún formato).
 * Ante la duda, null: un botón que llama a otro colegio es peor que no tenerlo.
 */
const numeroNacional = (telefono, id_provincia) => {
  let d = String(telefono ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('56')) d = d.slice(2);
  if (!d || /^0+$/.test(d) || d[0] === '0') return null;

  if (d.length === 9) return d[0] === '1' ? null : d;

  const area = CODIGO_AREA[id_provincia];
  if (!area) return null;
  const esRM = area === '2';

  if (esRM) {
    // Fijo de Santiago: 8 dígitos (2xxx/3xxx); 7 si es anterior a 2013.
    if (d.length === 8) return /^[23]/.test(d) ? `2${d}` : `9${d}`;
    if (d.length === 7) return `22${d}`;
    return null;
  }

  // Región: el fijo local tiene 7 dígitos (6 si es anterior a 2013), el
  // celular 8 si es anterior a 2016. Uno de 8 que empieza con el código de
  // área es un fijo viejo con su código, no un celular.
  if (d.length === 7) return `${area}${d}`;
  if (d.length === 6) return `${area}2${d}`;
  if (d.length === 8) return d.startsWith(area) ? `${area}2${d.slice(2)}` : `9${d}`;
  return null;
};

/** { telefono_marcable: '+56452213296', telefono_legible: '+56 45 221 3296' }, o nulls. */
const telefonoParaMarcar = (telefono, id_provincia) => {
  const n = numeroNacional(telefono, id_provincia);
  return n
    ? { telefono_marcable: `+56${n}`, telefono_legible: legible(n) }
    : { telefono_marcable: null, telefono_legible: null };
};

module.exports = { telefonoParaMarcar, numeroNacional };
