const {
  TIPOS_PARTICIPACION,
  camposDelPaso,
  validarCondicion,
  validarDependencia,
  validarPlazo,
  validarPaso,
  validarCampo,
  normalizarOpciones,
  normalizarMedidaRequerida,
  esPasoDeAprobacion,
} = require('./flujoProtocolo');

// Guardado completo de un paso del grafo en una sola transacción: el paso, sus
// roles, sus preguntas, las transiciones que salen de él y las que llegan, más
// los borrados de todo eso.
//
// Existe porque el editor guardaba con los endpoints de a uno: un request por
// el paso, otro por los roles, uno por cada pregunta, uno por cada rama. Cada
// request abre su propia validación (¿existe el protocolo? ¿el paso es de este
// protocolo?) y cada consulta cuesta ~270 ms contra la base remota, así que
// guardar un paso con tres preguntas y tres salidas eran nueve requests y unas
// sesenta consultas: quince segundos de reloj. Y si el sexto request fallaba,
// los cinco anteriores ya estaban escritos — el paso quedaba a medio guardar y
// la pantalla tenía que recargar para mostrar en qué estado había quedado.
//
// Acá se escribe todo con una conexión y una transacción: o queda entero o no
// queda nada, y las validaciones se corren una sola vez sobre el estado final.
//
// El catálogo global y el espejo del establecimiento tienen el mismo grafo con
// otros nombres de tabla y de clave, así que la mecánica va una vez y cada
// nivel aporta su dialecto y su regla de qué roles admite.

/** Error con el status HTTP que le corresponde, para que el controller no
 *  tenga que interpretar strings. */
class ErrorFlujo extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ErrorFlujo';
    this.status = status;
  }
}

// En las dos tablas el campo y el rol cuelgan del paso con el mismo nombre que
// la PK del paso (id_paso / id_paso_estab), así que `pkPaso` sirve para las tres.
const DIALECTO_CATALOGO = Object.freeze({
  tablaPaso: 'CATALOGO_PROTOCOLO_PASO',
  tablaTransicion: 'CATALOGO_PROTOCOLO_TRANSICION',
  tablaCampo: 'CATALOGO_PROTOCOLO_PASO_CAMPO',
  tablaRol: 'CATALOGO_PROTOCOLO_PASO_ROL',
  pkPaso: 'id_paso',
  pkTransicion: 'id_transicion',
  pkCampo: 'id_campo',
  fkProtocolo: 'id_protocolo',
});

const DIALECTO_ESTABLECIMIENTO = Object.freeze({
  tablaPaso: 'PROTOCOLO_ESTABLECIMIENTO_PASO',
  tablaTransicion: 'PROTOCOLO_ESTABLECIMIENTO_TRANSICION',
  tablaCampo: 'PROTOCOLO_ESTABLECIMIENTO_PASO_CAMPO',
  tablaRol: 'PROTOCOLO_ESTABLECIMIENTO_PASO_ROL',
  pkPaso: 'id_paso_estab',
  pkTransicion: 'id_transicion_estab',
  pkCampo: 'id_campo_estab',
  fkProtocolo: 'id_protocolo_establecimiento',
});

const COLUMNAS_PASO = [
  'nombre', 'descripcion', 'tipo_paso', 'plazo_valor', 'plazo_unidad',
  'accion_al_vencer', 'es_paso_inicial', 'es_paso_final', 'orden_visual',
  'por_involucrado_rol', 'requiere_notificacion', 'requiere_medida',
  'tipo_medida_requerida',
];

const valoresPaso = (p, plazo, tipoPorDefecto) => [
  p.nombre.trim(),
  p.descripcion?.trim() || null,
  p.tipo_paso || tipoPorDefecto || 'informativo',
  plazo.valor,
  plazo.unidad,
  p.accion_al_vencer || 'notificar',
  p.es_paso_inicial ? 1 : 0,
  p.es_paso_final ? 1 : 0,
  p.orden_visual ?? 0,
  p.por_involucrado_rol || null,
  p.requiere_notificacion ? 1 : 0,
  p.requiere_medida ? 1 : 0,
  normalizarMedidaRequerida(p),
];

