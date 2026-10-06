const crypto = require('crypto');
const pool = require('../db/connection');
const notificaciones = require('../services/notificaciones.service');

// Canal de denuncias con reserva de identidad (art. 46 letra e LGE, texto de
// la Ley 21.809). Ver docs/canal_denuncias.sql.
//
// Dos mitades:
//  - la pública, sin sesión: el formulario al que se llega por el QR del
//    colegio. Se identifica al colegio por un token aleatorio y no por su id,
//    para que no se pueda recorrer el canal de todos los colegios contando.
//  - la interna: el QR/link y la bandeja del coordinador.
//
// La identidad de quien denunció con reserva vive en DENUNCIA_IDENTIDAD y solo
// sale por GET /:id/identidad, que deja constancia de quién la miró. Ninguna
// otra respuesta la incluye: ni el listado, ni el detalle, ni la notificación.

const MODOS = ['anonima', 'reservada'];
const RELATO_MINIMO = 10;

const recortar = (v, max) => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t ? t.slice(0, max) : null;
};

const establecimientoPorToken = async (token) => {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
  const [[e]] = await pool.query(
    `SELECT id_establecimiento, nombre FROM ESTABLECIMIENTO
      WHERE token_denuncia = ? AND acceso_bloqueado = 0`,
    [token]
  );
  return e ?? null;
};

// 16 bytes en base64url son exactamente 22 caracteres.
const tokenNuevo = () => crypto.randomBytes(16).toString('base64url');

// ── Público ─────────────────────────────────────────────────────────────────

// GET /api/canal-denuncia/:token — para mostrar a qué colegio se denuncia.
const canalPublico = async (req, res) => {
  try {
    const e = await establecimientoPorToken(req.params.token);
    if (!e) return res.status(404).json({ message: 'Este enlace de denuncias no existe o ya no está vigente' });
    res.json({ nombre_establecimiento: e.nombre });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al abrir el canal de denuncias' });
  }
};

// POST /api/canal-denuncia/:token — { modo, relato, urgente, nombre?, curso?, contacto? }
//
// Lo mínimo a propósito: la ley no exige ningún dato en particular, y pedirle
// fecha, lugar, nombres y pruebas a quien lo está pasando mal es cargarle el
// armado del caso (art. 46 e: "la no revictimización de los afectados"). Las
// columnas lugar/fecha_hechos/personas_involucradas y DENUNCIA_ARCHIVO quedan
// en la base sin uso desde el formulario.
const enviarDenuncia = async (req, res) => {
  const b = req.body ?? {};
  const modo = MODOS.includes(b.modo) ? b.modo : null;
  const relato = recortar(b.relato, 10000);
  const nombre = recortar(b.nombre, 150);

  if (!modo) return res.status(400).json({ message: 'Elige si la denuncia es anónima o con reserva de identidad' });
  if (!relato || relato.length < RELATO_MINIMO)
    return res.status(400).json({ message: 'Cuéntanos con un poco más de detalle qué pasó' });
  if (modo === 'reservada' && !nombre)
    return res.status(400).json({ message: 'Para la denuncia con reserva de identidad necesitamos tu nombre' });

  const urgente = b.urgente === true || b.urgente === 'true';

  let e;
  try {
    e = await establecimientoPorToken(req.params.token);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al enviar la denuncia' });
  }
  if (!e) return res.status(404).json({ message: 'Este enlace de denuncias no existe o ya no está vigente' });

  const conn = await pool.getConnection();
  let id_denuncia, codigo;
  try {
    await conn.beginTransaction();
    // El trigger asigna el folio: dos denuncias simultáneas del mismo colegio
    // pueden calcular el mismo y la segunda choca con la clave única. Un
    // duplicado deshace solo la sentencia, así que se reintenta.
    let r;
    for (let i = 1; ; i++) {
      try {
        [r] = await conn.query(
          `INSERT INTO DENUNCIA (id_establecimiento, modo, relato, urgente)
           VALUES (?, ?, ?, ?)`,
          [e.id_establecimiento, modo, relato, urgente]
        );
        break;
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY' || i >= 3) throw err;
      }
    }
    id_denuncia = r.insertId;

    if (modo === 'reservada')
      await conn.query(
        'INSERT INTO DENUNCIA_IDENTIDAD (id_denuncia, nombre, curso, contacto) VALUES (?, ?, ?, ?)',
        [id_denuncia, nombre, recortar(b.curso, 60), recortar(b.contacto, 150)]
      );

    [[{ codigo }]] = await conn.query('SELECT codigo FROM DENUNCIA WHERE id_denuncia = ?', [id_denuncia]);
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error(err);
    return res.status(500).json({ message: 'No pudimos enviar la denuncia. Intenta de nuevo en un momento.' });
  } finally {
    conn.release();
  }

  res.status(201).json({ codigo, message: 'Denuncia recibida' });

  // Fuera de la transacción: el aviso nunca puede deshacer la denuncia. El
  // mensaje no lleva nada de la identidad ni del relato completo: la campana
  // se ve en pantallas compartidas.
  try {
    await notificaciones.crear(pool, {
      usuarios: await notificaciones.coordinadoresDeConvivencia(pool, e.id_establecimiento),
      id_establecimiento: e.id_establecimiento,
      tipo: 'denuncia_nueva',
      titulo: `${urgente ? 'URGENTE: ' : ''}Denuncia nueva ${codigo}`,
      mensaje: urgente
        ? 'Quien denunció indicó que está en peligro ahora. Revísala de inmediato.'
        : 'Entró una denuncia por el canal del colegio.',
      url: `/denuncias?abrir=${id_denuncia}`,
    });
  } catch (err) {
    console.error('No se pudo avisar la denuncia nueva:', err.message);
  }
};

