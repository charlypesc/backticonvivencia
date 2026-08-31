const pool = require('../db/connection');
const {
  TIPOS_PARTICIPACION,
  camposDelPaso,
  validarCondicion,
  validarDependencia,
  parsearCondicion,
  validarGrafo,
  validarPlazo,
  validarPaso,
  validarCampo,
  validarTechoLegal,
  normalizarOpciones,
} = require('../utils/flujoProtocolo');

// El grafo de un protocolo tal como lo ejecuta un establecimiento concreto.
//
// Un colegio que adopta un protocolo del catálogo NO recibe una copia: mientras
// no personalice nada, la ejecución materializa desde la plantilla global y las
// correcciones del ADMIN le llegan solas. Recién al personalizar se clona el
// grafo completo a las tablas espejo, y desde ese momento su ejecución sale de
// su copia.
//
// La existencia de filas en PROTOCOLO_ESTABLECIMIENTO_PASO es el flag: no hay
// una columna 'personalizado' que mantener sincronizada con la realidad.
//
// Caso aparte: un protocolo propio del colegio (id_protocolo NULL) no tiene
// plantilla detrás, así que su grafo vive en el espejo desde el primer paso y
// no hay nada que clonar ni a qué restaurar.

const CATALOGO = 'catalogo';   // hereda el grafo de la plantilla global
const PROPIO = 'propio';       // tiene copia espejo (clonada o creada de cero)
const VACIO = 'vacio';         // protocolo propio al que todavía no le armaron el grafo

// Resuelve el protocolo del establecimiento del usuario. Todo pasa por acá:
// un id de otro colegio devuelve null y el handler responde 404, nunca datos.
const buscarProtocoloEstablecimiento = async (id_protocolo_establecimiento, id_establecimiento) => {
  const [rows] = await pool.query(
    `SELECT pe.id_protocolo_establecimiento, pe.id_protocolo, pe.id_establecimiento,
            COALESCE(pe.nombre, cp.nombre) AS nombre,
            -- El ámbito decide contra qué techo legal se valida el protocolo.
            -- Se hereda del catálogo cuando la copia local no lo tiene: al
            -- adoptar no se estaba copiando, así que sin este COALESCE los
            -- protocolos de personal se validarían con el techo del estudiante.
            -- Si queda NULL (protocolo propio, sin genérico detrás) se aplica
            -- el techo del estudiante, que es el más estricto de los dos.
            COALESCE(pe.ambito, cp.ambito) AS ambito,
            cp.estado_flujo
     FROM PROTOCOLO_ESTABLECIMIENTO pe
     LEFT JOIN CATALOGO_PROTOCOLOS_GENERICOS cp ON pe.id_protocolo = cp.id_protocolo
     WHERE pe.id_protocolo_establecimiento = ? AND pe.id_establecimiento = ?`,
    [id_protocolo_establecimiento, id_establecimiento]
  );
  return rows[0] ?? null;
};

const cuentaEspejo = async (id_protocolo_establecimiento) => {
  const [[{ c }]] = await pool.query(
    'SELECT COUNT(*) c FROM PROTOCOLO_ESTABLECIMIENTO_PASO WHERE id_protocolo_establecimiento = ?',
    [id_protocolo_establecimiento]
  );
  return c;
};

const origenDelGrafo = async (pe) => {
  if ((await cuentaEspejo(pe.id_protocolo_establecimiento)) > 0) return PROPIO;
  return pe.id_protocolo === null ? VACIO : CATALOGO;
};

// Editar el espejo exige que exista. Para un protocolo adoptado eso significa
// haber personalizado primero: si no, cada edición crearía media copia y el
// grafo quedaría mitad heredado y mitad propio, que es justo el rompecabezas de
// coherencia que la clonación completa evita.
const exigirEspejoEditable = async (pe) => {
  const origen = await origenDelGrafo(pe);
  if (origen === PROPIO || origen === VACIO) return null;
  return 'Este protocolo hereda el flujo del catálogo. Personalízalo primero para poder editarlo.';
};

// Las funciones de validación trabajan con los nombres canónicos del grafo
// (id_paso, id_paso_origen, id_paso_destino). El espejo usa id_paso_estab, así
// que se aliasea en el SELECT en vez de traducir después en memoria.
const SELECT_PASOS = `
  SELECT id_paso_estab AS id_paso, id_paso_estab, id_protocolo_establecimiento,
         id_paso_origen_catalogo, nombre, descripcion, tipo_paso, plazo_valor, plazo_unidad,
         accion_al_vencer, es_paso_inicial, es_paso_final, orden_visual
  FROM PROTOCOLO_ESTABLECIMIENTO_PASO
  WHERE id_protocolo_establecimiento = ?
`;
const SELECT_TRANSICIONES = `
  SELECT id_transicion_estab AS id_transicion, id_transicion_estab, id_protocolo_establecimiento,
         id_paso_origen, id_paso_destino, condicion, etiqueta, es_default
  FROM PROTOCOLO_ESTABLECIMIENTO_TRANSICION
  WHERE id_protocolo_establecimiento = ?
`;

const buscarPaso = async (id_paso_estab, id_protocolo_establecimiento) => {
  const [rows] = await pool.query(`${SELECT_PASOS} AND id_paso_estab = ?`, [
    id_protocolo_establecimiento, id_paso_estab,
  ]);
  return rows[0] ?? null;
};

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

