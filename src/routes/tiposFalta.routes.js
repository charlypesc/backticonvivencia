const router = require('express').Router();
const { getAll, create, update, remove, setProtocolos } = require('../controllers/tiposFalta.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken, resolverScope, requireEstablecimiento);

router.get('/',       getAll);                            // ambos roles
router.post('/',      requirePermission(Permiso.TipoFaltaCrear), create);  // solo ENCARGADO
router.put('/:id',    requirePermission(Permiso.TipoFaltaEditar), update);  // solo ENCARGADO
router.delete('/:id', requirePermission(Permiso.TipoFaltaEliminar), remove);  // solo ENCARGADO
// Qué protocolos obliga a activar esta falta (Ley 21.809). Permiso propio: quien
// edita el texto de una falta no necesariamente decide qué protocolo dispara.
router.put('/:id/protocolos', requirePermission(Permiso.TipoFaltaVincularProtocolo), setProtocolos);

module.exports = router;