// ── Interno ─────────────────────────────────────────────────────────────────

// GET /api/denuncias/canal — el token del link; se crea la primera vez.
const getCanal = async (req, res) => {
  try {
    const [[e]] = await pool.query(
      'SELECT nombre, token_denuncia FROM ESTABLECIMIENTO WHERE id_establecimiento = ?',
      [req.id_establecimiento]
    );
    if (!e) return res.status(404).json({ message: 'Establecimiento no encontrado' });
    let token = e.token_denuncia;
    if (!token) {
      token = tokenNuevo();
      // Solo si sigue vacío: dos pestañas abiertas a la vez no generan dos QR
      // distintos, la segunda se queda con el de la primera.
      await pool.query(
        `UPDATE ESTABLECIMIENTO SET token_denuncia = ?
          WHERE id_establecimiento = ? AND token_denuncia IS NULL`,
        [token, req.id_establecimiento]
      );
      [[{ token_denuncia: token }]] = await pool.query(
        'SELECT token_denuncia FROM ESTABLECIMIENTO WHERE id_establecimiento = ?',
        [req.id_establecimiento]
      );
    }
    res.json({ token, nombre_establecimiento: e.nombre });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el canal de denuncias' });
  }
};

// POST /api/denuncias/canal/regenerar — el QR anterior deja de funcionar.
const regenerarCanal = async (req, res) => {
  try {
    const token = tokenNuevo();
    await pool.query('UPDATE ESTABLECIMIENTO SET token_denuncia = ? WHERE id_establecimiento = ?',
      [token, req.id_establecimiento]);
    res.json({ token, message: 'Se generó un QR nuevo. El anterior ya no funciona.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al regenerar el QR' });
  }
};

const COLUMNAS_LISTADO = `
  d.id_denuncia, d.codigo, d.modo, d.lugar, d.fecha_hechos, d.urgente, d.estado,
  d.fecha_creacion, d.id_registro, d.motivo_desestimacion, d.fecha_gestion,
  r.codigo AS registro_codigo,
  u.nombre AS gestiona_nombre, u.correo AS gestiona_correo`;

