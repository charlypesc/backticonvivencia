// Reglas del grafo de un protocolo, independientes de en qué nivel viva.
//
// Las mismas comprobaciones corren sobre la plantilla global, sobre la copia
// espejo de un establecimiento y sobre el grafo materializado en un caso. Por
// eso reciben arreglos de objetos y no consultan la BD: quien llama trae las
// filas de la tabla que le toca y las pasa con los nombres canónicos
// (`id_paso`, `id_paso_origen`, `id_paso_destino`).
//
// Sin ORM ni triggers, esto es lo único que impide que un protocolo mal armado
// llegue a producción y deje casos atascados en un nodo sin salida.

// Formato deliberadamente mínimo: `campo=valor` o `campo!=valor`. No hay >, <
// ni AND/OR. Los campos que deciden una rama son selectores y booleanos, no
// números, y un motor de reglas de verdad es una pieza que hay que mantener y
// depurar para algo que ninguna transición de un protocolo escolar necesita.
// Si algún día hacen falta rangos, se amplía acá y en validarCondicion().
const RE_CONDICION = /^\s*([a-z][a-z0-9_]{0,49})\s*(!=|=)\s*(.+?)\s*$/;

// El código de un campo viaja dentro de la condición como texto plano, así que
// se restringe a snake_case: un código con '=' o espacios haría imposible
// parsear la condición sin ambigüedad.
const RE_CODIGO_CAMPO = /^[a-z][a-z0-9_]{0,49}$/;

const TIPOS_CAMPO = ['texto', 'numero', 'fecha', 'seleccion', 'booleano'];
const TIPOS_PASO = ['informativo', 'formulario', 'adjunto', 'aprobacion', 'notificacion_externa'];
const UNIDADES_PLAZO = ['horas', 'dias_habiles', 'dias_corridos'];
const ACCIONES_VENCER = ['notificar', 'escalar', 'marcar_alerta'];
const TIPOS_PARTICIPACION = ['ejecutor', 'aprobador', 'notificado'];

// Solo estos tipos pueden decidir una rama. Condicionar sobre un texto libre
// es una condición que nunca se cumple salvo por coincidencia exacta, y sobre
// una fecha o un número haría falta comparación por rango, que no existe.
const TIPOS_DECIDIBLES = ['seleccion', 'booleano'];

const VALORES_BOOLEANO = ['si', 'no'];

/** `'gravedad=grave'` → `{ campo: 'gravedad', operador: '=', valor: 'grave' }`; null si no parsea. */
const parsearCondicion = (condicion) => {
  const m = RE_CONDICION.exec(condicion ?? '');
  if (!m) return null;
  return { campo: m[1], operador: m[2], valor: m[3] };
};

/**
 * Valida una condición contra los campos del paso de origen.
 *
 * Se comprueba al guardar la transición y no al evaluarla: un código de campo
 * mal escrito descubierto en runtime significa un caso real atascado a mitad
 * de un protocolo, y para entonces el grafo ya está congelado en ese caso.
 *
 * @param {string} condicion
 * @param {Array} campos filas de *_PASO_CAMPO del paso de origen
 * @returns {string|null} mensaje de error, o null si es válida
 */
const validarCondicion = (condicion, campos) => {
  const cond = parsearCondicion(condicion);
  if (!cond)
    return `Condición '${condicion}' mal formada. Se espera 'campo=valor' o 'campo!=valor'.`;

  const campo = campos.find((c) => c.codigo === cond.campo);
  if (!campo)
    return `La condición usa el campo '${cond.campo}', que no existe en el paso de origen.`;

  if (!TIPOS_DECIDIBLES.includes(campo.tipo_campo))
    return `El campo '${cond.campo}' es de tipo '${campo.tipo_campo}' y no puede decidir una rama. ` +
           `Solo se puede condicionar sobre campos de tipo ${TIPOS_DECIDIBLES.join(' o ')}.`;

  if (campo.tipo_campo === 'booleano' && !VALORES_BOOLEANO.includes(cond.valor))
    return `El campo '${cond.campo}' es booleano: el valor debe ser ${VALORES_BOOLEANO.join(' o ')}, no '${cond.valor}'.`;

  if (campo.tipo_campo === 'seleccion') {
    const opciones = normalizarOpciones(campo.opciones);
    if (!opciones.includes(cond.valor))
      return `El valor '${cond.valor}' no es una de las opciones de '${cond.campo}' (${opciones.join(', ')}).`;
  }

  return null;
};

