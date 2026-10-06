const router = require('express').Router();
const {
  getCanal, regenerarCanal, getAll, getById, getIdentidad, descargarArchivo, desestimar,
} = require('../controllers/denuncias.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

// Bandeja del canal de denuncias ("QR denuncias" en el menú). Crear el
// registro a partir de una denuncia va por POST /api/registros con id_denuncia,
// para que el registro y el cambio de estado de la denuncia sean una sola
// transacción.
router.use(verifyToken, resolverScope, requireEstablecimiento);

router.get ('/canal',           requirePermission(Permiso.DenunciaVer),          getCanal);
router.post('/canal/regenerar', requirePermission(Permiso.DenunciaGestionar),    regenerarCanal);
router.get ('/',                requirePermission(Permiso.DenunciaVer),          getAll);
router.get ('/:id',             requirePermission(Permiso.DenunciaVer),          getById);
router.get ('/:id/identidad',   requirePermission(Permiso.DenunciaVerIdentidad), getIdentidad);
router.get ('/:id/archivos/:idArchivo', requirePermission(Permiso.DenunciaVer),  descargarArchivo);
router.post('/:id/desestimar',  requirePermission(Permiso.DenunciaGestionar),    desestimar);

module.exports = router;
