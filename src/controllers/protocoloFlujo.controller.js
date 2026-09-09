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
  normalizarOpciones,
  normalizarMedidaRequerida,
  validarTechoLegal,
  esPasoDeAprobacion,
} = require('../utils/flujoProtocolo');
const {
  DIALECTO_CATALOGO,
  guardarPasoCompleto,
  mensajeDeError,
  anidarGrafo,
} = require('../utils/guardarPasoFlujo');

// CRUD del grafo de un protocolo del catálogo global: pasos, transiciones,
// roles por paso y campos por paso. Todo cuelga de /:id_protocolo, así que el
// protocolo se resuelve una sola vez en cada handler y no hay forma de tocar
// un paso de otro protocolo por id suelto.
//
// Editar la plantilla es seguro aunque haya casos abiertos: al activar, el
// grafo se materializa en las tablas de ejecución, y un caso vivo nunca vuelve
// a leer de acá. Lo único que se hereda en vivo es el texto del protocolo.

const existeProtocolo = async (id_protocolo) => {
  const [rows] = await pool.query(
    'SELECT id_protocolo, nombre, estado_flujo FROM CATALOGO_PROTOCOLOS_GENERICOS WHERE id_protocolo = ?',
    [id_protocolo]
  );
  return rows[0] ?? null;
};

const buscarPaso = async (id_paso, id_protocolo) => {
  const [rows] = await pool.query(
    'SELECT * FROM CATALOGO_PROTOCOLO_PASO WHERE id_paso = ? AND id_protocolo = ?',
    [id_paso, id_protocolo]
  );
  return rows[0] ?? null;
};

// Cualquier cambio estructural invalida la publicación: el grafo que se validó
// ya no es el que está guardado. Se vuelve a borrador en vez de dejar un
// protocolo marcado como publicado que nadie volvió a revisar.
const volverABorrador = (id_protocolo) =>
  pool.query(
    `UPDATE CATALOGO_PROTOCOLOS_GENERICOS
     SET estado_flujo = 'borrador', fecha_publicacion = NULL
     WHERE id_protocolo = ? AND estado_flujo = 'publicado'`,
    [id_protocolo]
  );

// ---------------------------------------------------------------------------
// Grafo completo
// ---------------------------------------------------------------------------

