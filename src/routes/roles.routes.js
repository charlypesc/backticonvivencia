const router = require('express').Router();
const {
  getAll, getPermisos, getCatalogoPermisos, create, update, setPermisos,
} = require('../controllers/roles.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken, resolverScope);

router.get('/',             requirePermission(Permiso.RolVer), getAll);
router.get('/permisos',     requirePermission(Permiso.RolAsignarPermiso), getCatalogoPermisos);
router.get('/:id/permisos', requirePermission(Permiso.RolVer), getPermisos);

// Definir roles dejó de ser exclusivo del ADMIN: va por permiso, así que un
// ENCARGADO puede armar los roles de su propio colegio sin depender de nadie.
//
// Lo que antes justificaba el `requireRole('ADMIN')` acá era el riesgo de
// escalada: quien pudiera crear un rol con todos los permisos y asignárselo
// sería ADMIN de hecho, y la guardia que impide otorgar el rol ADMIN no
// serviría de nada. Ese riesgo ahora lo cubre el controlador, con dos reglas
// que no dependen de qué rol tenga la persona:
//
//   1. Solo se otorgan permisos que el solicitante ya tiene (aguas abajo).
//   2. Quien no es ADMIN solo administra roles de su propio establecimiento,
//      nunca los globales, que los heredan todos los colegios.
router.post('/',            requirePermission(Permiso.RolCrear), create);
router.put('/:id',          requirePermission(Permiso.RolEditar), update);
router.put('/:id/permisos', requirePermission(Permiso.RolAsignarPermiso), setPermisos);

module.exports = router;
