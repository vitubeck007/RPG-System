/* Regras de acesso às páginas (funções puras, para o servidor e para os testes). */

// Valor de um cookie no cabeçalho `Cookie: a=1; b=2` (sem depender de pacote externo).
function lerCookie(cabecalho, nome) {
  for (const parte of String(cabecalho || "").split(";")) {
    const i = parte.indexOf("=");
    if (i > 0 && parte.slice(0, i).trim() === nome) {
      try {
        return decodeURIComponent(parte.slice(i + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}

module.exports = { lerCookie };
