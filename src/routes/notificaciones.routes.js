const router = require('express').Router();
const {
  getAll, getContador, marcarLeida, marcarTodasLeidas,
} = require('../controllers/notificaciones.controller');
const { verifyToken } = require('../middleware/auth');

// Sin `requirePermission` ni scope de establecimiento: cada endpoint filtra por
// `req.user.id`, que es un candado más estrecho. Y sin scope porque la campana
// tiene que funcionar igual apenas se entra, antes de elegir establecimiento.
router.use(verifyToken);

router.get('/', getAll);
router.get('/contador', getContador);
router.put('/leer-todas', marcarTodasLeidas);
// Después de /leer-todas: si fuera antes, '/leer-todas' entraría como :id.
router.put('/:id/leer', marcarLeida);

module.exports = router;
