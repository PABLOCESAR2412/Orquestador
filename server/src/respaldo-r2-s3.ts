import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream } from "node:fs";
import type { AlmacenRespaldosR2 } from "./respaldo-r2";

export type ConfiguracionR2Respaldos = {
  cuenta: string;
  bucket: string;
  claveAcceso: string;
  secreto: string;
  prefijo: string;
  conservar: number;
  conservarLocal: number;
};

const VARIABLES_R2 = [
  ["TELO_R2_ACCOUNT_ID", "cuenta"],
  ["TELO_R2_BUCKET", "bucket"],
  ["TELO_R2_ACCESS_KEY_ID", "clave de acceso"],
  ["TELO_R2_SECRET_ACCESS_KEY", "secreto de acceso"],
] as const;

export function leerConfiguracionR2Respaldos(entorno: NodeJS.ProcessEnv): ConfiguracionR2Respaldos | null {
  const valores = VARIABLES_R2.map(([nombre]) => entorno[nombre]?.trim() ?? "");
  if (valores.every((valor) => !valor)) return null;
  const faltantes = VARIABLES_R2.filter(([nombre]) => !entorno[nombre]?.trim()).map(([, etiqueta]) => etiqueta);
  if (faltantes.length) throw new Error(`configuración R2 incompleta; falta: ${faltantes.join(", ")}`);

  const [cuenta, bucket, claveAcceso, secreto] = valores as [string, string, string, string];
  const prefijoBase = (entorno.TELO_R2_PREFIX?.trim() || "respaldos").replace(/^\/+|\/+$/g, "");
  if (!prefijoBase || prefijoBase.split("/").includes("..") || /[\\\s]/.test(prefijoBase)) {
    throw new Error("TELO_R2_PREFIX debe ser una ruta simple dentro del bucket, por ejemplo respaldos");
  }
  const conservar = Number(entorno.TELO_R2_RESPALDOS_CONSERVAR || 1);
  if (!Number.isSafeInteger(conservar) || conservar < 1 || conservar > 100) {
    throw new Error("TELO_R2_RESPALDOS_CONSERVAR debe ser un entero entre 1 y 100");
  }
  const conservarLocal = Number(entorno.TELO_R2_RESPALDOS_LOCALES || 1);
  if (!Number.isSafeInteger(conservarLocal) || conservarLocal < 0 || conservarLocal > 100) {
    throw new Error("TELO_R2_RESPALDOS_LOCALES debe ser un entero entre 0 y 100");
  }
  return { cuenta, bucket, claveAcceso, secreto, prefijo: `${prefijoBase}/`, conservar, conservarLocal };
}

export function crearAlmacenR2Respaldos(config: ConfiguracionR2Respaldos): { almacen: AlmacenRespaldosR2; cerrar: () => void } {
  const cliente = new S3Client({
    region: "auto",
    endpoint: `https://${config.cuenta}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.claveAcceso, secretAccessKey: config.secreto },
  });

  const almacen: AlmacenRespaldosR2 = {
    async subirArchivo(clave, ruta, bytes) {
      const carga = new Upload({
        client: cliente,
        params: { Bucket: config.bucket, Key: clave, Body: createReadStream(ruta), ContentLength: bytes },
        partSize: 8 * 1024 * 1024,
        queueSize: 2,
        leavePartsOnError: false,
      });
      const resultado = await carga.done();
      return { etag: resultado.ETag };
    },
    async subirTexto(clave, contenido) {
      const resultado = await cliente.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: clave,
        Body: contenido,
        ContentType: "application/json; charset=utf-8",
        ContentLength: new TextEncoder().encode(contenido).byteLength,
      }));
      return { etag: resultado.ETag };
    },
    async revisar(clave) {
      const resultado = await cliente.send(new HeadObjectCommand({ Bucket: config.bucket, Key: clave }));
      return { bytes: resultado.ContentLength, etag: resultado.ETag };
    },
    async listar(prefijo, token) {
      const resultado = await cliente.send(new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefijo,
        ContinuationToken: token,
      }));
      if (resultado.IsTruncated && !resultado.NextContinuationToken) {
        throw new Error("R2 indicó más resultados sin entregar el cursor de paginación");
      }
      return {
        claves: (resultado.Contents ?? []).flatMap((objeto) => objeto.Key ? [objeto.Key] : []),
        siguienteToken: resultado.IsTruncated ? resultado.NextContinuationToken : undefined,
      };
    },
    async borrar(claves) {
      if (!claves.length) return;
      const resultado = await cliente.send(new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: { Objects: claves.map((Key) => ({ Key })), Quiet: true },
      }));
      if (resultado.Errors?.length) throw new Error(`R2 no pudo borrar ${resultado.Errors.length} objetos antiguos`);
    },
  };
  return { almacen, cerrar: () => cliente.destroy() };
}
