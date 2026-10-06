const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { canalPublico, enviarDenuncia } = require('../controllers/denuncias.controller');

// Formulario PÚBLICO del canal de denuncias: sin sesión, se llega por el QR
// del colegio. Ver denuncias.controller.js.
//
// No acepta adjuntos a propósito: la ley no exige pruebas para denunciar, y
// una foto puede traer metadatos (GPS, modelo del teléfono) que delatarían a
// quien denunció en forma anónima. Las pruebas se piden después, en el registro.

// Contra el spam y los envíos repetidos. El contador vive en memoria y se
// olvida solo: la IP no se guarda en ninguna parte, que es lo que hace que el
// canal anónimo sea anónimo de verdad.
const limiteEnvios = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Enviaste varias denuncias seguidas. Espera unos minutos antes de mandar otra.' },
});

router.get('/:token', canalPublico);
router.post('/:token', limiteEnvios, enviarDenuncia);

module.exports = router;
