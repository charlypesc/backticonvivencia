const router = require('express').Router();
const multer = require('multer');
const {
  actualizar, registrarReconsideracion, resolver,
  subirDocumento, descargarDocumento, generarActaConsejo,
} = require('../controllers/suspensionCautelar.controller');
const { verifyToken, requirePermission, tienePermiso } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

// Igual que medidasProteccion: ver y crear cuelgan del caso
// (/api/protocolos-activados/:id/...), porque una cautelar sin procedimiento
// sancionatorio no existe. Acá van las acciones sobre una suspensión concreta,
// que ya no necesitan saber de qué caso viene.
router.use(verifyToken, resolverScope, requireEstablecimiento);

// Corregir va con el permiso de crear: quien puede decretar la cautelar es
// quien puede arreglar el error con que la cargó. El controller se encarga de
// cerrar la ventana apenas hay reconsideración o resolución.
router.put('/:id', requirePermission(Permiso.SuspensionCautelarCrear), actualizar);

router.patch('/:id/reconsideracion',
  requirePermission(Permiso.SuspensionCautelarRegistrarReconsideracion), registrarReconsideracion);

// Resolver es facultad del director: es el mismo que decretó la medida y el
// que la ley obliga a resolver previa consulta al Consejo de Profesores.
router.patch('/:id/resolver',
  requirePermission(Permiso.SuspensionCautelarResolver), resolver);

// Documentos de la reconsideración. Sin filtro de tipo ni de peso, igual que
// el acta de notificación firmada: comprimirArchivo() achica lo que puede. El
// tope de 50 MB es sólo para no cargar la memoria del proceso.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// La solicitud la adjunta quien registra la reconsideración. El acta del
// Consejo también puede adjuntarla el director al resolver, que es cuando se
// exige.
const permisoDocumento = (req, res, next) => {
  const puede =
    tienePermiso(req, Permiso.SuspensionCautelarRegistrarReconsideracion) ||
    (req.params.tipo === 'acta_consejo' && tienePermiso(req, Permiso.SuspensionCautelarResolver));
  if (!puede) return res.status(403).json({ message: 'No tienes permisos para esta acción' });
  next();
};

router.put('/:id/documentos/:tipo', permisoDocumento, upload.single('archivo'), subirDocumento);
router.get('/:id/documentos/:tipo', requirePermission(Permiso.SuspensionCautelarVer), descargarDocumento);

// El formato en blanco del acta del Consejo, para imprimir y hacer firmar.
router.get('/:id/acta-consejo', requirePermission(Permiso.SuspensionCautelarVer), generarActaConsejo);

module.exports = router;
