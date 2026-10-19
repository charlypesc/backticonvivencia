const router = require('express').Router();
const multer = require('multer');
const {
  getAll, getByRegistro, getDetalle, getBitacora, sobreintervencion, plazoInvestigacion,
  create,
  completarPaso, aprobarPaso, omitirPaso, reasignarPaso,
  cerrar, anular, agregarNota,
  update, remove,
} = require('../controllers/protocolosActivados.controller');
const involucrados = require('../controllers/involucrados.controller');
const relatos = require('../controllers/relatos.controller');
const accesoCaso = require('../controllers/accesoCaso.controller');
const medidasPaso = require('../controllers/medidasPaso.controller');
const proteccionPaso = require('../controllers/proteccionPaso.controller');
const medidasProteccion = require('../controllers/medidasProteccion.controller');
const suspensionCautelar = require('../controllers/suspensionCautelar.controller');
const expediente = require('../controllers/expediente.controller');
const informeExpulsion = require('../controllers/informeExpulsion.controller');
const { verifyToken, requirePermission, tienePermiso } = require('../middleware/auth');
const pool = require('../db/connection');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');
const { permisosDelCaso, participaEnAlgunCaso } = require('../utils/accesoCaso');

router.use(verifyToken, resolverScope, requireEstablecimiento);

// Los permisos que da el propio caso (utils/accesoCaso.js): quien está en su
// lista de acceso trabaja ESE caso aunque su rol no tenga los permisos, y quien
// tiene una tarjeta o un relato encargado puede abrirlo. Se suman acá, a la
// copia del usuario de esta petición, para que todo lo de abajo —los
// requirePermission de cada ruta y los tienePermiso de los controllers— los vea
// sin cambiar nada. No salen del caso: el próximo pedido parte de nuevo.
router.param('id', async (req, res, next, id) => {
  try {
    const extra = await permisosDelCaso(pool, req, id);
    if (extra.length)
      req.user = { ...req.user, permisos: [...new Set([...(req.user.permisos ?? []), ...extra])] };
    next();
  } catch (err) {
    next(err);
  }
});

// El listado: con el permiso del rol, o teniendo algún caso por lista de acceso
// o encargo (ve solo esos: getAll filtra por participación).
const verListado = async (req, res, next) => {
  if (tienePermiso(req, Permiso.ProtocoloActivadoVer)) return next();
  try {
    if (await participaEnAlgunCaso(pool, req.user.id)) return next();
  } catch (err) {
    return next(err);
  }
  return requirePermission(Permiso.ProtocoloActivadoVer)(req, res, next);
};

// El permiso, o ser el responsable asignado de ESE paso. Cuando el coordinador
// le encarga una tarjeta a alguien cuyo rol no tiene el permiso general, la
// asignación es la autorización: si no, asignarle el paso no le serviría de
// nada. Alcanza solo a ese paso del caso, y el controller sigue aplicando sus
// propias reglas (decisiones indelegables, estado del caso, etc.).
//
// El paso sale de :id_paso o, en las gestiones, del :id_paso_involucrado.
const permisoOResponsable = (permiso) => {
  const conPermiso = requirePermission(permiso);
  return async (req, res, next) => {
    if (tienePermiso(req, permiso)) return next();
    try {
      const [filas] = req.params.id_paso
        ? await pool.query(
            `SELECT 1 FROM PROTOCOLO_ACTIVADO_PASO
             WHERE id_activado_paso = ? AND id_protocolo_activado = ? AND id_usuario_responsable = ?`,
            [req.params.id_paso, req.params.id, req.user.id])
        : await pool.query(
            `SELECT 1 FROM PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO pi
             JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = pi.id_activado_paso
             WHERE pi.id_paso_involucrado = ? AND p.id_protocolo_activado = ? AND p.id_usuario_responsable = ?`,
            [req.params.id_paso_involucrado, req.params.id, req.user.id]);
      if (filas.length) return next();
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'Error al verificar el permiso' });
    }
    return conPermiso(req, res, next); // responde el 403 de siempre
  };
};

// El acta firmada llega escaneada, fotografiada con el celular o como el
// documento que tenga a mano quien la sube. No se filtra ni por tipo ni por
// peso: comprimirArchivo() achica lo que puede (imagen y PDF) y deja pasar el
// resto, que es mejor que rechazar el archivo y quedarse sin la constancia. El
// tope de 50 MB es sólo para no cargar la memoria del proceso.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.get('/',                       verListado, getAll);
router.get('/registro/:id_registro',  requirePermission(Permiso.ProtocoloActivadoVer), getByRegistro);
// Antes de '/:id': si no, 'sobreintervencion' se leería como un id de caso.
router.get('/sobreintervencion',      requirePermission(Permiso.ProtocoloActivadoCrear), sobreintervencion);
router.get('/plazo-investigacion',    requirePermission(Permiso.ProtocoloActivadoCrear), plazoInvestigacion);
router.get('/:id',                    requirePermission(Permiso.ProtocoloActivadoVer), getDetalle);
router.get('/:id/bitacora',           requirePermission(Permiso.ProtocoloActivadoVerBitacora), getBitacora);

