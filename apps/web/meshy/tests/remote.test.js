import test from "node:test";
import assert from "node:assert/strict";
import { fetchModel, detectFormat, modelURL } from "../src/remote.js";

const encode = (text) => new TextEncoder().encode(text).buffer;
const response = (body, url, init) => {
  const result = new Response(body, init);
  Object.defineProperty(result, "url", { value: url });
  return result;
};

test("URL input rejects non-network schemes and credentials", () => {
  for (const url of [
    "file:///model.glb",
    "javascript:alert(1)",
    "https://user:pass@host/model.glb",
    "relative.glb",
  ]) {
    assert.throws(() => modelURL(url), /HTTP\/HTTPS/);
  }
  assert.equal(
    modelURL("../mesh.bin", "https://host/path/model.gltf").href,
    "https://host/mesh.bin",
  );
});

test("format detection handles signed URLs, extensionless GLB and HTML errors", () => {
  const glb = new ArrayBuffer(12);
  new DataView(glb).setUint32(0, 0x46546c67, true);
  assert.equal(detectFormat(glb, "https://host/download?id=1"), "glb");
  assert.equal(detectFormat(encode("v 0 0 0"), "https://host/model.obj?token=1"), "obj");
  assert.equal(detectFormat(encode("solid cube"), "https://host/download"), "stl");
  assert.equal(detectFormat(encode("v 0 0 0"), "https://host/download", "obj"), "obj");
  assert.throws(
    () => detectFormat(encode("<!doctype html><html>"), "https://host/model.glb"),
    /HTML/,
  );
});

test("redirected glTF resolves sidecars against final URL and preserves resource keys", async () => {
  const calls = [];
  const doc = JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ uri: "mesh.bin" }],
    images: [{ uri: "../textures/a.png" }, { uri: "data:image/png;base64,AA==" }],
  });
  const result = await fetchModel("https://host/start", {
    fetcher: async (url, options) => {
      calls.push(url);
      assert.equal(options.credentials, "omit");
      assert.equal(options.mode, "cors");
      return response(
        calls.length === 1 ? doc : new Uint8Array([1, 2]),
        calls.length === 1 ? "https://cdn.test/assets/model.gltf" : url,
      );
    },
  });
  assert.deepEqual(calls, [
    "https://host/start",
    "https://cdn.test/assets/mesh.bin",
    "https://cdn.test/textures/a.png",
  ]);
  assert.equal(result.files[0].name, "model.gltf");
  assert.equal(result.resources.size, 2);
  assert.equal(result.resources.get("../textures/a.png").size, 2);
});

test("OBJ fetches MTL and normal map relative to the MTL directory", async () => {
  const calls = [];
  const result = await fetchModel("https://host/model.obj", {
    fetcher: async (url) => {
      calls.push(url);
      const body = url.endsWith(".obj")
        ? "mtllib materials/a.mtl\nv 0 0 0"
        : url.endsWith(".mtl")
          ? "newmtl body\nmap_Kd -s 1 1 1 ../color.png\nnorm ../normal.png"
          : "image";
      return response(body, url);
    },
  });
  assert.deepEqual(calls, [
    "https://host/model.obj",
    "https://host/materials/a.mtl",
    "https://host/color.png",
    "https://host/normal.png",
  ]);
  assert.match(result.mtlText, /map_Kd -s 1 1 1 https:\/\/host\/color.png/);
  assert.equal(result.resources.size, 2);
});

test("HTTP and network errors are actionable", async () => {
  await assert.rejects(
    fetchModel("https://host/model.glb", {
      fetcher: async () => response("", "https://host/model.glb", { status: 404 }),
    }),
    /HTTP 404/,
  );
  await assert.rejects(
    fetchModel("https://host/model.glb", {
      fetcher: async () => {
        throw new TypeError("Failed to fetch");
      },
    }),
    /CORS/,
  );
});

test("byte budget counts sidecars and does not trust missing Content-Length", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(4));
      controller.enqueue(new Uint8Array(4));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    fetchModel("https://host/model.ply", {
      maxBytes: 6,
      fetcher: async () => response(stream, "https://host/model.ply"),
    }),
    /лимит/,
  );
  assert.ok(cancelled);
  const doc = JSON.stringify({ buffers: [{ uri: "mesh.bin" }] });
  await assert.rejects(
    fetchModel("https://host/model.gltf", {
      maxBytes: doc.length + 2,
      fetcher: async (url) => response(url.endsWith(".gltf") ? doc : "123", url),
    }),
    /лимит/,
  );
});

test("abort prevents requests and is preserved as cancellation", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("Cancelled", "AbortError"));
  let fetched = false;
  await assert.rejects(
    fetchModel("https://host/model.glb", {
      signal: controller.signal,
      fetcher: async () => {
        fetched = true;
      },
    }),
    { name: "AbortError" },
  );
  assert.equal(fetched, false);
});

test("animation downloads accept FBX and glTF, reject static formats, and share the byte budget", async () => {
  const fbx = await fetchModel("https://host/walk.fbx?download=1", {
    animation: true,
    fetcher: async (url) => response("; FBX 7.4.0 project file", url),
  });
  assert.equal(fbx.files[0].name, "walk.fbx");
  assert.equal(fbx.resources.size, 0);
  await assert.rejects(
    fetchModel("https://host/model.obj", {
      animation: true,
      fetcher: async (url) => response("v 0 0 0", url),
    }),
    /GLB.*glTF.*FBX/,
  );
  await assert.rejects(
    fetchModel("https://host/walk.fbx", {
      animation: true,
      maxBytes: 5,
      fetcher: async (url) => response("; FBX 7.4.0 project file", url),
    }),
    /лимит/,
  );
});

test("animation glTF only downloads motion buffers, never appearance-only images", async () => {
  const calls = [];
  const json = JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ uri: "motion.bin" }],
    images: [{ uri: "private-texture.png" }],
  });
  await fetchModel("https://host/motion.gltf", {
    animation: true,
    fetcher: async (url) => {
      calls.push(url);
      return response(url.endsWith(".gltf") ? json : "bin", url);
    },
  });
  assert.deepEqual(calls, ["https://host/motion.gltf", "https://host/motion.bin"]);
});