// Una sola llamada devuelve todo lo que el editor necesita dibujar. Son cuatro
// consultas planas en vez de un join con cuatro niveles de multiplicación de
// filas que después habría que desarmar en memoria.
const getGrafo = async (req, res) => {
  const { id_protocolo } = req.params;
  try {
    const protocolo = await existeProtocolo(id_protocolo);
    if (!protocolo) return res.status(404).json({ message: 'Protocolo genérico no encontrado' });

    const [pasos] = await pool.query(
      'SELECT * FROM CATALOGO_PROTOCOLO_PASO WHERE id_protocolo = ? ORDER BY orden_visual, id_paso',
      [id_protocolo]
    );
    const [transiciones] = await pool.query(
      'SELECT * FROM CATALOGO_PROTOCOLO_TRANSICION WHERE id_protocolo = ? ORDER BY id_paso_origen, es_default, id_transicion',
      [id_protocolo]
    );
    const [roles] = await pool.query(
      `SELECT pr.*, r.nombre AS rol_nombre, r.codigo AS rol_codigo
       FROM CATALOGO_PROTOCOLO_PASO_ROL pr
       JOIN CATALOGO_PROTOCOLO_PASO p ON p.id_paso = pr.id_paso
       JOIN ROLES r ON r.rol_id = pr.rol_id
       WHERE p.id_protocolo = ?`,
      [id_protocolo]
    );
    const [campos] = await pool.query(
      `SELECT c.* FROM CATALOGO_PROTOCOLO_PASO_CAMPO c
       JOIN CATALOGO_PROTOCOLO_PASO p ON p.id_paso = c.id_paso
       WHERE p.id_protocolo = ? ORDER BY c.orden, c.id_campo`,
      [id_protocolo]
    );

    res.json({
      protocolo,
      pasos: pasos.map((p) => ({
        ...p,
        roles: roles.filter((r) => r.id_paso === p.id_paso),
        campos: campos.filter((c) => c.id_paso === p.id_paso),
      })),
      transiciones,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el flujo del protocolo' });
  }
};

// ---------------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------------

const crearPaso = async (req, res) => {
  const { id_protocolo } = req.params;
  const {
    nombre, descripcion, tipo_paso, plazo_valor, plazo_unidad,
    accion_al_vencer, es_paso_inicial, es_paso_final, orden_visual,
    por_involucrado_rol, requiere_notificacion, requiere_medida, tipo_medida_requerida,
  } = req.body;

  const forma = validarPaso(req.body);
  if (forma) return res.status(400).json({ message: forma });

  const plazo = validarPlazo(plazo_valor, plazo_unidad);
  if (plazo.error) return res.status(400).json({ message: plazo.error });

  try {
    if (!(await existeProtocolo(id_protocolo)))
      return res.status(404).json({ message: 'Protocolo genérico no encontrado' });

    // El paso inicial es el punto de arranque del motor: dos serían ambiguos.
    // Se rechaza en vez de desmarcar el otro en silencio, porque cuál de los
    // dos debe quedar es una decisión del ADMIN, no del servidor.
    if (es_paso_inicial) {
      const [ya] = await pool.query(
        'SELECT nombre FROM CATALOGO_PROTOCOLO_PASO WHERE id_protocolo = ? AND es_paso_inicial = 1',
        [id_protocolo]
      );
      if (ya.length > 0)
        return res.status(409).json({ message: `'${ya[0].nombre}' ya es el paso inicial. Desmárcalo primero.` });
    }

    const [result] = await pool.query(
      `INSERT INTO CATALOGO_PROTOCOLO_PASO
         (id_protocolo, nombre, descripcion, tipo_paso, plazo_valor, plazo_unidad,
          accion_al_vencer, es_paso_inicial, es_paso_final, orden_visual,
          por_involucrado_rol, requiere_notificacion, requiere_medida, tipo_medida_requerida)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id_protocolo, nombre.trim(), descripcion?.trim() || null,
        tipo_paso || 'informativo', plazo.valor, plazo.unidad,
        accion_al_vencer || 'notificar',
        es_paso_inicial ? 1 : 0, es_paso_final ? 1 : 0, orden_visual ?? 0,
        por_involucrado_rol || null, requiere_notificacion ? 1 : 0, requiere_medida ? 1 : 0,
        normalizarMedidaRequerida(req.body),
      ]
    );
    await volverABorrador(id_protocolo);
    res.status(201).json({ id_paso: result.insertId, message: 'Paso creado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al crear el paso' });
  }
};

const actualizarPaso = async (req, res) => {
  const { id_protocolo, id_paso } = req.params;
  const {
    nombre, descripcion, tipo_paso, plazo_valor, plazo_unidad,
    accion_al_vencer, es_paso_inicial, es_paso_final, orden_visual,
    por_involucrado_rol, requiere_notificacion, requiere_medida, tipo_medida_requerida,
  } = req.body;

  const forma = validarPaso(req.body);
  if (forma) return res.status(400).json({ message: forma });

  const plazo = validarPlazo(plazo_valor, plazo_unidad);
  if (plazo.error) return res.status(400).json({ message: plazo.error });

  try {
    const paso = await buscarPaso(id_paso, id_protocolo);
    if (!paso) return res.status(404).json({ message: 'Paso no encontrado en este protocolo' });

    if (es_paso_inicial) {
      const [ya] = await pool.query(
        'SELECT nombre FROM CATALOGO_PROTOCOLO_PASO WHERE id_protocolo = ? AND es_paso_inicial = 1 AND id_paso <> ?',
        [id_protocolo, id_paso]
      );
      if (ya.length > 0)
        return res.status(409).json({ message: `'${ya[0].nombre}' ya es el paso inicial. Desmárcalo primero.` });
    }


    await pool.query(
      `UPDATE CATALOGO_PROTOCOLO_PASO
       SET nombre = ?, descripcion = ?, tipo_paso = ?, plazo_valor = ?, plazo_unidad = ?,
           accion_al_vencer = ?, es_paso_inicial = ?, es_paso_final = ?, orden_visual = ?,
           por_involucrado_rol = ?, requiere_notificacion = ?, requiere_medida = ?,
           tipo_medida_requerida = ?
       WHERE id_paso = ? AND id_protocolo = ?`,
      [
        nombre.trim(), descripcion?.trim() || null, tipo_paso || paso.tipo_paso,
        plazo.valor, plazo.unidad, accion_al_vencer || 'notificar',
        es_paso_inicial ? 1 : 0, es_paso_final ? 1 : 0, orden_visual ?? 0,
        por_involucrado_rol || null, requiere_notificacion ? 1 : 0, requiere_medida ? 1 : 0,
        normalizarMedidaRequerida(req.body),
        id_paso, id_protocolo,
      ]
    );
    await volverABorrador(id_protocolo);
    res.json({ message: 'Paso actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar el paso' });
  }
};

// Guarda el paso entero de una vez: sus datos, sus responsables, sus preguntas
// y sus salidas, en una transacción. Los endpoints de a uno de más abajo siguen
// existiendo (los usa el diagrama para mover o borrar cosas sueltas), pero el
// formulario del paso guarda por acá: con la base a ~270 ms por consulta, hacer
// nueve requests seguidos costaba quince segundos y podía dejar el paso a medio
// escribir si uno de los últimos fallaba.
const guardarPasoCompletoGenerico = async (req, res) => {
  const { id_protocolo, id_paso } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[protocolo]] = await conn.query(
      'SELECT id_protocolo, nombre, estado_flujo FROM CATALOGO_PROTOCOLOS_GENERICOS WHERE id_protocolo = ?',
      [id_protocolo]
    );
    if (!protocolo) {
      await conn.rollback();
      return res.status(404).json({ message: 'Protocolo genérico no encontrado' });
    }

    const { id_paso: idPaso, grafo } = await guardarPasoCompleto({
      conn,
      dialecto: DIALECTO_CATALOGO,
      idProtocolo: Number(id_protocolo),
      idPaso: id_paso ? Number(id_paso) : null,
      cuerpo: req.body,
      // El catálogo es global: solo puede referenciar roles globales. Un rol de
      // un colegio en la plantilla estándar significaría una plantilla que no se
      // puede ejecutar en ningún otro establecimiento.
      validarRol: (rol) => {
        if (rol.id_establecimiento !== null)
          return `'${rol.nombre}' es un rol de un establecimiento. El catálogo global solo admite roles globales.`;
        if (!rol.activo) return `El rol '${rol.nombre}' está inactivo.`;
        return null;
      },
    });

    // Cualquier cambio estructural invalida la publicación, igual que en los
    // endpoints de a uno; acá se escribe una sola vez y no nueve.
    await conn.query(
      `UPDATE CATALOGO_PROTOCOLOS_GENERICOS
       SET estado_flujo = 'borrador', fecha_publicacion = NULL
       WHERE id_protocolo = ? AND estado_flujo = 'publicado'`,
      [id_protocolo]
    );

    await conn.commit();
    res.json({
      message: id_paso ? 'Paso actualizado' : 'Paso creado',
      id_paso: idPaso,
      grafo: {
        protocolo: { ...protocolo, estado_flujo: 'borrador' },
        ...anidarGrafo(grafo),
      },
    });
  } catch (err) {
    await conn.rollback();
    const conocido = mensajeDeError(err);
    if (conocido) return res.status(conocido.status).json({ message: conocido.message });
    console.error(err);
    res.status(500).json({ message: 'Error al guardar el paso' });
  } finally {
    conn.release();
  }
};

// Borrar un paso arrastra en cascada sus transiciones, roles y campos. La
// cascada la hace la BD; acá se cuentan antes para poder decir qué se llevó
// por delante, en vez de que el ADMIN descubra después que perdió aristas.
const eliminarPaso = async (req, res) => {
  const { id_protocolo, id_paso } = req.params;
  try {
    const paso = await buscarPaso(id_paso, id_protocolo);
    if (!paso) return res.status(404).json({ message: 'Paso no encontrado en este protocolo' });

    const [[{ c: transiciones }]] = await pool.query(
      'SELECT COUNT(*) c FROM CATALOGO_PROTOCOLO_TRANSICION WHERE id_paso_origen = ? OR id_paso_destino = ?',
      [id_paso, id_paso]
    );
    await pool.query('DELETE FROM CATALOGO_PROTOCOLO_PASO WHERE id_paso = ? AND id_protocolo = ?', [
      id_paso, id_protocolo,
    ]);
    await volverABorrador(id_protocolo);
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

// Reglas comunes a crear y actualizar. Devuelve un mensaje de error o null.
const validarTransicion = async ({ id_protocolo, id_paso_origen, id_paso_destino, condicion, es_default, excluir }) => {
  const origen = await buscarPaso(id_paso_origen, id_protocolo);
  if (!origen) return 'El paso de origen no existe en este protocolo.';
  const destino = await buscarPaso(id_paso_destino, id_protocolo);
  if (!destino) return 'El paso de destino no existe en este protocolo.';

  // Volver al mismo paso es válido para "mantener el seguimiento otro ciclo",
  // pero solo bajo condición: una self-transición incondicional es un bucle
  // del que el caso no sale nunca.
  if (Number(id_paso_origen) === Number(id_paso_destino) && !condicion)
    return `La transición de '${origen.nombre}' a sí mismo necesita una condición: sin ella el protocolo quedaría en un bucle.`;

  if (origen.es_paso_final)
    return `'${origen.nombre}' es un paso final: no puede tener transiciones salientes.`;

  // La rama por defecto es la que se toma cuando ninguna condición se cumple.
  // Si además tuviera condición, no sería el escape de nada.
  if (es_default && condicion)
    return 'Una transición por defecto no lleva condición: es la rama que se toma cuando ninguna se cumple.';

  if (es_default) {
    const [ya] = await pool.query(
      `SELECT id_transicion FROM CATALOGO_PROTOCOLO_TRANSICION
       WHERE id_paso_origen = ? AND es_default = 1 AND id_transicion <> ?`,
      [id_paso_origen, excluir ?? 0]
    );
    if (ya.length > 0)
      return `'${origen.nombre}' ya tiene una transición por defecto; solo puede haber una.`;
  }

  if (condicion) {
    const [filas] = await pool.query(
      'SELECT * FROM CATALOGO_PROTOCOLO_PASO_CAMPO WHERE id_paso = ?',
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
  const { id_protocolo } = req.params;
  const { id_paso_origen, id_paso_destino, condicion, etiqueta, es_default } = req.body;

  if (!id_paso_origen || !id_paso_destino)
    return res.status(400).json({ message: 'id_paso_origen e id_paso_destino son requeridos' });

  try {
    if (!(await existeProtocolo(id_protocolo)))
      return res.status(404).json({ message: 'Protocolo genérico no encontrado' });

    const problema = await validarTransicion({
      id_protocolo, id_paso_origen, id_paso_destino,
      condicion: condicion?.trim() || null, es_default,
    });
    if (problema) return res.status(409).json({ message: problema });

    const [result] = await pool.query(
      `INSERT INTO CATALOGO_PROTOCOLO_TRANSICION
         (id_protocolo, id_paso_origen, id_paso_destino, condicion, etiqueta, es_default)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id_protocolo, id_paso_origen, id_paso_destino,
        condicion?.trim() || null, etiqueta?.trim() || null, es_default ? 1 : 0,
      ]
    );
    await volverABorrador(id_protocolo);
    res.status(201).json({ id_transicion: result.insertId, message: 'Transición creada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al crear la transición' });
  }
};

const actualizarTransicion = async (req, res) => {
  const { id_protocolo, id_transicion } = req.params;
  const { id_paso_origen, id_paso_destino, condicion, etiqueta, es_default } = req.body;

  if (!id_paso_origen || !id_paso_destino)
    return res.status(400).json({ message: 'id_paso_origen e id_paso_destino son requeridos' });

  try {
    const [existente] = await pool.query(
      'SELECT 1 FROM CATALOGO_PROTOCOLO_TRANSICION WHERE id_transicion = ? AND id_protocolo = ?',
      [id_transicion, id_protocolo]
    );
    if (existente.length === 0)
      return res.status(404).json({ message: 'Transición no encontrada en este protocolo' });

    const problema = await validarTransicion({
      id_protocolo, id_paso_origen, id_paso_destino,
      condicion: condicion?.trim() || null, es_default, excluir: id_transicion,
    });
    if (problema) return res.status(409).json({ message: problema });

    await pool.query(
      `UPDATE CATALOGO_PROTOCOLO_TRANSICION
       SET id_paso_origen = ?, id_paso_destino = ?, condicion = ?, etiqueta = ?, es_default = ?
       WHERE id_transicion = ? AND id_protocolo = ?`,
      [
        id_paso_origen, id_paso_destino, condicion?.trim() || null,
        etiqueta?.trim() || null, es_default ? 1 : 0, id_transicion, id_protocolo,
      ]
    );
    await volverABorrador(id_protocolo);
    res.json({ message: 'Transición actualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar la transición' });
  }
};

const eliminarTransicion = async (req, res) => {
  const { id_protocolo, id_transicion } = req.params;
  try {
    const [result] = await pool.query(
      'DELETE FROM CATALOGO_PROTOCOLO_TRANSICION WHERE id_transicion = ? AND id_protocolo = ?',
      [id_transicion, id_protocolo]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ message: 'Transición no encontrada en este protocolo' });
    await volverABorrador(id_protocolo);
    res.json({ message: 'Transición eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar la transición' });
  }
};