// Devuelve el grafo vigente, venga de donde venga. El cliente no tiene que
// saber si el colegio personalizó: pregunta por el flujo de su protocolo y
// recibe el que se va a ejecutar, con `origen` para poder mostrar de dónde sale.
const getGrafo = async (req, res) => {
  const { id_protocolo_establecimiento } = req.params;
  try {
    const pe = await buscarProtocoloEstablecimiento(id_protocolo_establecimiento, req.id_establecimiento);
    if (!pe) return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });

    const origen = await origenDelGrafo(pe);

    if (origen === CATALOGO) {
      const [pasos] = await pool.query(
        'SELECT * FROM CATALOGO_PROTOCOLO_PASO WHERE id_protocolo = ? ORDER BY orden_visual, id_paso',
        [pe.id_protocolo]
      );
      const [transiciones] = await pool.query(
        'SELECT * FROM CATALOGO_PROTOCOLO_TRANSICION WHERE id_protocolo = ?',
        [pe.id_protocolo]
      );
      const [roles] = await pool.query(
        `SELECT pr.*, r.nombre AS rol_nombre, r.codigo AS rol_codigo
         FROM CATALOGO_PROTOCOLO_PASO_ROL pr
         JOIN CATALOGO_PROTOCOLO_PASO p ON p.id_paso = pr.id_paso
         JOIN ROLES r ON r.rol_id = pr.rol_id
         WHERE p.id_protocolo = ?`,
        [pe.id_protocolo]
      );
      const [campos] = await pool.query(
        `SELECT c.* FROM CATALOGO_PROTOCOLO_PASO_CAMPO c
         JOIN CATALOGO_PROTOCOLO_PASO p ON p.id_paso = c.id_paso
         WHERE p.id_protocolo = ? ORDER BY c.orden, c.id_campo`,
        [pe.id_protocolo]
      );
      return res.json({
        protocolo: pe,
        origen,
        editable: false,
        pasos: pasos.map((p) => ({
          ...p,
          roles: roles.filter((r) => r.id_paso === p.id_paso),
          campos: campos.filter((c) => c.id_paso === p.id_paso),
        })),
        transiciones,
      });
    }

    const [pasos] = await pool.query(`${SELECT_PASOS} ORDER BY orden_visual, id_paso_estab`, [
      id_protocolo_establecimiento,
    ]);
    const [transiciones] = await pool.query(
      `${SELECT_TRANSICIONES} ORDER BY id_paso_origen, es_default, id_transicion_estab`,
      [id_protocolo_establecimiento]
    );
    const [roles] = await pool.query(
      `SELECT pr.*, r.nombre AS rol_nombre, r.codigo AS rol_codigo
       FROM PROTOCOLO_ESTABLECIMIENTO_PASO_ROL pr
       JOIN PROTOCOLO_ESTABLECIMIENTO_PASO p ON p.id_paso_estab = pr.id_paso_estab
       JOIN ROLES r ON r.rol_id = pr.rol_id
       WHERE p.id_protocolo_establecimiento = ?`,
      [id_protocolo_establecimiento]
    );
    const [campos] = await pool.query(
      `SELECT c.* FROM PROTOCOLO_ESTABLECIMIENTO_PASO_CAMPO c
       JOIN PROTOCOLO_ESTABLECIMIENTO_PASO p ON p.id_paso_estab = c.id_paso_estab
       WHERE p.id_protocolo_establecimiento = ? ORDER BY c.orden, c.id_campo_estab`,
      [id_protocolo_establecimiento]
    );

    res.json({
      protocolo: pe,
      origen,
      editable: true,
      pasos: pasos.map((p) => ({
        ...p,
        roles: roles.filter((r) => r.id_paso_estab === p.id_paso_estab),
        campos: campos.filter((c) => c.id_paso_estab === p.id_paso_estab),
      })),
      transiciones,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el flujo del protocolo' });
  }
};

// ---------------------------------------------------------------------------
// Personalizar y restaurar
// ---------------------------------------------------------------------------

