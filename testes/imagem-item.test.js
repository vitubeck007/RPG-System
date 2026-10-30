const { test } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./ajuda/ambiente');

test('imagem enquadrada é salva e disponibilizada pelo servidor', async () => {
  const servidor = await iniciarServidor();
  try {
    // Cabeçalho PNG de 256 × 256 para verificar o transporte e a persistência.
    const png = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(13, 8);
    png.write('IHDR', 12);
    png.writeUInt32BE(256, 16);
    png.writeUInt32BE(256, 20);
    const enviar = dados => fetch(`${servidor.url}/mestre/imagens-itens`, {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: dados,
    });
    assert.equal((await enviar(Buffer.from('inválido'))).status, 400);
    const resposta = await enviar(png);
    assert.equal(resposta.status, 200);
    const { imagem } = await resposta.json();
    assert.match(imagem, /^\/imagens-itens\/[a-f0-9]{64}\.png$/);
    const recuperada = await fetch(servidor.url + imagem);
    assert.equal(recuperada.status, 200);
    assert.deepEqual(Buffer.from(await recuperada.arrayBuffer()), png);
  } finally {
    await servidor.parar();
  }
});
