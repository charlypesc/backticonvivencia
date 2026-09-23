const pool = require('../db/connection');
const {
  camposDelPaso,
  validarCondicion,
  validarGrafo,
  pasosDescartados,
  elegirTransicion,
  calcularFechaLimite,
  validarDatosSalida,
  involucradosDelPaso,
  esPasoDeAprobacion,
} = require('../utils/flujoProtocolo');
const notificaciones = require('../services/notificaciones.service');
const { cargarFeriados } = require('../services/feriados.service');
const { reducirSiConfidencial } = require('../utils/confidencial');
const { tienePermiso } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');

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

/**
 * Qué clase de medida tiene constando cada paso del caso.
 *
 * Las tres tablas responden a la misma pregunta —¿qué paso ordenó esto?— pero
 * son tres institutos distintos, así que cada una aporta su propia clase y
 * ninguna cumple por otra:
 *
 *   MEDIDA_PROTECCION    → 'proteccion'      (Ley 21.809 art. 16 E letra j)
 *   SUSPENSION_CAUTELAR  → 'cautelar'        (DFL 2/1998 art. 6 letra d)
 *   MEDIDA_DISCIPLINARIA → 'disciplinaria'   (lo resuelto y sancionado)
 *
 * La disciplinaria se busca por el registro y no por el caso porque cuelga del
 * hecho, no del protocolo.
 */
const clasesDeMedidaPorPaso = async (db, { id_protocolo_activado, id_registro }) => {
  const [filas] = await db.query(
    `SELECT id_activado_paso, 'disciplinaria' AS clase FROM MEDIDA_DISCIPLINARIA
      WHERE id_registro = ? AND id_activado_paso IS NOT NULL
     UNION
     SELECT id_activado_paso, 'proteccion' FROM MEDIDA_PROTECCION
      WHERE id_protocolo_activado = ? AND id_activado_paso IS NOT NULL
     UNION
     SELECT id_activado_paso, 'cautelar' FROM SUSPENSION_CAUTELAR
      WHERE id_protocolo_activado = ? AND id_activado_paso IS NOT NULL`,
    [id_registro, id_protocolo_activado, id_protocolo_activado]
  );
  const mapa = new Map();
  for (const f of filas) {
    if (!mapa.has(f.id_activado_paso)) mapa.set(f.id_activado_paso, new Set());
    mapa.get(f.id_activado_paso).add(f.clase);
  }
  return mapa;
};

// Qué clases dan por cumplido un paso según lo que el paso pide. Cada instituto
// se cumple con el suyo: una suspensión cautelar sobre el señalado no es una
// medida de protección para la persona afectada, por más que ambas la resguarden
// de hecho, y el paso que pide una tiene que seguir pidiéndola.
//
// Un paso sin clase declarada (los que existían antes de
// docs/medidas_tipo_requerido.sql, y los que el establecimiento arma sin
// comprometerse a una vía) se conforma con cualquiera: es el comportamiento
// viejo, y degradarlo a "ninguna" dejaría pidiendo medida a pasos que ya la
// tienen.
const CLASES_QUE_CUMPLEN = {
  proteccion: ['proteccion'],
  cautelar: ['cautelar'],
  disciplinaria: ['disciplinaria'],
  cualquiera: ['proteccion', 'cautelar', 'disciplinaria'],
};

/**
 * ¿Este paso ordena una medida que todavía no consta?
 *
 * El caso de 'sin_medida' no es un descuido sino una respuesta: varios pasos de
 * resolución preguntan `tipo_medida` y ofrecen resolver que no corresponde
 * sanción. Eso es una resolución válida y completa, y seguir reclamándole una
 * medida convertiría en infracción justo lo contrario de una infracción.
 */
const medidaPendienteDe = (paso, clasesPorPaso) => {
  if (!paso.requiere_medida) return false;
  if (paso.datos_salida?.tipo_medida === 'sin_medida') return false;
  const acepta = CLASES_QUE_CUMPLEN[paso.tipo_medida_requerida] ?? CLASES_QUE_CUMPLEN.cualquiera;
  const registradas = clasesPorPaso.get(paso.id_activado_paso);
  return !registradas || !acepta.some((c) => registradas.has(c));
};