// Clona el grafo completo del catálogo. En una transacción porque un clon a
// medias (pasos sin sus transiciones) deja al colegio con un flujo roto y sin
// forma de volver: ya no heredaría, porque el flag es la existencia de filas.
const personalizar = async (req, res) => {
  const { id_protocolo_establecimiento } = req.params;
  try {
    const pe = await buscarProtocoloEstablecimiento(id_protocolo_establecimiento, req.id_establecimiento);
    if (!pe) return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });

    if (pe.id_protocolo === null)
      return res.status(409).json({
        message: 'Este es un protocolo propio del establecimiento: no hereda de ningún catálogo, su flujo se edita directamente.',
      });
    if ((await cuentaEspejo(id_protocolo_establecimiento)) > 0)
      return res.status(409).json({ message: 'Este protocolo ya está personalizado.' });

    const [pasos] = await pool.query(
      'SELECT * FROM CATALOGO_PROTOCOLO_PASO WHERE id_protocolo = ?',
      [pe.id_protocolo]
    );
    if (pasos.length === 0)
      return res.status(409).json({
        message: 'El protocolo del catálogo todavía no tiene flujo definido: no hay nada que personalizar.',
      });

    const [transiciones] = await pool.query(
      'SELECT * FROM CATALOGO_PROTOCOLO_TRANSICION WHERE id_protocolo = ?',
      [pe.id_protocolo]
    );
    const [roles] = await pool.query(
      `SELECT pr.* FROM CATALOGO_PROTOCOLO_PASO_ROL pr
       JOIN CATALOGO_PROTOCOLO_PASO p ON p.id_paso = pr.id_paso WHERE p.id_protocolo = ?`,
      [pe.id_protocolo]
    );
    const [campos] = await pool.query(
      `SELECT c.* FROM CATALOGO_PROTOCOLO_PASO_CAMPO c
       JOIN CATALOGO_PROTOCOLO_PASO p ON p.id_paso = c.id_paso WHERE p.id_protocolo = ?`,
      [pe.id_protocolo]
    );

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Los ids del espejo son nuevos, así que hay que traducir cada referencia
      // del catálogo a su copia. Se insertan de a uno para poder quedarse con
      // el insertId de cada paso y armar el mapa.
      const mapa = new Map();
      for (const p of pasos) {
        const [r] = await conn.query(
          `INSERT INTO PROTOCOLO_ESTABLECIMIENTO_PASO
             (id_protocolo_establecimiento, id_paso_origen_catalogo, nombre, descripcion, tipo_paso,
              plazo_valor, plazo_unidad, accion_al_vencer, es_paso_inicial, es_paso_final, orden_visual,
              por_involucrado_rol, requiere_acuse)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id_protocolo_establecimiento, p.id_paso, p.nombre, p.descripcion, p.tipo_paso,
            p.plazo_valor, p.plazo_unidad, p.accion_al_vencer,
            p.es_paso_inicial, p.es_paso_final, p.orden_visual,
            p.por_involucrado_rol, p.requiere_acuse,
          ]
        );
        mapa.set(p.id_paso, r.insertId);
      }

      if (transiciones.length > 0)
        await conn.query(
          `INSERT INTO PROTOCOLO_ESTABLECIMIENTO_TRANSICION
             (id_protocolo_establecimiento, id_paso_origen, id_paso_destino, condicion, etiqueta, es_default)
           VALUES ?`,
          [transiciones.map((t) => [
            id_protocolo_establecimiento, mapa.get(t.id_paso_origen), mapa.get(t.id_paso_destino),
            t.condicion, t.etiqueta, t.es_default,
          ])]
        );

      if (roles.length > 0)
        await conn.query(
          'INSERT INTO PROTOCOLO_ESTABLECIMIENTO_PASO_ROL (id_paso_estab, rol_id, tipo_participacion) VALUES ?',
          [roles.map((r) => [mapa.get(r.id_paso), r.rol_id, r.tipo_participacion])]
        );

      if (campos.length > 0)
        await conn.query(
          `INSERT INTO PROTOCOLO_ESTABLECIMIENTO_PASO_CAMPO
             (id_paso_estab, codigo, etiqueta, tipo_campo, opciones, es_obligatorio, depende_de, orden)
           VALUES ?`,
          [campos.map((c) => [
            mapa.get(c.id_paso), c.codigo, c.etiqueta, c.tipo_campo,
            c.opciones === null ? null : JSON.stringify(normalizarOpciones(c.opciones)),
            c.es_obligatorio, c.depende_de ?? null, c.orden,
          ])]
        );

      await conn.commit();
      res.status(201).json({
        message: 'Flujo personalizado: desde ahora este protocolo usa la copia del establecimiento',
        pasos: pasos.length,
        transiciones: transiciones.length,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al personalizar el flujo' });
  }
};

// Descarta la copia y vuelve a heredar. Los casos ya activados no se tocan:
// tienen su propio grafo congelado y siguen su curso con las reglas que tenían.
const restaurar = async (req, res) => {
  const { id_protocolo_establecimiento } = req.params;
  try {
    const pe = await buscarProtocoloEstablecimiento(id_protocolo_establecimiento, req.id_establecimiento);
    if (!pe) return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });

    if (pe.id_protocolo === null)
      return res.status(409).json({
        message: 'Este es un protocolo propio del establecimiento: no hay catálogo al que volver. Borrar su flujo lo dejaría sin nada que ejecutar.',
      });
    const pasos = await cuentaEspejo(id_protocolo_establecimiento);
    if (pasos === 0)
      return res.status(409).json({ message: 'Este protocolo no está personalizado: ya hereda del catálogo.' });

    // La cascada de la FK se lleva transiciones, roles y campos.
    await pool.query(
      'DELETE FROM PROTOCOLO_ESTABLECIMIENTO_PASO WHERE id_protocolo_establecimiento = ?',
      [id_protocolo_establecimiento]
    );
    res.json({
      message: `Personalización descartada: el protocolo vuelve a heredar el flujo del catálogo (se eliminaron ${pasos} paso(s))`,
      pasos_eliminados: pasos,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al restaurar el flujo del catálogo' });
  }
};

// ---------------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------------

const crearPaso = async (req, res) => {
  const { id_protocolo_establecimiento } = req.params;
  const {
    nombre, descripcion, tipo_paso, plazo_valor, plazo_unidad,
    accion_al_vencer, es_paso_inicial, es_paso_final, orden_visual,
    por_involucrado_rol, requiere_acuse,
  } = req.body;

  const forma = validarPaso(req.body);
  if (forma) return res.status(400).json({ message: forma });

  const plazo = validarPlazo(plazo_valor, plazo_unidad);
  if (plazo.error) return res.status(400).json({ message: plazo.error });

  try {
    const pe = await buscarProtocoloEstablecimiento(id_protocolo_establecimiento, req.id_establecimiento);
    if (!pe) return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });
    const bloqueo = await exigirEspejoEditable(pe);
    if (bloqueo) return res.status(409).json({ message: bloqueo });

    if (es_paso_inicial) {
      const [ya] = await pool.query(
        'SELECT nombre FROM PROTOCOLO_ESTABLECIMIENTO_PASO WHERE id_protocolo_establecimiento = ? AND es_paso_inicial = 1',
        [id_protocolo_establecimiento]
      );
      if (ya.length > 0)
        return res.status(409).json({ message: `'${ya[0].nombre}' ya es el paso inicial. Desmárcalo primero.` });
    }

    const [result] = await pool.query(
      `INSERT INTO PROTOCOLO_ESTABLECIMIENTO_PASO
         (id_protocolo_establecimiento, nombre, descripcion, tipo_paso, plazo_valor, plazo_unidad,
          accion_al_vencer, es_paso_inicial, es_paso_final, orden_visual,
          por_involucrado_rol, requiere_acuse)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id_protocolo_establecimiento, nombre.trim(), descripcion?.trim() || null,
        tipo_paso || 'informativo', plazo.valor, plazo.unidad, accion_al_vencer || 'notificar',
        es_paso_inicial ? 1 : 0, es_paso_final ? 1 : 0, orden_visual ?? 0,
        por_involucrado_rol || null, requiere_acuse ? 1 : 0,
      ]
    );
    res.status(201).json({ id_paso_estab: result.insertId, message: 'Paso creado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al crear el paso' });
  }
};

