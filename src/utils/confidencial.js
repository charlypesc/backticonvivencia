const { tienePermiso } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');

// Dos permisos distintos, a propósito:
//
// - registro.ver_confidencial      -> leer el contenido de un registro ajeno
// - registro.editar_confidencialidad -> marcar/levantar la confidencialidad ajena
//
// Separarlos permite que un DIRECTOR pueda leer un caso confidencial sin poder
// desmarcarlo: quien lo declaró confidencial (el encargado o el psicólogo)
// sigue siendo el único que decide cuándo deja de serlo. El autor siempre puede
// ambas cosas sobre lo suyo, y el ADMIN pasa por el bypass de tienePermiso.
const esAutor = (req, registro) => registro.id_usuario === req.user.id;

const puedeVerConfidencial = (req, registro) =>
  esAutor(req, registro) || tienePermiso(req, Permiso.RegistroVerConfidencial);

const puedeEditarConfidencialidad = (req, registro) =>
  esAutor(req, registro) || tienePermiso(req, Permiso.RegistroEditarConfidencialidad);

// A un funcionario se le nombra por su nombre: el correo solo queda de
// respaldo, para las cuentas que todavía no lo tienen cargado. Cada consulta
// aliasea distinto (encargado_correo en registros, autor_correo en el resto),
// así que se normaliza acá en vez de pedirle a cada SELECT que use el mismo
// alias.
const autorCorreo = (registro) =>
  registro.autor_correo ?? registro.encargado_correo ?? null;

const autorNombre = (registro) =>
  registro.autor_nombre ?? registro.encargado_nombre ?? null;

// Cualquier consulta que devuelva filas de REGISTRO_CONVIVENCIA (registros,
// historial de estudiante, dashboard...) debe pasarlas por acá antes de
// responder: si no, el contenido se filtra por la puerta de al lado.
//
// Se conserva la nota justamente para que el resto del equipo sepa que el caso
// existe y por qué no puede verlo.
//
// También se conservan autor y fecha de creación: saber quién declaró
// confidencial el caso y cuándo es lo que permite ir a pedirle acceso a esa
// persona. Ninguno de los dos revela el contenido del registro.
const reducirSiConfidencial = (req, registro) => {
  if (!registro.es_confidencial || puedeVerConfidencial(req, registro)) return registro;

  return {
    id_registro: registro.id_registro,
    codigo: registro.codigo,
    fecha_incidente: registro.fecha_incidente,
    fecha_creacion: registro.fecha_creacion,
    autor_correo: autorCorreo(registro),
    autor_nombre: autorNombre(registro),
    fecha_modificacion: registro.fecha_modificacion,
    editor_correo: registro.editor_correo ?? null,
    editor_nombre: registro.editor_nombre ?? null,
    es_confidencial: true,
    nota_confidencial: registro.nota_confidencial,
    // Quién lo atiende y a quién se derivó tampoco es contenido: sin esto el
    // listado marcaba "Por atender" a todo confidencial que no se puede leer.
    id_usuario_atiende: registro.id_usuario_atiende ?? null,
    ...(registro.derivado_a !== undefined
      ? { derivado_a: registro.derivado_a, derivacion_limite: registro.derivacion_limite }
      : {}),
    // Los involucrados no son el contenido reservado: lo reservado es qué pasó.
    // Saber que un estudiante figura en un caso confidencial es justamente lo
    // que el resto del equipo necesita para no tratarlo a ciegas. Solo se
    // incluye si la consulta los trajo (getAll y dashboard sí, el resto no).
    ...(registro.alumno_nombre !== undefined
      ? { alumno_nombre: registro.alumno_nombre }
      : {}),
    // Bandera explícita para el front: "esto viene recortado, no lo abras".
    // Deducirlo de los campos que faltan obliga a cada pantalla a inventar su
    // propio chequeo (una mira el asunto, otra alumno_nombre) y se rompe apenas
    // una consulta devuelve columnas distintas.
    contenido_oculto: true,
  };
};

/**
 * Qué registros puede siquiera VER EN UNA LISTA quien consulta (2026-10-06).
 *
 * reducirSiConfidencial recorta el contenido pero deja la fila a la vista, y
 * eso no alcanzaba: un profesor veía en la ficha del estudiante que había un
 * caso confidencial, y los registros nacidos del canal de denuncias aparecían
 * completos. Ahora, sin el permiso correspondiente, la fila no existe:
 *
 *  - confidencial              → registro.ver_confidencial
 *  - creado desde una denuncia → denuncia.ver (el canal tiene reserva de
 *                                identidad; su registro hereda ese resguardo)
 *
 * El autor siempre ve lo suyo, y quien recibió una derivación ve ese registro
 * (sin derivación no podría atender lo que se le pidió). Un confidencial
 * derivado se le sigue mostrando recortado por reducirSiConfidencial.
 *
 * Devuelve un fragmento ` AND ...` para pegar al WHERE, con sus parámetros.
 *
 * @param {string} a alias de REGISTRO_CONVIVENCIA en la consulta
 */
const filtroRegistrosVisibles = (req, a = 'r') => {
  const partes = [];
  const params = [];
  const propioODerivado = `${a}.id_usuario = ? OR EXISTS (
      SELECT 1 FROM REGISTRO_DERIVACION dv
       WHERE dv.id_registro = ${a}.id_registro AND dv.id_usuario_destino = ?)`;

  if (!tienePermiso(req, Permiso.RegistroVerConfidencial)) {
    partes.push(`(NOT ${a}.es_confidencial OR ${propioODerivado})`);
    params.push(req.user.id, req.user.id);
  }
  if (!tienePermiso(req, Permiso.DenunciaVer)) {
    partes.push(`(NOT EXISTS (SELECT 1 FROM DENUNCIA dn WHERE dn.id_registro = ${a}.id_registro)
               OR ${propioODerivado})`);
    params.push(req.user.id, req.user.id);
  }
  return { sql: partes.map((p) => ` AND ${p}`).join(''), params };
};

/** Mismo criterio para un registro puntual (detalle, PDF, escrituras). */
const registroVisible = async (db, req, id_registro) => {
  const f = filtroRegistrosVisibles(req, 'r');
  if (!f.sql) return true;
  const [[r]] = await db.query(
    `SELECT 1 AS ok FROM REGISTRO_CONVIVENCIA r WHERE r.id_registro = ?${f.sql}`,
    [id_registro, ...f.params]
  );
  return !!r;
};

module.exports = {
  filtroRegistrosVisibles,
  registroVisible,
  esAutor,
  autorCorreo,
  puedeVerConfidencial,
  puedeEditarConfidencialidad,
  reducirSiConfidencial,
};
