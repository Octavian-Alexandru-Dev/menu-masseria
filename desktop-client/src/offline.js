const params = new URLSearchParams(location.search);
document.getElementById("detail").textContent = [params.get("url"), params.get("error")].filter(Boolean).join(" — ");
document.getElementById("retry").addEventListener("click", () => window.mdpDesktop.reloadApp());
document.getElementById("settings").addEventListener("click", () => window.mdpDesktop.openSettings());
// Comes back on its own as soon as the connection does.
setInterval(() => { if (navigator.onLine) window.mdpDesktop.reloadApp(); }, 30_000);
