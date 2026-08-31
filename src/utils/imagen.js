const convertirHeic = require('heic-convert');

const MIMES_HEIC = [
  'image/heic', 'image/heif',
  'image/heic-sequence', 'image/heif-sequence',
];

const esHeic = (mimetype, originalname = '') =>
  MIMES_HEIC.includes(mimetype) || /\.(heic|heif)$/i.test(originalname);

/**
 * Document AI no acepta HEIC/HEIF (formato por defecto de las fotos de iPhone),
 * así que lo convertimos a JPEG antes de mandarlo. El resto de formatos pasa
 * tal cual. Devuelve { buffer, mimetype } listos para usar.
 */
async function normalizarImagen(buffer, mimetype, originalname = '') {
  if (!esHeic(mimetype, originalname)) return { buffer, mimetype };

  const jpeg = await convertirHeic({ buffer, format: 'JPEG', quality: 0.8 });
  return { buffer: Buffer.from(jpeg), mimetype: 'image/jpeg' };
}

module.exports = { normalizarImagen, esHeic };
