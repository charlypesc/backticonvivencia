// Piezas que comparten los PDF que arma el servidor.

/**
 * Texto apto para las fuentes estándar de jsPDF (helvetica, times, courier),
 * que sólo cubren Latin-1. Un solo carácter fuera de rango —una flecha, unas
 * comillas tipográficas— hace que TODA la línea salga con las letras separadas
 * y se vaya del margen. Tildes y ñ sí están en Latin-1 y se conservan.
 */
const plano = (valor) =>
  String(valor ?? '')
    // macOS entrega las tildes descompuestas ("I" + acento suelto). Sin
    // recomponerlas, el filtro de abajo se lleva el acento y parte la palabra:
    // es lo que salía como "MARIÌ•A".
    .normalize('NFC')
    .replace(/[→⇒⟶]/g, '->')
    .replace(/[←⇐]/g, '<-')
    .replace(/[–—]/g, '-')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[•●▪]/g, '·')
    .replace(/ /g, ' ')
    .replace(/[^\x00-\xFF]/g, '');

/** jsPDF → Buffer, para mandarlo con `res.send`. */
const aBuffer = (doc) => Buffer.from(doc.output('arraybuffer'));

/**
 * Responde el PDF. `inline` y no `attachment`: el front decide si lo descarga
 * o lo manda a imprimir (popover Imprimir/Descargar), y el nombre viaja igual
 * para que la descarga salga bien nombrada.
 *
 * El nombre va dos veces: `filename` en ASCII para los clientes viejos y
 * `filename*` en UTF-8 para que "Notificación María" no llegue roto.
 */
const enviarPdf = (res, buffer, nombre) => {
  const ascii = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '').replace(/"/g, '');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`
  );
  // El front lee el nombre de esta cabecera: sin exponerla, CORS la esconde.
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.send(buffer);
};

module.exports = { plano, aBuffer, enviarPdf };
