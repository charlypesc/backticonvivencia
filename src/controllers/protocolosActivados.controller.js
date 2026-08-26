const pool = require('../db/connection');
const {
  camposDelPaso,
  validarCondicion,
  validarGrafo,
  elegirTransicion,
  calcularFechaLimite,
  validarDatosSalida,
} = require('../utils/flujoProtocolo');
const notificaciones = require('../services/notificaciones.service');

// Motor de ejecución de protocolos.
//
// Al activar, el grafo se COPIA a las tablas de ejecución y el caso ya no
// vuelve a mirar la plantilla: si el ADMIN corrige un paso mañana, los casos
// abiertos siguen con las reglas que tenían el día que arrancaron. Lo único
// que se hereda en vivo es el texto del protocolo (nombre y descripción).
//
// El avance es manual con evaluación automática: alguien marca el paso como
// completado y el motor decide a dónde sigue evaluando las transiciones
// salientes contra los datos que ese paso produjo.
//
// Cada cosa que pasa se escribe en PROTOCOLO_ACTIVADO_EVENTO. Esa tabla es la
// que responde "quién hizo qué y cuándo" en una fiscalización, así que se
// inserta siempre dentro de la misma transacción que el cambio que describe:
// un evento que se pierde es peor que no tener bitácora, porque parece completa.

// El nombre/descripción sale del establecimiento si lo personalizó, y si no del
// catálogo genérico. El LEFT JOIN es necesario porque un protocolo propio del
// colegio no tiene genérico detrás.
const BASE_SELECT = `
  SELECT pa.*,
         COALESCE(pe.nombre, cp.nombre)           AS nombre,
         COALESCE(pe.descripcion, cp.descripcion) AS descripcion
  FROM PROTOCOLO_ACTIVADO pa
  JOIN PROTOCOLO_ESTABLECIMIENTO pe ON pa.id_protocolo_establecimiento = pe.id_protocolo_establecimiento
  LEFT JOIN CATALOGO_PROTOCOLOS_GENERICOS cp ON pe.id_protocolo = cp.id_protocolo
  WHERE pa.id_establecimiento = ?
`;

// Ahora que id_establecimiento está denormalizado, el filtro del tenant es una
// comparación directa sobre la propia fila y no un join en cadena hasta el
// autor del registro.
const buscarActivado = async (id, id_establecimiento) => {
  const [rows] = await pool.query(`${BASE_SELECT} AND pa.id_protocolo_activado = ?`, [
    id_establecimiento, id,
  ]);
  return rows[0] ?? null;
};

const buscarPasoActivado = async (id_activado_paso, id_protocolo_activado) => {
  const [rows] = await pool.query(
    'SELECT * FROM PROTOCOLO_ACTIVADO_PASO WHERE id_activado_paso = ? AND id_protocolo_activado = ?',
    [id_activado_paso, id_protocolo_activado]
  );
  return rows[0] ?? null;
};

