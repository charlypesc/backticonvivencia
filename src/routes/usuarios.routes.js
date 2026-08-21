const router = require('express').Router();
const {
  getAll, create, toggleActivo,
  getRoles, asignarRol, quitarRol,
} = require('../controllers/usuarios.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken, resolverScope);

// Antes todo este router era requireRole('DIRECTOR'). Ahora va por permiso, y
// ENCARGADO también los tiene: dar de alta usuarios dejó de ser exclusivo del
// director. Quién puede hacerlo se cambia en rol_permisos, sin tocar código.
router.get('/',             requirePermission(Permiso.UsuarioVer),     getAll);
router.post('/',            requirePermission(Permiso.UsuarioCrear),   create);
router.patch('/:id/toggle', requirePermission(Permiso.UsuarioActivar), toggleActivo);

router.get('/:id/roles',            requirePermission(Permiso.UsuarioVer),         getRoles);
router.post('/:id/roles',           requirePermission(Permiso.UsuarioAsignarRol), asignarRol);
router.delete('/:id/roles/:rolId',  requirePermission(Permiso.UsuarioAsignarRol), quitarRol);

module.exports = router;