// Activar materializa el grafo: es lo que convierte una plantilla en un caso.
router.post('/', requirePermission(Permiso.ProtocoloActivadoCrear), create);

// Acciones del motor. Cada verbo tiene su permiso: completar un paso, aprobarlo
// y anular el caso son actos distintos, con firmas distintas en la bitácora.
router.post('/:id/pasos/:id_paso/completar', permisoOResponsable(Permiso.ProtocoloActivadoCompletarPaso), completarPaso);
router.post('/:id/pasos/:id_paso/aprobar',   permisoOResponsable(Permiso.ProtocoloActivadoAprobarPaso),   aprobarPaso);
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

// Acogida de relatos: a quién se le acoge, cada relato y sus correcciones, y a
// quién se le encarga el relato de cada persona. Sin permiso de ruta: el
// alcance lo decide el controller por persona (quien ve el caso completo, el
// responsable del paso, su ejecutor por rol, o a quien le encargaron ESE
// relato) — un permiso general no sirve para decir "solo este relato".
router.put('/:id/pasos/:id_paso/relatos/personas/:id_involucrado', relatos.decidir);
router.put('/:id/pasos/:id_paso/relatos/personas/:id_involucrado/responsable', relatos.asignar);
router.post('/:id/pasos/:id_paso/relatos', relatos.acoger);
router.put('/:id/pasos/:id_paso/relatos/:id_relato', relatos.editar);

// Tarjeta "Medidas": la medida (o "Sin medidas") de cada involucrado.
router.post('/:id/pasos/:id_paso/medidas',
  permisoOResponsable(Permiso.ProtocoloActivadoCompletarPaso), medidasPaso.registrar);
// Medidas de protección decididas desde el afectado (paso de protección para las dos partes).
router.post('/:id/pasos/:id_paso/proteccion',
  permisoOResponsable(Permiso.ProtocoloActivadoCompletarPaso), proteccionPaso.registrar);
router.post('/:id/pasos/:id_paso/proteccion/sin-medidas',
  permisoOResponsable(Permiso.ProtocoloActivadoCompletarPaso), proteccionPaso.sinMedidas);
// Las de protección vigentes de pasos anteriores: mantenerlas o concluirlas ahí mismo.
router.post('/:id/pasos/:id_paso/medidas/previas/:id_medida',
  permisoOResponsable(Permiso.ProtocoloActivadoCompletarPaso), medidasPaso.decidirPrevia);
// El documento que se firma por una medida (resolución del director o acta del
// equipo de convivencia): en blanco para imprimir, y el firmado para subir y ver.
router.get('/:id/medidas/:id_medida/documento-pdf',
  requirePermission(Permiso.ProtocoloActivadoVer), medidasPaso.generarDocumento);
router.put('/:id/medidas/:id_medida/documento',
  requirePermission(Permiso.ProtocoloActivadoCompletarPaso), upload.single('archivo'), medidasPaso.subirDocumento);
router.get('/:id/medidas/:id_medida/documento',
  requirePermission(Permiso.ProtocoloActivadoVer), medidasPaso.verDocumento);

// "¿Quién puede ver este protocolo completo?": la lista de acceso del caso. La
// administran los roles de supervisión (ver utils/accesoCaso.js).
router.get   ('/:id/acceso',             accesoCaso.getAcceso);
router.post  ('/:id/acceso',             accesoCaso.otorgar);
router.delete('/:id/acceso/:id_usuario', accesoCaso.retirar);

// Lo que se hizo con una persona en un paso: la notificación, la entrega, la
// firma. Va bajo el paso porque es parte de completarlo.
router.post('/:id/gestiones/:id_paso_involucrado',
  permisoOResponsable(Permiso.ProtocoloActivadoCompletarPaso), involucrados.registrarGestion);

// El acta de notificación firmada por la persona. Adjuntarla es completar la
// gestión (mismo permiso); verla es ver el caso.
router.put('/:id/gestiones/:id_paso_involucrado/acta',
  permisoOResponsable(Permiso.ProtocoloActivadoCompletarPaso), upload.single('archivo'),
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
