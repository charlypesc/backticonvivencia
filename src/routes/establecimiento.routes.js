const router = require('express').Router();
const { getMine, updateMine } = require('../controllers/establecimiento.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken, resolverScope, requireEstablecimiento);

router.get('/',  getMine);                            // ambos roles
router.put('/',  requirePermission(Permiso.MiEstablecimientoEditar), updateMine); // solo DIRECTOR

module.exports = router;