const registrarEvento = (conn, { activado, paso = null, tipo, descripcion, id_usuario }) =>
  conn.query(
    `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
       (id_protocolo_activado, id_establecimiento, id_activado_paso, tipo_evento, descripcion, id_usuario, fecha)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [activado.id_protocolo_activado, activado.id_establecimiento, paso, tipo, descripcion, id_usuario]
  );

// Quién puede actuar sobre un paso, y a qué título. Devuelve:
//   'propio'      → tiene el rol del paso, o es el responsable asignado
//   'en_lugar_de' → no le toca, pero puede tomarlo igual (ver abajo)
//   null          → no puede
//
// Lo de 'en_lugar_de' no abre nada nuevo: quien tiene reasignar_paso ya podía
// hacer cualquier paso dando un rodeo —se lo reasignaba a sí mismo y quedaba
// como responsable—, y ese rodeo deja PEOR registro, porque sobrescribe al
// responsable original y el expediente termina diciendo que el paso siempre fue
// suyo. Acá se hace derecho y el paso conserva a su responsable, que es el dato
// que una fiscalización va a preguntar.
//
// El gate es reasignar_paso y no completar_paso a propósito: completar_paso lo
// tienen 13 roles (Funcionario, Docente, Profesor jefe...) y usarlo como gate le
// abriría los pasos del Director a todos ellos. reasignar_paso lo tienen solo
// los que gestionan el caso, que son justamente los que ya podían dar el rodeo.
const puedeActuar = async (req, paso, tipo_participacion) => {
  if ((req.user.roles ?? []).includes('ADMIN')) return 'propio';
  if (paso.id_usuario_responsable === req.user.id) return 'propio';

  const [rows] = await pool.query(
    `SELECT 1 FROM PROTOCOLO_ACTIVADO_PASO_ROL pr
     JOIN USUARIO_ROLES ur ON ur.rol_id = pr.rol_id
     WHERE pr.id_activado_paso = ? AND pr.tipo_participacion = ? AND ur.id_usuario = ?
       AND (ur.expira_at IS NULL OR ur.expira_at > NOW())
     LIMIT 1`,
    [paso.id_activado_paso, tipo_participacion, req.user.id]
  );
  if (rows.length > 0) return 'propio';

  return tienePermiso(req, Permiso.ProtocoloActivadoReasignarPaso) ? 'en_lugar_de' : null;
};

/**
 * Los roles a los que sí les tocaba el paso, para nombrarlos en el aviso y en
 * la bitácora. Sin esto el mensaje sería "este paso no es tuyo" a secas, que no
 * le dice a nadie de quién era.
 */
const rolesDelPaso = async (id_activado_paso, tipo_participacion) => {
  const [rows] = await pool.query(
    `SELECT r.nombre FROM PROTOCOLO_ACTIVADO_PASO_ROL pr
     JOIN ROLES r ON r.rol_id = pr.rol_id
     WHERE pr.id_activado_paso = ? AND pr.tipo_participacion = ?
     ORDER BY r.nombre`,
    [id_activado_paso, tipo_participacion]
  );
  return rows.map((r) => r.nombre).join(', ');
};

// Arranca un paso: lo pone en curso y le calcula el vencimiento. La fecha
// límite se calcula acá y no al activar el protocolo porque un paso que espera
// tres semanas en 'pendiente' no debería nacer ya vencido.
const iniciarPaso = async (conn, paso) => {
  const ahora = new Date();
  // Los feriados dependen de la región del establecimiento (hay feriados
  // regionales), así que se piden por caso y no una vez para todo el sistema.
  const feriados = await cargarFeriados(paso.id_establecimiento);
  const limite = calcularFechaLimite(ahora, paso.plazo_valor, paso.plazo_unidad, feriados);
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

// Las medidas de protección y las suspensiones cautelares "podrán extenderse
// hasta la conclusión del procedimiento respectivo" (art. 16 E letra j): cerrar
// el caso con una todavía corriendo es la infracción misma, así que acá no
// alcanza con un motivo como en el resto de los faltantes del cierre — se
// bloquea hasta que se concluyan o resuelvan. Lo usan el cierre a mano y el
// cierre automático del paso final, para que ninguna de las dos puertas lo
// saltee. Devuelve el mensaje para el 409, o null si no queda nada abierto.
const medidasAbiertasAlCerrar = async (conn, id_protocolo_activado) => {
  const [[{ proteccion }]] = await conn.query(
    `SELECT COUNT(*) AS proteccion FROM MEDIDA_PROTECCION
     WHERE id_protocolo_activado = ? AND estado = 'vigente'`,
    [id_protocolo_activado]
  );
  const [[{ cautelares }]] = await conn.query(
    `SELECT COUNT(*) AS cautelares FROM SUSPENSION_CAUTELAR
     WHERE id_protocolo_activado = ? AND estado <> 'resuelta'`,
    [id_protocolo_activado]
  );
  const abiertas = [
    proteccion > 0 ? `${proteccion} medida(s) de protección vigente(s)` : '',
    cautelares > 0 ? `${cautelares} suspensión(es) cautelar(es) sin resolver` : '',
  ].filter(Boolean);
  if (abiertas.length === 0) return null;
  return `No se puede cerrar el caso: quedan ${abiertas.join(' y ')}. ` +
    'Solo pueden extenderse hasta la conclusión del procedimiento (art. 16 E letra j): ' +
    'concluílas o resolvelas antes de cerrar.';
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
      `SELECT p.*, u.nombre AS responsable_nombre, u.correo AS responsable_correo
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

    const [involucrados] = await pool.query(
      `SELECT * FROM PROTOCOLO_ACTIVADO_INVOLUCRADO
       WHERE id_protocolo_activado = ? ORDER BY FIELD(rol, 'afectado','senalado','denunciante','testigo'), nombre`,
      [req.params.id]
    );

    // El hecho que se está tramitando. El caso solo guarda el id del registro,
    // y quien abre el protocolo tiene que poder leer de qué se trata sin salir
    // a buscarlo: los pasos se resuelven contra los antecedentes, no contra el
    // número. Pasa por reducirSiConfidencial como cualquier otra pantalla que
    // devuelva filas del registro.
    const [[registro]] = await pool.query(
      `SELECT r.id_registro, r.asunto, r.fecha_incidente, r.antecedentes, r.acuerdos,
              r.es_confidencial, r.nota_confidencial, r.id_usuario,
              r.fecha_creacion, tf.nombre AS tipo_falta_nombre, tf.gravedad,
              u.nombre AS autor_nombre, u.correo AS autor_correo
         FROM REGISTRO_CONVIVENCIA r
         JOIN TIPO_FALTA tf ON tf.id_tipo_falta = r.id_tipo_falta
         JOIN USUARIO    u  ON u.id_usuario     = r.id_usuario
        WHERE r.id_registro = ? AND r.id_establecimiento = ?`,
      [activado.id_registro, req.id_establecimiento]
    );
    // El cumplimiento por persona de los pasos que alcanzan a varios. Trae el
    // nombre del involucrado para que la pantalla no tenga que cruzarlo.
    const [porPersona] = await pool.query(
      `SELECT pi.*, i.nombre AS involucrado_nombre, i.rol AS involucrado_rol,
              i.rut AS involucrado_rut, i.curso AS involucrado_curso,
              (a.id_paso_involucrado IS NOT NULL) AS tiene_acta_firmada,
              -- Quién dejó la constancia. El dato ya se guardaba (pi.id_usuario)
              -- pero no salía a la pantalla, así que la notificación se leía
              -- como hecha por "el establecimiento" y no por una persona. El
              -- cargo va junto al nombre por lo mismo que en el acta: importa en
              -- qué calidad notificó, y el rol puede cambiar después.
              ur.nombre AS notificador_nombre,
              rn.nombre AS notificador_cargo
       FROM PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO pi
       LEFT JOIN PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO_ARCHIVO a
              ON a.id_paso_involucrado = pi.id_paso_involucrado
       LEFT JOIN USUARIO ur ON ur.id_usuario = pi.id_usuario
       LEFT JOIN ROLES   rn ON rn.rol_id = (
              SELECT ro.rol_id FROM USUARIO_ROLES uro
                JOIN ROLES ro ON ro.rol_id = uro.rol_id AND ro.activo = TRUE
               WHERE uro.id_usuario = ur.id_usuario
                 AND (uro.expira_at IS NULL OR uro.expira_at > NOW())
               LIMIT 1)
       JOIN PROTOCOLO_ACTIVADO_INVOLUCRADO i ON i.id_involucrado = pi.id_involucrado
       JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = pi.id_activado_paso
       WHERE p.id_protocolo_activado = ?
       ORDER BY FIELD(i.rol, 'afectado','senalado','denunciante','testigo'), i.nombre`,
      [req.params.id]
    );

    // Medidas disciplinarias ya registradas contra este caso. Cuelgan del
    // registro y no del caso; cuando vienen atadas a un paso (fase de
    // resolución) sirven para saber si el paso con requiere_medida ya tiene su
    // medida constando, igual que requiere_notificacion con la constancia. Se
    // traen todas (no solo las atadas a un paso) para que la pantalla pueda
    // anticipar, antes de cerrar, exactamente lo mismo que valida `cerrar()`.
    const [medidasDelCaso] = await pool.query(
      `SELECT id_activado_paso, resultado, estado, fecha_termino
       FROM MEDIDA_DISCIPLINARIA WHERE id_registro = ?`,
      [activado.id_registro]
    );
    // Qué clase de medida tiene ya cada paso, para contrastarla con la que pide.
    const clasesPorPaso = await clasesDeMedidaPorPaso(pool, {
      id_protocolo_activado: req.params.id,
      id_registro: activado.id_registro,
    });

    const hoyStr = new Date().toISOString().slice(0, 10);
    const medidasSinResultado = medidasDelCaso.filter((m) => !m.resultado).length;
    const medidasVencidasSinCerrar = medidasDelCaso.filter(
      (m) => m.estado === 'vigente' && m.fecha_termino !== null && m.fecha_termino < hoyStr
    ).length;

    // La rama que el caso no tomó se marca acá y no se guarda: la pantalla la
    // esconde para que la línea de tiempo muestre el recorrido real.
    const descartados = pasosDescartados(pasos, transiciones);

    // A qué título puede actuar quien está mirando, paso por paso. Se calcula
    // acá con lo que ya se leyó (los roles del grafo y los del token) en vez de
    // consultar por paso: es la misma regla de puedeActuar, sin viajes extra.
    //
    // Va en el detalle y no lo deduce la pantalla porque el frontend no tiene
    // por qué conocer la regla: si mañana cambia, cambia en un solo lado.
    const misRoles = req.user.roles ?? [];
    const esAdministrador = misRoles.includes('ADMIN');
    const puedeTomarAjenos = tienePermiso(req, Permiso.ProtocoloActivadoReasignarPaso);

    // El orden es el de puedeActuar y no otro: ser ADMIN o ser el responsable
    // asignado alcanza por sí solo, sin mirar los roles del paso.
    //
    // Acá había un corte previo —"si el paso no tiene rol de ese tipo, nadie
    // puede"— que dejaba pasos imposibles de avanzar: un paso guardado sin
    // ejecutor no le habilitaba el botón ni al ADMIN ni a su propio responsable,
    // aunque el endpoint de completar sí los aceptaba. La pantalla decía que no
    // y la API decía que sí, así que el caso se quedaba trabado sin explicación.
    // Un paso sin titular no es de nadie, y por eso mismo lo toma quien gestiona
    // el caso: queda como 'en_lugar_de' y la bitácora lo deja escrito.
    const tituloSobre = (paso, tipo_participacion) => {
      if (esAdministrador || paso.id_usuario_responsable === req.user.id) return 'propio';
      const delPaso = roles.filter(
        (r) => r.id_activado_paso === paso.id_activado_paso && r.tipo_participacion === tipo_participacion
      );
      if (delPaso.some((r) => misRoles.includes(r.rol_codigo))) return 'propio';
      return puedeTomarAjenos ? 'en_lugar_de' : null;
    };

    res.json({
      ...activado,
      registro: registro ? reducirSiConfidencial(req, registro) : null,
      involucrados,
      medidas_sin_resultado: medidasSinResultado,
      medidas_vencidas_sin_cerrar: medidasVencidasSinCerrar,
      pasos: pasos.map((p) => {
        const suyos = porPersona.filter((x) => x.id_activado_paso === p.id_activado_paso);
        const delPaso = roles.filter((r) => r.id_activado_paso === p.id_activado_paso);
        const nombresDe = (tipo) =>
          delPaso.filter((r) => r.tipo_participacion === tipo).map((r) => r.rol_nombre).join(', ');
        return {
          ...p,
          roles: delPaso,
          // 'propio' | 'en_lugar_de' | null. La pantalla lo usa para decidir si
          // muestra el botón y si antes pide confirmación.
          puede_ejecutar: tituloSobre(p, 'ejecutor'),
          puede_aprobar: tituloSobre(p, 'aprobador'),
          // De quién es el paso, ya armado para el mensaje del aviso.
          rol_ejecutor_nombre: nombresDe('ejecutor'),
          rol_aprobador_nombre: nombresDe('aprobador'),
          campos: camposDelPaso(p, campos.filter((c) => c.id_activado_paso === p.id_activado_paso)),
          vencido: p.estado === 'en_curso' && p.fecha_limite !== null && p.fecha_limite < new Date(),
          // Quedó colgado de una rama que no se tomó: no es un paso olvidado.
          descartado: descartados.has(p.id_activado_paso),
          involucrados: suyos,
          // Lo que la pantalla pinta en rojo: el paso se dio por hecho pero a
          // alguien todavía no consta que se le haya notificado. No bloquea
          // nada (decisión de la fase 12.3); se avisa y se exige motivo recién
          // al cerrar el caso.
          notificaciones_pendientes: p.requiere_notificacion
            ? suyos.filter((x) => x.estado !== 'no_aplica' && x.fecha_notificacion === null).length
            : 0,
          // Igual mecánica que arriba pero sin distinguir por persona: la
          // medida es una sola por paso, no una por involucrado.
          medida_pendiente: medidaPendienteDe(p, clasesPorPaso),
        };
      }),
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
      `SELECT e.*, u.nombre AS usuario_nombre, u.correo AS usuario_correo, p.nombre AS paso_nombre
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
            accion_al_vencer, es_paso_inicial, es_paso_final, id_paso_origen_catalogo,
            por_involucrado_rol, requiere_notificacion, requiere_medida, tipo_medida_requerida
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
              c.es_obligatorio, c.depende_de, c.orden
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
    `SELECT c.id_paso AS id_paso, c.codigo, c.etiqueta, c.tipo_campo, c.opciones, c.es_obligatorio,
            c.depende_de, c.orden
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
              COALESCE(pe.nombre, cp.nombre) AS nombre,
              pe.version,
              COALESCE(pe.ambito, cp.ambito, 'estudiante') AS ambito,
              COALESCE(cp.categoria_ley, 'otra')           AS categoria_ley
       FROM PROTOCOLO_ESTABLECIMIENTO pe
       LEFT JOIN CATALOGO_PROTOCOLOS_GENERICOS cp ON pe.id_protocolo = cp.id_protocolo
       WHERE pe.id_protocolo_establecimiento = ? AND pe.id_establecimiento = ?`,
      [id_protocolo_establecimiento, req.id_establecimiento]
    );
    if (pes.length === 0)
      return res.status(404).json({ message: 'Protocolo de establecimiento no encontrado' });
    const pe = pes[0];

    // El registro tiene que ser del mismo colegio: se compara contra su propia
    // columna de tenant (antes se derivaba del autor, y eso dejaba fuera todo
    // lo creado por un ADMIN, que es global).
    const [reg] = await pool.query(
      `SELECT r.id_registro FROM REGISTRO_CONVIVENCIA r
       WHERE r.id_registro = ? AND r.id_establecimiento = ?`,
      [id_registro, req.id_establecimiento]
    );
    if (reg.length === 0)
      return res.status(404).json({ message: 'Registro de convivencia no encontrado' });

    const fuente = await cargarGrafoFuente(pe);
    if (fuente.error) return res.status(409).json({ message: fuente.error });

    // Se valida ANTES de materializar: un grafo roto copiado a un caso es un
    // caso que se atasca a mitad de camino y ya no se puede arreglar editando
    // la plantilla, porque el caso dejó de leerla.
    const problemas = validarGrafo(fuente.pasos, fuente.transiciones, fuente.campos);
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

      // El nombre y la versión se congelan junto con el grafo. Hasta ahora el
      // nombre se heredaba en vivo por COALESCE desde el genérico: si el ADMIN
      // lo corregía después, un expediente de marzo terminaba mostrando un
      // nombre que no era el vigente el día en que el caso se activó.
      //
      // fecha_limite_investigacion materializa el techo del art. 16 E letra g:
      // 2 meses cuando el involucrado es estudiante. Para protocolos de
      // personal no aplica — esos van por el Título V de la Ley 18.834 o la
      // Ley 18.883, con sus propios plazos.
      const limiteInvestigacion = pe.ambito === 'personal' ? null : (() => {
        const f = new Date();
        f.setUTCMonth(f.getUTCMonth() + 2);
        return f.toISOString().slice(0, 10);
      })();

      const [cab] = await conn.query(
        `INSERT INTO PROTOCOLO_ACTIVADO
           (id_protocolo_establecimiento, id_registro, id_establecimiento, estado,
            nombre_protocolo, version_protocolo, categoria_ley,
            id_usuario_activo, fecha_activacion, fecha_limite_investigacion)
         VALUES (?, ?, ?, 'activo', ?, ?, ?, ?, NOW(), ?)`,
        [id_protocolo_establecimiento, id_registro, req.id_establecimiento,
         pe.nombre, pe.version, pe.categoria_ley, req.user.id, limiteInvestigacion]
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
              plazo_valor, plazo_unidad, accion_al_vencer, por_involucrado_rol, requiere_notificacion,
              requiere_medida, tipo_medida_requerida)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id_protocolo_activado, req.id_establecimiento,
            fuente.esEspejo ? p.id_paso_origen_catalogo : p.id_paso,
            fuente.esEspejo ? p.id_paso : null,
            p.nombre, p.descripcion, p.tipo_paso, p.es_paso_inicial, p.es_paso_final,
            p.plazo_valor, p.plazo_unidad, p.accion_al_vencer,
            p.por_involucrado_rol ?? null, p.requiere_notificacion ?? 0, p.requiere_medida ?? 0,
            p.tipo_medida_requerida ?? null,
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
             (id_activado_paso, codigo, etiqueta, tipo_campo, opciones, es_obligatorio, depende_de, orden)
           VALUES ?`,
          [fuente.campos.map((c) => [
            mapa.get(c.id_paso), c.codigo, c.etiqueta, c.tipo_campo,
            c.opciones === null ? null : JSON.stringify(c.opciones),
            c.es_obligatorio, c.depende_de ?? null, c.orden,
          ])]
        );

      // Los involucrados se copian del registro y se congelan con su nombre:
      // el expediente se conserva 24 meses y el estudiante puede egresar. Un
      // caso se instruye CONTRA alguien, así que sin esto el expediente no
      // puede decir contra quién.
      const [delRegistro] = await conn.query(
        `SELECT re.id_estudiante, re.rol_en_incidente,
                CONCAT(e.nombre, ' ', e.apellido) AS nombre,
                CONCAT(e.run, '-', e.dv) AS rut, c.nombre AS curso
         FROM REGISTRO_ESTUDIANTE re
         JOIN ESTUDIANTE e ON e.id_estudiante = re.id_estudiante
         LEFT JOIN CURSO c ON c.id_curso = e.id_curso
         WHERE re.id_registro = ?`,
        [id_registro]
      );
      const involucrados = [];
      for (const i of delRegistro) {
        const [r] = await conn.query(
          `INSERT INTO PROTOCOLO_ACTIVADO_INVOLUCRADO
             (id_protocolo_activado, id_establecimiento, tipo_persona, id_estudiante,
              nombre, rut, curso, rol, id_usuario_registro)
           VALUES (?, ?, 'estudiante', ?, ?, ?, ?, ?, ?)`,
          [id_protocolo_activado, req.id_establecimiento, i.id_estudiante,
           i.nombre, i.rut, i.curso, i.rol_en_incidente, req.user.id]
        );
        involucrados.push({ id_involucrado: r.insertId, rol: i.rol_en_incidente, nombre: i.nombre });
      }

      // El denunciante (u otro involucrado) que no es estudiante se copia
      // igual: un inspector o un profesor que reportó el hecho también tiene
      // que quedar contra quién — o mejor dicho, a nombre de quién — se
      // instruyó el caso. Sin esto quedaba anotado en el registro pero se
      // perdía apenas se activaba el protocolo.
      const [personalDelRegistro] = await conn.query(
        `SELECT tipo_persona, id_usuario, nombre, rut, rol_en_incidente
         FROM REGISTRO_INVOLUCRADO_NO_ESTUDIANTE
         WHERE id_registro = ?`,
        [id_registro]
      );
      for (const i of personalDelRegistro) {
        const [r] = await conn.query(
          `INSERT INTO PROTOCOLO_ACTIVADO_INVOLUCRADO
             (id_protocolo_activado, id_establecimiento, tipo_persona, id_usuario,
              nombre, rut, rol, id_usuario_registro)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id_protocolo_activado, req.id_establecimiento, i.tipo_persona, i.id_usuario,
           i.nombre, i.rut, i.rol_en_incidente, req.user.id]
        );
        involucrados.push({ id_involucrado: r.insertId, rol: i.rol_en_incidente, nombre: i.nombre });
      }

      // Los pasos que se cumplen una vez por persona reciben acá su fila por
      // cada involucrado que corresponda. El paso sigue siendo un solo nodo
      // del grafo: lo que se multiplica es el registro de cumplimiento.
      const filasPorPersona = [];
      for (const p of fuente.pasos)
        for (const i of involucradosDelPaso(p, involucrados))
          filasPorPersona.push([mapa.get(p.id_paso), i.id_involucrado]);
      if (filasPorPersona.length > 0)
        await conn.query(
          'INSERT INTO PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO (id_activado_paso, id_involucrado) VALUES ?',
          [filasPorPersona]
        );

      const activado = { id_protocolo_activado, id_establecimiento: req.id_establecimiento };
      await registrarEvento(conn, {
        activado, tipo: 'activacion', id_usuario: req.user.id,
        descripcion:
          `Protocolo activado sobre el registro ${id_registro} (flujo ${fuente.origen})` +
          (involucrados.length
            ? ` — involucrados: ${involucrados.map((i) => `${i.nombre} (${i.rol})`).join(', ')}`
            : ' — sin involucrados registrados'),
      });

      // El paso inicial arranca en curso: un protocolo recién activado con
      // todo en 'pendiente' no le aparece a nadie por hacer.
      const inicial = fuente.pasos.find((p) => p.es_paso_inicial);
      const idInicial = mapa.get(inicial.id_paso);
      const pasoInicial = await buscarPasoActivadoEn(conn, idInicial);
      const limite = await iniciarPaso(conn, pasoInicial);
      await registrarEvento(conn, {
        activado, paso: idInicial, tipo: 'inicio_paso', id_usuario: req.user.id,
        descripcion: `Inicia ${inicial.nombre}${limite ? ` con plazo hasta ${limite.toISOString()}` : ''}`,
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
    // El que llama hace rollback con el error, así que el paso tampoco queda
    // marcado como completado.
    const abiertas = await medidasAbiertasAlCerrar(conn, activado.id_protocolo_activado);
    if (abiertas) return { error: abiertas };
    await cerrarProtocolo(conn, activado.id_protocolo_activado);
    await registrarEvento(conn, {
      activado, paso: paso.id_activado_paso, tipo: 'cierre', id_usuario: req.user.id,
      descripcion: `Protocolo cerrado al completarse el paso final ${paso.nombre}`,
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
    descripcion: `${paso.nombre} → ${destino.nombre}` +
      // Por qué rama salió es vocabulario del grafo: se anota sólo cuando hubo
      // una condición que evaluar. Decir "(rama por defecto)" no informaba nada
      // y ensuciaba el expediente.
      (elegida.transicion.condicion ? ` (condición ${elegida.transicion.condicion})` : ''),
  });
  await registrarEvento(conn, {
    activado, paso: destino.id_activado_paso, tipo: 'inicio_paso', id_usuario: req.user.id,
    descripcion: `Inicia ${destino.nombre}${limite ? ` con plazo hasta ${limite.toISOString()}` : ''}`,
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
  const titulo = await puedeActuar(req, paso, tipo_participacion);
  if (!titulo) {
    res.status(403).json({
      message: `No tienes el rol de ${tipo_participacion} para este paso.`,
    });
    return null;
  }

  // Quién debía hacerlo, cuando no es quien lo está haciendo. Se resuelve acá
  // —una sola vez, y solo en ese caso— para que las tres acciones de avance lo
  // dejen escrito igual en la bitácora sin repetir la consulta.
  const enLugarDe = titulo === 'en_lugar_de'
    ? (await rolesDelPaso(paso.id_activado_paso, tipo_participacion)) || null
    : null;

  return { activado, paso, enLugarDe };
};

/** Sufijo para la bitácora: deja constancia de que el acto no lo hizo su titular. */
const sufijoEnLugarDe = (enLugarDe) =>
  enLugarDe ? ` (en lugar del rol ${enLugarDe})` : '';

const completarPaso = async (req, res) => {
  try {
    const ctx = await prepararAccion(req, res, 'ejecutor');
    if (!ctx) return;
    const { activado, paso, enLugarDe } = ctx;

    if (esPasoDeAprobacion(paso.tipo_paso))
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
        evento: 'completado_paso',
        descripcion: `Completa ${paso.nombre}${sufijoEnLugarDe(enLugarDe)}`,
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
    const { activado, paso, enLugarDe } = ctx;

    if (!esPasoDeAprobacion(paso.tipo_paso))
      return res.status(409).json({ message: 'Este paso no es de tipo aprobación.' });

    // El comentario es obligatorio cuando la decisión necesita fundamento: un
    // rechazo sin motivo deja al siguiente sin saber qué corregir, y una
    // aprobación firmada en lugar del rol titular tiene que decir por qué la
    // tomó otro. Si la aprueba su propio titular, el comentario es opcional.
    if ((!aprobado || enLugarDe) && !comentario?.trim())
      return res.status(400).json({
        message: aprobado
          ? `Debes indicar por qué apruebas este paso en lugar del rol ${enLugarDe}.`
          : 'Debes indicar el motivo del rechazo.',
      });

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
        descripcion: `${aprobado ? 'Aprueba' : 'Rechaza'} ${paso.nombre}` +
          sufijoEnLugarDe(enLugarDe) +
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
    const { activado, paso, enLugarDe } = ctx;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const r = await avanzar(conn, {
        req, activado, paso, estadoFinal: 'omitido', datos: null,
        evento: 'omitido_paso',
        descripcion: `Omite ${paso.nombre}${sufijoEnLugarDe(enLugarDe)}: ${motivo}`,
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
      'SELECT nombre, correo FROM USUARIO WHERE id_usuario = ? AND id_establecimiento = ? AND activo = 1',
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
        descripcion: `Responsable de ${paso.nombre} asignado a ${u[0].nombre || u[0].correo}`,
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

    // Va antes que los faltantes que se salvan con motivo: este no se salva.
    const abiertas = await medidasAbiertasAlCerrar(pool, req.params.id);
    if (abiertas) return res.status(409).json({ message: abiertas });

    // Los pasos de una rama que el caso no tomó están pendientes y van a
    // quedarlo siempre: exigir un motivo por ellos sería pedir que se
    // justifique no haber hecho algo que nunca correspondía hacer.
    const [pasosDelCaso] = await pool.query(
      `SELECT id_activado_paso, estado, datos_salida, requiere_medida, tipo_medida_requerida
       FROM PROTOCOLO_ACTIVADO_PASO WHERE id_protocolo_activado = ?`,
      [req.params.id]
    );
    const [transicionesDelCaso] = await pool.query(
      'SELECT * FROM PROTOCOLO_ACTIVADO_TRANSICION WHERE id_protocolo_activado = ?',
      [req.params.id]
    );
    const descartados = pasosDescartados(pasosDelCaso, transicionesDelCaso);
    const pendientes = pasosDelCaso.filter(
      (p) => ['pendiente', 'en_curso'].includes(p.estado) && !descartados.has(p.id_activado_paso)
    ).length;
    if (pendientes > 0 && !motivo)
      return res.status(400).json({
        message: `Quedan ${pendientes} paso(s) sin completar. Para cerrar igual, indica un motivo.`,
      });

    // Una notificación sin constancia no detiene el protocolo mientras corre
    // (fase 12.3), pero el cierre es la última oportunidad de dejar dicho por
    // qué se cerró sin ella. Mismo mecanismo que los pasos sin completar: no se
    // prohíbe, se exige explicación, que es lo que la fiscalización va a leer.
    //
    // Los pasos descartados quedan fuera por la misma razón que arriba: una
    // notificación que pertenece a una rama que el caso no tomó no es una
    // notificación pendiente.
    const [sinNotificar] = await pool.query(
      `SELECT pi.id_activado_paso FROM PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO pi
       JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = pi.id_activado_paso
       WHERE p.id_protocolo_activado = ? AND p.requiere_notificacion = 1
         AND pi.estado <> 'no_aplica' AND pi.fecha_notificacion IS NULL`,
      [req.params.id]
    );
    const faltanNotificar = sinNotificar.filter((g) => !descartados.has(g.id_activado_paso)).length;
    if (faltanNotificar > 0 && !motivo)
      return res.status(400).json({
        message: `Hay ${faltanNotificar} persona(s) sin constancia de notificación. Para cerrar igual, indica un motivo.`,
      });

    // Mismo mecanismo, ahora sobre las medidas: un paso de resolución que
    // ordena una medida y no la tiene, una medida sin resultado (el dato que
    // el informe de expulsión exige "con indicación de los resultados
    // obtenidos"), o una suspensión vencida con el caso todavía activo — que es
    // justo la infracción del art. 16 E letra j / Circular 482, no al revés.
    // No se bloquea nada: se exige explicación, igual que arriba.
    const [medidas] = await pool.query(
      `SELECT id_activado_paso, resultado, estado, fecha_termino
       FROM MEDIDA_DISCIPLINARIA WHERE id_registro = ?`,
      [activado.id_registro]
    );
    const clasesPorPaso = await clasesDeMedidaPorPaso(pool, {
      id_protocolo_activado: req.params.id,
      id_registro: activado.id_registro,
    });
    // Los pasos ya vienen leídos arriba con lo que hace falta para decidir
    // —requiere_medida, la clase que piden y los datos con que se resolvieron—,
    // así que la consulta aparte que traía solo los ids sobraba.
    const pasosSinMedida = pasosDelCaso.filter(
      (p) => !descartados.has(p.id_activado_paso) && medidaPendienteDe(p, clasesPorPaso)
    ).length;
    const hoy = new Date().toISOString().slice(0, 10);
    const sinResultado = medidas.filter((m) => !m.resultado).length;
    const vencidasSinCerrar = medidas.filter(
      (m) => m.estado === 'vigente' && m.fecha_termino !== null && m.fecha_termino < hoy
    ).length;
    const faltantesMedida = [
      pasosSinMedida > 0 ? `${pasosSinMedida} paso(s) sin medida registrada` : '',
      sinResultado > 0 ? `${sinResultado} medida(s) sin resultado` : '',
      vencidasSinCerrar > 0 ? `${vencidasSinCerrar} medida(s) vencida(s) sin cerrar` : '',
    ].filter(Boolean);
    if (faltantesMedida.length > 0 && !motivo)
      return res.status(400).json({
        message: `${faltantesMedida.join(', ')}. Para cerrar igual, indica un motivo.`,
      });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Los descartados se dejan en 'pendiente' a propósito: marcarlos
      // 'omitido' los volvía indistinguibles de un paso que sí correspondía y
      // no se hizo, y `pasosDescartados` solo reconoce los pendientes. Es
      // además cómo quedan cuando el caso cierra por el flujo normal, así que
      // el cierre a mano deja de producir un estado distinto.
      await conn.query(
        `UPDATE PROTOCOLO_ACTIVADO_PASO SET estado = 'omitido'
         WHERE id_protocolo_activado = ? AND estado IN ('pendiente','en_curso')
           ${descartados.size ? 'AND id_activado_paso NOT IN (?)' : ''}`,
        descartados.size ? [req.params.id, [...descartados]] : [req.params.id]
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
    // El mensaje depende del estado porque anular solo acepta casos activos:
    // sugerírselo a un caso ya cerrado mandaba a la persona a un botón que
    // siempre iba a estar apagado, sin decirle por qué.
    if (avanzados[0].c > 0)
      return res.status(409).json({
        message: activado.estado === 'activo'
          ? 'Este protocolo ya tiene pasos ejecutados: eliminarlo borraría la bitácora. Anúlalo en su lugar.'
          : `Este protocolo está ${activado.estado} y ya tiene pasos ejecutados: su bitácora es el registro del caso tramitado y no se elimina.`,
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