const actualizarPaso = async (req, res) => {
  const { id_protocolo_establecimiento, id_paso } = req.params;
  const {
    nombre, descripcion, tipo_paso, plazo_valor, plazo_unidad,
    accion_al_vencer, es_paso_inicial, es_paso_final, orden_visual,
    por_involucrado_rol, requiere_acuse,
  } = req.body;

  const forma = validarPaso(req.body);
  if (forma) return res.status(400).json({ message: forma });

  const plazo = validarPlazo(plazo_valor, plazo_unidad);
  if (plazo.error) return res.status(400).json({ message: plazo.error });

  try {
    const pe = await buscarProtocoloEstablecimiento(id_protocolo_establecimiento, req.id_establecimiento);
    if (!pe) return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });

    const paso = await buscarPaso(id_paso, id_protocolo_establecimiento);
    if (!paso) return res.status(404).json({ message: 'Paso no encontrado en este protocolo' });

    if (es_paso_inicial) {
      const [ya] = await pool.query(
        `SELECT nombre FROM PROTOCOLO_ESTABLECIMIENTO_PASO
         WHERE id_protocolo_establecimiento = ? AND es_paso_inicial = 1 AND id_paso_estab <> ?`,
        [id_protocolo_establecimiento, id_paso]
      );
      if (ya.length > 0)
        return res.status(409).json({ message: `'${ya[0].nombre}' ya es el paso inicial. Desmárcalo primero.` });
    }

    if (paso.tipo_paso === 'formulario' && tipo_paso && tipo_paso !== 'formulario') {
      const [[{ c }]] = await pool.query(
        'SELECT COUNT(*) c FROM PROTOCOLO_ESTABLECIMIENTO_TRANSICION WHERE id_paso_origen = ? AND condicion IS NOT NULL',
        [id_paso]
      );
      if (c > 0)
        return res.status(409).json({
          message: `Hay ${c} transición(es) que dependen de los campos de este paso. Elimínalas antes de cambiarle el tipo.`,
        });
    }

    await pool.query(
      `UPDATE PROTOCOLO_ESTABLECIMIENTO_PASO
       SET nombre = ?, descripcion = ?, tipo_paso = ?, plazo_valor = ?, plazo_unidad = ?,
           accion_al_vencer = ?, es_paso_inicial = ?, es_paso_final = ?, orden_visual = ?,
           por_involucrado_rol = ?, requiere_acuse = ?
       WHERE id_paso_estab = ? AND id_protocolo_establecimiento = ?`,
      [
        nombre.trim(), descripcion?.trim() || null, tipo_paso || paso.tipo_paso,
        plazo.valor, plazo.unidad, accion_al_vencer || 'notificar',
        es_paso_inicial ? 1 : 0, es_paso_final ? 1 : 0, orden_visual ?? 0,
        por_involucrado_rol || null, requiere_acuse ? 1 : 0,
        id_paso, id_protocolo_establecimiento,
      ]
    );
    res.json({ message: 'Paso actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar el paso' });
  }
};

const eliminarPaso = async (req, res) => {
  const { id_protocolo_establecimiento, id_paso } = req.params;
  try {
    const pe = await buscarProtocoloEstablecimiento(id_protocolo_establecimiento, req.id_establecimiento);
    if (!pe) return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });

    const paso = await buscarPaso(id_paso, id_protocolo_establecimiento);
    if (!paso) return res.status(404).json({ message: 'Paso no encontrado en este protocolo' });

    const [[{ c: transiciones }]] = await pool.query(
      'SELECT COUNT(*) c FROM PROTOCOLO_ESTABLECIMIENTO_TRANSICION WHERE id_paso_origen = ? OR id_paso_destino = ?',
      [id_paso, id_paso]
    );
    await pool.query(
      'DELETE FROM PROTOCOLO_ESTABLECIMIENTO_PASO WHERE id_paso_estab = ? AND id_protocolo_establecimiento = ?',
      [id_paso, id_protocolo_establecimiento]
    );
    res.json({
      message: transiciones > 0
        ? `Paso eliminado junto con ${transiciones} transición(es) que lo conectaban`
        : 'Paso eliminado',
      transiciones_eliminadas: transiciones,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar el paso' });
  }
};

