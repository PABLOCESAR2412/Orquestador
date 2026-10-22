import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {for(const width of [320,390,600,1440]) {
const page=await browser.newPage({viewport:{width,height:800}});
const css=['styles.css','styles-chat.css','styles-picker.css'].map(x=>readFileSync('src/'+x,'utf8')).join('\n');
await page.setContent(`<style>${css}</style><header class="tl-chat-cabecera"><div class="tl-chat-cabecera-izq"><span class="tl-chip-modelo">MiniMax M3.1</span><h2 class="tl-chat-titulo">Una conversación con un título muy largo</h2></div><div class="tl-chat-cabecera-der">${['Compartir','Exportar','Contexto','Historial'].map(x=>`<button class="tl-boton" aria-label="${x}"><span class="tl-boton-texto">${x}</span>○</button>`).join('')}</div></header><div class="picker-configuracion"><div class="segmented">${['Auto','Bajo','Medio','Alto','Muy alto','Máximo'].map(x=>`<button>${x}</button>`).join('')}</div></div>`);
const result=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...document.querySelectorAll('.segmented button')].map(x=>({h:x.getBoundingClientRect().height,y:x.getBoundingClientRect().y,w:x.getBoundingClientRect().width}))}));
if(result.overflow || (width<=760 && (result.buttons.some(x=>x.h<44) || Math.max(...result.buttons.map(x=>x.w))-Math.min(...result.buttons.map(x=>x.w))>1))) throw new Error(JSON.stringify(result));
console.log('PASS',width);await page.close();
}}finally {await browser.close();}
