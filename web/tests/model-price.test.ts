import {expect,test} from "bun:test";
import {formatPrice,TIER_LABEL} from "../src/lib/model";
import type {ModelInfo} from "../src/api";

test("precio desconocido no se presenta como gratis ni como tarifa cero",()=>{
  const m:ModelInfo={id:"google/prueba",provider:"google",name:"Prueba",inputUsd:0,outputUsd:0,context:1000,variants:[],free:false,priceKnown:false,costTier:"desconocido",costWarning:null,group:"Google",recommended:true};
  expect(formatPrice(m)).toBe("Precio no disponible");expect(TIER_LABEL.desconocido).toBe("Precio no disponible");
  expect(formatPrice({...m,free:true,priceKnown:true,costTier:"gratis"})).toBe("Sin costo");
});
