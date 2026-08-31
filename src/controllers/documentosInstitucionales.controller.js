const pool = require('../db/connection');
const { comprimirArchivo } = require('../utils/comprimirArchivo');

// RICE y Plan de Gestión, y la constancia de que se entregaron (art. 16 G).
//
// La ley obliga a entregar ambos documentos a los apoderados al matricular o
// renovar matrícula, "en formato impreso o digital", y a dejar constancia de la
// recepción. Acá el sistema no es el que entrega: el colegio entrega por su
// canal y registra la fecha, adjuntando la constancia firmada.
//
// El documento se versiona porque la constancia es de UNA versión: si el RICE
// se actualiza (la ley obliga a revisarlo al menos cada 4 años), la recepción
// del texto viejo no acredita nada sobre el nuevo. Por eso la unicidad de
// CONSTANCIA_RECEPCION es (documento, estudiante) y no solo estudiante.
//
// El binario vive en una tabla 1:1 aparte: los listados no tienen por qué
// arrastrar megabytes que nadie va a mirar.

const TIPOS = ['rice', 'plan_gestion'];

const SELECT_DOC = `
  SELECT d.*,
         u.correo AS cargado_por,
         a.nombre_archivo, a.tipo_archivo, a.bytes,
         (SELECT COUNT(*) FROM CONSTANCIA_RECEPCION c
           WHERE c.id_documento_institucional = d.id_documento_institucional) AS constancias
  FROM DOCUMENTO_INSTITUCIONAL d
  JOIN USUARIO u ON u.id_usuario = d.id_usuario
  LEFT JOIN DOCUMENTO_INSTITUCIONAL_ARCHIVO a
    ON a.id_documento_institucional = d.id_documento_institucional
`;

const buscarDoc = async (db, id, id_establecimiento) => {
  const [[doc]] = await db.query(
    `SELECT * FROM DOCUMENTO_INSTITUCIONAL
     WHERE id_documento_institucional = ? AND id_establecimiento = ?`,
    [id, id_establecimiento]
  );
  return doc ?? null;
};

// GET /api/documentos-institucionales
const getAll = async (req, res) => {
  try {
    const [filas] = await pool.query(
      `${SELECT_DOC} WHERE d.id_establecimiento = ?
       ORDER BY d.tipo, d.version DESC`,
      [req.id_establecimiento]
    );
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener los documentos institucionales' });
  }
};