// GET /api/denuncias?estado= — la bandeja. Sin identidad, nunca.
const getAll = async (req, res) => {
  try {
    const params = [req.id_establecimiento];
    let filtro = '';
    if (['nueva', 'en_revision', 'convertida', 'desestimada'].includes(req.query.estado)) {
      filtro = 'AND d.estado = ?';
      params.push(req.query.estado);
    }
    const [rows] = await pool.query(
      `SELECT ${COLUMNAS_LISTADO}, LEFT(d.relato, 160) AS extracto,
              (SELECT COUNT(*) FROM DENUNCIA_ARCHIVO a WHERE a.id_denuncia = d.id_denuncia) AS archivos
         FROM DENUNCIA d
         LEFT JOIN REGISTRO_CONVIVENCIA r ON r.id_registro = d.id_registro
         LEFT JOIN USUARIO u ON u.id_usuario = d.id_usuario_gestiona
        WHERE d.id_establecimiento = ? ${filtro}
        -- Las urgentes sin resolver primero: son las que no pueden esperar.
        ORDER BY (d.urgente AND d.estado IN ('nueva','en_revision')) DESC, d.fecha_creacion DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener las denuncias' });
  }
};

const denunciaDelScope = async (req) => {
  const [[d]] = await pool.query(
    `SELECT ${COLUMNAS_LISTADO}, d.relato, d.personas_involucradas
       FROM DENUNCIA d
       LEFT JOIN REGISTRO_CONVIVENCIA r ON r.id_registro = d.id_registro
       LEFT JOIN USUARIO u ON u.id_usuario = d.id_usuario_gestiona
      WHERE d.id_denuncia = ? AND d.id_establecimiento = ?`,
    [req.params.id, req.id_establecimiento]
  );
  return d ?? null;
};

// GET /api/denuncias/:id — abrirla la pasa a "en revisión".
const getById = async (req, res) => {
  try {
    const d = await denunciaDelScope(req);
    if (!d) return res.status(404).json({ message: 'Denuncia no encontrada' });

    if (d.estado === 'nueva') {
      await pool.query(
        `UPDATE DENUNCIA SET estado = 'en_revision' WHERE id_denuncia = ? AND estado = 'nueva'`,
        [d.id_denuncia]
      );
      d.estado = 'en_revision';
    }
    // Abierta por alguien, la campana de los demás coordinadores deja de reclamarla.
    await pool.query(
      `UPDATE NOTIFICACION SET leida = 1 WHERE tipo = 'denuncia_nueva' AND url = ?`,
      [`/denuncias?abrir=${d.id_denuncia}`]
    );

    const [archivos] = await pool.query(
      `SELECT id_archivo, nombre_archivo, tipo_archivo, bytes
         FROM DENUNCIA_ARCHIVO WHERE id_denuncia = ? ORDER BY id_archivo`,
      [d.id_denuncia]
    );
    res.json({ ...d, archivos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener la denuncia' });
  }
};

// GET /api/denuncias/:id/identidad — queda constancia de cada consulta.
const getIdentidad = async (req, res) => {
  try {
    const d = await denunciaDelScope(req);
    if (!d) return res.status(404).json({ message: 'Denuncia no encontrada' });
    if (d.modo !== 'reservada')
      return res.status(404).json({ message: 'Esta denuncia es anónima: no hay identidad guardada' });

    const [[identidad]] = await pool.query(
      'SELECT nombre, curso, contacto FROM DENUNCIA_IDENTIDAD WHERE id_denuncia = ?',
      [d.id_denuncia]
    );
    await pool.query(
      'INSERT INTO DENUNCIA_IDENTIDAD_ACCESO (id_denuncia, id_usuario) VALUES (?, ?)',
      [d.id_denuncia, req.user.id]
    );
    const [accesos] = await pool.query(
      `SELECT a.fecha, u.nombre, u.correo
         FROM DENUNCIA_IDENTIDAD_ACCESO a
         LEFT JOIN USUARIO u ON u.id_usuario = a.id_usuario
        WHERE a.id_denuncia = ? ORDER BY a.fecha DESC`,
      [d.id_denuncia]
    );
    res.json({ ...(identidad ?? {}), accesos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener la identidad' });
  }
};

// GET /api/denuncias/:id/archivos/:idArchivo
const descargarArchivo = async (req, res) => {
  try {
    const [[a]] = await pool.query(
      `SELECT a.nombre_archivo, a.tipo_archivo, a.contenido
         FROM DENUNCIA_ARCHIVO a
         JOIN DENUNCIA d ON d.id_denuncia = a.id_denuncia
        WHERE a.id_archivo = ? AND a.id_denuncia = ? AND d.id_establecimiento = ?`,
      [req.params.idArchivo, req.params.id, req.id_establecimiento]
    );
    if (!a) return res.status(404).json({ message: 'Archivo no encontrado' });
    res.setHeader('Content-Type', a.tipo_archivo);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.nombre_archivo)}"`);
    res.send(a.contenido);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al descargar el archivo' });
  }
};

// POST /api/denuncias/:id/desestimar — { motivo }
const desestimar = async (req, res) => {
  const motivo = recortar(req.body?.motivo, 500);
  if (!motivo) return res.status(400).json({ message: 'Indica el motivo para desestimar la denuncia' });
  try {
    const d = await denunciaDelScope(req);
    if (!d) return res.status(404).json({ message: 'Denuncia no encontrada' });
    const [r] = await pool.query(
      `UPDATE DENUNCIA
          SET estado = 'desestimada', motivo_desestimacion = ?,
              id_usuario_gestiona = ?, fecha_gestion = NOW()
        WHERE id_denuncia = ? AND estado IN ('nueva','en_revision')`,
      [motivo, req.user.id, d.id_denuncia]
    );
    if (r.affectedRows === 0)
      return res.status(409).json({ message: 'Esta denuncia ya fue gestionada' });
    await pool.query(
      `UPDATE NOTIFICACION SET leida = 1 WHERE tipo = 'denuncia_nueva' AND url = ?`,
      [`/denuncias?abrir=${d.id_denuncia}`]
    );
    res.json({ message: `Denuncia ${d.codigo} desestimada` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al desestimar la denuncia' });
  }
};

module.exports = {
  canalPublico, enviarDenuncia,
  getCanal, regenerarCanal, getAll, getById, getIdentidad, descargarArchivo, desestimar,
};