const registrarEvento = (conn, { activado, paso = null, tipo, descripcion, id_usuario }) =>
  conn.query(
    `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
       (id_protocolo_activado, id_establecimiento, id_activado_paso, tipo_evento, descripcion, id_usuario, fecha)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [activado.id_protocolo_activado, activado.id_establecimiento, paso, tipo, descripcion, id_usuario]
  );

// Quién puede actuar sobre un paso: quien tenga el rol correspondiente en el
// grafo congelado, o el responsable asignado. El ADMIN pasa igual que en el
// resto del sistema.
const puedeActuar = async (req, paso, tipo_participacion) => {
  if ((req.user.roles ?? []).includes('ADMIN')) return true;
  if (paso.id_usuario_responsable === req.user.id) return true;

  const [rows] = await pool.query(
    `SELECT 1 FROM PROTOCOLO_ACTIVADO_PASO_ROL pr
     JOIN USUARIO_ROLES ur ON ur.rol_id = pr.rol_id
     WHERE pr.id_activado_paso = ? AND pr.tipo_participacion = ? AND ur.id_usuario = ?
       AND (ur.expira_at IS NULL OR ur.expira_at > NOW())
     LIMIT 1`,
    [paso.id_activado_paso, tipo_participacion, req.user.id]
  );
  return rows.length > 0;
};

// Arranca un paso: lo pone en curso y le calcula el vencimiento. La fecha
// límite se calcula acá y no al activar el protocolo porque un paso que espera
// tres semanas en 'pendiente' no debería nacer ya vencido.
const iniciarPaso = async (conn, paso) => {
  const ahora = new Date();
  const limite = calcularFechaLimite(ahora, paso.plazo_valor, paso.plazo_unidad);
  await conn.query(
    `UPDATE PROTOCOLO_ACTIVADO_PASO
     SET estado = 'en_curso', fecha_inicio = ?, fecha_limite = ?
     WHERE id_activado_paso = ?`,
    [ahora, limite, paso.id_activado_paso]
  );
  await conn.query(
    'UPDATE PROTOCOLO_ACTIVADO SET id_paso_actual = ? WHERE id_protocolo_activado = ?',
    [paso.id_activado_paso, paso.id_protocolo_activado]
  );
  return limite;
};

const cerrarProtocolo = (conn, id_protocolo_activado) =>
  conn.query(
    `UPDATE PROTOCOLO_ACTIVADO
     SET estado = 'cerrado', fecha_cierre = NOW(), id_paso_actual = NULL
     WHERE id_protocolo_activado = ?`,
    [id_protocolo_activado]
  );

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `${BASE_SELECT} ${req.query.estado ? 'AND pa.estado = ?' : ''} ORDER BY pa.fecha_activacion DESC`,
      req.query.estado ? [req.id_establecimiento, req.query.estado] : [req.id_establecimiento]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener protocolos activados' });
  }
};

const getByRegistro = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `${BASE_SELECT} AND pa.id_registro = ? ORDER BY pa.fecha_activacion DESC`,
      [req.id_establecimiento, req.params.id_registro]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener protocolos activados del registro' });
  }
};

// El caso completo: cabecera, el grafo congelado y en qué estado va cada paso.
// Es lo que dibuja la línea de tiempo del protocolo dentro del caso.
const getDetalle = async (req, res) => {
  try {
    const activado = await buscarActivado(req.params.id, req.id_establecimiento);
    if (!activado) return res.status(404).json({ message: 'Protocolo activado no encontrado' });

    const [pasos] = await pool.query(
      `SELECT p.*, u.correo AS responsable_correo
       FROM PROTOCOLO_ACTIVADO_PASO p
       LEFT JOIN USUARIO u ON u.id_usuario = p.id_usuario_responsable
       WHERE p.id_protocolo_activado = ? ORDER BY p.id_activado_paso`,
      [req.params.id]
    );
    const [transiciones] = await pool.query(
      'SELECT * FROM PROTOCOLO_ACTIVADO_TRANSICION WHERE id_protocolo_activado = ?',
      [req.params.id]
    );
    const [roles] = await pool.query(
      `SELECT pr.*, r.nombre AS rol_nombre, r.codigo AS rol_codigo
       FROM PROTOCOLO_ACTIVADO_PASO_ROL pr
       JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = pr.id_activado_paso
       JOIN ROLES r ON r.rol_id = pr.rol_id
       WHERE p.id_protocolo_activado = ?`,
      [req.params.id]
    );
    const [campos] = await pool.query(
      `SELECT c.* FROM PROTOCOLO_ACTIVADO_PASO_CAMPO c
       JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = c.id_activado_paso
       WHERE p.id_protocolo_activado = ? ORDER BY c.orden, c.id_campo_activado`,
      [req.params.id]
    );

    res.json({
      ...activado,
      pasos: pasos.map((p) => ({
        ...p,
        roles: roles.filter((r) => r.id_activado_paso === p.id_activado_paso),
        campos: camposDelPaso(p, campos.filter((c) => c.id_activado_paso === p.id_activado_paso)),
        vencido: p.estado === 'en_curso' && p.fecha_limite !== null && p.fecha_limite < new Date(),
      })),
      transiciones,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el detalle del protocolo activado' });
  }
};

const getBitacora = async (req, res) => {
  try {
    const activado = await buscarActivado(req.params.id, req.id_establecimiento);
    if (!activado) return res.status(404).json({ message: 'Protocolo activado no encontrado' });

    const [eventos] = await pool.query(
      `SELECT e.*, u.correo AS usuario_correo, p.nombre AS paso_nombre
       FROM PROTOCOLO_ACTIVADO_EVENTO e
       LEFT JOIN USUARIO u ON u.id_usuario = e.id_usuario
       LEFT JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = e.id_activado_paso
       WHERE e.id_protocolo_activado = ? ORDER BY e.fecha, e.id_evento`,
      [req.params.id]
    );
    res.json(eventos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener la bitácora' });
  }
};

// ---------------------------------------------------------------------------
// Activar
// ---------------------------------------------------------------------------

// De dónde sale el grafo: de la copia del colegio si personalizó, y si no del
// catálogo global, que además tiene que estar publicado. Es la misma pregunta
// que responde el módulo de flujo, resuelta acá con las filas ya cargadas para
// poder materializarlas en la misma transacción.
const cargarGrafoFuente = async (pe) => {
  const [espejo] = await pool.query(
    `SELECT id_paso_estab AS id_paso, nombre, descripcion, tipo_paso, plazo_valor, plazo_unidad,
            accion_al_vencer, es_paso_inicial, es_paso_final, id_paso_origen_catalogo
     FROM PROTOCOLO_ESTABLECIMIENTO_PASO WHERE id_protocolo_establecimiento = ?`,
    [pe.id_protocolo_establecimiento]
  );

  if (espejo.length > 0) {
    const [transiciones] = await pool.query(
      `SELECT id_paso_origen, id_paso_destino, condicion, etiqueta, es_default
       FROM PROTOCOLO_ESTABLECIMIENTO_TRANSICION WHERE id_protocolo_establecimiento = ?`,
      [pe.id_protocolo_establecimiento]
    );
    const [roles] = await pool.query(
      `SELECT pr.id_paso_estab AS id_paso, pr.rol_id, pr.tipo_participacion
       FROM PROTOCOLO_ESTABLECIMIENTO_PASO_ROL pr
       JOIN PROTOCOLO_ESTABLECIMIENTO_PASO p ON p.id_paso_estab = pr.id_paso_estab
       WHERE p.id_protocolo_establecimiento = ?`,
      [pe.id_protocolo_establecimiento]
    );
    const [campos] = await pool.query(
      `SELECT c.id_paso_estab AS id_paso, c.codigo, c.etiqueta, c.tipo_campo, c.opciones,
              c.es_obligatorio, c.orden
       FROM PROTOCOLO_ESTABLECIMIENTO_PASO_CAMPO c
       JOIN PROTOCOLO_ESTABLECIMIENTO_PASO p ON p.id_paso_estab = c.id_paso_estab
       WHERE p.id_protocolo_establecimiento = ?`,
      [pe.id_protocolo_establecimiento]
    );
    return { origen: 'propio', pasos: espejo, transiciones, roles, campos, esEspejo: true };
  }

  if (pe.id_protocolo === null)
    return { error: 'Este protocolo propio todavía no tiene ningún paso definido.' };
  if (pe.estado_flujo !== 'publicado')
    return { error: 'El flujo de este protocolo todavía no fue publicado por el administrador.' };

  const [pasos] = await pool.query('SELECT * FROM CATALOGO_PROTOCOLO_PASO WHERE id_protocolo = ?', [pe.id_protocolo]);
  if (pasos.length === 0) return { error: 'El protocolo del catálogo no tiene pasos definidos.' };

  const [transiciones] = await pool.query(
    'SELECT id_paso_origen, id_paso_destino, condicion, etiqueta, es_default FROM CATALOGO_PROTOCOLO_TRANSICION WHERE id_protocolo = ?',
    [pe.id_protocolo]
  );
  const [roles] = await pool.query(
    `SELECT pr.id_paso AS id_paso, pr.rol_id, pr.tipo_participacion
     FROM CATALOGO_PROTOCOLO_PASO_ROL pr
     JOIN CATALOGO_PROTOCOLO_PASO p ON p.id_paso = pr.id_paso WHERE p.id_protocolo = ?`,
    [pe.id_protocolo]
  );
  const [campos] = await pool.query(
    `SELECT c.id_paso AS id_paso, c.codigo, c.etiqueta, c.tipo_campo, c.opciones, c.es_obligatorio, c.orden
     FROM CATALOGO_PROTOCOLO_PASO_CAMPO c
     JOIN CATALOGO_PROTOCOLO_PASO p ON p.id_paso = c.id_paso WHERE p.id_protocolo = ?`,
    [pe.id_protocolo]
  );
  return { origen: 'catalogo', pasos, transiciones, roles, campos, esEspejo: false };
};

const activar = async (req, res) => {
  const { id_protocolo_establecimiento, id_registro } = req.body;

  if (!id_protocolo_establecimiento || !id_registro)
    return res.status(400).json({ message: 'id_protocolo_establecimiento e id_registro son requeridos' });

  try {
    const [pes] = await pool.query(
      `SELECT pe.id_protocolo_establecimiento, pe.id_protocolo, pe.id_establecimiento, cp.estado_flujo,
              COALESCE(pe.nombre, cp.nombre) AS nombre
       FROM PROTOCOLO_ESTABLECIMIENTO pe
       LEFT JOIN CATALOGO_PROTOCOLOS_GENERICOS cp ON pe.id_protocolo = cp.id_protocolo
       WHERE pe.id_protocolo_establecimiento = ? AND pe.id_establecimiento = ?`,
      [id_protocolo_establecimiento, req.id_establecimiento]
    );
    if (pes.length === 0)
      return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });
    const pe = pes[0];

    // El registro tiene que ser del mismo colegio. REGISTRO_CONVIVENCIA no
    // guarda el tenant, así que se deriva por el autor; es el único lugar del
    // motor donde queda un join en cadena, y por eso el resultado se copia a
    // la columna denormalizada de la activación.
    const [reg] = await pool.query(
      `SELECT r.id_registro FROM REGISTRO_CONVIVENCIA r
       JOIN USUARIO u ON u.id_usuario = r.id_usuario
       WHERE r.id_registro = ? AND u.id_establecimiento = ?`,
      [id_registro, req.id_establecimiento]
    );
    if (reg.length === 0)
      return res.status(404).json({ message: 'Registro de convivencia no encontrado' });

    const fuente = await cargarGrafoFuente(pe);
    if (fuente.error) return res.status(409).json({ message: fuente.error });

    // Se valida ANTES de materializar: un grafo roto copiado a un caso es un
    // caso que se atasca a mitad de camino y ya no se puede arreglar editando
    // la plantilla, porque el caso dejó de leerla.
    const problemas = validarGrafo(fuente.pasos, fuente.transiciones);
    for (const t of fuente.transiciones.filter((t) => t.condicion)) {
      const paso = fuente.pasos.find((p) => p.id_paso === t.id_paso_origen);
      const err = validarCondicion(
        t.condicion,
        camposDelPaso(paso, fuente.campos.filter((c) => c.id_paso === t.id_paso_origen))
      );
      if (err) problemas.push(`Transición desde '${paso?.nombre ?? t.id_paso_origen}': ${err}`);
    }
    if (problemas.length > 0)
      return res.status(409).json({ message: 'El flujo del protocolo tiene problemas de coherencia', problemas });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [cab] = await conn.query(
        `INSERT INTO PROTOCOLO_ACTIVADO
           (id_protocolo_establecimiento, id_registro, id_establecimiento, estado,
            id_usuario_activo, fecha_activacion)
         VALUES (?, ?, ?, 'activo', ?, NOW())`,
        [id_protocolo_establecimiento, id_registro, req.id_establecimiento, req.user.id]
      );
      const id_protocolo_activado = cab.insertId;

      // Igual que al clonar el espejo: los ids son nuevos, así que hay que
      // traducir cada referencia del grafo fuente a su copia.
      const mapa = new Map();
      for (const p of fuente.pasos) {
        const [r] = await conn.query(
          `INSERT INTO PROTOCOLO_ACTIVADO_PASO
             (id_protocolo_activado, id_establecimiento, id_paso_origen_catalogo, id_paso_origen_estab,
              nombre, descripcion, tipo_paso, estado, es_paso_inicial, es_paso_final,
              plazo_valor, plazo_unidad, accion_al_vencer)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?)`,
          [
            id_protocolo_activado, req.id_establecimiento,
            fuente.esEspejo ? p.id_paso_origen_catalogo : p.id_paso,
            fuente.esEspejo ? p.id_paso : null,
            p.nombre, p.descripcion, p.tipo_paso, p.es_paso_inicial, p.es_paso_final,
            p.plazo_valor, p.plazo_unidad, p.accion_al_vencer,
          ]
        );
        mapa.set(p.id_paso, r.insertId);
      }

      if (fuente.transiciones.length > 0)
        await conn.query(
          `INSERT INTO PROTOCOLO_ACTIVADO_TRANSICION
             (id_protocolo_activado, id_paso_origen, id_paso_destino, condicion, etiqueta, es_default)
           VALUES ?`,
          [fuente.transiciones.map((t) => [
            id_protocolo_activado, mapa.get(t.id_paso_origen), mapa.get(t.id_paso_destino),
            t.condicion, t.etiqueta, t.es_default,
          ])]
        );

      if (fuente.roles.length > 0)
        await conn.query(
          'INSERT INTO PROTOCOLO_ACTIVADO_PASO_ROL (id_activado_paso, rol_id, tipo_participacion) VALUES ?',
          [fuente.roles.map((r) => [mapa.get(r.id_paso), r.rol_id, r.tipo_participacion])]
        );

      if (fuente.campos.length > 0)
        await conn.query(
          `INSERT INTO PROTOCOLO_ACTIVADO_PASO_CAMPO
             (id_activado_paso, codigo, etiqueta, tipo_campo, opciones, es_obligatorio, orden) VALUES ?`,
          [fuente.campos.map((c) => [
            mapa.get(c.id_paso), c.codigo, c.etiqueta, c.tipo_campo,
            c.opciones === null ? null : JSON.stringify(c.opciones),
            c.es_obligatorio, c.orden,
          ])]
        );

      const activado = { id_protocolo_activado, id_establecimiento: req.id_establecimiento };
      await registrarEvento(conn, {
        activado, tipo: 'activacion', id_usuario: req.user.id,
        descripcion: `Protocolo activado sobre el registro ${id_registro} (flujo ${fuente.origen})`,
      });

      // El paso inicial arranca en curso: un protocolo recién activado con
      // todo en 'pendiente' no le aparece a nadie por hacer.
      const inicial = fuente.pasos.find((p) => p.es_paso_inicial);
      const idInicial = mapa.get(inicial.id_paso);
      const pasoInicial = await buscarPasoActivadoEn(conn, idInicial);
      const limite = await iniciarPaso(conn, pasoInicial);
      await registrarEvento(conn, {
        activado, paso: idInicial, tipo: 'inicio_paso', id_usuario: req.user.id,
        descripcion: `Inicia '${inicial.nombre}'${limite ? ` con plazo hasta ${limite.toISOString()}` : ''}`,
      });

      // Quien activa el protocolo casi nunca es quien ejecuta el primer paso:
      // sin este aviso, el paso inicial nace en curso y con plazo corriendo
      // para alguien que no sabe que existe.
      await notificaciones.avisarPasoEnCurso(conn, {
        activado: { ...activado, nombre: pe.nombre },
        paso: { ...pasoInicial, fecha_limite: limite },
        excepto: req.user.id,
      });

      await conn.commit();
      res.status(201).json({
        id_protocolo_activado,
        id_paso_actual: idInicial,
        origen_flujo: fuente.origen,
        pasos: fuente.pasos.length,
        message: 'Protocolo activado',
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'Este protocolo ya está activado sobre este registro.' });
    console.error(err);
    res.status(500).json({ message: 'Error al activar protocolo' });
  }
};

// Dentro de una transacción hay que leer por la misma conexión, o la fila
// recién insertada todavía no es visible.
const buscarPasoActivadoEn = async (conn, id_activado_paso) => {
  const [rows] = await conn.query('SELECT * FROM PROTOCOLO_ACTIVADO_PASO WHERE id_activado_paso = ?', [
    id_activado_paso,
  ]);
  return rows[0];
};

// ---------------------------------------------------------------------------
// Avance
// ---------------------------------------------------------------------------

// Cierra un paso y decide el destino. Es el corazón del motor: lo comparten
// completar, aprobar y omitir, que solo se diferencian en qué datos_salida
// producen y en qué estado dejan el paso.
const avanzar = async (conn, { req, activado, paso, estadoFinal, datos, evento, descripcion }) => {
  await conn.query(
    `UPDATE PROTOCOLO_ACTIVADO_PASO
     SET estado = ?, fecha_completado = NOW(), id_usuario_completo = ?, datos_salida = ?
     WHERE id_activado_paso = ?`,
    [estadoFinal, req.user.id, datos ? JSON.stringify(datos) : null, paso.id_activado_paso]
  );
  await registrarEvento(conn, {
    activado, paso: paso.id_activado_paso, tipo: evento, descripcion, id_usuario: req.user.id,
  });

  if (paso.es_paso_final) {
    await cerrarProtocolo(conn, activado.id_protocolo_activado);
    await registrarEvento(conn, {
      activado, paso: paso.id_activado_paso, tipo: 'cierre', id_usuario: req.user.id,
      descripcion: `Protocolo cerrado al completarse el paso final '${paso.nombre}'`,
    });
    return { cerrado: true };
  }

  const [salientes] = await conn.query(
    'SELECT * FROM PROTOCOLO_ACTIVADO_TRANSICION WHERE id_paso_origen = ? ORDER BY es_default, id_activado_transicion',
    [paso.id_activado_paso]
  );
  const elegida = elegirTransicion(salientes, datos);
  if (elegida.error) return { error: elegida.error };

  const destino = await buscarPasoActivadoEn(conn, elegida.transicion.id_paso_destino);
  const limite = await iniciarPaso(conn, destino);
  await registrarEvento(conn, {
    activado, paso: destino.id_activado_paso, tipo: 'transicion', id_usuario: req.user.id,
    descripcion: `'${paso.nombre}' → '${destino.nombre}'` +
      (elegida.transicion.condicion ? ` (condición ${elegida.transicion.condicion})` : ' (rama por defecto)'),
  });
  await registrarEvento(conn, {
    activado, paso: destino.id_activado_paso, tipo: 'inicio_paso', id_usuario: req.user.id,
    descripcion: `Inicia '${destino.nombre}'${limite ? ` con plazo hasta ${limite.toISOString()}` : ''}`,
  });
  // El paso siguiente suele tocarle a otro rol: este es el aviso que hace que
  // el caso no se detenga esperando a que alguien entre a mirar por casualidad.
  await notificaciones.avisarPasoEnCurso(conn, {
    activado,
    paso: { ...destino, fecha_limite: limite },
    excepto: req.user.id,
  });

  return { siguiente: { id_activado_paso: destino.id_activado_paso, nombre: destino.nombre, fecha_limite: limite } };
};

// Comprobaciones comunes a las tres acciones de avance.
const prepararAccion = async (req, res, tipo_participacion) => {
  const activado = await buscarActivado(req.params.id, req.id_establecimiento);
  if (!activado) {
    res.status(404).json({ message: 'Protocolo activado no encontrado' });
    return null;
  }
  if (activado.estado !== 'activo') {
    res.status(409).json({ message: `El protocolo está ${activado.estado}: ya no admite cambios.` });
    return null;
  }
  const paso = await buscarPasoActivado(req.params.id_paso, req.params.id);
  if (!paso) {
    res.status(404).json({ message: 'Paso no encontrado en este protocolo' });
    return null;
  }
  // Un paso vencido sigue siendo trabajo de alguien: el job lo marca para que
  // se vea, no para bloquearlo. Lo que ya no se puede tocar es lo cerrado.
  if (!['en_curso', 'vencido'].includes(paso.estado)) {
    res.status(409).json({
      message: paso.estado === 'pendiente'
        ? 'Este paso todavía no está en curso: el protocolo no llegó hasta él.'
        : `El paso ya está '${paso.estado}'.`,
    });
    return null;
  }
  if (!(await puedeActuar(req, paso, tipo_participacion))) {
    res.status(403).json({
      message: `No tienes el rol de ${tipo_participacion} para este paso.`,
    });
    return null;
  }
  return { activado, paso };
};

const completarPaso = async (req, res) => {
  try {
    const ctx = await prepararAccion(req, res, 'ejecutor');
    if (!ctx) return;
    const { activado, paso } = ctx;

    if (paso.tipo_paso === 'aprobacion')
      return res.status(409).json({ message: 'Este es un paso de aprobación: usa la acción de aprobar.' });

    const [campos] = await pool.query(
      'SELECT * FROM PROTOCOLO_ACTIVADO_PASO_CAMPO WHERE id_activado_paso = ?',
      [paso.id_activado_paso]
    );
    const validados = validarDatosSalida(campos, req.body?.datos_salida);
    if (validados.error) return res.status(400).json({ message: validados.error });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const r = await avanzar(conn, {
        req, activado, paso, estadoFinal: 'completado', datos: validados.datos,
        evento: 'completado_paso', descripcion: `Completa '${paso.nombre}'`,
      });
      if (r.error) {
        await conn.rollback();
        return res.status(409).json({ message: r.error });
      }
      await conn.commit();
      res.json({ message: 'Paso completado', ...r });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al completar el paso' });
  }
};

// La aprobación produce su propio datos_salida con el campo implícito
// 'aprobado', que es sobre lo que ramifican las transiciones que salen de acá.
const aprobarPaso = async (req, res) => {
  const { aprobado, comentario } = req.body ?? {};
  if (typeof aprobado !== 'boolean')
    return res.status(400).json({ message: 'aprobado debe ser true o false' });

  try {
    const ctx = await prepararAccion(req, res, 'aprobador');
    if (!ctx) return;
    const { activado, paso } = ctx;

    if (paso.tipo_paso !== 'aprobacion')
      return res.status(409).json({ message: 'Este paso no es de tipo aprobación.' });

    // Un paso de aprobación puede además tener campos configurados (el tipo de
    // medida que se resuelve, por ejemplo). 'aprobado' lo pone el motor y no se
    // acepta desde el body: es el resultado del acto, no un dato más.
    const [campos] = await pool.query(
      'SELECT * FROM PROTOCOLO_ACTIVADO_PASO_CAMPO WHERE id_activado_paso = ?',
      [paso.id_activado_paso]
    );
    const validados = validarDatosSalida(campos, req.body?.datos_salida);
    if (validados.error) return res.status(400).json({ message: validados.error });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const r = await avanzar(conn, {
        req, activado, paso, estadoFinal: 'completado',
        datos: { ...validados.datos, aprobado: aprobado ? 'si' : 'no' },
        evento: 'completado_paso',
        descripcion: `${aprobado ? 'Aprueba' : 'Rechaza'} '${paso.nombre}'` +
          (comentario?.trim() ? `: ${comentario.trim()}` : ''),
      });
      if (r.error) {
        await conn.rollback();
        return res.status(409).json({ message: r.error });
      }
      await conn.commit();
      res.json({ message: aprobado ? 'Paso aprobado' : 'Paso rechazado', ...r });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al aprobar el paso' });
  }
};

// Omitir no produce datos, así que ninguna condición puede evaluarse: el caso
// sale por la rama por defecto. Un paso omitido sin rama de escape deja el
// protocolo sin destino, y por eso se rechaza en vez de dejarlo colgado.
const omitirPaso = async (req, res) => {
  const motivo = req.body?.motivo?.trim();
  if (!motivo)
    return res.status(400).json({ message: 'motivo es requerido para omitir un paso' });

  try {
    const ctx = await prepararAccion(req, res, 'ejecutor');
    if (!ctx) return;
    const { activado, paso } = ctx;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const r = await avanzar(conn, {
        req, activado, paso, estadoFinal: 'omitido', datos: null,
        evento: 'omitido_paso', descripcion: `Omite '${paso.nombre}': ${motivo}`,
      });
      if (r.error) {
        await conn.rollback();
        return res.status(409).json({
          message: `${r.error} Un paso omitido no produce datos, así que solo puede salir por la rama por defecto.`,
        });
      }
      await conn.commit();
      res.json({ message: 'Paso omitido', ...r });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al omitir el paso' });
  }
};

// Asigna el paso a una persona concreta. El grafo define ROLES; esto es lo que
// convierte "alguien de convivencia" en "esta persona", sin sacarle el paso al
// resto del rol: quien tenga el rol sigue pudiendo actuar.
const reasignarPaso = async (req, res) => {
  const { id_usuario } = req.body ?? {};
  if (!id_usuario) return res.status(400).json({ message: 'id_usuario es requerido' });

  try {
    const activado = await buscarActivado(req.params.id, req.id_establecimiento);
    if (!activado) return res.status(404).json({ message: 'Protocolo activado no encontrado' });
    if (activado.estado !== 'activo')
      return res.status(409).json({ message: `El protocolo está ${activado.estado}: ya no admite cambios.` });

    const paso = await buscarPasoActivado(req.params.id_paso, req.params.id);
    if (!paso) return res.status(404).json({ message: 'Paso no encontrado en este protocolo' });
    if (['completado', 'omitido'].includes(paso.estado))
      return res.status(409).json({ message: `El paso ya está '${paso.estado}': no tiene sentido reasignarlo.` });

    const [u] = await pool.query(
      'SELECT correo FROM USUARIO WHERE id_usuario = ? AND id_establecimiento = ? AND activo = 1',
      [id_usuario, req.id_establecimiento]
    );
    if (u.length === 0)
      return res.status(404).json({ message: 'Usuario no encontrado en este establecimiento' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE PROTOCOLO_ACTIVADO_PASO SET id_usuario_responsable = ? WHERE id_activado_paso = ?', [
        id_usuario, paso.id_activado_paso,
      ]);
      await registrarEvento(conn, {
        activado, paso: paso.id_activado_paso, tipo: 'nota', id_usuario: req.user.id,
        descripcion: `Responsable de '${paso.nombre}' asignado a ${u[0].correo}`,
      });
      await notificaciones.crear(conn, {
        usuarios: [id_usuario],
        id_establecimiento: activado.id_establecimiento,
        tipo: 'paso_reasignado',
        titulo: `Te asignaron: ${paso.nombre}`,
        mensaje: `Protocolo "${activado.nombre}"`,
        id_protocolo_activado: activado.id_protocolo_activado,
        id_activado_paso: paso.id_activado_paso,
        excepto: req.user.id,
      });
      await conn.commit();
      res.json({ message: 'Responsable asignado' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al reasignar el paso' });
  }
};

// ---------------------------------------------------------------------------
// Cerrar, anular, nota
// ---------------------------------------------------------------------------

// El cierre normal lo hace el motor al completarse un paso final. Este es el
// cierre a mano, para el caso que se resolvió por fuera del flujo: exige
// motivo, porque cerrar sin llegar al final es justo lo que una fiscalización
// va a preguntar.
const cerrar = async (req, res) => {
  const motivo = req.body?.motivo?.trim();
  try {
    const activado = await buscarActivado(req.params.id, req.id_establecimiento);
    if (!activado) return res.status(404).json({ message: 'Protocolo activado no encontrado' });
    if (activado.estado !== 'activo')
      return res.status(409).json({ message: `El protocolo ya está ${activado.estado}.` });

    const [pendientes] = await pool.query(
      `SELECT COUNT(*) c FROM PROTOCOLO_ACTIVADO_PASO
       WHERE id_protocolo_activado = ? AND estado IN ('pendiente','en_curso')`,
      [req.params.id]
    );
    if (pendientes[0].c > 0 && !motivo)
      return res.status(400).json({
        message: `Quedan ${pendientes[0].c} paso(s) sin completar. Para cerrar igual, indica un motivo.`,
      });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE PROTOCOLO_ACTIVADO_PASO SET estado = 'omitido'
         WHERE id_protocolo_activado = ? AND estado IN ('pendiente','en_curso')`,
        [req.params.id]
      );
      await cerrarProtocolo(conn, req.params.id);
      await registrarEvento(conn, {
        activado, tipo: 'cierre', id_usuario: req.user.id,
        descripcion: motivo ? `Cierre anticipado: ${motivo}` : 'Protocolo cerrado',
      });
      // Se avisa a quien lo activó: cerrar con pasos sin completar es
      // justamente lo que esa persona necesita poder discutir.
      await notificaciones.crear(conn, {
        usuarios: [activado.id_usuario_activo],
        id_establecimiento: activado.id_establecimiento,
        tipo: 'protocolo_cerrado',
        titulo: `Se cerró: ${activado.nombre}`,
        mensaje: motivo ? `Cierre anticipado: ${motivo}` : 'Protocolo cerrado',
        id_protocolo_activado: activado.id_protocolo_activado,
        excepto: req.user.id,
      });
      await conn.commit();
      res.json({ message: 'Protocolo cerrado' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al cerrar el protocolo' });
  }
};