// ---------------------------------------------------------------------------
// Transiciones
// ---------------------------------------------------------------------------

const validarTransicion = async ({ id_protocolo_establecimiento, id_paso_origen, id_paso_destino, condicion, es_default, excluir }) => {
  const origen = await buscarPaso(id_paso_origen, id_protocolo_establecimiento);
  if (!origen) return 'El paso de origen no existe en este protocolo.';
  const destino = await buscarPaso(id_paso_destino, id_protocolo_establecimiento);
  if (!destino) return 'El paso de destino no existe en este protocolo.';

  // Volver al mismo paso es válido para "mantener el seguimiento otro ciclo",
  // pero solo bajo condición: una self-transición incondicional es un bucle
  // del que el caso no sale nunca.
  if (Number(id_paso_origen) === Number(id_paso_destino) && !condicion)
    return `La transición de '${origen.nombre}' a sí mismo necesita una condición: sin ella el protocolo quedaría en un bucle.`;
  if (origen.es_paso_final)
    return `'${origen.nombre}' es un paso final: no puede tener transiciones salientes.`;
  if (es_default && condicion)
    return 'Una transición por defecto no lleva condición: es la rama que se toma cuando ninguna se cumple.';

  if (es_default) {
    const [ya] = await pool.query(
      `SELECT id_transicion_estab FROM PROTOCOLO_ESTABLECIMIENTO_TRANSICION
       WHERE id_paso_origen = ? AND es_default = 1 AND id_transicion_estab <> ?`,
      [id_paso_origen, excluir ?? 0]
    );
    if (ya.length > 0)
      return `'${origen.nombre}' ya tiene una transición por defecto; solo puede haber una.`;
  }

  if (condicion) {
    const [filas] = await pool.query(
      'SELECT * FROM PROTOCOLO_ESTABLECIMIENTO_PASO_CAMPO WHERE id_paso_estab = ?',
      [id_paso_origen]
    );
    // Un paso de aprobación aporta su campo implícito 'aprobado'.
    const campos = camposDelPaso(origen, filas);
    if (campos.length === 0)
      return `'${origen.nombre}' no tiene campos definidos: no hay nada contra qué evaluar la condición.`;
    const problema = validarCondicion(condicion, campos);
    if (problema) return problema;
  }

  return null;
};

