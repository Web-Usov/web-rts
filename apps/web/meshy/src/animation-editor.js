import { JOINTS } from "./rigging.ts";
import { autoBoneMap, rigBones, retargetHumanoid } from "./retarget.ts";
import { loadAnimationFiles } from "./animation-loader.js";
import { fetchModel } from "./remote.js";
import { disposeModel } from "./loaders.js";

const libraryURL = new URL("../assets/quaternius-standard.glb", import.meta.url).href;
const labels = {
  Idle_Loop: "Ожидание",
  Walk_Loop: "Ходьба",
  Jog_Fwd_Loop: "Бег трусцой",
  Sprint_Loop: "Спринт",
  Sword_Attack: "Удар мечом",
  Sword_Attack_RM: "Удар мечом с перемещением",
  Sword_Idle: "Стойка с мечом",
  Jump_Start: "Начало прыжка",
  Jump_Loop: "В воздухе",
  Jump_Land: "Приземление",
  Death01: "Смерть",
  Dance_Loop: "Танец",
  Crouch_Idle_Loop: "Ожидание сидя",
  Crouch_Fwd_Loop: "Ходьба пригнувшись",
  Punch_Jab: "Прямой удар",
  Punch_Cross: "Удар другой рукой",
  Punch_Enter: "Боевая стойка",
};