// mysql2 devuelve una columna JSON ya parseada, pero el mismo objeto puede
// venir del body de un request como string. Se acepta cualquiera de las dos.
const normalizarOpciones = (opciones) => {
  if (Array.isArray(opciones)) return opciones;
  if (typeof opciones === 'string') {
    try {
      const parsed = JSON.parse(opciones);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

/**
 * Batería de coherencia sobre el grafo completo. Corre al publicar y no en
 * cada edición: mientras el ADMIN arma el protocolo el grafo está roto casi
 * todo el tiempo (el primer paso creado no tiene todavía ninguna transición),
 * así que bloquear cada guardado haría imposible construirlo.
 *
 * @param {Array} pasos        filas de *_PASO
 * @param {Array} transiciones filas de *_TRANSICION
 * @returns {string[]} problemas encontrados; vacío = grafo publicable
 */
const validarGrafo = (pasos, transiciones) => {
  const problemas = [];

  if (pasos.length === 0) return ['El protocolo no tiene ningún paso definido.'];

  const iniciales = pasos.filter((p) => p.es_paso_inicial);
  if (iniciales.length === 0)
    problemas.push('No hay paso inicial: el motor no tiene por dónde arrancar.');
  else if (iniciales.length > 1)
    problemas.push(
      `Hay ${iniciales.length} pasos iniciales (${iniciales.map((p) => p.nombre).join(', ')}); debe haber exactamente uno.`
    );

  if (!pasos.some((p) => p.es_paso_final))
    problemas.push('No hay ningún paso final: el protocolo nunca podría cerrarse.');

  // Un paso final con salidas es contradictorio: o cierra o continúa.
  for (const p of pasos)
    if (p.es_paso_final && transiciones.some((t) => t.id_paso_origen === p.id_paso))
      problemas.push(`El paso final '${p.nombre}' tiene transiciones salientes.`);

  const salientesPor = new Map();
  for (const t of transiciones) {
    if (!salientesPor.has(t.id_paso_origen)) salientesPor.set(t.id_paso_origen, []);
    salientesPor.get(t.id_paso_origen).push(t);
  }

  for (const p of pasos) {
    const salientes = salientesPor.get(p.id_paso) ?? [];

    // Callejón sin salida: un paso que no cierra y del que no se puede seguir
    // deja el caso detenido para siempre, sin error visible en ninguna parte.
    if (!p.es_paso_final && salientes.length === 0)
      problemas.push(`El paso '${p.nombre}' no es final y no tiene ninguna transición saliente.`);

    // Un paso que solo vuelve sobre sí mismo no avanza nunca. El self-loop es
    // legítimo ("mantener el seguimiento otro ciclo"), pero tiene que convivir
    // con al menos una salida real.
    if (!p.es_paso_final && salientes.length > 0 && salientes.every((t) => t.id_paso_destino === p.id_paso))
      problemas.push(`Todas las transiciones de '${p.nombre}' vuelven al mismo paso: el protocolo no podría avanzar.`);

    const defaults = salientes.filter((t) => t.es_default);
    if (defaults.length > 1)
      problemas.push(`El paso '${p.nombre}' tiene ${defaults.length} transiciones marcadas por defecto; solo puede haber una.`);

    // Si todas las salidas son condicionales y ninguna se cumple, el caso
    // queda igual de atascado que sin salidas. La rama por defecto es el
    // escape obligatorio.
    if (salientes.length > 0 && salientes.every((t) => t.condicion) && defaults.length === 0)
      problemas.push(
        `Todas las transiciones desde '${p.nombre}' son condicionales y no hay una por defecto: ` +
        'si ninguna condición se cumple, el caso queda sin destino.'
      );
  }

  // Alcanzabilidad desde el inicial. Un paso huérfano no rompe ningún caso,
  // pero es trabajo que el colegio cree configurado y que nunca va a ejecutarse.
  if (iniciales.length === 1) {
    const alcanzados = new Set([iniciales[0].id_paso]);
    const cola = [iniciales[0].id_paso];
    while (cola.length > 0) {
      for (const t of salientesPor.get(cola.pop()) ?? [])
        if (!alcanzados.has(t.id_paso_destino)) {
          alcanzados.add(t.id_paso_destino);
          cola.push(t.id_paso_destino);
        }
    }
    const huerfanos = pasos.filter((p) => !alcanzados.has(p.id_paso));
    if (huerfanos.length > 0)
      problemas.push(
        `Estos pasos no son alcanzables desde el paso inicial: ${huerfanos.map((p) => p.nombre).join(', ')}.`
      );
  }

  return problemas;
};

// Un paso de aprobación no tiene campos configurables, pero sí produce un
// resultado sobre el que ramificar — que es el caso más natural de todos:
// "si lo aprueban, seguir; si no, volver". Se expone como un campo implícito
// para que las condiciones no necesiten un mecanismo aparte.
const CAMPO_APROBACION = Object.freeze({
  codigo: 'aprobado',
  etiqueta: '¿Aprobado?',
  tipo_campo: 'seleccion',
  opciones: ['si', 'no'],
  es_obligatorio: 1,
  implicito: true,
});

/**
 * Campos contra los que se evalúan las condiciones que salen de un paso: los
 * configurados, salvo en aprobación, donde es el implícito.
 */
const camposDelPaso = (paso, campos) =>
  paso?.tipo_paso === 'aprobacion' ? [CAMPO_APROBACION, ...(campos ?? [])] : (campos ?? []);

/**
 * Elige el destino al completar un paso.
 *
 * Se toma la primera transición condicional que se cumpla contra el
 * `datos_salida` del paso recién completado, y si ninguna se cumple, la que
 * esté marcada por defecto. Las condiciones nunca miran pasos anteriores: eso
 * mantiene cada salto explicable con lo que se ve en la bitácora de ese paso.
 *
 * @returns {{transicion: object}|{error: string}}
 */
const elegirTransicion = (transiciones, datosSalida) => {
  const datos = datosSalida ?? {};
  const condicionales = transiciones.filter((t) => t.condicion);
  // Una salida sin condición vale como destino aunque nadie la haya marcado
  // por defecto: es el caso corriente de un paso con una sola continuación.
  // `es_default` solo desempata cuando hay varias incondicionales.
  const incondicionales = transiciones.filter((t) => !t.condicion);
  const porDefecto = incondicionales.find((t) => t.es_default) ?? incondicionales[0];

  for (const t of condicionales) {
    const cond = parsearCondicion(t.condicion);
    if (!cond) continue;
    const valor = datos[cond.campo];
    if (valor === undefined || valor === null) continue;
    const coincide = cond.operador === '='
      ? String(valor) === cond.valor
      : String(valor) !== cond.valor;
    if (coincide) return { transicion: t };
  }

  if (porDefecto) return { transicion: porDefecto };

  // El grafo se valida antes de activarse, así que llegar acá significa que se
  // activó con reglas rotas o que el paso no tenía salidas.
  return {
    error: transiciones.length === 0
      ? 'El paso no tiene ninguna transición saliente y no es final.'
      : 'Ninguna condición se cumplió y el paso no tiene una transición por defecto.',
  };
};

/**
 * Fecha límite de un paso que arranca en `desde`.
 *
 * `dias_habiles` cuenta de lunes a viernes y NO descuenta feriados: no hay
 * calendario de feriados en el sistema todavía. Para plazos legales de la
 * Superintendencia eso puede adelantar el vencimiento respecto del plazo real,
 * así que hay que reemplazarlo por un calendario de verdad antes de apoyarse
 * en las alertas para un sumario.
 */
const calcularFechaLimite = (desde, plazo_valor, plazo_unidad) => {
  if (!plazo_valor || !plazo_unidad) return null;
  const f = new Date(desde);

  if (plazo_unidad === 'horas') {
    f.setUTCHours(f.getUTCHours() + plazo_valor);
    return f;
  }
  if (plazo_unidad === 'dias_corridos') {
    f.setUTCDate(f.getUTCDate() + plazo_valor);
    return f;
  }

  let restantes = plazo_valor;
  while (restantes > 0) {
    f.setUTCDate(f.getUTCDate() + 1);
    const dia = f.getUTCDay();
    if (dia !== 0 && dia !== 6) restantes--;
  }
  return f;
};

/**
 * Valida los datos que llegan al completar un paso contra el schema congelado
 * de ese paso. Devuelve `{ datos }` normalizados o `{ error }`.
 *
 * Se rechazan las claves desconocidas en vez de ignorarlas: un campo que el
 * cliente cree estar guardando y que se descarta en silencio reaparece como
 * una condición que nunca se cumple, meses después y sin rastro.
 */
const validarDatosSalida = (campos, datos) => {
  const entrada = datos ?? {};
  const porCodigo = new Map(campos.map((c) => [c.codigo, c]));

  for (const clave of Object.keys(entrada))
    if (!porCodigo.has(clave))
      return { error: `El campo '${clave}' no existe en este paso.` };

  const limpio = {};
  for (const campo of campos) {
    const valor = entrada[campo.codigo];
    const vacio = valor === undefined || valor === null || String(valor).trim() === '';

    if (vacio) {
      if (campo.es_obligatorio) return { error: `El campo '${campo.etiqueta}' es obligatorio.` };
      continue;
    }

    const texto = String(valor).trim();
    if (campo.tipo_campo === 'numero' && Number.isNaN(Number(texto)))
      return { error: `El campo '${campo.etiqueta}' debe ser un número.` };
    if (campo.tipo_campo === 'fecha' && Number.isNaN(Date.parse(texto)))
      return { error: `El campo '${campo.etiqueta}' debe ser una fecha válida.` };
    if (campo.tipo_campo === 'booleano' && !VALORES_BOOLEANO.includes(texto))
      return { error: `El campo '${campo.etiqueta}' debe ser ${VALORES_BOOLEANO.join(' o ')}.` };
    if (campo.tipo_campo === 'seleccion') {
      const opciones = normalizarOpciones(campo.opciones);
      if (!opciones.includes(texto))
        return { error: `'${texto}' no es una opción válida de '${campo.etiqueta}' (${opciones.join(', ')}).` };
    }

    limpio[campo.codigo] = texto;
  }

  return { datos: limpio };
};

/**
 * Normaliza el plazo de un paso: valor y unidad van juntos o no van ninguno.
 * Un plazo con valor y sin unidad no se puede calcular, y una unidad sin valor
 * no significa nada.
 *
 * @returns {{valor: number|null, unidad: string|null}|{error: string}}
 */
const validarPlazo = (plazo_valor, plazo_unidad) => {
  const hayValor = plazo_valor !== undefined && plazo_valor !== null && plazo_valor !== '';
  const hayUnidad = plazo_unidad !== undefined && plazo_unidad !== null && plazo_unidad !== '';

  if (hayValor !== hayUnidad)
    return { error: 'plazo_valor y plazo_unidad se definen juntos o se omiten los dos.' };
  if (!hayValor) return { valor: null, unidad: null };
  if (!Number.isInteger(Number(plazo_valor)) || Number(plazo_valor) <= 0)
    return { error: 'plazo_valor debe ser un entero mayor que cero.' };
  if (!UNIDADES_PLAZO.includes(plazo_unidad))
    return { error: `plazo_unidad debe ser uno de: ${UNIDADES_PLAZO.join(', ')}.` };

  return { valor: Number(plazo_valor), unidad: plazo_unidad };
};

/** Validaciones de forma de un paso, sin mirar la BD. Devuelve mensaje o null. */
const validarPaso = ({ nombre, tipo_paso, accion_al_vencer }) => {
  if (!nombre?.trim()) return 'Nombre es requerido';
  if (tipo_paso && !TIPOS_PASO.includes(tipo_paso))
    return `tipo_paso debe ser uno de: ${TIPOS_PASO.join(', ')}.`;
  if (accion_al_vencer && !ACCIONES_VENCER.includes(accion_al_vencer))
    return `accion_al_vencer debe ser uno de: ${ACCIONES_VENCER.join(', ')}.`;
  return null;
};

/** Validaciones de forma de un campo de formulario. Devuelve mensaje o null. */
const validarCampo = ({ codigo, etiqueta, tipo_campo, opciones }) => {
  if (!codigo?.trim()) return 'codigo es requerido';
  if (!RE_CODIGO_CAMPO.test(codigo.trim()))
    return "codigo debe ser snake_case: empezar con letra minúscula y usar solo letras, números y '_' (es lo que se escribe dentro de una condición).";
  if (!etiqueta?.trim()) return 'etiqueta es requerida';
  if (!TIPOS_CAMPO.includes(tipo_campo)) return `tipo_campo debe ser uno de: ${TIPOS_CAMPO.join(', ')}.`;

  if (tipo_campo === 'seleccion') {
    const lista = normalizarOpciones(opciones);
    if (lista.length < 2) return 'Un campo de selección necesita al menos dos opciones.';
    if (new Set(lista).size !== lista.length) return 'Las opciones no pueden repetirse.';
  }
  return null;
};

module.exports = {
  TIPOS_CAMPO,
  TIPOS_PASO,
  UNIDADES_PLAZO,
  ACCIONES_VENCER,
  TIPOS_PARTICIPACION,
  TIPOS_DECIDIBLES,
  VALORES_BOOLEANO,
  RE_CODIGO_CAMPO,
  CAMPO_APROBACION,
  camposDelPaso,
  elegirTransicion,
  calcularFechaLimite,
  validarDatosSalida,
  parsearCondicion,
  validarCondicion,
  validarGrafo,
  validarPlazo,
  validarPaso,
  validarCampo,
  normalizarOpciones,
};
