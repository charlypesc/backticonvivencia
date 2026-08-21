const router = require('express').Router();
const { getAll, create, createPropio, update, remove } = require('../controllers/protocolosEstablecimiento.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken, resolverScope, requireEstablecimiento);

router.get('/',       requirePermission(Permiso.ProtocoloEstablecimientoVer), getAll);
router.post('/',      requirePermission(Permiso.ProtocoloEstablecimientoCrear), create);      // adoptar un genérico
router.post('/propio', requirePermission(Permiso.ProtocoloEstablecimientoCrearPropio), createPropio); // crear uno propio del colegio
router.put('/:id',    requirePermission(Permiso.ProtocoloEstablecimientoEditar), update);     // personalizar el texto local
router.delete('/:id', requirePermission(Permiso.ProtocoloEstablecimientoEliminar), remove);

module.exports = router;
