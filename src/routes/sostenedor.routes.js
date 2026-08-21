const router = require('express').Router();
const {
  getAll,
  getById,
  create,
  update,
  remove,
  getEstablecimientos,
  asignarEstablecimiento,
  desasignarEstablecimiento,
} = require('../controllers/sostenedor.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken);

router.get('/',       requirePermission(Permiso.SostenedorVer),      getAll);
router.post('/',      requirePermission(Permiso.SostenedorCrear),    create);
router.get('/:id',    requirePermission(Permiso.SostenedorVer),      getById);
router.put('/:id',    requirePermission(Permiso.SostenedorEditar),   update);
router.delete('/:id', requirePermission(Permiso.SostenedorEliminar), remove);

router.get('/:id/establecimientos',
  requirePermission(Permiso.SostenedorVer), getEstablecimientos);
router.put('/:id/establecimientos/:idEstablecimiento',
  requirePermission(Permiso.SostenedorAsignarEstablecimiento), asignarEstablecimiento);
router.delete('/:id/establecimientos/:idEstablecimiento',
  requirePermission(Permiso.SostenedorAsignarEstablecimiento), desasignarEstablecimiento);

module.exports = router;
