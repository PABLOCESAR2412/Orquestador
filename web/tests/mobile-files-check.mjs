import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
for (const width of [320, 390, 600, 1440]) {
const page = await browser.newPage({viewport:{width,height:900}});
const css = ['src/styles.css','src/styles-chat.css','src/styles-shell.css'].map(p=>readFileSync(p,'utf8')).join('\n');
await page.setContent(`<style>${css}</style><main style="width:calc(100% - 32px);margin:16px"><div class="tl-cambios-pestanas"><button class="tl-cambios-tab">Versiones destacadas</button><button class="tl-cambios-tab">Registro detallado</button><button class="tl-cambios-tab">PRs</button></div><div class="tl-md"><div class="tl-tabla-wrap"><table><thead><tr><th>Archivo</th><th>Formato</th><th>Detalle</th></tr></thead><tbody><tr><td><span class="tl-archivo-chip"><button class="tl-archivo-chip-abrir"><span class="tl-archivo-chip-ruta">segunda-guerra-mundial-narracion-stories.mp4</span><span class="tl-archivo-chip-tipo">MP4</span><span class="tl-archivo-chip-abrir-etiqueta">Abrir</span></button></span></td><td>H.264 + AAC</td><td>1080 × 1920, 9,9 segundos, con voz</td></tr></tbody></table></div></div></main>`);
const result = await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,tableHeight:document.querySelector('table').getBoundingClientRect().height,tabs:[...document.querySelectorAll('.tl-cambios-tab')].every(x=>x.scrollWidth<=x.clientWidth)}));
if(result.overflow || result.tableHeight>220 || !result.tabs) throw new Error(JSON.stringify({width,...result}));
console.log('PASS',width,JSON.stringify(result)); await page.close();
}
} finally {await browser.close();}
