const XLSX   = require('xlsx');
const bcrypt = require('bcryptjs');
const { PDFDocument } = require('pdf-lib');
const pool   = require('../db/connection');
const { establecimientoRequerido } = require('../middleware/scope');
const { generarPassword } = require('../utils/password');
const { construirCredencialesPdf } = require('../services/pdf/credenciales.pdf');
const { sembrarTiposFalta } = require('../utils/sembrarTiposFalta');

// Alta masiva de funcionarios desde un Excel.
//
// El flujo pensado es: el encargado descarga la plantilla, se la pasa a
// alguien de secretaría que la llena, y la sube ya completa. Por eso la
// plantilla trae la lista de roles del colegio con su nombre legible, y la
// columna Rol acepta tanto el nombre ("Inspector General") como el código
// (INSPECTOR_GENERAL): quien la llena no conoce los códigos.
//
// Todo o nada: primero se valida el archivo entero y, si una sola fila tiene
// un problema, no se crea nadie y se devuelve la lista de errores por fila.
// Crear a medias obligaría a borrar del Excel las filas que sí entraron antes
// de volver a subirlo, o chocarían con "correo ya registrado".

const COLUMNAS = ['Nombre completo', 'Correo', 'Rol', 'Rol adicional (opcional)'];
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "Inspector  General", "inspector_general" e "INSPECTOR GENERAL" son lo mismo. */
const normalizar = (s) =>
  String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[_\s]+/g, ' ').trim();

/**
 * Roles que se pueden asignar en el colegio: los globales y los propios del
 * establecimiento. ADMIN nunca: dar acceso a todos los colegios no puede
 * colarse en una planilla que llenó otra persona.
 */
const rolesAsignables = async (conn, id_est) => {
  const [rows] = await conn.query(
    `SELECT rol_id, codigo, nombre FROM ROLES
      WHERE activo = TRUE AND codigo <> 'ADMIN'
        AND (id_establecimiento IS NULL OR id_establecimiento = ?)
      ORDER BY nombre`,
    [id_est]
  );
  return rows;
};

