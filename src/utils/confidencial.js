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

// USUARIO no tiene nombre, solo correo: el correo es la única forma de
// identificar al autor. Cada consulta lo aliasea distinto (encargado_correo en
// registros, autor_correo en el resto), así que se normaliza acá en vez de
// pedirle a cada SELECT que use el mismo alias.
const autorCorreo = (registro) =>
  registro.autor_correo ?? registro.encargado_correo ?? null;

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
    fecha_incidente: registro.fecha_incidente,
    fecha_creacion: registro.fecha_creacion,
    autor_correo: autorCorreo(registro),
    fecha_modificacion: registro.fecha_modificacion,
    editor_correo: registro.editor_correo ?? null,
    es_confidencial: true,
    nota_confidencial: registro.nota_confidencial,
    // Los involucrados no son el contenido reservado: lo reservado es qué pasó.
    // Saber que un estudiante figura en un caso confidencial es justamente lo
    // que el resto del equipo necesita para no tratarlo a ciegas. Solo se
    // incluye si la consulta los trajo (getAll y dashboard sí, el resto no).
    ...(registro.alumno_nombre !== undefined
      ? { alumno_nombre: registro.alumno_nombre }
      : {}),
    // Bandera explícita para el front: "esto viene recortado, no lo abras".
    // Deducirlo de los campos que faltan obliga a cada pantalla a inventar su
    // propio chequeo (una mira tematica, otra alumno_nombre) y se rompe apenas
    // una consulta devuelve columnas distintas.
    contenido_oculto: true,
  };
};

module.exports = {
  esAutor,
  autorCorreo,
  puedeVerConfidencial,
  puedeEditarConfidencialidad,
  reducirSiConfidencial,
};
