// JSON backup of the whole menu (menu/data): download a copy, and read one
// back to restore it (MenuSettings.jsx) or to create the menu on a brand-new
// database (MenuBootstrap). Restoring replaces the menu on the server at
// once (MenuApp.jsx > handleRestore).

// Reads and validates a chosen .json file. Only checks the minimal shape
// needed to avoid crashing the app or saving corrupted data.
export function parseMenuJsonFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error("Nessun file selezionato.")); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("Il file non ha la struttura di un menù valido.");
        }
        if (!Array.isArray(data.categories)) {
          throw new Error("Il file non ha la struttura di un menù valido (manca 'categories').");
        }
        for (const cat of data.categories) {
          if (!cat || !Array.isArray(cat.items)) {
            throw new Error("Una categoria nel file non ha un elenco di voci ('items') valido.");
          }
        }
        resolve(data);
      } catch (err) {
        reject(err instanceof SyntaxError ? new Error("Il file non è un JSON valido.") : err);
      }
    };
    reader.onerror = () => reject(new Error("Impossibile leggere il file."));
    reader.readAsText(file);
  });
}

export function downloadMenuJson(menu) {
  const blob = new Blob([JSON.stringify(menu, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `menu-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
