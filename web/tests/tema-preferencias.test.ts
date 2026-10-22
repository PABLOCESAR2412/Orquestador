import {test,expect} from 'bun:test';
import {guardarTema,leerTema,temaComplementario} from '../src/lib/tema';
test('al alternar claro y oscuro recupera la paleta personalizada sin pareja',()=>{
 const datos=new Map(); const originales=['localStorage','document','window'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]);
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>datos.get(k)??null,setItem:(k,v)=>datos.set(k,v)}});
 Object.defineProperty(globalThis,'window',{configurable:true,value:new EventTarget()});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{dataset:{},style:{setProperty(){},removeProperty(){}}}}});
 try {guardarTema('dracula');guardarTema(temaComplementario(leerTema()));expect(leerTema()).toBe('telo-claro');guardarTema(temaComplementario(leerTema()));expect(leerTema()).toBe('dracula');guardarTema('github-light');guardarTema(temaComplementario(leerTema()));expect(leerTema()).toBe('dracula');guardarTema(temaComplementario(leerTema()));expect(leerTema()).toBe('github-light');}
 finally {for(const [k,desc] of originales) {if(desc) Object.defineProperty(globalThis,k,desc);else delete globalThis[k];}}
});
