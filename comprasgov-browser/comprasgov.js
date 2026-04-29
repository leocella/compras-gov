'use strict';

const SEL = {
  campoUasg:        'input[name*="uasg" i], input[id*="uasg" i]',
  campoNumero:      'input[name*="numero" i], input[id*="numero" i]',
  botaoBuscar:      'button:has-text("Pesquisar"), button:has-text("Buscar")',
  linkItens:        'a:has-text("itens"), a[href*="itens"]',
  linhasItens:      'table tbody tr',
  colNumero:        'td:nth-child(1)',
  colDescricao:     'td:nth-child(2)',
  colQuantidade:    'td:nth-child(3)',
  colUnidade:       'td:nth-child(4)',
  colValorEstimado: 'td:nth-child(5)',
};

function extrairMarcas(descricao) {
  const out = { marcaObrigatoria: '', marcaPreferencia: '' };
  if (!descricao || typeof descricao !== 'string') return out;

  const reObrig = /marca\s+obrigat[óo]ria\s*[:\-–—]\s*([^\n.;]+)/i;
  const rePref  = /marca\s+de\s+prefer[êe]ncia\s*[:\-–—]\s*([^\n.;]+)/i;

  const mO = descricao.match(reObrig);
  const mP = descricao.match(rePref);

  if (mO) out.marcaObrigatoria = mO[1].trim();
  if (mP) out.marcaPreferencia = mP[1].trim();
  return out;
}

async function tirarScreenshot(page) {
  const buf = await page.screenshot({ type: 'png', fullPage: false });
  return buf.toString('base64');
}

async function rasparItensPregao(page, uasg, numeroPregao, startUrl) {
  await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

  await page.fill(SEL.campoUasg, String(uasg));
  await page.fill(SEL.campoNumero, String(numeroPregao));
  await page.click(SEL.botaoBuscar);
  await page.waitForLoadState('networkidle');

  await page.click(SEL.linkItens);
  await page.waitForLoadState('networkidle');

  const linhas = await page.$$eval(SEL.linhasItens, (rows, sel) => {
    const txt = (el, q) => {
      const n = el.querySelector(q);
      return n ? n.textContent.trim() : '';
    };
    const num = (s) => {
      if (!s) return null;
      const limpo = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
      const n = parseFloat(limpo);
      return Number.isFinite(n) ? n : null;
    };
    return rows.map((r) => ({
      numero:        txt(r, sel.colNumero),
      descricao:     txt(r, sel.colDescricao),
      quantidade:    num(txt(r, sel.colQuantidade)),
      unidade:       txt(r, sel.colUnidade),
      valorEstimado: num(txt(r, sel.colValorEstimado)),
    }));
  }, SEL);

  const itens = linhas
    .filter((l) => l.numero || l.descricao)
    .map((l) => ({ ...l, ...extrairMarcas(l.descricao) }));

  return { itens, url: page.url() };
}

module.exports = { extrairMarcas, tirarScreenshot, rasparItensPregao, SEL };