/**
 * Resuelve una referencia a paso del cuerpo del request.
 *
 * Los ids reales no existen hasta después del INSERT, y el editor necesita
 * poder decir "esta rama va al paso que estoy guardando" o "va a un paso nuevo
 * que se llama X" antes de que ninguno de los dos tenga id. Por eso el cuerpo
 * usa dos marcas, y el resto son ids de verdad:
 *
 *   '@paso'          el paso que se está guardando
 *   '@nuevo:<clave>' una entrada de `pasos_nuevos`
 */
const resolverRef = (ref, idPaso, idsNuevos) => {
  if (ref === '@paso') return idPaso;
  if (typeof ref === 'string' && ref.startsWith('@nuevo:')) {
    const clave = ref.slice('@nuevo:'.length);
    const id = idsNuevos.get(clave);
    if (id === undefined)
      throw new ErrorFlujo(400, `La referencia '${ref}' no corresponde a ningún paso nuevo del envío.`);
    return id;
  }
  const n = Number(ref);
  if (!Number.isInteger(n) || n <= 0)
    throw new ErrorFlujo(400, `Referencia de paso inválida: '${ref}'.`);
  return n;
};

/**
 * Relee el grafo completo del protocolo. Es la misma forma que devuelve
 * getGrafo, para que la pantalla pueda repintarse con esta respuesta y no
 * tenga que pedir el grafo otra vez: ese request era la décima ida y vuelta
 * del guardado.
 */
const leerGrafo = async (conn, D, idProtocolo) => {
  const [pasos] = await conn.query(
    `SELECT *, ${D.pkPaso} AS id_paso FROM ${D.tablaPaso}
     WHERE ${D.fkProtocolo} = ? ORDER BY orden_visual, ${D.pkPaso}`,
    [idProtocolo]
  );
  const [transiciones] = await conn.query(
    `SELECT *, ${D.pkTransicion} AS id_transicion FROM ${D.tablaTransicion}
     WHERE ${D.fkProtocolo} = ? ORDER BY id_paso_origen, es_default, ${D.pkTransicion}`,
    [idProtocolo]
  );
  const [roles] = await conn.query(
    `SELECT pr.*, pr.${D.pkPaso} AS id_paso, r.nombre AS rol_nombre, r.codigo AS rol_codigo
     FROM ${D.tablaRol} pr
     JOIN ${D.tablaPaso} p ON p.${D.pkPaso} = pr.${D.pkPaso}
     JOIN ROLES r ON r.rol_id = pr.rol_id
     WHERE p.${D.fkProtocolo} = ?`,
    [idProtocolo]
  );
  const [campos] = await conn.query(
    `SELECT c.*, c.${D.pkCampo} AS id_campo, c.${D.pkPaso} AS id_paso
     FROM ${D.tablaCampo} c
     JOIN ${D.tablaPaso} p ON p.${D.pkPaso} = c.${D.pkPaso}
     WHERE p.${D.fkProtocolo} = ? ORDER BY c.orden, c.${D.pkCampo}`,
    [idProtocolo]
  );
  return { pasos, transiciones, roles, campos };
};

/**
 * Coherencia del grafo después de escribir, dentro de la transacción y antes
 * del commit: si algo no cierra se lanza y no queda nada.
 *
 * Se revisa el estado final y no los datos del request porque eso es lo que
 * hacía falta: antes, una condición sobre una pregunta creada en el mismo
 * guardado no se podía validar (la pregunta todavía no existía cuando se
 * guardaba la rama), y el editor tenía que ordenar los requests para que
 * calzaran. Acá ya está todo escrito, así que se valida contra la verdad.
 *
 * Solo se revisan los pasos que el guardado tocó. Revisar el grafo entero
 * significaría que no se puede guardar un paso porque otro, que nadie está
 * mirando, quedó incoherente de antes; para eso está `validar`.
 */