// Anular es lo que hay que usar cuando el protocolo se activó por error: deja
// la bitácora intacta, a diferencia de eliminar.
const anular = async (req, res) => {
  const motivo = req.body?.motivo?.trim();
  if (!motivo) return res.status(400).json({ message: 'motivo es requerido para anular' });

  try {
    const activado = await buscarActivado(req.params.id, req.id_establecimiento);
    if (!activado) return res.status(404).json({ message: 'Protocolo activado no encontrado' });
    if (activado.estado !== 'activo')
      return res.status(409).json({ message: `El protocolo ya está ${activado.estado}.` });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE PROTOCOLO_ACTIVADO_PASO SET estado = 'omitido'
         WHERE id_protocolo_activado = ? AND estado IN ('pendiente','en_curso')`,
        [req.params.id]
      );
      await conn.query(
        `UPDATE PROTOCOLO_ACTIVADO SET estado = 'anulado', fecha_cierre = NOW(), id_paso_actual = NULL
         WHERE id_protocolo_activado = ?`,
        [req.params.id]
      );
      await registrarEvento(conn, {
        activado, tipo: 'anulacion', id_usuario: req.user.id, descripcion: `Anulado: ${motivo}`,
      });
      await notificaciones.crear(conn, {
        usuarios: [activado.id_usuario_activo],
        id_establecimiento: activado.id_establecimiento,
        tipo: 'protocolo_anulado',
        titulo: `Se anuló: ${activado.nombre}`,
        mensaje: `Anulado: ${motivo}`,
        id_protocolo_activado: activado.id_protocolo_activado,
        excepto: req.user.id,
      });
      await conn.commit();
      res.json({ message: 'Protocolo anulado' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al anular el protocolo' });
  }
};

const agregarNota = async (req, res) => {
  const texto = req.body?.descripcion?.trim();
  if (!texto) return res.status(400).json({ message: 'descripcion es requerida' });

  try {
    const activado = await buscarActivado(req.params.id, req.id_establecimiento);
    if (!activado) return res.status(404).json({ message: 'Protocolo activado no encontrado' });

    const conn = await pool.getConnection();
    try {
      await registrarEvento(conn, {
        activado, paso: activado.id_paso_actual, tipo: 'nota', descripcion: texto, id_usuario: req.user.id,
      });
      res.status(201).json({ message: 'Nota registrada en la bitácora' });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al registrar la nota' });
  }
};

// ---------------------------------------------------------------------------
// Compatibilidad
// ---------------------------------------------------------------------------

// Antes se podía reapuntar una activación a otro protocolo o a otro registro.
// Con el grafo materializado eso dejaría los pasos copiados de un protocolo
// colgando de otro. Se responde explicando la alternativa en vez de borrar la
// ruta, para que un cliente viejo reciba un mensaje y no un 404 sin contexto.
const update = async (req, res) =>
  res.status(409).json({
    message: 'Una activación ya no se puede reapuntar: su flujo está materializado. Anúlala y activa el protocolo correcto.',
  });

// Eliminar borra también la bitácora. Se permite solo mientras el caso no
// avanzó; después, lo correcto es anular, que conserva el rastro.
const remove = async (req, res) => {
  try {
    const activado = await buscarActivado(req.params.id, req.id_establecimiento);
    if (!activado) return res.status(404).json({ message: 'Protocolo activado no encontrado' });

    const [avanzados] = await pool.query(
      `SELECT COUNT(*) c FROM PROTOCOLO_ACTIVADO_PASO
       WHERE id_protocolo_activado = ? AND estado IN ('completado','omitido')`,
      [req.params.id]
    );
    if (avanzados[0].c > 0)
      return res.status(409).json({
        message: 'Este protocolo ya tiene pasos ejecutados: eliminarlo borraría la bitácora. Anúlalo en su lugar.',
      });

    await pool.query('DELETE FROM PROTOCOLO_ACTIVADO WHERE id_protocolo_activado = ?', [req.params.id]);
    res.json({ message: 'Protocolo activado eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar' });
  }
};

module.exports = {
  getAll, getByRegistro, getDetalle, getBitacora,
  create: activar,
  completarPaso, aprobarPaso, omitirPaso, reasignarPaso,
  cerrar, anular, agregarNota,
  update, remove,
};
