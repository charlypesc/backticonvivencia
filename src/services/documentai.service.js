const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);

const client = new DocumentProcessorServiceClient({ credentials });

const PROJECT_ID   = '400144374569';
const LOCATION     = 'us';
const PROCESSOR_ID = '8d53c29678cb1e81';

const processorName = `projects/${PROJECT_ID}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;

async function procesarDocumento(buffer, mimeType = 'application/pdf') {
  const request = {
    name: processorName,
    rawDocument: {
      content: buffer.toString('base64'),
      mimeType,
    },
  };

  const [result] = await client.processDocument(request);
  const { text, pages } = result.document;

  // Confianza promedio de todas las páginas
  const confianza = pages.reduce((acc, p) => {
    const bloques = p.blocks || [];
    const promPagina = bloques.length
      ? bloques.reduce((s, b) => s + (b.layout?.confidence || 0), 0) / bloques.length
      : 1;
    return acc + promPagina;
  }, 0) / (pages.length || 1);

  return { texto: text, nivelConfianza: Math.round(confianza * 100) / 100 };
}

module.exports = { procesarDocumento };