const crearTransicion = async (req, res) => {
  const { id_protocolo_establecimiento } = req.params;
  const { id_paso_origen, id_paso_destino, condicion, etiqueta, es_default } = req.body;

  if (!id_paso_origen || !id_paso_destino)
    return res.status(400).json({ message: 'id_paso_origen e id_paso_destino son requeridos' });

  try {
    const pe = await buscarProtocoloEstablecimiento(id_protocolo_establecimiento, req.id_establecimiento);
    if (!pe) return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });
    const bloqueo = await exigirEspejoEditable(pe);
    if (bloqueo) return res.status(409).json({ message: bloqueo });

    const problema = await validarTransicion({
      id_protocolo_establecimiento, id_paso_origen, id_paso_destino,
      condicion: condicion?.trim() || null, es_default,
    });
    if (problema) return res.status(409).json({ message: problema });

    const [result] = await pool.query(
      `INSERT INTO PROTOCOLO_ESTABLECIMIENTO_TRANSICION
         (id_protocolo_establecimiento, id_paso_origen, id_paso_destino, condicion, etiqueta, es_default)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id_protocolo_establecimiento, id_paso_origen, id_paso_destino,
        condicion?.trim() || null, etiqueta?.trim() || null, es_default ? 1 : 0,
      ]
    );
    res.status(201).json({ id_transicion_estab: result.insertId, message: 'Transición creada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al crear la transición' });
  }
};

const actualizarTransicion = async (req, res) => {
  const { id_protocolo_establecimiento, id_transicion } = req.params;
  const { id_paso_origen, id_paso_destino, condicion, etiqueta, es_default } = req.body;

  if (!id_paso_origen || !id_paso_destino)
    return res.status(400).json({ message: 'id_paso_origen e id_paso_destino son requeridos' });

  try {
    const pe = await buscarProtocoloEstablecimiento(id_protocolo_establecimiento, req.id_establecimiento);
    if (!pe) return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });

    const [existente] = await pool.query(
      `SELECT 1 FROM PROTOCOLO_ESTABLECIMIENTO_TRANSICION
       WHERE id_transicion_estab = ? AND id_protocolo_establecimiento = ?`,
      [id_transicion, id_protocolo_establecimiento]
    );
    if (existente.length === 0)
      return res.status(404).json({ message: 'Transición no encontrada en este protocolo' });

    const problema = await validarTransicion({
      id_protocolo_establecimiento, id_paso_origen, id_paso_destino,
      condicion: condicion?.trim() || null, es_default, excluir: id_transicion,
    });
    if (problema) return res.status(409).json({ message: problema });

    await pool.query(
      `UPDATE PROTOCOLO_ESTABLECIMIENTO_TRANSICION
       SET id_paso_origen = ?, id_paso_destino = ?, condicion = ?, etiqueta = ?, es_default = ?
       WHERE id_transicion_estab = ? AND id_protocolo_establecimiento = ?`,
      [
        id_paso_origen, id_paso_destino, condicion?.trim() || null,
        etiqueta?.trim() || null, es_default ? 1 : 0, id_transicion, id_protocolo_establecimiento,
      ]
    );
    res.json({ message: 'Transición actualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar la transición' });
  }
};

const eliminarTransicion = async (req, res) => {
  const { id_protocolo_establecimiento, id_transicion } = req.params;
  try {
    const pe = await buscarProtocoloEstablecimiento(id_protocolo_establecimiento, req.id_establecimiento);
    if (!pe) return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });

    const [result] = await pool.query(
      `DELETE FROM PROTOCOLO_ESTABLECIMIENTO_TRANSICION
       WHERE id_transicion_estab = ? AND id_protocolo_establecimiento = ?`,
      [id_transicion, id_protocolo_establecimiento]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ message: 'Transición no encontrada en este protocolo' });
    res.json({ message: 'Transición eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar la transición' });
  }
};

// ---------------------------------------------------------------------------
// Roles por paso
// ---------------------------------------------------------------------------

const reemplazarRoles = async (req, res) => {
  const { id_protocolo_establecimiento, id_paso } = req.params;
  const { roles } = req.body;

  if (!Array.isArray(roles))
    return res.status(400).json({ message: 'roles debe ser un arreglo de { rol_id, tipo_participacion }' });

  for (const r of roles) {
    if (!r?.rol_id) return res.status(400).json({ message: 'Cada rol necesita rol_id' });
    if (r.tipo_participacion && !TIPOS_PARTICIPACION.includes(r.tipo_participacion))
      return res.status(400).json({
        message: `tipo_participacion debe ser uno de: ${TIPOS_PARTICIPACION.join(', ')}.`,
      });
  }

  try {
    const pe = await buscarProtocoloEstablecimiento(id_protocolo_establecimiento, req.id_establecimiento);
    if (!pe) return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });

    const paso = await buscarPaso(id_paso, id_protocolo_establecimiento);
    if (!paso) return res.status(404).json({ message: 'Paso no encontrado en este protocolo' });

    // A diferencia del catálogo global, acá sí valen los roles propios del
    // colegio: es su copia y la ejecuta su gente. Lo que no puede es apuntar a
    // un rol de OTRO establecimiento.
    if (roles.length > 0) {
      const ids = [...new Set(roles.map((r) => Number(r.rol_id)))];
      const [validos] = await pool.query(
        'SELECT rol_id, nombre, id_establecimiento, activo FROM ROLES WHERE rol_id IN (?)',
        [ids]
      );
      const porId = new Map(validos.map((r) => [r.rol_id, r]));
      for (const id of ids) {
        const rol = porId.get(id);
        if (!rol) return res.status(404).json({ message: `El rol ${id} no existe.` });
        if (rol.id_establecimiento !== null && rol.id_establecimiento !== req.id_establecimiento)
          return res.status(404).json({ message: `El rol ${id} no existe.` });
        if (!rol.activo) return res.status(409).json({ message: `El rol '${rol.nombre}' está inactivo.` });
      }
    }

    if (paso.tipo_paso === 'aprobacion' && !roles.some((r) => (r.tipo_participacion ?? 'ejecutor') === 'aprobador'))
      return res.status(409).json({
        message: 'Un paso de tipo aprobación necesita al menos un rol con tipo_participacion = aprobador.',
      });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM PROTOCOLO_ESTABLECIMIENTO_PASO_ROL WHERE id_paso_estab = ?', [id_paso]);
      if (roles.length > 0)
        await conn.query(
          'INSERT INTO PROTOCOLO_ESTABLECIMIENTO_PASO_ROL (id_paso_estab, rol_id, tipo_participacion) VALUES ?',
          [roles.map((r) => [id_paso, r.rol_id, r.tipo_participacion || 'ejecutor'])]
        );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    res.json({ message: 'Roles del paso actualizados', total: roles.length });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'Hay un rol repetido con el mismo tipo de participación.' });
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar los roles del paso' });
  }
};

// ---------------------------------------------------------------------------
// Campos por paso
// ---------------------------------------------------------------------------

const crearCampo = async (req, res) => {
  const { id_protocolo_establecimiento, id_paso } = req.params;
  const { codigo, etiqueta, tipo_campo, opciones, es_obligatorio, depende_de, orden } = req.body;

  const problema = validarCampo(req.body);
  if (problema) return res.status(400).json({ message: problema });

  try {
    const pe = await buscarProtocoloEstablecimiento(id_protocolo_establecimiento, req.id_establecimiento);
    if (!pe) return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });

    const paso = await buscarPaso(id_paso, id_protocolo_establecimiento);
    if (!paso) return res.status(404).json({ message: 'Paso no encontrado en este protocolo' });

    // La dependencia se valida contra los campos que ya tiene el paso: apunta a
    // uno de ellos, y sin eso el campo quedaría escondido para siempre.
    const [hermanos] = await pool.query(
      'SELECT * FROM PROTOCOLO_ESTABLECIMIENTO_PASO_CAMPO WHERE id_paso_estab = ?', [id_paso]
    );
    const malaDependencia = validarDependencia(depende_de, codigo.trim(), hermanos);
    if (malaDependencia) return res.status(400).json({ message: malaDependencia });

    const [result] = await pool.query(
      `INSERT INTO PROTOCOLO_ESTABLECIMIENTO_PASO_CAMPO
         (id_paso_estab, codigo, etiqueta, tipo_campo, opciones, es_obligatorio, depende_de, orden)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id_paso, codigo.trim(), etiqueta.trim(), tipo_campo,
        tipo_campo === 'seleccion' ? JSON.stringify(normalizarOpciones(opciones)) : null,
        es_obligatorio ? 1 : 0, depende_de?.trim() || null, orden ?? 0,
      ]
    );
    res.status(201).json({ id_campo_estab: result.insertId, message: 'Campo creado' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'Ya existe un campo con ese código en este paso.' });
    console.error(err);
    res.status(500).json({ message: 'Error al crear el campo' });
  }
};