/** GET /usuarios/plantilla — el Excel vacío, con instrucciones y roles del colegio. */
const plantilla = async (req, res) => {
  const id_est = establecimientoRequerido(req);
  if (id_est === null || id_est === undefined)
    return res.status(400).json({ message: 'Falta indicar el establecimiento' });

  try {
    const roles = await rolesAsignables(pool, id_est);
    const [[est]] = await pool.query(
      'SELECT nombre FROM ESTABLECIMIENTO WHERE id_establecimiento = ?', [id_est]
    );

    const libro = XLSX.utils.book_new();

    // Sin filas de ejemplo en la hoja que se importa: un ejemplo olvidado
    // terminaría creado como usuario. El ejemplo va en Instrucciones.
    const hoja = XLSX.utils.aoa_to_sheet([COLUMNAS]);
    hoja['!cols'] = [{ wch: 34 }, { wch: 34 }, { wch: 30 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(libro, hoja, 'Usuarios');

    const instrucciones = XLSX.utils.aoa_to_sheet([
      [`Carga de usuarios — ${est?.nombre ?? ''}`],
      [],
      ['1. Complete la hoja "Usuarios", una persona por fila, desde la fila 2.'],
      ['2. Nombre completo y Correo son obligatorios. El correo es el usuario para entrar al sistema.'],
      ['3. En Rol escriba uno de los roles de la hoja "Roles" (vale el nombre o el código).'],
      ['4. Si la persona cumple dos funciones, ponga la segunda en "Rol adicional".'],
      ['5. No escriba contraseñas: el sistema genera una por persona y la entrega impresa.'],
      ['6. Si alguna fila tiene un error, no se crea nadie y se indica qué corregir.'],
      [],
      ['Ejemplo:'],
      COLUMNAS,
      ['María José Pérez Soto', 'mperez@colegio.cl', 'Profesor', ''],
      ['Juan Carlos Rojas', 'jrojas@colegio.cl', 'Inspector General', 'Coordinador de convivencia educativa'],
    ]);
    instrucciones['!cols'] = [{ wch: 34 }, { wch: 30 }, { wch: 26 }, { wch: 38 }];
    XLSX.utils.book_append_sheet(libro, instrucciones, 'Instrucciones');

    const hojaRoles = XLSX.utils.aoa_to_sheet([
      ['Rol (nombre)', 'Código'],
      ...roles.map((r) => [r.nombre, r.codigo]),
    ]);
    hojaRoles['!cols'] = [{ wch: 40 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(libro, hojaRoles, 'Roles');

    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-usuarios.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al generar la plantilla' });
  }
};

/**
 * Lee las filas de la hoja "Usuarios" (o la primera, si le cambiaron el
 * nombre) y descarta las completamente vacías: Excel suele dejar filas con
 * formato pero sin datos al final.
 */
const leerFilas = (buffer) => {
  const libro = XLSX.read(buffer, { type: 'buffer' });
  const nombreHoja = libro.SheetNames.find((n) => normalizar(n) === 'usuarios') ?? libro.SheetNames[0];
  const filas = XLSX.utils.sheet_to_json(libro.Sheets[nombreHoja], { header: 1, defval: '', blankrows: true });
  // La fila 1 es el encabezado; se numera como la ve quien abre el Excel.
  return filas.slice(1)
    .map((f, i) => ({
      fila: i + 2,
      nombre: String(f[0] ?? '').trim().replace(/\s+/g, ' '),
      correo: String(f[1] ?? '').trim().toLowerCase(),
      rol: String(f[2] ?? '').trim(),
      rol2: String(f[3] ?? '').trim(),
    }))
    .filter((f) => f.nombre || f.correo || f.rol || f.rol2);
};

/** Une los comprobantes individuales en un solo PDF: una hoja por persona. */
const unirPdfs = async (buffers) => {
  const salida = await PDFDocument.create();
  for (const b of buffers) {
    const doc = await PDFDocument.load(b);
    const paginas = await salida.copyPages(doc, doc.getPageIndices());
    paginas.forEach((p) => salida.addPage(p));
  }
  return Buffer.from(await salida.save({ useObjectStreams: true }));
};

/** POST /usuarios/importar — crea las cuentas del Excel llenado. */
const importar = async (req, res) => {
  const id_est = establecimientoRequerido(req);
  if (id_est === null || id_est === undefined)
    return res.status(400).json({ message: 'Falta indicar el establecimiento' });
  if (!req.file)
    return res.status(400).json({ message: 'Adjunta el Excel con los usuarios' });

  let filas;
  try {
    filas = leerFilas(req.file.buffer);
  } catch {
    return res.status(400).json({ message: 'No se pudo leer el archivo. Usa la plantilla en formato Excel (.xlsx).' });
  }
  if (filas.length === 0)
    return res.status(400).json({ message: 'La hoja "Usuarios" no tiene filas con datos' });

  const conn = await pool.getConnection();
  try {
    const roles = await rolesAsignables(conn, id_est);
    const buscarRol = (texto) => {
      const t = normalizar(texto);
      return roles.find((r) => normalizar(r.codigo) === t || normalizar(r.nombre) === t);
    };

    const correos = filas.map((f) => f.correo).filter(Boolean);
    const [existentes] = correos.length
      ? await conn.query('SELECT correo FROM USUARIO WHERE correo IN (?)', [correos])
      : [[]];
    const yaRegistrados = new Set(existentes.map((e) => e.correo.toLowerCase()));

    // ── Validación completa antes de escribir nada ──────────────────────
    const errores = [];
    const vistos = new Map();
    const validas = [];
    for (const f of filas) {
      const problemas = [];
      if (!f.nombre) problemas.push('falta el nombre');
      if (!f.correo) problemas.push('falta el correo');
      else if (!CORREO_RE.test(f.correo)) problemas.push(`el correo "${f.correo}" no es válido`);
      else if (yaRegistrados.has(f.correo)) problemas.push(`el correo ${f.correo} ya tiene cuenta en el sistema`);
      else if (vistos.has(f.correo)) problemas.push(`el correo ${f.correo} está repetido (también en la fila ${vistos.get(f.correo)})`);

      const rolesFila = [];
      if (!f.rol) problemas.push('falta el rol');
      for (const texto of [f.rol, f.rol2].filter(Boolean)) {
        const r = buscarRol(texto);
        if (!r) problemas.push(`el rol "${texto}" no existe (revisa la hoja Roles)`);
        else if (!rolesFila.some((x) => x.rol_id === r.rol_id)) rolesFila.push(r);
      }

      if (f.correo) vistos.set(f.correo, vistos.get(f.correo) ?? f.fila);
      if (problemas.length) errores.push({ fila: f.fila, correo: f.correo || null, problemas });
      else validas.push({ ...f, roles: rolesFila });
    }

    if (errores.length)
      return res.status(400).json({
        message: `El archivo tiene ${errores.length} ${errores.length === 1 ? 'fila' : 'filas'} con problemas. No se creó ningún usuario.`,
        errores,
      });

    // ── Alta en una sola transacción ────────────────────────────────────
    await conn.beginTransaction();
    const creados = [];
    for (const f of validas) {
      // Misma regla que el alta de a uno: la clave la genera el servidor,
      // viaja en claro solo en esta respuesta y debe cambiarse al entrar.
      const password = generarPassword();
      const hash = await bcrypt.hash(password, 10);
      const [ins] = await conn.query(
        `INSERT INTO USUARIO (correo, nombre, password_hash, rol, id_establecimiento, debe_cambiar_password)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [f.correo, f.nombre, hash, f.roles[0].codigo, id_est]
      );
      for (const r of f.roles)
        await conn.query(
          'INSERT INTO USUARIO_ROLES (id_usuario, rol_id, asignado_por) VALUES (?, ?, ?)',
          [ins.insertId, r.rol_id, req.user.id]
        );
      creados.push({
        id_usuario: ins.insertId,
        nombre: f.nombre,
        correo: f.correo,
        rol: f.roles.map((r) => r.nombre).join(', '),
        password,
      });
    }

    // Igual que el alta de a uno (ver usuarios.controller → create).
    await conn.query(
      'UPDATE ESTABLECIMIENTO SET es_tenant = TRUE WHERE id_establecimiento = ? AND es_tenant = FALSE',
      [id_est]
    );
    await sembrarTiposFalta(conn, id_est);
    const [[est]] = await conn.query('SELECT nombre FROM ESTABLECIMIENTO WHERE id_establecimiento = ?', [id_est]);

    await conn.commit();

    // Un solo PDF con una hoja por persona, para imprimir y repartir. Si
    // falla, las cuentas ya están creadas: las claves siguen en la respuesta.
    let pdf_base64 = null;
    try {
      const hojas = creados.map((c) => construirCredencialesPdf({
        correo: c.correo, nombre: c.nombre, password: c.password,
        establecimiento: est?.nombre, rol: c.rol, variante: 'creacion',
      }));
      pdf_base64 = (await unirPdfs(hojas)).toString('base64');
    } catch (err) {
      console.error('No se pudo armar el PDF de credenciales masivo', err);
    }

    res.status(201).json({
      message: `${creados.length} ${creados.length === 1 ? 'usuario creado' : 'usuarios creados'}`,
      creados,
      pdf_base64,
      pdf_nombre: pdf_base64 ? `credenciales-${creados.length}-usuarios.pdf` : null,
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'Uno de los correos se registró mientras se importaba. Vuelve a subir el archivo.' });
    console.error(err);
    res.status(500).json({ message: 'Error al importar usuarios' });
  } finally {
    conn.release();
  }
};

module.exports = { plantilla, importar };
