// Interoperability decoder based on the MIT-licensed clean-room format research:
// https://github.com/Amal-David/meshy2glb
const MAGIC = "MESHY.AI";
const KEY = 'JSON{"accessors":[{"bufferView":';
const PREFIX_SIZE = 8192;
const HEADER_SIZE = 32;
const TAG_SIZE = 16;

export function isMeshy(buffer) {
  return buffer.byteLength >= 8 && new TextDecoder().decode(new Uint8Array(buffer, 0, 8)) === MAGIC;
}

export async function decodeMeshy(buffer) {
  if (!isMeshy(buffer)) throw new Error("В файле нет заголовка MESHY.AI.");
  if (buffer.byteLength < HEADER_SIZE + PREFIX_SIZE + TAG_SIZE)
    throw new Error("Файл .meshy обрезан или повреждён.");
  const header = new DataView(buffer);
  if (header.getUint16(8, true) !== 1)
    throw new Error("Эта версия .meshy пока не поддерживается. Ожидается версия 1.");
  if (!globalThis.crypto?.subtle)
    throw new Error(
      "Декодирование .meshy требует HTTPS, localhost или открытия локального HTML-файла.",
    );
  const bytes = new Uint8Array(buffer);
  const counter = new Uint8Array(16);
  counter.set(bytes.subarray(10, 22));
  counter[15] = 2;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(KEY),
    { name: "AES-CTR" },
    false,
    ["decrypt"],
  );
  const prefix = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-CTR", counter, length: 32 },
      key,
      bytes.subarray(HEADER_SIZE, HEADER_SIZE + PREFIX_SIZE),
    ),
  );
  if (new DataView(prefix.buffer).getUint32(0, true) !== 0x46546c67)
    throw new Error("Не удалось прочитать модель внутри .meshy. Возможно, формат изменился.");
  const tail = bytes.subarray(HEADER_SIZE + PREFIX_SIZE + TAG_SIZE);
  const result = new Uint8Array(PREFIX_SIZE + tail.length);
  result.set(prefix);
  result.set(tail, PREFIX_SIZE);
  new DataView(result.buffer).setUint32(8, result.length, true);
  return result.buffer;
}
