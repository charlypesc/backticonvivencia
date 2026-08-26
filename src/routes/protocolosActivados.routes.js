const router = require('express').Router();
const {
  getAll, getByRegistro, getDetalle, getBitacora,
  create,
  completarPaso, aprobarPaso, omitirPaso, reasignarPaso,
  cerrar, anular, agregarNota,
  update, remove,
} = require('../controllers/protocolosActivados.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken, resolverScope, requireEstablecimiento);

router.get('/',                       requirePermission(Permiso.ProtocoloActivadoVer), getAll);
router.get('/registro/:id_registro',  requirePermission(Permiso.ProtocoloActivadoVer), getByRegistro);
router.get('/:id',                    requirePermission(Permiso.ProtocoloActivadoVer), getDetalle);
router.get('/:id/bitacora',           requirePermission(Permiso.ProtocoloActivadoVerBitacora), getBitacora);

// Activar materializa el grafo: es lo que convierte una plantilla en un caso.
router.post('/', requirePermission(Permiso.ProtocoloActivadoCrear), create);

// Acciones del motor. Cada verbo tiene su permiso: completar un paso, aprobarlo
// y anular el caso son actos distintos, con firmas distintas en la bitácora.
router.post('/:id/pasos/:id_paso/completar', requirePermission(Permiso.ProtocoloActivadoCompletarPaso), completarPaso);
router.post('/:id/pasos/:id_paso/aprobar',   requirePermission(Permiso.ProtocoloActivadoAprobarPaso),   aprobarPaso);
router.post('/:id/pasos/:id_paso/omitir',    requirePermission(Permiso.ProtocoloActivadoOmitirPaso),    omitirPaso);
router.post('/:id/pasos/:id_paso/reasignar', requirePermission(Permiso.ProtocoloActivadoReasignarPaso), reasignarPaso);

router.post('/:id/cerrar', requirePermission(Permiso.ProtocoloActivadoCerrar), cerrar);
router.post('/:id/anular', requirePermission(Permiso.ProtocoloActivadoAnular), anular);
router.post('/:id/nota',   requirePermission(Permiso.ProtocoloActivadoEditar), agregarNota);

router.put   ('/:id', requirePermission(Permiso.ProtocoloActivadoEditar),   update);   // ver el controller: ya no reapunta
router.delete('/:id', requirePermission(Permiso.ProtocoloActivadoEliminar), remove);

module.exports = router;