const revisarPasosTocados = ({ pasos, transiciones, campos, roles }, idsTocados) => {
  const porId = new Map(pasos.map((p) => [p.id_paso, p]));

  // El paso inicial es el punto de arranque del motor: dos serían ambiguos. Se
  // rechaza en vez de desmarcar el otro en silencio, porque cuál de los dos
  // debe quedar es una decisión de quien edita, no del servidor. El mensaje
  // nombra al que ya lo era, que es el que hay que ir a desmarcar.
  const iniciales = pasos.filter((p) => p.es_paso_inicial);
  if (iniciales.length > 1) {
    const previo = iniciales.find((p) => !idsTocados.has(p.id_paso)) ?? iniciales[0];
    throw new ErrorFlujo(409, `'${previo.nombre}' ya es el paso inicial. Desmárcalo primero.`);
  }

  for (const idPaso of idsTocados) {
    const paso = porId.get(idPaso);
    if (!paso) continue;

    const suyos = campos.filter((c) => c.id_paso === idPaso);
    const salientes = transiciones.filter((t) => t.id_paso_origen === idPaso);

    if (paso.es_paso_final && salientes.length > 0)
      throw new ErrorFlujo(409, `'${paso.nombre}' es un paso final: no puede tener transiciones salientes.`);

    // Un paso de aprobación sin aprobador no se puede completar nunca: el caso
    // se queda ahí para siempre. Es el bug que dejó trancado el paso de
    // resolución en los protocolos del catálogo.
    const delPaso = roles.filter((r) => r.id_paso === idPaso);
    if (esPasoDeAprobacion(paso.tipo_paso) && !delPaso.some((r) => r.tipo_participacion === 'aprobador'))
      throw new ErrorFlujo(
        409,
        `El paso '${paso.nombre}' es de tipo aprobación: necesita al menos un rol con tipo_participacion = aprobador.`
      );

    // Una sola rama por defecto: es la que se toma cuando ninguna condición se
    // cumple, y dos serían un empate sin criterio.
    const defaults = salientes.filter((t) => t.es_default);
    if (defaults.length > 1)
      throw new ErrorFlujo(409, `'${paso.nombre}' tiene ${defaults.length} transiciones por defecto; solo puede haber una.`);

    for (const c of suyos) {
      const problema = validarDependencia(
        c.depende_de,
        c.codigo,
        suyos.filter((o) => o.id_campo !== c.id_campo)
      );
      if (problema) throw new ErrorFlujo(409, `Pregunta '${c.etiqueta}': ${problema}`);
    }

    const disponibles = camposDelPaso(paso, suyos);
    for (const t of salientes) {
      if (t.id_paso_origen === t.id_paso_destino && !t.condicion)
        throw new ErrorFlujo(
          409,
          `La transición de '${paso.nombre}' a sí mismo necesita una condición: sin ella el protocolo quedaría en un bucle.`
        );
      if (!t.condicion) continue;
      if (disponibles.length === 0)
        throw new ErrorFlujo(409, `'${paso.nombre}' no tiene preguntas definidas: no hay nada contra qué evaluar la condición '${t.condicion}'.`);
      const problema = validarCondicion(t.condicion, disponibles);
      if (problema) throw new ErrorFlujo(409, `Salida de '${paso.nombre}' ('${t.condicion}'): ${problema}`);
    }
  }
};

/**
 * @param conn        conexión con la transacción ya abierta
 * @param dialecto    DIALECTO_CATALOGO o DIALECTO_ESTABLECIMIENTO
 * @param idProtocolo id del protocolo (genérico o de establecimiento)
 * @param idPaso      id del paso a actualizar, o null para crearlo
 * @param cuerpo      el body del request (ver README de la ruta)
 * @param validarRol  (fila de ROLES) => mensaje de error o null; cada nivel
 *                    decide qué roles admite (el catálogo solo globales, el
 *                    espejo también los propios del colegio)
 * @returns { id_paso, grafo }
 */
