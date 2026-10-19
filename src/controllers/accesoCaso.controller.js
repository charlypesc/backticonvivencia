// "¿Quién puede ver este protocolo completo?" — la lista de acceso de un caso.
//
// La administran solo los roles de supervisión (ver utils/accesoCaso.js): dar
// acceso al expediente entero de un caso es una decisión sobre datos
// sensibles, no algo que se delega con el propio acceso.
const pool = require('../db/connection');
const { ROLES_SUPERVISION, esSupervisor } = require('../utils/accesoCaso');

const buscarCaso = async (req) => {
  const [[caso]] = await pool.query(
    'SELECT * FROM PROTOCOLO_ACTIVADO WHERE id_protocolo_activado = ? AND id_establecimiento = ?',
    [req.params.id, req.id_establecimiento]
  );
  return caso ?? null;
};

const registrarEvento = (conn, { caso, tipo, descripcion, id_usuario }) =>
  conn.query(
    `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
       (id_protocolo_activado, id_establecimiento, id_activado_paso, tipo_evento, descripcion, id_usuario, fecha)
     VALUES (?, ?, NULL, ?, ?, ?, NOW())`,
    [caso.id_protocolo_activado, caso.id_establecimiento, tipo, descripcion, id_usuario]
  );

/** GET /:id/acceso — la lista, y quiénes lo ven por su rol (para decirlo en pantalla). */
const getAcceso = async (req, res) => {
  try {
    const caso = await buscarCaso(req);
    if (!caso) return res.status(404).json({ message: 'Protocolo activado no encontrado' });
    if (!esSupervisor(req))
      return res.status(403).json({ message: 'Solo la dirección y convivencia administran el acceso al caso.' });

    const [usuarios] = await pool.query(
      `SELECT a.id_usuario, u.nombre, u.correo, a.fecha,
              o.nombre AS otorgado_por_nombre, o.correo AS otorgado_por_correo,
              (a.id_usuario = ?) AS es_quien_activo
       FROM PROTOCOLO_ACTIVADO_ACCESO a
       JOIN USUARIO u ON u.id_usuario = a.id_usuario
       LEFT JOIN USUARIO o ON o.id_usuario = a.id_usuario_otorga
       WHERE a.id_protocolo_activado = ?
       ORDER BY a.fecha`,
      [caso.id_usuario_activo, caso.id_protocolo_activado]
    );
    // Los nombres de los roles que lo ven siempre, como los nombra el colegio.
    const [roles] = await pool.query(
      `SELECT DISTINCT nombre FROM ROLES
       WHERE codigo IN (?) AND activo = TRUE AND (id_establecimiento IS NULL OR id_establecimiento = ?)`,
      [ROLES_SUPERVISION.filter((r) => r !== 'ADMIN'), caso.id_establecimiento]
    );
    res.json({
      usuarios: usuarios.map((u) => ({ ...u, es_quien_activo: !!u.es_quien_activo })),
      roles_supervision: roles.map((r) => r.nombre),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el acceso al caso' });
  }
};

/** POST /:id/acceso — { id_usuario } */
const otorgar = async (req, res) => {
  const { id_usuario } = req.body ?? {};
  if (!id_usuario) return res.status(400).json({ message: 'Indica a quién darle acceso.' });
  try {
    const caso = await buscarCaso(req);
    if (!caso) return res.status(404).json({ message: 'Protocolo activado no encontrado' });
    if (!esSupervisor(req))
      return res.status(403).json({ message: 'Solo la dirección y convivencia administran el acceso al caso.' });
    const [[u]] = await pool.query(
      'SELECT nombre, correo FROM USUARIO WHERE id_usuario = ? AND id_establecimiento = ? AND activo = 1',
      [id_usuario, req.id_establecimiento]
    );
    if (!u) return res.status(404).json({ message: 'Funcionario no encontrado en este establecimiento' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query(
        `INSERT IGNORE INTO PROTOCOLO_ACTIVADO_ACCESO (id_protocolo_activado, id_usuario, id_usuario_otorga)
         VALUES (?, ?, ?)`,
        [caso.id_protocolo_activado, id_usuario, req.user.id]
      );
      if (r.affectedRows === 0) {
        await conn.rollback();
        return res.json({ message: `${u.nombre || u.correo} ya tenía acceso` });
      }
      await registrarEvento(conn, {
        caso, tipo: 'acceso_otorgado', id_usuario: req.user.id,
        descripcion: `Se da acceso al caso completo a ${u.nombre || u.correo}`,
      });
      await conn.commit();
      res.status(201).json({ message: `${u.nombre || u.correo} ya puede ver el caso completo` });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al dar acceso al caso' });
  }
};

/** DELETE /:id/acceso/:id_usuario */
const retirar = async (req, res) => {
  try {
    const caso = await buscarCaso(req);
    if (!caso) return res.status(404).json({ message: 'Protocolo activado no encontrado' });
    if (!esSupervisor(req))
      return res.status(403).json({ message: 'Solo la dirección y convivencia administran el acceso al caso.' });
    const [[u]] = await pool.query('SELECT nombre, correo FROM USUARIO WHERE id_usuario = ?', [req.params.id_usuario]);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query(
        'DELETE FROM PROTOCOLO_ACTIVADO_ACCESO WHERE id_protocolo_activado = ? AND id_usuario = ?',
        [caso.id_protocolo_activado, req.params.id_usuario]
      );
      if (r.affectedRows === 0) {
        await conn.rollback();
        return res.status(404).json({ message: 'Esa persona no estaba en la lista' });
      }
      await registrarEvento(conn, {
        caso, tipo: 'acceso_retirado', id_usuario: req.user.id,
        descripcion: `Se retira el acceso al caso completo a ${u?.nombre || u?.correo || 'un usuario'}`,
      });
      await conn.commit();
      res.json({ message: 'Acceso retirado' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al retirar el acceso' });
  }
};

module.exports = { getAcceso, otorgar, retirar };
