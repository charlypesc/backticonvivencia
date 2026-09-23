const router = require('express').Router();
const multer = require('multer');
const {
  getAll, getByRegistro, getDetalle, getBitacora,
  create,
  completarPaso, aprobarPaso, omitirPaso, reasignarPaso,
  cerrar, anular, agregarNota,
  update, remove,
} = require('../controllers/protocolosActivados.controller');
const involucrados = require('../controllers/involucrados.controller');
const medidasProteccion = require('../controllers/medidasProteccion.controller');
const suspensionCautelar = require('../controllers/suspensionCautelar.controller');
const expediente = require('../controllers/expediente.controller');
const informeExpulsion = require('../controllers/informeExpulsion.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken, resolverScope, requireEstablecimiento);

// El acta firmada llega escaneada, fotografiada con el celular o como el
// documento que tenga a mano quien la sube. No se filtra ni por tipo ni por
// peso: comprimirArchivo() achica lo que puede (imagen y PDF) y deja pasar el
// resto, que es mejor que rechazar el archivo y quedarse sin la constancia. El
// tope de 50 MB es sólo para no cargar la memoria del proceso.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

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

// Involucrados del caso: contra quién y a favor de quién se instruye.
//
// No estrenan permisos propios: ver los involucrados es ver el caso, tocarlos
// es editarlo, y registrar la gestión de una persona es cumplir parte de un
// paso. Inventar tres permisos nuevos habría dejado a todos los roles sin
// poder usar la función hasta repartirlos a mano.
router.get   ('/:id/involucrados', requirePermission(Permiso.ProtocoloActivadoVer),    involucrados.getByCaso);
router.post  ('/:id/involucrados', requirePermission(Permiso.ProtocoloActivadoEditar), involucrados.agregar);
router.put   ('/:id/involucrados/:id_involucrado/rol', requirePermission(Permiso.ProtocoloActivadoEditar), involucrados.cambiarRol);
router.delete('/:id/involucrados/:id_involucrado',     requirePermission(Permiso.ProtocoloActivadoEditar), involucrados.quitar);

// Lo que se hizo con una persona en un paso: la notificación, la entrega, la
// firma. Va bajo el paso porque es parte de completarlo.
router.post('/:id/gestiones/:id_paso_involucrado',
  requirePermission(Permiso.ProtocoloActivadoCompletarPaso), involucrados.registrarGestion);

// El acta de notificación firmada por la persona. Adjuntarla es completar la
// gestión (mismo permiso); verla es ver el caso.
router.put('/:id/gestiones/:id_paso_involucrado/acta',
  requirePermission(Permiso.ProtocoloActivadoCompletarPaso), upload.single('archivo'),
  involucrados.adjuntarActaFirmada);
router.get('/:id/gestiones/:id_paso_involucrado/acta',
  requirePermission(Permiso.ProtocoloActivadoVer), involucrados.descargarActaFirmada);
// El acta en blanco, para imprimir y hacer firmar. La arma el servidor.
router.get('/:id/gestiones/:id_paso_involucrado/acta-notificacion',
  requirePermission(Permiso.ProtocoloActivadoVer), involucrados.generarActaNotificacion);

// Medidas de protección del caso (art. 16 E letra j). Cuelgan del caso porque
// una medida sin caso no existe; el resto de sus acciones va en su propia ruta.
router.get ('/:id/medidas-proteccion', requirePermission(Permiso.MedidaProteccionVer),   medidasProteccion.getByCaso);
router.post('/:id/medidas-proteccion', requirePermission(Permiso.MedidaProteccionCrear), medidasProteccion.crear);

// Suspensión cautelar del art. 6 letra d, que es otra cosa que la de
// protección: acompaña al procedimiento sancionatorio en vez de resguardar a la
// persona afectada. Decretarla es facultad del director, por eso el permiso de
// crear no es el mismo que el de ver.
router.get ('/:id/suspensiones-cautelares', requirePermission(Permiso.SuspensionCautelarVer),   suspensionCautelar.getByCaso);
router.post('/:id/suspensiones-cautelares', requirePermission(Permiso.SuspensionCautelarCrear), suspensionCautelar.crear);

// Expediente del caso: lo que se le entrega a la Superintendencia.
router.get('/:id/expediente', requirePermission(Permiso.ExpedienteExportar), expediente.getExpediente);
router.get('/:id/expediente/pdf', requirePermission(Permiso.ExpedienteExportar), expediente.getExpedientePdf);

// Informe previo de expulsión o cancelación de matrícula.
router.get ('/:id/informe-expulsion', requirePermission(Permiso.InformeExpulsionVer),      informeExpulsion.getByCaso);
router.post('/:id/informe-expulsion', requirePermission(Permiso.InformeExpulsionElaborar), informeExpulsion.crear);

router.put   ('/:id', requirePermission(Permiso.ProtocoloActivadoEditar),   update);   // ver el controller: ya no reapunta
router.delete('/:id', requirePermission(Permiso.ProtocoloActivadoEliminar), remove);

module.exports = router;