async function guardarPasoCompleto({ conn, dialecto: D, idProtocolo, idPaso, cuerpo, validarRol }) {
  const {
    paso: datosPaso,
    roles = [],
    campos = [],
    campos_eliminados = [],
    transiciones = [],
    transiciones_eliminadas = [],
    pasos_nuevos = [],
  } = cuerpo ?? {};

  // -- Forma del envío, antes de tocar la base ------------------------------

  if (!datosPaso || typeof datosPaso !== 'object')
    throw new ErrorFlujo(400, 'Falta el objeto `paso` con los datos del paso.');

  const forma = validarPaso(datosPaso);
  if (forma) throw new ErrorFlujo(400, forma);

  const plazo = validarPlazo(datosPaso.plazo_valor, datosPaso.plazo_unidad);
  if (plazo.error) throw new ErrorFlujo(400, plazo.error);

  if (!Array.isArray(roles))
    throw new ErrorFlujo(400, 'roles debe ser un arreglo de { rol_id, tipo_participacion }');
  for (const r of roles) {
    if (!r?.rol_id) throw new ErrorFlujo(400, 'Cada rol necesita rol_id');
    if (r.tipo_participacion && !TIPOS_PARTICIPACION.includes(r.tipo_participacion))
      throw new ErrorFlujo(400, `tipo_participacion debe ser uno de: ${TIPOS_PARTICIPACION.join(', ')}.`);
  }

  if (!Array.isArray(campos)) throw new ErrorFlujo(400, 'campos debe ser un arreglo');
  for (const c of campos) {
    const problema = validarCampo(c);
    if (problema) throw new ErrorFlujo(400, problema);
  }
  // El código identifica la pregunta dentro del paso: es lo que citan las
  // condiciones. Se rechaza acá con el nombre de la pregunta repetida, en vez
  // de dejar que la BD devuelva un ER_DUP_ENTRY sin decir cuál era.
  const vistos = new Set();
  for (const c of campos) {
    const codigo = c.codigo.trim();
    if (vistos.has(codigo))
      throw new ErrorFlujo(409, `Hay dos preguntas con el código '${codigo}' en este paso.`);
    vistos.add(codigo);
  }

  if (!Array.isArray(pasos_nuevos)) throw new ErrorFlujo(400, 'pasos_nuevos debe ser un arreglo');
  for (const p of pasos_nuevos) {
    if (!p?.clave) throw new ErrorFlujo(400, 'Cada paso nuevo necesita una clave para poder referenciarlo.');
    if (!p?.nombre?.trim()) throw new ErrorFlujo(400, 'Cada paso nuevo necesita nombre.');
  }

  // -- Los roles referenciados tienen que existir y ser usables -------------

  if (roles.length > 0) {
    const ids = [...new Set(roles.map((r) => Number(r.rol_id)))];
    const [validos] = await conn.query(
      'SELECT rol_id, nombre, id_establecimiento, activo FROM ROLES WHERE rol_id IN (?)',
      [ids]
    );
    const porId = new Map(validos.map((r) => [r.rol_id, r]));
    for (const id of ids) {
      const rol = porId.get(id);
      if (!rol) throw new ErrorFlujo(404, `El rol ${id} no existe.`);
      const problema = validarRol(rol);
      if (problema) throw new ErrorFlujo(problema.status ?? 409, problema.message ?? problema);
    }
  }

  // -- El paso -------------------------------------------------------------

  let idPasoFinal = idPaso;
  if (idPaso) {
    // Se lee solo para el tipo previo: `tipo_paso` puede venir vacío en el
    // body y en ese caso se conserva el que ya tenía.
    const [[actual]] = await conn.query(
      `SELECT tipo_paso FROM ${D.tablaPaso} WHERE ${D.pkPaso} = ? AND ${D.fkProtocolo} = ?`,
      [idPaso, idProtocolo]
    );
    if (!actual) throw new ErrorFlujo(404, 'Paso no encontrado en este protocolo');

    await conn.query(
      `UPDATE ${D.tablaPaso} SET ${COLUMNAS_PASO.map((c) => `${c} = ?`).join(', ')}
       WHERE ${D.pkPaso} = ? AND ${D.fkProtocolo} = ?`,
      [...valoresPaso(datosPaso, plazo, actual.tipo_paso), idPaso, idProtocolo]
    );
  } else {
    const [r] = await conn.query(
      `INSERT INTO ${D.tablaPaso} (${D.fkProtocolo}, ${COLUMNAS_PASO.join(', ')})
       VALUES (${['?', ...COLUMNAS_PASO.map(() => '?')].join(', ')})`,
      [idProtocolo, ...valoresPaso(datosPaso, plazo)]
    );
    idPasoFinal = r.insertId;
  }

  // -- Los pasos que el editor crea al pasar ("la rama va a un paso nuevo") --

  const idsNuevos = new Map();
  for (const p of pasos_nuevos) {
    const [r] = await conn.query(
      `INSERT INTO ${D.tablaPaso} (${D.fkProtocolo}, ${COLUMNAS_PASO.join(', ')})
       VALUES (${['?', ...COLUMNAS_PASO.map(() => '?')].join(', ')})`,
      [idProtocolo, ...valoresPaso({ tipo_paso: 'informativo', ...p }, { valor: null, unidad: null })]
    );
    idsNuevos.set(String(p.clave), r.insertId);
  }

  // Estos pasos se crean con un nombre y nada más —el editor solo pide "que
  // siga en un paso nuevo llamado X"— así que nacían sin ejecutor: un paso que
  // nadie puede completar, y el error recién aparece al publicar el protocolo.
  // Se les deja de ejecutor al coordinador de convivencia, que es quien conduce
  // el procedimiento; después se edita como cualquier otro paso.
  if (idsNuevos.size > 0) {
    const [[coordinador]] = await conn.query(
      "SELECT rol_id FROM ROLES WHERE codigo = 'ENCARGADO' AND activo = 1 LIMIT 1"
    );
    if (coordinador)
      await conn.query(
        `INSERT INTO ${D.tablaRol} (${D.pkPaso}, rol_id, tipo_participacion) VALUES ?`,
        [[...idsNuevos.values()].map((id) => [id, coordinador.rol_id, 'ejecutor'])]
      );
  }

  // -- Roles: se reemplaza el set completo ---------------------------------

  await conn.query(`DELETE FROM ${D.tablaRol} WHERE ${D.pkPaso} = ?`, [idPasoFinal]);
  if (roles.length > 0)
    await conn.query(
      `INSERT INTO ${D.tablaRol} (${D.pkPaso}, rol_id, tipo_participacion) VALUES ?`,
      [roles.map((r) => [idPasoFinal, r.rol_id, r.tipo_participacion || 'ejecutor'])]
    );

  // -- Borrados. Van antes de las altas: una condición viva sobre una
  //    pregunta que se está por borrar bloquearía el borrado. -------------

  if (transiciones_eliminadas.length > 0)
    await conn.query(
      `DELETE FROM ${D.tablaTransicion} WHERE ${D.pkTransicion} IN (?) AND ${D.fkProtocolo} = ?`,
      [transiciones_eliminadas.map(Number), idProtocolo]
    );
  if (campos_eliminados.length > 0)
    await conn.query(
      `DELETE FROM ${D.tablaCampo} WHERE ${D.pkCampo} IN (?) AND ${D.pkPaso} = ?`,
      [campos_eliminados.map(Number), idPasoFinal]
    );

  // -- Preguntas -----------------------------------------------------------
  //
  // Los updates van de a uno y no en un INSERT ... ON DUPLICATE KEY: la tabla
  // tiene único (paso, codigo) además de la PK, así que un lote donde dos
  // preguntas se intercambian el código podría actualizar la fila equivocada
  // sin fallar. Las altas sí van en un solo INSERT.

  const nuevos = [];
  for (const [i, c] of campos.entries()) {
    const valores = [
      c.codigo.trim(), c.etiqueta.trim(), c.tipo_campo,
      c.tipo_campo === 'seleccion' ? JSON.stringify(normalizarOpciones(c.opciones)) : null,
      c.es_obligatorio ? 1 : 0, c.depende_de?.trim() || null, c.orden ?? i,
    ];
    if (c.id_campo) {
      await conn.query(
        `UPDATE ${D.tablaCampo}
         SET codigo = ?, etiqueta = ?, tipo_campo = ?, opciones = ?, es_obligatorio = ?,
             depende_de = ?, orden = ?
         WHERE ${D.pkCampo} = ? AND ${D.pkPaso} = ?`,
        [...valores, c.id_campo, idPasoFinal]
      );
    } else {
      nuevos.push([idPasoFinal, ...valores]);
    }
  }
  if (nuevos.length > 0)
    await conn.query(
      `INSERT INTO ${D.tablaCampo}
         (${D.pkPaso}, codigo, etiqueta, tipo_campo, opciones, es_obligatorio, depende_de, orden)
       VALUES ?`,
      [nuevos]
    );

  // -- Transiciones --------------------------------------------------------

  const tocados = new Set([idPasoFinal, ...idsNuevos.values()]);
  const altas = [];
  for (const t of transiciones) {
    const origen = resolverRef(t.id_paso_origen ?? '@paso', idPasoFinal, idsNuevos);
    const destino = resolverRef(t.id_paso_destino, idPasoFinal, idsNuevos);
    tocados.add(origen);
    const valores = [
      origen, destino, t.condicion?.trim() || null,
      t.etiqueta?.trim() || null, t.es_default ? 1 : 0,
    ];
    if (t.id_transicion) {
      const [r] = await conn.query(
        `UPDATE ${D.tablaTransicion}
         SET id_paso_origen = ?, id_paso_destino = ?, condicion = ?, etiqueta = ?, es_default = ?
         WHERE ${D.pkTransicion} = ? AND ${D.fkProtocolo} = ?`,
        [...valores, t.id_transicion, idProtocolo]
      );
      if (r.affectedRows === 0)
        throw new ErrorFlujo(404, `La salida ${t.id_transicion} no existe en este protocolo.`);
    } else {
      altas.push([idProtocolo, ...valores]);
    }
  }
  if (altas.length > 0)
    await conn.query(
      `INSERT INTO ${D.tablaTransicion}
         (${D.fkProtocolo}, id_paso_origen, id_paso_destino, condicion, etiqueta, es_default)
       VALUES ?`,
      [altas]
    );

  // -- Coherencia sobre lo que quedó escrito -------------------------------

  const grafo = await leerGrafo(conn, D, idProtocolo);
  revisarPasosTocados(grafo, tocados);

  return { id_paso: idPasoFinal, grafo };
}

