const router = require('express').Router();
const { getAll, getByRegistro, create, update, remove } = require('../controllers/protocolosActivados.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken, resolverScope, requireEstablecimiento);

router.get('/',                    getAll);                            // ambos roles
router.get('/registro/:id_registro', getByRegistro);                   // ambos roles
router.post('/',                   requirePermission(Permiso.ProtocoloActivadoCrear), create);  // solo ENCARGADO
router.put('/:id',                 requirePermission(Permiso.ProtocoloActivadoEditar), update);  // solo ENCARGADO
router.delete('/:id',              requirePermission(Permiso.ProtocoloActivadoEliminar), remove);  // solo ENCARGADO

module.exports = router;