// POST /api/documentos-institucionales  (multipart)
const crear = async (req, res) => {
  const { tipo, titulo, descripcion, fecha_aprobacion, vigente_desde } = req.body;

  if (!TIPOS.includes(tipo))
    return res.status(400).json({ message: `tipo debe ser uno de: ${TIPOS.join(', ')}` });
  if (!titulo?.trim())
    return res.status(400).json({ message: 'El título es requerido' });
  if (!req.file)
    return res.status(400).json({ message: 'Hay que adjuntar el documento' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // La versión se calcula acá dentro de la transacción y no en el cliente:
    // dos cargas simultáneas del mismo tipo pedirían la misma versión, y la
    // unique key las rechazaría con un error que no dice nada útil.
    const [[ultima]] = await conn.query(
      `SELECT COALESCE(MAX(version), 0) AS v FROM DOCUMENTO_INSTITUCIONAL
       WHERE id_establecimiento = ? AND tipo = ?`,
      [req.id_establecimiento, tipo]
    );
    const version = ultima.v + 1;

    const [r] = await conn.query(
      `INSERT INTO DOCUMENTO_INSTITUCIONAL
         (id_establecimiento, tipo, version, titulo, descripcion,
          fecha_aprobacion, vigente_desde, estado, id_usuario)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'borrador', ?)`,
      [req.id_establecimiento, tipo, version, titulo.trim(), descripcion?.trim() || null,
       fecha_aprobacion || null, vigente_desde || null, req.user.id]
    );

    const archivo = await comprimirArchivo(req.file);
    await conn.query(
      `INSERT INTO DOCUMENTO_INSTITUCIONAL_ARCHIVO
         (id_documento_institucional, nombre_archivo, tipo_archivo, bytes, contenido)
       VALUES (?, ?, ?, ?, ?)`,
      [r.insertId, archivo.originalname, archivo.mimetype, archivo.size, archivo.buffer]
    );

    await conn.commit();
    res.status(201).json({
      id_documento_institucional: r.insertId,
      version,
      bytes: archivo.size,
      bytes_originales: archivo.bytes_originales,
      message: `Documento cargado como versión ${version}, en borrador`,
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Error al cargar el documento' });
  } finally {
    conn.release();
  }
};

// POST /api/documentos-institucionales/:id/publicar
//
// Poner una versión vigente marca la anterior como reemplazada. Se hace en una
// transacción porque un colegio con dos versiones vigentes del mismo tipo no
// sabría contra cuál pedir las constancias.
const publicar = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const doc = await buscarDoc(conn, req.params.id, req.id_establecimiento);
    if (!doc) return res.status(404).json({ message: 'Documento no encontrado' });
    if (doc.estado === 'vigente')
      return res.status(409).json({ message: 'Esta versión ya está vigente' });

    await conn.beginTransaction();
    await conn.query(
      `UPDATE DOCUMENTO_INSTITUCIONAL SET estado = 'reemplazado'
       WHERE id_establecimiento = ? AND tipo = ? AND estado = 'vigente'`,
      [req.id_establecimiento, doc.tipo]
    );
    await conn.query(
      `UPDATE DOCUMENTO_INSTITUCIONAL
       SET estado = 'vigente', vigente_desde = COALESCE(vigente_desde, CURDATE())
       WHERE id_documento_institucional = ?`,
      [req.params.id]
    );
    await conn.commit();

    res.json({ message: `Versión ${doc.version} vigente` });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Error al publicar el documento' });
  } finally {
    conn.release();
  }
};

// Descarga tanto del documento como de la constancia firmada: es la misma
// operación sobre dos tablas con la misma forma.
const descargar = (tabla, columnaId) => async (req, res) => {
  try {
    const [[archivo]] = await pool.query(
      `SELECT a.nombre_archivo, a.tipo_archivo, a.contenido
       FROM ${tabla} a
       WHERE a.${columnaId} = ?`,
      [req.params.id]
    );
    if (!archivo) return res.status(404).json({ message: 'Archivo no encontrado' });

    res.setHeader('Content-Type', archivo.tipo_archivo);
    // inline y no attachment: el usuario decide si lo imprime o lo guarda desde
    // el visor, en vez de que el navegador le baje el archivo de una.
    res.setHeader('Content-Disposition', `inline; filename="${archivo.nombre_archivo}"`);
    res.send(archivo.contenido);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al descargar el archivo' });
  }
};

// GET /api/documentos-institucionales/:id/constancias
//
// Devuelve las constancias registradas y, además, a quién falta entregarle.
// Lo segundo es lo que hace útil la pantalla: la obligación no se cumple
// sabiendo a quiénes se les entregó, sino sabiendo a quiénes no.
const getConstancias = async (req, res) => {
  try {
    const doc = await buscarDoc(pool, req.params.id, req.id_establecimiento);
    if (!doc) return res.status(404).json({ message: 'Documento no encontrado' });

    const [constancias] = await pool.query(
      `SELECT c.*, e.nombre AS estudiante_nombre, e.apellido AS estudiante_apellido,
              e.run, e.dv, cu.nombre AS curso_nombre, u.correo AS registrada_por,
              (a.id_constancia IS NOT NULL) AS tiene_archivo
       FROM CONSTANCIA_RECEPCION c
       JOIN ESTUDIANTE e ON e.id_estudiante = c.id_estudiante
       LEFT JOIN CURSO cu ON cu.id_curso = e.id_curso
       JOIN USUARIO u ON u.id_usuario = c.id_usuario
       LEFT JOIN CONSTANCIA_RECEPCION_ARCHIVO a ON a.id_constancia = c.id_constancia
       WHERE c.id_documento_institucional = ?
       ORDER BY e.apellido, e.nombre`,
      [req.params.id]
    );

    const [pendientes] = await pool.query(
      `SELECT e.id_estudiante, e.nombre, e.apellido, e.run, e.dv, cu.nombre AS curso_nombre
       FROM ESTUDIANTE e
       LEFT JOIN CURSO cu ON cu.id_curso = e.id_curso
       LEFT JOIN CONSTANCIA_RECEPCION c
         ON c.id_estudiante = e.id_estudiante AND c.id_documento_institucional = ?
       WHERE e.id_establecimiento = ? AND e.activo = 1 AND c.id_constancia IS NULL
       ORDER BY e.apellido, e.nombre`,
      [req.params.id, req.id_establecimiento]
    );

    res.json({ documento: doc, constancias, pendientes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener las constancias' });
  }
};

// POST /api/documentos-institucionales/:id/constancias  (multipart, archivo opcional)
const registrarConstancia = async (req, res) => {
  const {
    id_estudiante, apoderado_nombre, apoderado_run,
    canal, motivo, fecha_entrega, observaciones,
  } = req.body;

  if (!id_estudiante || !apoderado_nombre?.trim() || !fecha_entrega)
    return res.status(400).json({
      message: 'Estudiante, nombre del apoderado y fecha de entrega son requeridos',
    });

  const conn = await pool.getConnection();
  try {
    const doc = await buscarDoc(conn, req.params.id, req.id_establecimiento);
    if (!doc) return res.status(404).json({ message: 'Documento no encontrado' });
    // Registrar la entrega de un borrador acreditaría haber entregado algo que
    // el colegio todavía no adoptó.
    if (doc.estado === 'borrador')
      return res.status(409).json({
        message: 'El documento está en borrador: publicá la versión antes de registrar entregas',
      });

    const [[estudiante]] = await conn.query(
      'SELECT id_estudiante FROM ESTUDIANTE WHERE id_estudiante = ? AND id_establecimiento = ?',
      [id_estudiante, req.id_establecimiento]
    );
    if (!estudiante)
      return res.status(400).json({ message: 'El estudiante no pertenece a este establecimiento' });

    await conn.beginTransaction();

    const [r] = await conn.query(
      `INSERT INTO CONSTANCIA_RECEPCION
         (id_documento_institucional, id_establecimiento, id_estudiante, apoderado_nombre,
          apoderado_run, canal, motivo, fecha_entrega, observaciones, id_usuario)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, req.id_establecimiento, id_estudiante, apoderado_nombre.trim(),
       apoderado_run?.trim() || null, canal || 'impreso', motivo || 'matricula',
       fecha_entrega, observaciones?.trim() || null, req.user.id]
    );

    // El archivo firmado es opcional al registrar: la entrega puede quedar
    // anotada el mismo día y el papel escanearse después. Se puede adjuntar
    // más tarde con PUT .../archivo.
    if (req.file) {
      const archivo = await comprimirArchivo(req.file);
      await conn.query(
        `INSERT INTO CONSTANCIA_RECEPCION_ARCHIVO
           (id_constancia, nombre_archivo, tipo_archivo, bytes, contenido)
         VALUES (?, ?, ?, ?, ?)`,
        [r.insertId, archivo.originalname, archivo.mimetype, archivo.size, archivo.buffer]
      );
    }

    await conn.commit();
    res.status(201).json({ id_constancia: r.insertId, message: 'Constancia registrada' });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({
        message: 'Ya hay una constancia de este estudiante para esta versión del documento',
      });
    console.error(err);
    res.status(500).json({ message: 'Error al registrar la constancia' });
  } finally {
    conn.release();
  }
};

// PUT /api/constancias/:id/archivo — adjuntar (o reemplazar) el firmado
const adjuntarFirmada = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No se recibió archivo' });

  try {
    const [[constancia]] = await pool.query(
      'SELECT id_constancia FROM CONSTANCIA_RECEPCION WHERE id_constancia = ? AND id_establecimiento = ?',
      [req.params.id, req.id_establecimiento]
    );
    if (!constancia) return res.status(404).json({ message: 'Constancia no encontrada' });

    const archivo = await comprimirArchivo(req.file);
    await pool.query(
      `INSERT INTO CONSTANCIA_RECEPCION_ARCHIVO
         (id_constancia, nombre_archivo, tipo_archivo, bytes, contenido)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         nombre_archivo = VALUES(nombre_archivo), tipo_archivo = VALUES(tipo_archivo),
         bytes = VALUES(bytes), contenido = VALUES(contenido), fecha_subida = NOW()`,
      [req.params.id, archivo.originalname, archivo.mimetype, archivo.size, archivo.buffer]
    );
    res.json({
      message: 'Constancia firmada adjuntada',
      bytes: archivo.size,
      bytes_originales: archivo.bytes_originales,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al adjuntar la constancia firmada' });
  }
};

module.exports = {
  getAll, crear, publicar, getConstancias, registrarConstancia, adjuntarFirmada,
  descargarDocumento: descargar('DOCUMENTO_INSTITUCIONAL_ARCHIVO', 'id_documento_institucional'),
  descargarConstancia: descargar('CONSTANCIA_RECEPCION_ARCHIVO', 'id_constancia'),
  TIPOS,
};