/** Traduce los choques de la BD al mensaje que ya devolvían los endpoints de
 *  a uno, para no cambiar lo que lee el usuario. */
const mensajeDeError = (err) => {
  if (err instanceof ErrorFlujo) return { status: err.status, message: err.message };
  if (err.code === 'ER_DUP_ENTRY') {
    if (/PASO_ROL/i.test(err.message))
      return { status: 409, message: 'Hay un rol repetido con el mismo tipo de participación.' };
    return { status: 409, message: 'Ya existe una pregunta con ese código en este paso.' };
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW')
    return { status: 409, message: 'Alguna salida apunta a un paso que no existe en este protocolo.' };
  return null;
};

/** El grafo con roles y campos colgando de su paso, que es la forma en que lo
 *  consume el editor (la misma que devuelve getGrafo). */
const anidarGrafo = ({ pasos, transiciones, roles, campos }) => ({
  pasos: pasos.map((p) => ({
    ...p,
    roles: roles.filter((r) => r.id_paso === p.id_paso),
    campos: campos.filter((c) => c.id_paso === p.id_paso),
  })),
  transiciones,
});

module.exports = {
  ErrorFlujo,
  DIALECTO_CATALOGO,
  DIALECTO_ESTABLECIMIENTO,
  guardarPasoCompleto,
  mensajeDeError,
  anidarGrafo,
};
