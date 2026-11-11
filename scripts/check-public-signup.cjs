const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const QRCode = require('qrcode');
async function main() {
  const base=process.env.SIGNUP_TEST_URL||'http://127.0.0.1:4173';
  mkdirSync('.local/signup-ui',{recursive:true});
  const browser=await chromium.launch({headless:true});
  const errors=[];
  try {
    for(const width of [1440,768,390,320]){
      const context=await browser.newContext({viewport:{width,height:960}});
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base+'/?registro=1&plan=pro&periodo=YEARLY');
      await page.getByRole('heading',{name:'Empecemos por lo tuyo.'}).waitFor();
      assert.match(await page.locator('.signup-summary').innerText(),/199,99/);
      await page.getByLabel('Nombre del negocio').fill('Colección de Ana');
      assert.equal(await page.locator('input[name=slug]').inputValue(),'coleccion-de-ana');
      await page.locator('input[name=slug]').fill('ana-moda');
      await page.getByLabel('Nombre del negocio').fill('Otra colección');
      assert.equal(await page.locator('input[name=slug]').inputValue(),'ana-moda');
      await page.locator('input[name=password]').fill('SoloPrueba2026!');
      await page.getByRole('button',{name:'Mostrar contraseña'}).click();
      assert.equal(await page.locator('input[name=password]').getAttribute('type'),'text');
      await page.getByRole('button',{name:'Ocultar contraseña'}).click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Overflow '+width);
      await page.screenshot({path:'.local/signup-ui/signup-'+width+'.png',fullPage:true});
      await context.close();console.log('PASS: registration design, annual price, slug and layout at '+width);
    }
    const context=await browser.newContext({viewport:{width:390,height:900}});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    let view, captured;
    await context.route('**/api/public/signup**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path.endsWith('/qr'))return route.fulfill({json:{qrDataUrl:await QRCode.toDataURL('https://example.test/qa'),paymentUrl:base+'/?registro=1'}});
      if(path.endsWith('/complete'))view={...view,state:'ACTIVE',webPath:'/?tienda=ana-qa'};
      else if(route.request().method()==='POST'){
        captured=route.request().postDataJSON();
        view={id:captured.operationId,state:'PENDING',companyName:captured.companyName,slug:captured.slug,planCode:'esencial',billingInterval:'MONTHLY',amountMinor:999,currency:'USD',provider:'QR_SIMULATED',checkoutUrl:null,webPath:null,expiresAt:new Date(Date.now()+3600000).toISOString()};
      }
      return route.fulfill({json:view});
    });
    await page.goto(base+'/?registro=1&plan=esencial');
    await page.getByLabel('Nombre del negocio').fill('Ana QA');
    await page.locator('input[name=slug]').fill('ana-qa');
    await page.locator('input[name=firstName]').fill('Ana');await page.locator('input[name=lastName]').fill('Prueba');
    await page.locator('input[name=email]').fill('qa@example.test');await page.locator('input[name=password]').fill('SoloPrueba2026!');
    await page.getByRole('radio').nth(1).check();await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:'Continuar al pago seguro'}).click();
    await page.getByRole('heading',{name:'Activa tu negocio.'}).waitFor();
    await page.getByAltText(/QR de prueba/).waitFor();
    assert.equal(captured.provider,'QR_SIMULATED');assert.equal(captured.planCode,'esencial');
    assert.equal('amountMinor' in captured,false);
    const stored=await page.evaluate(()=>sessionStorage.getItem('lumina.signup.pending'));
    assert.equal(stored.includes('SoloPrueba2026!'),false);assert.equal(stored.includes('qa@example.test'),false);
    await page.getByRole('button',{name:/Confirmar pago simulado/}).click();
    await page.getByRole('heading',{name:'Tu tienda está lista.'}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Entrar a mi tienda',exact:true}).getAttribute('href'),'/?tienda=ana-qa');
    assert.deepEqual(errors,[]);
    await context.unrouteAll({behavior:'wait'});await context.close();
    console.log('PASS: registration → simulated QR → own store; no password persisted and no browser errors');
  } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
