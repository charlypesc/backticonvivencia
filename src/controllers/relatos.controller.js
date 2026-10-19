// Acogida de relatos: el paso estándar de todos los protocolos.
//
// En un paso de tipo 'acogida_relatos' se hacen dos cosas, en orden:
//
//  1. Se decide a quién se le acoge el relato. La lista es la de TODOS los
//     involucrados del caso (testigos incluidos, y los que se incorporen
//     después). A quien no se le acoge, se le pide el porqué: un relato que
//     falta sin explicación es lo primero que se objeta del procedimiento.
//  2. Se registra el relato de cada persona elegida. Una persona puede tener
//     varios (una segunda entrevista), y el coordinador puede seguir
//     agregando aunque el paso ya se haya completado, mientras el caso siga
//     activo.
//
// Nada de esto se borra. Un relato se puede corregir, pero el texto anterior
// queda en PROTOCOLO_ACTIVADO_RELATO_VERSION y sale en el expediente, junto
// con la fecha y hora en que se ingresó cada uno y quién lo hizo. Cada
// decisión, relato y corrección deja además su evento en la bitácora.
//
// No reusa PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO: esas filas se materializan
// por rol al activar y 'todos' deja fuera a los testigos; acá la lista es la
// del caso, siempre completa.
const pool = require('../db/connection');
const { etiquetaDe } = require('../utils/etiquetas');
const { tienePermiso } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');
const { tieneAccesoCompleto } = require('../utils/accesoCaso');
const notificaciones = require('../services/notificaciones.service');

const TIPO_PASO_RELATOS = 'acogida_relatos';
const MAX_MOTIVO = 1000;
// Un relato puede ser largo (una entrevista transcrita), pero no infinito: la
// columna es TEXT (64 KB) y el texto viaja entero al expediente.
const MAX_RELATO = 20000;

