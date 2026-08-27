// Upload immagini piatti su Cloudinary (upload "unsigned": il browser carica
// direttamente sul bucket Cloudinary, senza passare da un server nostro).
// Richiede due variabili d'ambiente, prese dalla console Cloudinary:
//   VITE_CLOUDINARY_CLOUD_NAME   → nome del cloud (in alto a destra nel Dashboard)
//   VITE_CLOUDINARY_UPLOAD_PRESET → nome di un upload preset "Unsigned"
// Vedi GUIDA.md per i passaggi di configurazione.

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB, margine ampio per foto da telefono

// Carica un file immagine su Cloudinary e restituisce il suo URL pubblico
// (già ottimizzato in fase di consegna tramite optimizedImageUrl, non in upload).
export async function uploadMenuImage(file) {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error("Upload immagini non configurato (mancano le variabili Cloudinary in .env).");
  }
  if (!file.type || !file.type.startsWith("image/")) {
    throw new Error("Il file scelto non è un'immagine.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Immagine troppo grande (massimo 8 MB).");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);
  formData.append("folder", "menu");

  let res;
  try {
    res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: "POST",
      body: formData,
    });
  } catch {
    throw new Error("Caricamento non riuscito: controlla la connessione e riprova.");
  }

  if (!res.ok) {
    throw new Error("Caricamento non riuscito: riprova tra poco.");
  }

  const data = await res.json();
  return data.secure_url;
}

// Costruisce un URL di consegna ottimizzato (formato moderno + compressione
// automatica + ridimensionamento) a partire da un secure_url di Cloudinary,
// inserendo i parametri di trasformazione dopo "/upload/". Se l'URL non è di
// Cloudinary (es. incollato a mano da un altro sito), viene restituito invariato.
export function optimizedImageUrl(url, { width } = {}) {
  if (!url || !url.includes("/upload/")) return url;
  const transforms = ["f_auto", "q_auto"];
  if (width) transforms.push(`w_${width}`, "dpr_auto");
  return url.replace("/upload/", `/upload/${transforms.join(",")}/`);
}
