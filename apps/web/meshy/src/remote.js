import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { decodeMeshy, isMeshy } from "./meshy.js";

const FORMATS = ["meshy", "glb", "gltf", "obj", "stl", "ply"];
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_RESOURCES = 128;

export function modelURL(value, base) {
  let url;
  try {
    url = new URL(value, base);
  } catch {
    throw new Error("Введите полную HTTP/HTTPS-ссылку на модель.");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Поддерживаются HTTP/HTTPS-ссылки без логина и пароля.");
  }
  return url;
}

export function detectFormat(buffer, url, format = "auto") {
  if (format !== "auto") {
    if (!FORMATS.includes(format)) throw new Error("Неизвестный формат модели.");
    return format;
  }
  if (isMeshy(buffer)) return "meshy";
  if (buffer.byteLength >= 4 && new DataView(buffer).getUint32(0, true) === 0x46546c67)
    return "glb";
  const text = new TextDecoder()
    .decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096)))
    .trimStart();
  if (/^(<!doctype html|<html)/i.test(text))
    throw new Error("По ссылке получена HTML-страница. Нужна прямая ссылка на файл модели.");
  if (text.startsWith("{")) return "gltf";
  if (/^ply\s/.test(text)) return "ply";
  const extension = new URL(url).pathname.split(".").pop().toLowerCase();
  if (FORMATS.includes(extension)) return extension;
  if (/^solid\s/.test(text)) return "stl";
  throw new Error("Не удалось определить формат. Укажите его в списке «Формат».");
}

function gltfDocument(buffer) {
  if (new DataView(buffer).getUint32(0, true) !== 0x46546c67) {
    return JSON.parse(new TextDecoder().decode(buffer));
  }
  const view = new DataView(buffer);
  if (
    buffer.byteLength < 20 ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    view.getUint32(12, true) > buffer.byteLength - 20
  ) {
    throw new Error("Повреждён JSON-блок GLB.");
  }
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, view.getUint32(12, true))));
}

// All network resources pass through the same byte budget and cancellation signal.
// GLTFLoader/MTLLoader receive only prefetched blobs and cannot start unchecked fetches.
export async function fetchModel(
  value,
  {
    format = "auto",
    signal,
    onProgress = () => {},
    fetcher = globalThis.fetch,
    maxBytes = MAX_BYTES,
  } = {},
) {
  const requested = modelURL(value);
  const resources = new Map(),
    fetched = new Map();
  let total = 0;
  async function read(url) {
    signal?.throwIfAborted();
    const key = modelURL(url).href;
    if (fetched.has(key)) return fetched.get(key);
    if (fetched.size >= MAX_RESOURCES)
      throw new Error("В модели слишком много связанных файлов (максимум 128).");
    let response;
    try {
      response = await fetcher(key, {
        signal,
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw new Error(
        "Скачать файл не удалось. Проверьте ссылку, доступность сервера и разрешение CORS.",
        { cause: error },
      );
    }
    if (!response.ok)
      throw new Error(
        `Сервер вернул HTTP ${response.status}. Проверьте прямую ссылку и доступ к файлу.`,
      );
    const advertised = Number(response.headers.get("content-length"));
    if (advertised > maxBytes - total) {
      await response.body?.cancel();
      throw new Error("Модель со связанными файлами превышает лимит 200 МБ.");
    }
    const reader = response.body?.getReader(),
      chunks = [];
    let length = 0;
    try {
      if (reader) {
        while (true) {
          signal?.throwIfAborted();
          const { done, value: chunk } = await reader.read();
          if (done) break;
          total += chunk.byteLength;
          length += chunk.byteLength;
          if (total > maxBytes)
            throw new Error("Модель со связанными файлами превышает лимит 200 МБ.");
          chunks.push(chunk);
          onProgress({ bytes: total, resources: fetched.size + 1 });
        }
      } else {
        const chunk = new Uint8Array(await response.arrayBuffer());
        total += chunk.byteLength;
        length = chunk.byteLength;
        if (total > maxBytes)
          throw new Error("Модель со связанными файлами превышает лимит 200 МБ.");
        chunks.push(chunk);
      }
    } catch (error) {
      await reader?.cancel().catch(() => {});
      throw error;
    } finally {
      reader?.releaseLock();
    }
    signal?.throwIfAborted();
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const result = {
      bytes,
      url: modelURL(response.url || key).href,
      type: response.headers.get("content-type") || "application/octet-stream",
    };
    fetched.set(key, result);
    return result;
  }
  const source = await read(requested.href);
  const extension = detectFormat(source.bytes.buffer, source.url, format);
  let name;
  try {
    name = decodeURIComponent(new URL(source.url).pathname.split("/").pop()) || "model";
  } catch {
    name = "model";
  }
  if (!name.toLowerCase().endsWith(`.${extension}`)) name += `.${extension}`;
  const file = new File([source.bytes], name, { type: source.type });
  async function resource(uri, base) {
    if (uri.startsWith("data:")) return;
    const result = await read(modelURL(uri, base).href);
    resources.set(uri, new Blob([result.bytes], { type: result.type }));
  }
  let mtlText;
  if (["meshy", "glb", "gltf"].includes(extension)) {
    const buffer = isMeshy(source.bytes.buffer)
      ? await decodeMeshy(source.bytes.buffer)
      : source.bytes.buffer;
    const json = gltfDocument(buffer);
    for (const entry of [...(json.buffers || []), ...(json.images || [])]) {
      if (entry.uri) await resource(entry.uri, source.url);
    }
  } else if (extension === "obj") {
    const obj = new TextDecoder().decode(source.bytes);
    const mtlNames = [...obj.matchAll(/^\s*mtllib\s+(.+)$/gm)].flatMap((match) =>
      match[1].trim().split(/\s+/),
    );
    const texts = [];
    for (const mtlName of new Set(mtlNames)) {
      const mtl = await read(modelURL(mtlName, source.url).href);
      const lines = new TextDecoder().decode(mtl.bytes).split(/\r?\n/);
      const parser = new MTLLoader().parse("", "");
      for (let i = 0; i < lines.length; i++) {
        const match = /^\s*(map_kd|map_ks|map_ke|norm|map_bump|bump|disp|map_d)\s+(.+)$/i.exec(
          lines[i],
        );
        if (!match) continue;
        const texture = parser.getTextureParams(match[2], {}).url;
        const absolute = texture.startsWith("data:") ? texture : modelURL(texture, mtl.url).href;
        await resource(absolute, mtl.url);
        lines[i] = `${match[1]} ${match[2].slice(0, match[2].lastIndexOf(texture))}${absolute}`;
      }
      texts.push(lines.join("\n"));
    }
    if (texts.length) mtlText = texts.join("\n");
  }
  signal?.throwIfAborted();
  return { files: [file], resources, mtlText };
}