const registrarEvento = (conn, { id_protocolo_activado, id_establecimiento, paso, tipo, descripcion, id_usuario }) =>
  conn.query(
    `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
       (id_protocolo_activado, id_establecimiento, id_activado_paso, tipo_evento, descripcion, id_usuario, fecha)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [id_protocolo_activado, id_establecimiento, paso, tipo, descripcion, id_usuario]
  );

/**
 * Hasta dónde llega quien mira en los relatos de un paso.
 *
 *  - `todo`: ve y trabaja los relatos de todas las personas. Lo tiene quien ve
 *    el caso completo (utils/accesoCaso.js), el responsable asignado del paso,
 *    y quien es ejecutor del paso por su rol y puede completar pasos.
 *  - `asignados`: las personas cuyo relato le encargaron. Ve y trabaja solo
 *    esos: no los demás relatos ni los demás pasos del caso.
 *
 * Es una función pura sobre datos ya leídos, para que el detalle del caso (que
 * ya los tiene) no repita consultas; `alcanceRelatos` la usa leyéndolos.
 */
const alcanceRelatosDe = ({ verCompleto, paso, id_usuario, misRoles, rolesDelPaso, puedeCompletar, decisiones }) => {
  const ejecutorPorRol = rolesDelPaso.some(
    (r) => r.tipo_participacion === 'ejecutor' && misRoles.includes(r.rol_codigo));
  return {
    todo: verCompleto || paso.id_usuario_responsable === id_usuario || (puedeCompletar && ejecutorPorRol),
    asignados: new Set(
      decisiones
        .filter((d) => d.id_activado_paso === paso.id_activado_paso && d.id_usuario_responsable === id_usuario)
        .map((d) => d.id_involucrado)),
  };
};

const alcanceRelatos = async (req, caso, paso) => {
  const [rolesDelPaso] = await pool.query(
    `SELECT pr.tipo_participacion, r.codigo AS rol_codigo FROM PROTOCOLO_ACTIVADO_PASO_ROL pr
     JOIN ROLES r ON r.rol_id = pr.rol_id WHERE pr.id_activado_paso = ?`,
    [paso.id_activado_paso]
  );
  const [decisiones] = await pool.query(
    'SELECT * FROM PROTOCOLO_ACTIVADO_RELATO_DECISION WHERE id_activado_paso = ?',
    [paso.id_activado_paso]
  );
  return alcanceRelatosDe({
    verCompleto: await tieneAccesoCompleto(pool, req, caso.id_protocolo_activado),
    paso, id_usuario: req.user.id, misRoles: req.user.roles ?? [], rolesDelPaso,
    puedeCompletar: tienePermiso(req, Permiso.ProtocoloActivadoCompletarPaso),
    decisiones,
  });
};

const alcanza = (alcance, id_involucrado) => alcance.todo || alcance.asignados.has(Number(id_involucrado));

const SIN_ALCANCE = 'Este relato no te fue asignado: solo puedes trabajar los relatos que te encargaron.';

/**
 * Lo que los tres endpoints comprueban antes de tocar nada: que el caso sea
 * de este colegio y esté activo, que el paso sea suyo y de acogida de
 * relatos, que el protocolo ya haya llegado a él, y —si viene— que la persona
 * sea un involucrado del caso. Responde el error y devuelve null si algo
 * falla.
 */
const contexto = async (req, res, id_involucrado = null) => {
  const [[caso]] = await pool.query(
    'SELECT * FROM PROTOCOLO_ACTIVADO WHERE id_protocolo_activado = ? AND id_establecimiento = ?',
    [req.params.id, req.id_establecimiento]
  );
  if (!caso) {
    res.status(404).json({ message: 'Protocolo activado no encontrado' });
    return null;
  }
  if (caso.estado !== 'activo') {
    res.status(409).json({ message: `El protocolo está ${caso.estado}: ya no admite relatos.` });
    return null;
  }
  const [[paso]] = await pool.query(
    'SELECT * FROM PROTOCOLO_ACTIVADO_PASO WHERE id_activado_paso = ? AND id_protocolo_activado = ?',
    [req.params.id_paso, req.params.id]
  );
  if (!paso) {
    res.status(404).json({ message: 'Paso no encontrado en este protocolo' });
    return null;
  }
  if (paso.tipo_paso !== TIPO_PASO_RELATOS) {
    res.status(409).json({ message: 'Este paso no es de acogida de relatos.' });
    return null;
  }
  // Completado sí: el coordinador puede agregar relatos después. Pendiente no
  // (el protocolo no llegó) ni omitido (se decidió no hacerlo, con motivo).
  if (!['en_curso', 'vencido', 'completado'].includes(paso.estado)) {
    res.status(409).json({
      message: paso.estado === 'pendiente'
        ? 'Este paso todavía no está en curso: el protocolo no llegó hasta él.'
        : `El paso está ${etiquetaDe(paso.estado, 'estado_paso').toLowerCase()}: no admite relatos.`,
    });
    return null;
  }
  const alcance = await alcanceRelatos(req, caso, paso);
  if (!alcance.todo && alcance.asignados.size === 0) {
    res.status(403).json({ message: 'No tienes acceso a los relatos de este caso.' });
    return null;
  }
  let involucrado = null;
  if (id_involucrado !== null) {
    if (!alcanza(alcance, id_involucrado)) {
      res.status(403).json({ message: SIN_ALCANCE });
      return null;
    }
    [[involucrado]] = await pool.query(
      'SELECT * FROM PROTOCOLO_ACTIVADO_INVOLUCRADO WHERE id_involucrado = ? AND id_protocolo_activado = ?',
      [id_involucrado, req.params.id]
    );
    if (!involucrado) {
      res.status(404).json({ message: 'La persona no es un involucrado de este caso' });
      return null;
    }
  }
  return { caso, paso, involucrado, alcance };
};

const quien = (i) => `${i.nombre} (${etiquetaDe(i.rol, 'rol_involucrado').toLowerCase()})`;

/** PUT /:id/pasos/:id_paso/relatos/personas/:id_involucrado — { se_acoge, motivo } */
const decidir = async (req, res) => {
  const { se_acoge, motivo } = req.body ?? {};
  if (typeof se_acoge !== 'boolean')
    return res.status(400).json({ message: 'se_acoge debe ser true o false' });
  const motivoLimpio = (motivo ?? '').trim();
  if (!se_acoge && motivoLimpio.length < 5)
    return res.status(400).json({ message: 'Explica por qué no se le acoge el relato a esta persona.' });
  if (motivoLimpio.length > MAX_MOTIVO)
    return res.status(400).json({ message: `El motivo no puede pasar de ${MAX_MOTIVO} caracteres.` });

  try {
    const ctx = await contexto(req, res, req.params.id_involucrado);
    if (!ctx) return;
    const { caso, paso, involucrado } = ctx;

    // Decir que no se le acoge a quien ya tiene un relato en el paso dejaría el
    // expediente contradiciéndose: el relato está ahí.
    if (!se_acoge) {
      const [[{ n }]] = await pool.query(
        'SELECT COUNT(*) AS n FROM PROTOCOLO_ACTIVADO_RELATO WHERE id_activado_paso = ? AND id_involucrado = ?',
        [paso.id_activado_paso, involucrado.id_involucrado]
      );
      if (n > 0)
        return res.status(409).json({
          message: `${involucrado.nombre} ya tiene ${n === 1 ? 'un relato acogido' : `${n} relatos acogidos`} en este paso.`,
        });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO PROTOCOLO_ACTIVADO_RELATO_DECISION
           (id_activado_paso, id_involucrado, se_acoge, motivo, id_usuario)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE se_acoge = VALUES(se_acoge), motivo = VALUES(motivo),
           id_usuario = VALUES(id_usuario), fecha_modificacion = NOW()`,
        [paso.id_activado_paso, involucrado.id_involucrado, se_acoge, se_acoge ? null : motivoLimpio, req.user.id]
      );
      await registrarEvento(conn, {
        id_protocolo_activado: caso.id_protocolo_activado, id_establecimiento: req.id_establecimiento,
        paso: paso.id_activado_paso, tipo: 'relato_decision', id_usuario: req.user.id,
        descripcion: se_acoge
          ? `${paso.nombre} — se acogerá el relato de ${quien(involucrado)}`
          : `${paso.nombre} — no se acoge el relato de ${quien(involucrado)}. Motivo: ${motivoLimpio}`,
      });
      await conn.commit();
      res.json({ message: se_acoge ? 'Se acogerá su relato' : 'Motivo registrado' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al registrar la decisión' });
  }
};

