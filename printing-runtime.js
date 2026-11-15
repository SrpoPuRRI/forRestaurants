export default function createPrintingRuntime({ supabase, state, esc }) {
  let timer = null;
  let inFlight = false;
  let generation = 0;
  let activeRunId = null;
  let restaurantId = null;
  const seenRunIds = new Set();
  const queuedRuns = new Map();

  const errorLabel = (value) => ({
    printer_heartbeat_timeout: "La impresora dejó de responder.",
    printing_device_inactive: "La impresora estaba inactiva.",
    printing_device_not_linked: "El punto no tiene una impresora enlazada.",
    printing_point_inactive: "El punto de impresión está pausado.",
    manual_printing_view_pending: "La vista de impresión manual todavía no está implementada.",
    sunat_integration_pending: "La integración SUNAT todavía no está conectada.",
  }[value] || value || "No se pudo completar la impresión.");

  function syncDeviceLabels(devices) {
    state.printingDeviceStatuses = devices || [];
    for (const device of devices || []) {
      document.querySelectorAll(`[data-print-device-status="${CSS.escape(device.id)}"]`).forEach((element) => {
        element.classList.toggle("is-online", device.available);
        element.classList.toggle("is-offline", !device.available);
        const label = element.querySelector("[data-print-device-label]");
        if (label) label.textContent = device.available
          ? (device.operation_mode === "working" ? "Impresora trabajando" : "Impresora disponible")
          : "Impresora inactiva";
      });
    }
  }

  function renderRunReport(run) {
    if (document.querySelector("dialog[data-print-run-report]")) return;
    const tasks = run.tasks || [];
    const failed = Number(run.failed_count || tasks.filter((task) => task.status === "failed").length);
    const succeeded = Number(run.success_count || tasks.filter((task) => task.status === "success").length);
    const allSucceeded = failed === 0 && succeeded > 0;
    const details = tasks.map((task) => `<li class="printing-report-task ${task.status === "success" ? "is-success" : "is-failed"}"><span class="printing-report-mark">${task.status === "success" ? "✓" : "!"}</span><span><strong>${esc(task.point_name || "Punto de impresión")}</strong><small>${task.status === "success" ? "Impresión completada" : esc(errorLabel(task.error))}</small></span><b>${task.status === "success" ? "Lista" : "Falló"}</b></li>`).join("");
    const dialog = document.createElement("dialog");
    dialog.dataset.printRunReport = run.id;
    dialog.className = "password-dialog printing-run-report";
    dialog.innerHTML = `<div class="panel-title">${allSucceeded ? "Impresión completada" : "Resultado del flujo de impresión"}</div><p class="meta">${allSucceeded ? "La tarea de impresión fue completada exitosamente." : `Completadas: ${succeeded} · Fallidas: ${failed}`}</p>${allSucceeded ? "" : `<ul class="printing-report-list">${details}</ul>`}<p class="printing-report-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn primary" data-ack> Aceptar </button></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector("[data-ack]").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const { error } = await supabase.rpc("acknowledge_printing_flow_run", { p_run_id: run.id });
      if (error) {
        dialog.querySelector(".printing-report-error").textContent = error.message || "No se pudo cerrar el reporte.";
        button.disabled = false;
        return;
      }
      activeRunId = null;
      seenRunIds.delete(run.id);
      queuedRuns.delete(run.id);
      dialog.close();
      void poll();
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (activeRunId === run.id) activeRunId = null;
      showNextReport();
    }, { once: true });
    dialog.addEventListener("cancel", (event) => event.preventDefault());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) event.preventDefault();
    });
    activeRunId = run.id;
    dialog.showModal();
  }

  function showNextReport() {
    if (activeRunId || document.querySelector("dialog[data-print-run-report]")) return;
    const next = queuedRuns.values().next().value;
    if (next) renderRunReport(next);
  }

  async function poll() {
    if (!supabase || !state.user || inFlight || !(state.restaurantNeeds || []).includes("printing_systems")) return;
    inFlight = true;
    const pollGeneration = generation;
    try {
      const { data, error } = await supabase.rpc("operate_printing_web");
      if (error) throw error;
      if (pollGeneration !== generation) return;
      state.printingRuntimeError = "";
      syncDeviceLabels(data?.devices || []);
      for (const run of data?.completed_runs || []) {
        if (seenRunIds.has(run.id)) continue;
        seenRunIds.add(run.id);
        queuedRuns.set(run.id, run);
      }
      showNextReport();
    } catch (error) {
      if (pollGeneration !== generation) return;
      // Keep the five-second operation resilient; the next pass retries.
      state.printingRuntimeError = error?.message || "No se pudo actualizar el estado de impresión.";
    } finally {
      if (pollGeneration === generation) inFlight = false;
    }
  }

  function start() {
    if (!supabase || !state.restaurantId) return;
    if (restaurantId !== state.restaurantId) {
      stop();
      restaurantId = state.restaurantId;
      seenRunIds.clear();
      queuedRuns.clear();
    }
    if (timer) return;
    void poll();
    timer = setInterval(poll, 5000);
  }

  function stop() {
    generation += 1;
    if (timer) clearInterval(timer);
    timer = null;
    restaurantId = null;
    inFlight = false;
    activeRunId = null;
    seenRunIds.clear();
    queuedRuns.clear();
    state.printingDeviceStatuses = [];
    state.printingRuntimeError = "";
    document.querySelectorAll("dialog[data-print-run-report]").forEach((dialog) => dialog.close());
  }

  return { start, stop, poll };
}