// ---------------------------------------------------------------------------
// Roles por paso
// ---------------------------------------------------------------------------

// Se reemplaza el set completo en vez de exponer alta y baja por separado: la
// pantalla que lo edita muestra todos los roles del paso a la vez, y mandar el
// estado final evita el ida y vuelta de calcular qué cambió en el cliente.
const reemplazarRoles = async (req, res) => {
  const { id_protocolo, id_paso } = req.params;
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
    const paso = await buscarPaso(id_paso, id_protocolo);
    if (!paso) return res.status(404).json({ message: 'Paso no encontrado en este protocolo' });

    // El catálogo es global: solo puede referenciar roles globales. Un rol de
    // un colegio en la plantilla estándar significaría una plantilla que no se
    // puede ejecutar en ningún otro establecimiento.
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
        if (rol.id_establecimiento !== null)
          return res.status(409).json({
            message: `'${rol.nombre}' es un rol de un establecimiento. El catálogo global solo admite roles globales.`,
          });
        if (!rol.activo)
          return res.status(409).json({ message: `El rol '${rol.nombre}' está inactivo.` });
      }
    }

    // Un paso de aprobación sin aprobador no se puede completar nunca.
    if (esPasoDeAprobacion(paso.tipo_paso) && !roles.some((r) => (r.tipo_participacion ?? 'ejecutor') === 'aprobador'))
      return res.status(409).json({
        message: 'Un paso de tipo aprobación necesita al menos un rol con tipo_participacion = aprobador.',
      });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM CATALOGO_PROTOCOLO_PASO_ROL WHERE id_paso = ?', [id_paso]);
      if (roles.length > 0)
        await conn.query(
          'INSERT INTO CATALOGO_PROTOCOLO_PASO_ROL (id_paso, rol_id, tipo_participacion) VALUES ?',
          [roles.map((r) => [id_paso, r.rol_id, r.tipo_participacion || 'ejecutor'])]
        );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await volverABorrador(id_protocolo);
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
  const { id_protocolo, id_paso } = req.params;
  const { codigo, etiqueta, tipo_campo, opciones, es_obligatorio, depende_de, orden } = req.body;

  const problema = validarCampo(req.body);
  if (problema) return res.status(400).json({ message: problema });

  try {
    const paso = await buscarPaso(id_paso, id_protocolo);
    if (!paso) return res.status(404).json({ message: 'Paso no encontrado en este protocolo' });

    // La dependencia se valida contra los campos que ya tiene el paso: apunta a
    // uno de ellos, y sin eso el campo quedaría escondido para siempre.
    const [hermanos] = await pool.query(
      'SELECT * FROM CATALOGO_PROTOCOLO_PASO_CAMPO WHERE id_paso = ?', [id_paso]
    );
    const malaDependencia = validarDependencia(depende_de, codigo.trim(), hermanos);
    if (malaDependencia) return res.status(400).json({ message: malaDependencia });

    const [result] = await pool.query(
      `INSERT INTO CATALOGO_PROTOCOLO_PASO_CAMPO
         (id_paso, codigo, etiqueta, tipo_campo, opciones, es_obligatorio, depende_de, orden)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id_paso, codigo.trim(), etiqueta.trim(), tipo_campo,
        tipo_campo === 'seleccion' ? JSON.stringify(normalizarOpciones(opciones)) : null,
        es_obligatorio ? 1 : 0, depende_de?.trim() || null, orden ?? 0,
      ]
    );
    await volverABorrador(id_protocolo);
    res.status(201).json({ id_campo: result.insertId, message: 'Campo creado' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'Ya existe un campo con ese código en este paso.' });
    console.error(err);
    res.status(500).json({ message: 'Error al crear el campo' });
  }
};

const actualizarCampo = async (req, res) => {
  const { id_protocolo, id_paso, id_campo } = req.params;
  const { codigo, etiqueta, tipo_campo, opciones, es_obligatorio, depende_de, orden } = req.body;

  const problema = validarCampo(req.body);
  if (problema) return res.status(400).json({ message: problema });

  try {
    const paso = await buscarPaso(id_paso, id_protocolo);
    if (!paso) return res.status(404).json({ message: 'Paso no encontrado en este protocolo' });

    const [actual] = await pool.query(
      'SELECT * FROM CATALOGO_PROTOCOLO_PASO_CAMPO WHERE id_campo = ? AND id_paso = ?',
      [id_campo, id_paso]
    );
    if (actual.length === 0) return res.status(404).json({ message: 'Campo no encontrado en este paso' });

    // Renombrar el código o cambiar el tipo/las opciones puede dejar colgadas
    // las condiciones que lo usan. Se revalidan todas contra cómo quedaría el
    // campo: si alguna deja de ser válida, se rechaza el cambio en vez de
    // romper el grafo por un lado que el ADMIN no está mirando.
    const [otros] = await pool.query(
      'SELECT * FROM CATALOGO_PROTOCOLO_PASO_CAMPO WHERE id_paso = ? AND id_campo <> ?',
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
      'SELECT id_transicion, condicion FROM CATALOGO_PROTOCOLO_TRANSICION WHERE id_paso_origen = ? AND condicion IS NOT NULL',
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
            message: `El cambio rompe la transición ${t.id_transicion} ('${t.condicion}'): ${err}`,
          });
      }
    }

    await pool.query(
      `UPDATE CATALOGO_PROTOCOLO_PASO_CAMPO
       SET codigo = ?, etiqueta = ?, tipo_campo = ?, opciones = ?, es_obligatorio = ?,
           depende_de = ?, orden = ?
       WHERE id_campo = ? AND id_paso = ?`,
      [
        codigo.trim(), etiqueta.trim(), tipo_campo,
        tipo_campo === 'seleccion' ? JSON.stringify(normalizarOpciones(opciones)) : null,
        es_obligatorio ? 1 : 0, depende_de?.trim() || null, orden ?? 0, id_campo, id_paso,
      ]
    );
    await volverABorrador(id_protocolo);
    res.json({ message: 'Campo actualizado' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'Ya existe un campo con ese código en este paso.' });
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar el campo' });
  }
};

const eliminarCampo = async (req, res) => {
  const { id_protocolo, id_paso, id_campo } = req.params;
  try {
    const paso = await buscarPaso(id_paso, id_protocolo);
    if (!paso) return res.status(404).json({ message: 'Paso no encontrado en este protocolo' });

    const [campo] = await pool.query(
      'SELECT codigo FROM CATALOGO_PROTOCOLO_PASO_CAMPO WHERE id_campo = ? AND id_paso = ?',
      [id_campo, id_paso]
    );
    if (campo.length === 0) return res.status(404).json({ message: 'Campo no encontrado en este paso' });

    // La FK no protege esto: la condición guarda el código como texto, no como
    // referencia. Sin este chequeo el campo se borra y la transición queda
    // apuntando a algo que ya no existe.
    const [salientes] = await pool.query(
      'SELECT id_transicion, condicion FROM CATALOGO_PROTOCOLO_TRANSICION WHERE id_paso_origen = ? AND condicion IS NOT NULL',
      [id_paso]
    );
    const enUso = salientes.filter((t) => t.condicion.startsWith(`${campo[0].codigo}=`) || t.condicion.startsWith(`${campo[0].codigo}!=`));
    if (enUso.length > 0)
      return res.status(409).json({
        message: `El campo '${campo[0].codigo}' se usa en ${enUso.length} transición(es) (${enUso.map((t) => t.condicion).join(', ')}). Elimínalas primero.`,
      });

    // Mismo problema con los campos que dependen de este: la dependencia
    // también guarda el código como texto. Si se borra, el dependiente deja de
    // mostrarse para siempre y sin ningún aviso.
    const [dependientes] = await pool.query(
      `SELECT etiqueta, depende_de FROM CATALOGO_PROTOCOLO_PASO_CAMPO
        WHERE id_paso = ? AND id_campo <> ? AND depende_de IS NOT NULL`,
      [id_paso, id_campo]
    );
    const colgados = dependientes.filter((c) => parsearCondicion(c.depende_de)?.campo === campo[0].codigo);
    if (colgados.length > 0)
      return res.status(409).json({
        message: `'${colgados[0].etiqueta}' solo se pregunta si se cumple '${colgados[0].depende_de}'. ` +
                 `Quita esa dependencia antes de eliminar el campo.`,
      });

    await pool.query('DELETE FROM CATALOGO_PROTOCOLO_PASO_CAMPO WHERE id_campo = ? AND id_paso = ?', [
      id_campo, id_paso,
    ]);
    await volverABorrador(id_protocolo);
    res.json({ message: 'Campo eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar el campo' });
  }
};

// ---------------------------------------------------------------------------
// Validar y publicar
// ---------------------------------------------------------------------------

// Reúne las filas y corre la batería completa: la coherencia del grafo más una
// revalidación de todas las condiciones. Las condiciones ya se validan al
// guardarse, pero el grafo pudo cambiar debajo (se borró un paso con sus
// campos), así que antes de publicar se comprueban de nuevo.
const revisarProtocolo = async (id_protocolo) => {
  const [pasos] = await pool.query('SELECT * FROM CATALOGO_PROTOCOLO_PASO WHERE id_protocolo = ?', [id_protocolo]);
  const [transiciones] = await pool.query('SELECT * FROM CATALOGO_PROTOCOLO_TRANSICION WHERE id_protocolo = ?', [id_protocolo]);
  const [campos] = await pool.query(
    `SELECT c.* FROM CATALOGO_PROTOCOLO_PASO_CAMPO c
     JOIN CATALOGO_PROTOCOLO_PASO p ON p.id_paso = c.id_paso WHERE p.id_protocolo = ?`,
    [id_protocolo]
  );
  const [roles] = await pool.query(
    `SELECT pr.* FROM CATALOGO_PROTOCOLO_PASO_ROL pr
     JOIN CATALOGO_PROTOCOLO_PASO p ON p.id_paso = pr.id_paso WHERE p.id_protocolo = ?`,
    [id_protocolo]
  );

  const problemas = validarGrafo(pasos, transiciones, campos);

  // El techo de 2 meses del art. 16 E letra g se comprueba acá, junto al resto
  // de la coherencia del grafo: un protocolo que no cabe en el plazo legal no
  // debería poder publicarse ni, por lo tanto, activarse en un caso real.
  const [[protocolo]] = await pool.query(
    'SELECT ambito FROM CATALOGO_PROTOCOLOS_GENERICOS WHERE id_protocolo = ?', [id_protocolo]);
  problemas.push(...validarTechoLegal(pasos, transiciones, protocolo?.ambito));

  for (const t of transiciones.filter((t) => t.condicion)) {
    const paso = pasos.find((p) => p.id_paso === t.id_paso_origen);
    const err = validarCondicion(
      t.condicion,
      camposDelPaso(paso, campos.filter((c) => c.id_paso === t.id_paso_origen))
    );
    if (err) problemas.push(`Transición desde '${paso?.nombre ?? t.id_paso_origen}': ${err}`);
  }

  for (const p of pasos) {
    const delPaso = roles.filter((r) => r.id_paso === p.id_paso);
    // Un paso sin ejecutor no le aparece a nadie en su bandeja.
    if (!delPaso.some((r) => r.tipo_participacion === 'ejecutor'))
      problemas.push(`El paso '${p.nombre}' no tiene ningún rol ejecutor asignado.`);
    if (esPasoDeAprobacion(p.tipo_paso) && !delPaso.some((r) => r.tipo_participacion === 'aprobador'))
      problemas.push(`El paso de aprobación '${p.nombre}' no tiene ningún rol aprobador.`);
    if (p.tipo_paso === 'formulario' && !campos.some((c) => c.id_paso === p.id_paso))
      problemas.push(`El paso de formulario '${p.nombre}' no tiene campos definidos.`);
  }

  return problemas;
};

const validar = async (req, res) => {
  const { id_protocolo } = req.params;
  try {
    if (!(await existeProtocolo(id_protocolo)))
      return res.status(404).json({ message: 'Protocolo genérico no encontrado' });
    const problemas = await revisarProtocolo(id_protocolo);
    res.json({ publicable: problemas.length === 0, problemas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al validar el flujo' });
  }
};

const publicar = async (req, res) => {
  const { id_protocolo } = req.params;
  try {
    if (!(await existeProtocolo(id_protocolo)))
      return res.status(404).json({ message: 'Protocolo genérico no encontrado' });

    const problemas = await revisarProtocolo(id_protocolo);
    if (problemas.length > 0)
      return res.status(409).json({ message: 'El flujo tiene problemas de coherencia', problemas });

    // La versión sube en cada publicación, no en cada edición: entre dos
    // publicaciones el grafo es borrador y nadie lo ejecuta, así que numerar
    // los borradores solo produciría versiones que ningún caso usó nunca.
    // Es el número que después se cita en el expediente ("Protocolo X v3").
    await pool.query(
      `UPDATE CATALOGO_PROTOCOLOS_GENERICOS
       SET estado_flujo = 'publicado', fecha_publicacion = NOW(), version = version + 1
       WHERE id_protocolo = ?`,
      [id_protocolo]
    );
    const [[fila]] = await pool.query(
      'SELECT version FROM CATALOGO_PROTOCOLOS_GENERICOS WHERE id_protocolo = ?',
      [id_protocolo]
    );
    res.json({ message: `Protocolo publicado (versión ${fila.version})`, version: fila.version });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al publicar el protocolo' });
  }
};

module.exports = {
  getGrafo,
  crearPaso, actualizarPaso, eliminarPaso, guardarPasoCompletoGenerico,
  crearTransicion, actualizarTransicion, eliminarTransicion,
  reemplazarRoles,
  crearCampo, actualizarCampo, eliminarCampo,
  validar, publicar,
};
