const bcrypt = require('bcryptjs');
const pool = require('../db/connection');
const { sembrarTiposFalta } = require('../utils/sembrarTiposFalta');

// ESTABLECIMIENTO es a la vez el directorio nacional de colegios (7.847
// filas importadas del MINEDUC) y la tabla de tenants. `es_tenant` distingue
// los colegios que usan el sistema del resto del directorio: casi toda consulta
// de este módulo tiene que filtrarlo o devuelve el país entero.

const SELECT_ESTABLECIMIENTO = `
  SELECT g.id_establecimiento,
         g.nombre, g.rbd, g.direccion, g.telefono, g.correo,
         g.tipo_dependencia, g.matriculas, g.es_tenant,
         g.id_comuna, c.id_provincia, p.id_region, r.id_pais,
         g.id_sostenedor
  FROM ESTABLECIMIENTO g
  JOIN COMUNA    c ON c.id_comuna    = g.id_comuna
  JOIN PROVINCIA p ON p.id_provincia = c.id_provincia
  JOIN REGION    r ON r.id_region    = p.id_region
`;

const getMine = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `${SELECT_ESTABLECIMIENTO} WHERE g.id_establecimiento = ?`,
      [req.id_establecimiento]
    );
    if (rows.length === 0)
      return res.status(404).json({ message: 'Establecimiento no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el establecimiento' });
  }
};

const updateMine = async (req, res) => {
  const { nombre, rbd, id_comuna, direccion, telefono, correo } = req.body;

  if (!nombre || !rbd)
    return res.status(400).json({ message: 'Nombre y RBD son requeridos' });

  try {
    await pool.query(
      `UPDATE ESTABLECIMIENTO
       SET nombre=?, rbd=?, id_comuna=COALESCE(?, id_comuna),
           direccion=?, telefono=?, correo=?
       WHERE id_establecimiento = ?`,
      [nombre, rbd, id_comuna || null, direccion || null, telefono || null,
       correo || null, req.id_establecimiento]
    );
    res.json({ message: 'Establecimiento actualizado' });
  } catch (err) {
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'El RBD ya está registrado' });
    if (err.code === 'ER_NO_REFERENCED_ROW_2')
      return res.status(400).json({ message: 'La comuna indicada no existe' });
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

// --- Administración de tenants ---

// Solo los colegios que usan el sistema. Sin el filtro es_tenant esto
// devolvería las 7.847 filas del directorio nacional.
const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `${SELECT_ESTABLECIMIENTO} WHERE g.es_tenant = TRUE ORDER BY g.nombre`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener los establecimientos' });
  }
};

const getById = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `${SELECT_ESTABLECIMIENTO} WHERE g.id_establecimiento = ?`,
      [req.params.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ message: 'Establecimiento no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el establecimiento' });
  }
};

// Dar de alta un tenant ya no inserta una fila: marca como cliente un colegio
// que ya está en el directorio y le crea su DIRECTOR. Insertar colegios nuevos
// al directorio es tarea del módulo Geo, no de acá.
const create = async (req, res) => {
  const { id_establecimiento, correo, password } = req.body;

  if (!id_establecimiento || !correo || !password)
    return res.status(400).json({
      message: 'id_establecimiento, correo y password son requeridos',
    });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [existe] = await conn.query(
      `SELECT es_tenant FROM ESTABLECIMIENTO WHERE id_establecimiento = ?`,
      [id_establecimiento]
    );
    if (existe.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'El establecimiento no existe en el directorio' });
    }
    if (existe[0].es_tenant) {
      await conn.rollback();
      return res.status(409).json({ message: 'El establecimiento ya está dado de alta' });
    }

    await conn.query(
      `UPDATE ESTABLECIMIENTO SET es_tenant = TRUE WHERE id_establecimiento = ?`,
      [id_establecimiento]
    );

    // Un colegio recién dado de alta con el catálogo de faltas vacío no puede
    // registrar nada: el formulario de registros exige un id_tipo_falta.
    await sembrarTiposFalta(conn, id_establecimiento);

    const password_hash = await bcrypt.hash(password, 10);
    const [userResult] = await conn.query(
      `INSERT INTO USUARIO (correo, password_hash, rol, id_establecimiento)
       VALUES (?, ?, 'DIRECTOR', ?)`,
      [correo, password_hash, id_establecimiento]
    );

    await conn.commit();
    res.status(201).json({
      id_establecimiento: id_establecimiento,
      id_usuario: userResult.insertId,
      message: 'Establecimiento dado de alta y director creado',
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'El correo ya está registrado' });
    res.status(500).json({ message: 'Error al dar de alta el establecimiento' });
  } finally {
    conn.release();
  }
};

const update = async (req, res) => {
  const { nombre, rbd, id_comuna, direccion, telefono, correo } = req.body;

  if (!nombre || !rbd)
    return res.status(400).json({ message: 'Nombre y RBD son requeridos' });

  try {
    await pool.query(
      `UPDATE ESTABLECIMIENTO
       SET nombre=?, rbd=?, id_comuna=COALESCE(?, id_comuna),
           direccion=?, telefono=?, correo=?
       WHERE id_establecimiento = ?`,
      [nombre, rbd, id_comuna || null, direccion || null, telefono || null,
       correo || null, req.params.id]
    );
    res.json({ message: 'Establecimiento actualizado' });
  } catch (err) {
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'El RBD ya está registrado' });
    if (err.code === 'ER_NO_REFERENCED_ROW_2')
      return res.status(400).json({ message: 'La comuna indicada no existe' });
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

// Dar de baja un tenant NO borra la fila: eliminaría un colegio real del
// directorio nacional. Solo se desmarca es_tenant. Se bloquea si todavía tiene
// datos operativos colgando, porque esas filas quedarían huérfanas de tenant.
const remove = async (req, res) => {
  try {
    const [[{ dependientes }]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM USUARIO    WHERE id_establecimiento = ?)
            + (SELECT COUNT(*) FROM ESTUDIANTE WHERE id_establecimiento = ?)
            + (SELECT COUNT(*) FROM CURSO      WHERE id_establecimiento = ?) AS dependientes`,
      [req.params.id, req.params.id, req.params.id]
    );

    if (dependientes > 0)
      return res.status(409).json({
        message: 'No es posible dar de baja un establecimiento en uso.',
      });

    await pool.query(
      `UPDATE ESTABLECIMIENTO SET es_tenant = FALSE WHERE id_establecimiento = ?`,
      [req.params.id]
    );
    res.json({ message: 'Establecimiento dado de baja' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al dar de baja' });
  }
};

module.exports = { getMine, updateMine, getAll, getById, create, update, remove };
