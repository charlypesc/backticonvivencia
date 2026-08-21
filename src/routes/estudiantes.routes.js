const router = require('express').Router();
const { getAll, create, update, toggleActivo, consultarRut, remove, buscar } = require('../controllers/estudiantes.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken, resolverScope, requireEstablecimiento);

router.get('/',              getAll);
router.get('/buscar',        buscar);
router.get('/rut/:rut',      consultarRut);
router.post('/',             requirePermission(Permiso.EstudianteCrear), create);
router.put('/:id',           requirePermission(Permiso.EstudianteEditar), update);
router.patch('/:id/toggle',  requirePermission(Permiso.EstudianteActivar), toggleActivo);
router.delete('/:id',        requirePermission(Permiso.EstudianteEliminar), remove);
module.exports = router;