/**
 * POST /:id/pasos/:id_paso/relatos — { id_involucrado, relato }
 *
 * Solo el texto. Quién estuvo presente (el apoderado, otro adulto) se cuenta en
 * el propio relato: la ley no exige la presencia del apoderado en la entrevista
 * del estudiante, y un selector obligatorio la hacía parecer un requisito.
 * Tampoco se marca si quien relata es profesional de la educación afectado: la
 * ley le da ese peso por sí sola (art. 8 bis inc. 10° del Estatuto Docente) y
 * la pantalla solo lo avisa.
 */
const acoger = async (req, res) => {
  const { id_involucrado, relato } = req.body ?? {};
  const texto = (relato ?? '').trim();
  if (!id_involucrado) return res.status(400).json({ message: 'Indica de quién es el relato.' });
  if (!texto) return res.status(400).json({ message: 'El relato está vacío.' });
  if (texto.length > MAX_RELATO)
    return res.status(400).json({ message: `El relato no puede pasar de ${MAX_RELATO} caracteres.` });

  try {
    const ctx = await contexto(req, res, id_involucrado);
    if (!ctx) return;
    const { caso, paso, involucrado } = ctx;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Acoger un relato es por sí mismo decidir que se le acoge: si estaba
      // marcada como "no se acoge", queda corregido (y el motivo, en la
      // bitácora, donde ya estaba escrito).
      await conn.query(
        `INSERT INTO PROTOCOLO_ACTIVADO_RELATO_DECISION
           (id_activado_paso, id_involucrado, se_acoge, motivo, id_usuario)
         VALUES (?, ?, 1, NULL, ?)
         ON DUPLICATE KEY UPDATE
           fecha_modificacion = IF(se_acoge = 1, fecha_modificacion, NOW()),
           se_acoge = 1, motivo = NULL`,
        [paso.id_activado_paso, involucrado.id_involucrado, req.user.id]
      );
      const [r] = await conn.query(
        `INSERT INTO PROTOCOLO_ACTIVADO_RELATO
           (id_activado_paso, id_involucrado, relato, id_usuario)
         VALUES (?, ?, ?, ?)`,
        [paso.id_activado_paso, involucrado.id_involucrado, texto, req.user.id]
      );
      await registrarEvento(conn, {
        id_protocolo_activado: caso.id_protocolo_activado, id_establecimiento: req.id_establecimiento,
        paso: paso.id_activado_paso, tipo: 'relato_acogido', id_usuario: req.user.id,
        descripcion:
          `${paso.nombre} — se acoge el relato de ${quien(involucrado)}` +
          (paso.estado === 'completado' ? ' (agregado con el paso ya completado)' : ''),
      });
      await conn.commit();
      res.status(201).json({ id_relato: r.insertId, message: 'Relato acogido' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al acoger el relato' });
  }
};

/** PUT /:id/pasos/:id_paso/relatos/:id_relato — { relato } */
const editar = async (req, res) => {
  const texto = (req.body?.relato ?? '').trim();
  if (!texto) return res.status(400).json({ message: 'El relato está vacío.' });
  if (texto.length > MAX_RELATO)
    return res.status(400).json({ message: `El relato no puede pasar de ${MAX_RELATO} caracteres.` });

  try {
    const ctx = await contexto(req, res);
    if (!ctx) return;
    const { caso, paso, alcance } = ctx;

    const [[actual]] = await pool.query(
      `SELECT r.*, i.nombre, i.rol FROM PROTOCOLO_ACTIVADO_RELATO r
       JOIN PROTOCOLO_ACTIVADO_INVOLUCRADO i ON i.id_involucrado = r.id_involucrado
       WHERE r.id_relato = ? AND r.id_activado_paso = ?`,
      [req.params.id_relato, paso.id_activado_paso]
    );
    if (!actual) return res.status(404).json({ message: 'Relato no encontrado en este paso' });
    // Corregir un relato es leerlo: mismo alcance que en el detalle.
    if (!alcanza(alcance, actual.id_involucrado)) return res.status(403).json({ message: SIN_ALCANCE });
    if (actual.relato === texto) return res.json({ message: 'Sin cambios' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Lo que decía antes, con quién y cuándo lo había dejado así.
      await conn.query(
        `INSERT INTO PROTOCOLO_ACTIVADO_RELATO_VERSION (id_relato, relato, id_usuario, fecha)
         VALUES (?, ?, ?, COALESCE(?, ?))`,
        [actual.id_relato, actual.relato,
         actual.id_usuario_modificacion ?? actual.id_usuario,
         actual.fecha_modificacion, actual.fecha_registro]
      );
      await conn.query(
        `UPDATE PROTOCOLO_ACTIVADO_RELATO
         SET relato = ?, id_usuario_modificacion = ?, fecha_modificacion = NOW()
         WHERE id_relato = ?`,
        [texto, req.user.id, actual.id_relato]
      );
      await registrarEvento(conn, {
        id_protocolo_activado: caso.id_protocolo_activado, id_establecimiento: req.id_establecimiento,
        paso: paso.id_activado_paso, tipo: 'relato_editado', id_usuario: req.user.id,
        descripcion: `${paso.nombre} — se corrige el relato de ${quien(actual)}`,
      });
      await conn.commit();
      res.json({ message: 'Relato corregido' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al corregir el relato' });
  }
};

/**
 * Las decisiones, relatos y versiones de todos los pasos de relatos de un
 * caso, en tres consultas. Lo usan el detalle del caso y el expediente.
 */
const relatosDelCaso = async (db, id_protocolo_activado) => {
  const [decisiones] = await db.query(
    `SELECT d.*, u.nombre AS usuario_nombre, u.correo AS usuario_correo,
            ur.nombre AS responsable_nombre, ur.correo AS responsable_correo
     FROM PROTOCOLO_ACTIVADO_RELATO_DECISION d
     JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = d.id_activado_paso
     LEFT JOIN USUARIO u  ON u.id_usuario  = d.id_usuario
     LEFT JOIN USUARIO ur ON ur.id_usuario = d.id_usuario_responsable
     WHERE p.id_protocolo_activado = ?`,
    [id_protocolo_activado]
  );
  const [relatos] = await db.query(
    `SELECT r.*, u.nombre AS usuario_nombre, u.correo AS usuario_correo,
            um.nombre AS modificado_por_nombre, um.correo AS modificado_por_correo
     FROM PROTOCOLO_ACTIVADO_RELATO r
     JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = r.id_activado_paso
     LEFT JOIN USUARIO u  ON u.id_usuario  = r.id_usuario
     LEFT JOIN USUARIO um ON um.id_usuario = r.id_usuario_modificacion
     WHERE p.id_protocolo_activado = ?
     ORDER BY r.fecha_registro, r.id_relato`,
    [id_protocolo_activado]
  );
  const ids = relatos.map((r) => r.id_relato);
  const [versiones] = ids.length
    ? await db.query(
        `SELECT v.*, u.nombre AS usuario_nombre, u.correo AS usuario_correo
         FROM PROTOCOLO_ACTIVADO_RELATO_VERSION v
         LEFT JOIN USUARIO u ON u.id_usuario = v.id_usuario
         WHERE v.id_relato IN (?) ORDER BY v.fecha, v.id_version`,
        [ids])
    : [[]];
  return { decisiones, relatos, versiones };
};

/**
 * Qué impide completar un paso de relatos, en castellano. Vacío si está listo.
 *
 * Cada involucrado tiene que tener una decisión: a los que se les acoge, al
 * menos un relato; a los que no, el motivo (ya se exige al guardarlo).
 */
const faltantesDeRelatos = async (db, paso) => {
  const [personas] = await db.query(
    `SELECT i.nombre, d.se_acoge,
            (SELECT COUNT(*) FROM PROTOCOLO_ACTIVADO_RELATO r
              WHERE r.id_activado_paso = ? AND r.id_involucrado = i.id_involucrado) AS relatos
     FROM PROTOCOLO_ACTIVADO_INVOLUCRADO i
     LEFT JOIN PROTOCOLO_ACTIVADO_RELATO_DECISION d
            ON d.id_involucrado = i.id_involucrado AND d.id_activado_paso = ?
     WHERE i.id_protocolo_activado = ?
     ORDER BY FIELD(i.rol, 'afectado','senalado','denunciante','testigo'), i.nombre`,
    [paso.id_activado_paso, paso.id_activado_paso, paso.id_protocolo_activado]
  );
  if (personas.length === 0)
    return ['El caso no tiene involucrados: agrega a quienes corresponda antes de acoger los relatos.'];
  const sinDecidir = personas.filter((p) => p.se_acoge === null).map((p) => p.nombre);
  const sinRelato = personas.filter((p) => p.se_acoge === 1 && p.relatos === 0).map((p) => p.nombre);
  return [
    ...(sinDecidir.length ? [`Falta indicar si se le acoge el relato a: ${sinDecidir.join(', ')}.`] : []),
    ...(sinRelato.length ? [`Falta acoger el relato de: ${sinRelato.join(', ')}.`] : []),
  ];
};

/**
 * PUT /:id/pasos/:id_paso/relatos/personas/:id_involucrado/responsable — { id_usuario | null }
 *
 * Encarga el relato de una persona a un funcionario: lo ve en Protocolos
 * activados con solo ese relato —no los demás ni los otros pasos— y puede
 * acogerlo. Lo hace quien ve el caso completo; null quita el encargo.
 */
const asignar = async (req, res) => {
  const id_usuario = req.body?.id_usuario ?? null;
  try {
    const ctx = await contexto(req, res, req.params.id_involucrado);
    if (!ctx) return;
    const { caso, paso, involucrado } = ctx;
    if (!(await tieneAccesoCompleto(pool, req, caso.id_protocolo_activado)))
      return res.status(403).json({ message: 'Solo quien ve el caso completo puede encargar un relato.' });

    let u = null;
    if (id_usuario !== null) {
      [[u]] = await pool.query(
        'SELECT nombre, correo FROM USUARIO WHERE id_usuario = ? AND id_establecimiento = ? AND activo = 1',
        [id_usuario, req.id_establecimiento]
      );
      if (!u) return res.status(404).json({ message: 'Funcionario no encontrado en este establecimiento' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // La fila puede no existir todavía (nadie decidió aún si se le acoge).
      await conn.query(
        `INSERT INTO PROTOCOLO_ACTIVADO_RELATO_DECISION
           (id_activado_paso, id_involucrado, se_acoge, id_usuario_responsable, id_usuario)
         VALUES (?, ?, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE id_usuario_responsable = VALUES(id_usuario_responsable)`,
        [paso.id_activado_paso, involucrado.id_involucrado, id_usuario, req.user.id]
      );
      await registrarEvento(conn, {
        id_protocolo_activado: caso.id_protocolo_activado, id_establecimiento: req.id_establecimiento,
        paso: paso.id_activado_paso, tipo: 'relato_asignado', id_usuario: req.user.id,
        descripcion: u
          ? `${paso.nombre} — el relato de ${quien(involucrado)} se encarga a ${u.nombre || u.correo}`
          : `${paso.nombre} — el relato de ${quien(involucrado)} deja de estar encargado`,
      });
      if (u)
        await notificaciones.crear(conn, {
          usuarios: [id_usuario],
          id_establecimiento: caso.id_establecimiento,
          tipo: 'paso_reasignado',
          titulo: `Te encargaron un relato: ${involucrado.nombre}`,
          mensaje: `Protocolo "${caso.nombre_protocolo}" — ${paso.nombre}`,
          id_protocolo_activado: caso.id_protocolo_activado,
          id_activado_paso: paso.id_activado_paso,
          excepto: req.user.id,
        });
      await conn.commit();
      res.json({ message: u ? `Relato encargado a ${u.nombre || u.correo}` : 'Encargo quitado' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al encargar el relato' });
  }
};

module.exports = {
  TIPO_PASO_RELATOS, alcanceRelatosDe,
  decidir, acoger, editar, asignar,
  relatosDelCaso, faltantesDeRelatos,
};
