/* Regras de acesso às páginas (funções puras, para o servidor e para os testes). */

// O endereço de quem pediu é "local" se for a própria máquina do servidor: loopback ou qualquer
// endereço das placas de rede dela (o mestre pode abrir o painel pelo IP da rede, não só por localhost).
function enderecoEhLocal(ip, enderecosProprios = []) {
  const limpo = String(ip || "").replace(/^::ffff:/i, "");
  if (limpo === "::1" || limpo === "127.0.0.1") return true;
  return enderecosProprios.some((e) => String(e).replace(/^::ffff:/i, "") === limpo);
}

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

module.exports = { enderecoEhLocal, lerCookie };