const actualizarCampo = async (req, res) => {
  const { id_protocolo_establecimiento, id_paso, id_campo } = req.params;
  const { codigo, etiqueta, tipo_campo, opciones, es_obligatorio, depende_de, orden } = req.body;

  const problema = validarCampo(req.body);
  if (problema) return res.status(400).json({ message: problema });

  try {
    const pe = await buscarProtocoloEstablecimiento(id_protocolo_establecimiento, req.id_establecimiento);
    if (!pe) return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });

    const paso = await buscarPaso(id_paso, id_protocolo_establecimiento);
    if (!paso) return res.status(404).json({ message: 'Paso no encontrado en este protocolo' });

    const [actual] = await pool.query(
      'SELECT * FROM PROTOCOLO_ESTABLECIMIENTO_PASO_CAMPO WHERE id_campo_estab = ? AND id_paso_estab = ?',
      [id_campo, id_paso]
    );
    if (actual.length === 0) return res.status(404).json({ message: 'Campo no encontrado en este paso' });

    const [otros] = await pool.query(
      'SELECT * FROM PROTOCOLO_ESTABLECIMIENTO_PASO_CAMPO WHERE id_paso_estab = ? AND id_campo_estab <> ?',
      [id_paso, id_campo]
    );
    const malaDependencia = validarDependencia(depende_de, codigo.trim(), otros);
    if (malaDependencia) return res.status(400).json({ message: malaDependencia });

    // Renombrar este campo también puede dejar colgada la dependencia de otro
    // que lo apunta: se revisa antes de tocarlo, igual que con las transiciones.
    const rotos = otros.filter(
      (c) => c.depende_de && validarDependencia(c.depende_de, c.codigo, [
        ...otros.filter((o) => o.codigo !== c.codigo),
        { codigo: codigo.trim(), tipo_campo, opciones: normalizarOpciones(opciones) },
      ])
    );
    if (rotos.length > 0)
      return res.status(409).json({
        message: `El cambio rompe la dependencia de '${rotos[0].etiqueta}' ('${rotos[0].depende_de}').`,
      });

    const [salientes] = await pool.query(
      `SELECT id_transicion_estab, condicion FROM PROTOCOLO_ESTABLECIMIENTO_TRANSICION
       WHERE id_paso_origen = ? AND condicion IS NOT NULL`,
      [id_paso]
    );
    if (salientes.length > 0) {
      const propuesto = [
        ...otros,
        { codigo: codigo.trim(), tipo_campo, opciones: normalizarOpciones(opciones) },
      ];
      for (const t of salientes) {
        const err = validarCondicion(t.condicion, propuesto);
        if (err)
          return res.status(409).json({
            message: `El cambio rompe la transición ${t.id_transicion_estab} ('${t.condicion}'): ${err}`,
          });
      }
    }

    await pool.query(
      `UPDATE PROTOCOLO_ESTABLECIMIENTO_PASO_CAMPO
       SET codigo = ?, etiqueta = ?, tipo_campo = ?, opciones = ?, es_obligatorio = ?,
           depende_de = ?, orden = ?
       WHERE id_campo_estab = ? AND id_paso_estab = ?`,
      [
        codigo.trim(), etiqueta.trim(), tipo_campo,
        tipo_campo === 'seleccion' ? JSON.stringify(normalizarOpciones(opciones)) : null,
        es_obligatorio ? 1 : 0, depende_de?.trim() || null, orden ?? 0, id_campo, id_paso,
      ]
    );
    res.json({ message: 'Campo actualizado' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'Ya existe un campo con ese código en este paso.' });
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar el campo' });
  }
};

const eliminarCampo = async (req, res) => {
  const { id_protocolo_establecimiento, id_paso, id_campo } = req.params;
  try {
    const pe = await buscarProtocoloEstablecimiento(id_protocolo_establecimiento, req.id_establecimiento);
    if (!pe) return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });

    const paso = await buscarPaso(id_paso, id_protocolo_establecimiento);
    if (!paso) return res.status(404).json({ message: 'Paso no encontrado en este protocolo' });

    const [campo] = await pool.query(
      'SELECT codigo FROM PROTOCOLO_ESTABLECIMIENTO_PASO_CAMPO WHERE id_campo_estab = ? AND id_paso_estab = ?',
      [id_campo, id_paso]
    );
    if (campo.length === 0) return res.status(404).json({ message: 'Campo no encontrado en este paso' });

    const [salientes] = await pool.query(
      `SELECT condicion FROM PROTOCOLO_ESTABLECIMIENTO_TRANSICION
       WHERE id_paso_origen = ? AND condicion IS NOT NULL`,
      [id_paso]
    );
    const enUso = salientes.filter(
      (t) => t.condicion.startsWith(`${campo[0].codigo}=`) || t.condicion.startsWith(`${campo[0].codigo}!=`)
    );
    if (enUso.length > 0)
      return res.status(409).json({
        message: `El campo '${campo[0].codigo}' se usa en ${enUso.length} transición(es) (${enUso.map((t) => t.condicion).join(', ')}). Elimínalas primero.`,
      });

    // Mismo problema con los campos que dependen de este: la dependencia
    // también guarda el código como texto. Si se borra, el dependiente deja de
    // mostrarse para siempre y sin ningún aviso.
    const [dependientes] = await pool.query(
      `SELECT etiqueta, depende_de FROM PROTOCOLO_ESTABLECIMIENTO_PASO_CAMPO
        WHERE id_paso_estab = ? AND id_campo_estab <> ? AND depende_de IS NOT NULL`,
      [id_paso, id_campo]
    );
    const colgados = dependientes.filter((c) => parsearCondicion(c.depende_de)?.campo === campo[0].codigo);
    if (colgados.length > 0)
      return res.status(409).json({
        message: `'${colgados[0].etiqueta}' solo se pregunta si se cumple '${colgados[0].depende_de}'. ` +
                 `Quita esa dependencia antes de eliminar el campo.`,
      });

    await pool.query(
      'DELETE FROM PROTOCOLO_ESTABLECIMIENTO_PASO_CAMPO WHERE id_campo_estab = ? AND id_paso_estab = ?',
      [id_campo, id_paso]
    );
    res.json({ message: 'Campo eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar el campo' });
  }
};