export function createAnimationEditor({ getModel, loading, message, beforeApply, addClip }) {
  const $ = (id) => document.getElementById(id);
  let librarySource = false;
  let source = null,
    targetMap = {},
    sourceMap = {},
    targetBones = [],
    busy = false,
    controller = null;
  const status = (text) => ($("motion-status").textContent = text);
  function filterClips() {
    if (!source) return;
    const query = $("motion-search").value.trim().toLocaleLowerCase("ru");
    const category = $("motion-category").value;
    const group = (name) =>
      /Sword|Punch|Pistol|Hit|Spell/.test(name)
        ? "combat"
        : /Walk|Jog|Sprint|Jump|Swim|Roll|Crouch_Fwd/.test(name)
          ? "move"
          : /Idle|Talking/.test(name)
            ? "idle"
            : "other";
    const selected = $("motion-clip").value;
    $("motion-clip").replaceChildren();
    source.animations.forEach((clip, index) => {
      if (librarySource && clip.name === "A_TPose") return;
      const name = labels[clip.name] ?? clip.name;
      if (category !== "all" && group(clip.name) !== category) return;
      if (query && !`${name} ${clip.name}`.toLocaleLowerCase("ru").includes(query)) return;
      $("motion-clip").append(new Option(`${name} · ${clip.duration.toFixed(1)} с`, index));
    });
    if ([...$("motion-clip").options].some((option) => option.value === selected))
      $("motion-clip").value = selected;
    $("motion-results").textContent = $("motion-clip").options.length
      ? `Найдено: ${$("motion-clip").options.length}`
      : "Ничего не найдено. Измените запрос или категорию.";
    controlsState();
  }
  $("motion-search").addEventListener("input", filterClips);
  $("motion-category").addEventListener("change", filterClips);
  function controlsState() {
    for (const id of [
      "motion-library",
      "motion-open",
      "motion-download",
      "motion-clip",
      "motion-yaw",
      "motion-in-place",
      "motion-auto-map",
      "motion-url",
      "motion-format",
      "motion-search",
      "motion-category",
    ])
      $(id).disabled = busy;
    $("motion-apply").disabled =
      busy || !source || !targetBones.length || !$("motion-clip").options.length;
    $("motion-transfer").hidden = !source;
    $("motion-map-rows")
      .querySelectorAll("select")
      .forEach((s) => (s.disabled = busy));
  }
  function summary() {
    const count = JOINTS.filter(([role]) => sourceMap[role] && targetMap[role]).length;
    $("motion-map-summary").textContent = `Сопоставление костей · ${count}/22`;
  }
  function selector(bones, mapping, role, label) {
    const select = document.createElement("select");
    select.setAttribute("aria-label", `${label}: ${JOINTS.find((j) => j[0] === role)[1]}`);
    select.append(new Option("— Не сопоставлена —", ""));
    for (const bone of bones) select.append(new Option(bone.name, bone.name));
    select.value = mapping[role] ?? "";
    select.addEventListener("change", () => {
      mapping[role] = select.value;
      summary();
    });
    return select;
  }
  function renderMapping() {
    $("motion-map-rows").replaceChildren();
    if (!source) return;
    const sourceBones = rigBones(source.root);
    for (const [role, label] of JOINTS) {
      const row = document.createElement("div");
      row.className = "motion-map-row";
      const title = document.createElement("span");
      title.textContent = label;
      row.append(
        title,
        selector(targetBones, targetMap, role, "Персонаж"),
        selector(sourceBones, sourceMap, role, "Источник"),
      );
      $("motion-map-rows").append(row);
    }
    summary();
    controlsState();
  }
  function modelChanged() {
    targetBones = [];
    targetMap = {};
    try {
      if (getModel()) {
        targetBones = rigBones(getModel().root, true);
        targetMap = autoBoneMap(getModel().root);
      }
      status(source ? "Выберите клип и примените его к персонажу." : "");
    } catch (error) {
      status(error.message);
    }
    renderMapping();
    controlsState();
  }
  async function loadSource(files, label, signal) {
    const next = await loadAnimationFiles(files.files ?? files, files);
    if (signal?.aborted) {
      disposeModel(next.root);
      signal.throwIfAborted();
    }
    if (source) disposeModel(source.root);
    source = next;
    librarySource = label === "Quaternius Standard";
    sourceMap = autoBoneMap(source.root);
    $("motion-clip").replaceChildren();
    source.animations.forEach((clip, i) => {
      // The bind-pose reference is not an action in the built-in catalogue.
      if (label === "Quaternius Standard" && clip.name === "A_TPose") return;
      $("motion-clip").append(
        new Option(
          label === "Quaternius Standard"
            ? `${labels[clip.name] ?? clip.name} · ${clip.duration.toFixed(1)} с`
            : clip.name || `Клип ${i + 1}`,
          i,
        ),
      );
    });
    if (label === "Quaternius Standard")
      $("motion-clip").value = String(source.animations.findIndex((c) => c.name === "Idle_Loop"));
    $("motion-source-status").textContent =
      `${label ?? next.file.name} · ${$("motion-clip").options.length} клипов`;
    $("motion-search").value = "";
    $("motion-category").value = "all";
    filterClips();
    $("motion-sources").open = false;
    modelChanged();
  }
  async function runLoad(getFiles, label, signal) {
    if (busy) return;
    loading(true, "Загружаем анимации…");
    status("Загружаем источник…");
    try {
      await loadSource(await getFiles(), label, signal);
    } catch (error) {
      const text = signal?.aborted ? "Загрузка анимации отменена." : error.message;
      status(text);
      message(text, !signal?.aborted);
    } finally {
      loading(false);
      $("motion-file").value = "";
    }
  }
  $("motion-library").addEventListener("click", () =>
    runLoad(() => fetchModel(libraryURL, { animation: true }), "Quaternius Standard"),
  );
  $("motion-open").addEventListener("click", () => $("motion-file").click());
  $("motion-file").addEventListener("change", (event) => runLoad(() => event.target.files));
  $("motion-download").addEventListener("click", async () => {
    if (busy) return;
    controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
    $("motion-cancel").hidden = false;
    await runLoad(
      () =>
        fetchModel($("motion-url").value.trim(), {
          animation: true,
          format: $("motion-format").value,
          signal,
          onProgress: ({ bytes }) => status(`Скачано ${(bytes / 1024 / 1024).toFixed(1)} МБ…`),
        }),
      null,
      signal,
    );
    $("motion-cancel").hidden = true;
    controller = null;
  });
  $("motion-cancel").addEventListener("click", () => controller?.abort());
  $("motion-auto-map").addEventListener("click", () => {
    if (!source || !targetBones.length || busy) return;
    targetMap = autoBoneMap(getModel().root);
    sourceMap = autoBoneMap(source.root);
    renderMapping();
  });
  $("motion-apply").addEventListener("click", async () => {
    if (busy || !source) return;
    loading(true, "Переносим движение…");
    status("Переносим движение на скелет персонажа…");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      beforeApply();
      const clip = source.animations[Number($("motion-clip").value)];
      const next = retargetHumanoid(source.root, getModel().root, clip, {
        sourceMap,
        targetMap,
        inPlace: $("motion-in-place").checked,
        yaw: (Number($("motion-yaw").value) * Math.PI) / 180,
        name: `Импорт: ${clip.name || "Анимация"}`,
      });
      addClip(next);
      status(`Применено: ${clip.name}. Клип добавлен к персонажу и готов к экспорту GLB/glTF.`);
      message("Анимация применена к персонажу.");
    } catch (error) {
      status(error.message);
      message(error.message, true);
    } finally {
      loading(false);
    }
  });
  controlsState();
  return {
    modelChanged,
    setBusy(value) {
      busy = value;
      controlsState();
    },
  };
}
