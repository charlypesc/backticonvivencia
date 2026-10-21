const jwt = require('jsonwebtoken');
const { CODIGO_POR_ID, codigoDe } = require('../constants/permisos');
const { estaBloqueado } = require('../utils/accesoBloqueado');

// Los permisos viajan en el token como ids numéricos. Los tokens emitidos
// antes de este cambio los traen como códigos string; se traducen acá para no
// dejar a nadie con 403 en todo hasta que expire su sesión. Se puede borrar
// junto con el resto del fallback legacy cuando ya no queden tokens viejos.
const ID_POR_CODIGO = Object.fromEntries(
  Object.entries(CODIGO_POR_ID).map(([id, codigo]) => [codigo, Number(id)])
);

const normalizarPermisos = (permisos) =>
  (permisos ?? []).map((p) => (typeof p === 'number' ? p : ID_POR_CODIGO[p])).filter(Boolean);

// Lo único que se puede hacer con una clave temporal: leer la sesión y cambiarla.
const RUTAS_CON_CLAVE_TEMPORAL = ['/api/auth/me', '/api/auth/password'];

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  // 401 (no 403) con `sesion_expirada`: el front lo usa para volver al login.
  // Un 403 se confundía con "no tienes permiso" y la pantalla quedaba vacía.
  if (!token)
    return res.status(401).json({ message: 'Token requerido', sesion_expirada: true });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    req.user.permisos = normalizarPermisos(req.user.permisos);
  } catch {
    return res.status(401).json({ message: 'Tu sesión expiró, vuelve a iniciar sesión', sesion_expirada: true });
  }

  // Clave temporal (recién creada o restablecida por el encargado): quien la
  // entregó la conoce, así que hasta reemplazarla la sesión solo sirve para
  // eso. Se bloquea acá y no solo en la pantalla porque la API se puede
  // llamar directo con el token.
  if (req.user.debe_cambiar_password && !RUTAS_CON_CLAVE_TEMPORAL.includes(req.baseUrl + req.path))
    return res.status(403).json({
      message: 'Tienes que cambiar tu contraseña temporal antes de continuar',
      cambio_password_requerido: true,
    });

  // Establecimiento suspendido desde Geo: corta también las sesiones que ya
  // estaban abiertas al suspenderlo (el login solo frena las nuevas). 401 con
  // sesion_expirada para que el front vuelva al login, que muestra el motivo.
  // El ADMIN queda exento, igual que en el login.
  if (esAdmin(req)) return next();
  estaBloqueado(req.user.id_establecimiento)
    .then((bloqueado) => {
      if (bloqueado)
        return res.status(401).json({
          message: 'El acceso de este establecimiento está suspendido. Contacte al administrador.',
          sesion_expirada: true,
        });
      next();
    })
    .catch(next);
};

// Los tokens emitidos antes de RBAC solo traen `rol` (string). El fallback los
// mantiene válidos hasta que expiren, en vez de dejar a la gente afuera al
// desplegar.
const rolesDe = (req) => req.user.roles ?? (req.user.rol ? [req.user.rol] : []);

// El ADMIN pasa todos los chequeos sin consultar sus permisos: por eso el login
// no se los mete en el token. Contrapartida: ADMIN no se puede restringir por
// datos — si algún día hace falta un admin acotado, hay que sacar este bypass
// y asignarle permisos explícitos.
const esAdmin = (req) => rolesDe(req).includes('ADMIN');

const requireRole = (...roles) => (req, res, next) => {
  if (esAdmin(req)) return next();
  if (!rolesDe(req).some((r) => roles.includes(r)))
    return res.status(403).json({ message: 'No tienes permisos para esta acción' });
  next();
};

// Recibe un id de Permiso (ver src/constants/permisos.js), no un string. Se
// valida el tipo porque pasar un string acá no fallaría: no coincidiría con
// ningún id y denegaría el acceso siempre, en silencio.
const requirePermission = (id) => {
  if (typeof id !== 'number')
    throw new TypeError(
      `requirePermission espera un id de Permiso (número), recibió ${JSON.stringify(id)}. ` +
      'Usa Permiso.RecursoAccion en vez del código string.'
    );
  if (!CODIGO_POR_ID[id])
    throw new Error(`requirePermission recibió el id ${id}, que no existe en el catálogo de permisos`);

  return (req, res, next) => {
    if (esAdmin(req)) return next();
    if (!req.user.permisos.includes(id))
      return res.status(403).json({
        message: 'No tienes permisos para esta acción',
        permiso_requerido: codigoDe(id),
      });
    next();
  };
};

const tienePermiso = (req, id) => esAdmin(req) || (req.user.permisos ?? []).includes(id);

// Un registro de convivencia queda firmado por quien lo crea, y esa autoría es
// parte del expediente: tiene que ser una persona del colegio (el coordinador,
// un inspector), no la cuenta de administración del sistema. Por eso la cuenta
// ADMIN, que pasa todos los demás chequeos, no crea registros. Va antes que
// requirePermission porque el bypass de ADMIN está justamente ahí.
const MSG_ADMIN_NO_CREA =
  'La cuenta de administrador no crea registros: ingresa con la cuenta del coordinador de convivencia u otro funcionario del colegio.';
const noAdminAutor = (req, res, next) =>
  esAdmin(req) ? res.status(403).json({ message: MSG_ADMIN_NO_CREA }) : next();

module.exports = {
  verifyToken, requireRole, requirePermission, rolesDe, esAdmin, tienePermiso, noAdminAutor,
};