// ---------------------------------------------------------------------------
// Validar
// ---------------------------------------------------------------------------

// El espejo no tiene estado publicado/borrador como el catálogo: el colegio no
// "publica" su copia, la ejecuta. La coherencia se comprueba acá para poder
// mostrársela mientras edita, y la activación vuelve a comprobarla antes de
// materializar el grafo en un caso.
const validar = async (req, res) => {
  const { id_protocolo_establecimiento } = req.params;
  try {
    const pe = await buscarProtocoloEstablecimiento(id_protocolo_establecimiento, req.id_establecimiento);
    if (!pe) return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });

    const origen = await origenDelGrafo(pe);
    if (origen === CATALOGO)
      return res.json({
        origen,
        activable: pe.estado_flujo === 'publicado',
        problemas: [],
        mensaje: 'El flujo se hereda del catálogo: su coherencia la valida el ADMIN al publicarlo.',
      });
    if (origen === VACIO)
      return res.json({ origen, activable: false, problemas: ['El protocolo todavía no tiene ningún paso definido.'] });

    const [pasos] = await pool.query(SELECT_PASOS, [id_protocolo_establecimiento]);
    const [transiciones] = await pool.query(SELECT_TRANSICIONES, [id_protocolo_establecimiento]);
    const [campos] = await pool.query(
      `SELECT c.* FROM PROTOCOLO_ESTABLECIMIENTO_PASO_CAMPO c
       JOIN PROTOCOLO_ESTABLECIMIENTO_PASO p ON p.id_paso_estab = c.id_paso_estab
       WHERE p.id_protocolo_establecimiento = ?`,
      [id_protocolo_establecimiento]
    );
    const [roles] = await pool.query(
      `SELECT pr.* FROM PROTOCOLO_ESTABLECIMIENTO_PASO_ROL pr
       JOIN PROTOCOLO_ESTABLECIMIENTO_PASO p ON p.id_paso_estab = pr.id_paso_estab
       WHERE p.id_protocolo_establecimiento = ?`,
      [id_protocolo_establecimiento]
    );

    const problemas = validarGrafo(pasos, transiciones, campos);

    // El techo legal también se comprueba acá, no solo sobre el catálogo.
    // Faltaba: un establecimiento podía personalizar los plazos de un protocolo
    // hasta pasarse de los 2 meses del art. 16 E letra g y activarlo igual,
    // porque la única validación del techo vivía en protocoloFlujo.controller
    // (el catálogo genérico), que es justamente el grafo que el colegio deja de
    // usar en cuanto lo personaliza.
    problemas.push(...validarTechoLegal(pasos, transiciones, pe.ambito));

    for (const t of transiciones.filter((t) => t.condicion)) {
      const paso = pasos.find((p) => p.id_paso === t.id_paso_origen);
      const err = validarCondicion(
        t.condicion,
        camposDelPaso(paso, campos.filter((c) => c.id_paso_estab === t.id_paso_origen))
      );
      if (err) problemas.push(`Transición desde '${paso?.nombre ?? t.id_paso_origen}': ${err}`);
    }

    for (const p of pasos) {
      const delPaso = roles.filter((r) => r.id_paso_estab === p.id_paso_estab);
      if (!delPaso.some((r) => r.tipo_participacion === 'ejecutor'))
        problemas.push(`El paso '${p.nombre}' no tiene ningún rol ejecutor asignado.`);
      if (p.tipo_paso === 'aprobacion' && !delPaso.some((r) => r.tipo_participacion === 'aprobador'))
        problemas.push(`El paso de aprobación '${p.nombre}' no tiene ningún rol aprobador.`);
      if (p.tipo_paso === 'formulario' && !campos.some((c) => c.id_paso_estab === p.id_paso_estab))
        problemas.push(`El paso de formulario '${p.nombre}' no tiene campos definidos.`);
    }

    res.json({ origen, activable: problemas.length === 0, problemas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al validar el flujo' });
  }
};

module.exports = {
  getGrafo,
  personalizar, restaurar,
  crearPaso, actualizarPaso, eliminarPaso,
  crearTransicion, actualizarTransicion, eliminarTransicion,
  reemplazarRoles,
  crearCampo, actualizarCampo, eliminarCampo,
  validar,
};
